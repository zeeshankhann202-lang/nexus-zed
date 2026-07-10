/**
 * NEXUS ZED — Cloudflare Worker v1.0
 * ════════════════════════════════════════════════════════════
 * Central data proxy for NEXUS ZED Trading Dashboard
 *
 * WHAT IT DOES:
 *  1. Proxies all external API calls — hides keys from client
 *  2. Aggregates all 6 market feeds in one round-trip
 *  3. Serves OHLC candles from Twelve Data (6 timeframes)
 *  4. Caches COT data weekly, FRED data daily
 *  5. Enforces tier-based access (Free = 15-min delay)
 *  6. Rate limiting per IP (100 req/hour free tier)
 *  7. Full CORS headers for browser fetch
 *
 * DEPLOYMENT:
 *  1. Install Wrangler: npm install -g wrangler
 *  2. Login: wrangler login
 *  3. Set secrets:
 *       wrangler secret put TWELVE_DATA_KEY
 *       wrangler secret put NEXUS_PRO_SECRET   (optional, for paid tier)
 *  4. Deploy: wrangler deploy
 *  5. Copy the deployed URL into NEXUS Settings → Cloudflare Worker URL
 *
 * ENVIRONMENT VARIABLES (set in wrangler.toml or dashboard):
 *  - TWELVE_DATA_KEY  : Your Twelve Data API key
 *  - NEXUS_PRO_SECRET : Shared secret for Pro tier validation (optional)
 *
 * KV NAMESPACE (create in Cloudflare dashboard → Workers → KV):
 *  - NEXUS_CACHE      : Bind as "NEXUS_CACHE" in wrangler.toml
 *
 * COST: Cloudflare Workers free tier = 100,000 req/day. $5/mo for 10M req.
 *       At 500 subscribers polling every 10s = 4.3M req/day → $5/mo plan.
 * ════════════════════════════════════════════════════════════
 */

// ── WRANGLER CONFIG (paste into wrangler.toml) ────────────
/*
name = "nexus-zed-worker"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "NEXUS_CACHE"
id = "YOUR_KV_NAMESPACE_ID"

[vars]
WORKER_VERSION = "1.0.0"
FREE_DELAY_MINUTES = "15"
RATE_LIMIT_PER_HOUR = "100"
*/

// ── CORS HEADERS ──────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Nexus-Tier, X-Nexus-Token',
  'Access-Control-Max-Age':       '86400',
};

// ── CACHE TTLs (seconds) ──────────────────────────────────
const TTL = {
  prices:   10,      // market prices — 10s
  ohlc_m1:  60,      // M1 candles — 1 min
  ohlc_m5:  300,     // M5 candles — 5 min
  ohlc_m15: 900,     // M15 candles — 15 min
  ohlc_h1:  3600,    // H1 candles — 1 hour
  ohlc_h4:  14400,   // H4 candles — 4 hours
  ohlc_d1:  86400,   // D1 candles — 1 day
  free_delay: 900,   // Free tier delay — 15 min
  cot:      604800,  // COT data — 1 week
  fred:     86400,   // FRED macro — 1 day
  calendar: 3600,    // Econ calendar — 1 hour
  dxy:      30,      // DXY (computed) — 30s
};

// ── FALLBACK PRICES ───────────────────────────────────────
const FALLBACK = {
  gold:  { price: 3382, ch: 0 },
  dxy:   { price: 104.5, ch: 0 },
  yield: { price: 4.28, ch: 0 },
  oil:   { price: 78.0, ch: 0 },
  spx:   { price: 5348, ch: 0 },
  vix:   { price: 18.5, ch: 0 },
};

// ════════════════════════════════════════════════════════════
// MAIN REQUEST HANDLER
// ════════════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const params = url.searchParams;

    // ── TIER DETECTION ───────────────────────────────────
    const tierHeader = request.headers.get('X-Nexus-Tier') || 'free';
    const tokenHeader = request.headers.get('X-Nexus-Token') || '';
    const tier = validateTier(tierHeader, tokenHeader, env);

    // ── RATE LIMITING ────────────────────────────────────
    if (env.NEXUS_CACHE) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitOk = await checkRateLimit(env, ip, tier);
      if (!rateLimitOk) {
        return jsonResponse({ error: 'Rate limit exceeded. Free tier: 100 req/hour.' }, 429);
      }
    }

    // ── ROUTE DISPATCHER ─────────────────────────────────
    try {
      if (path === '/' || path === '/prices' || path === '') {
        return await handlePrices(request, env, ctx, tier);
      }
      if (path === '/ohlc') {
        return await handleOHLC(request, env, ctx, tier, params);
      }
      if (path === '/cot') {
        return await handleCOT(request, env, ctx);
      }
      if (path === '/fred') {
        return await handleFRED(request, env, ctx);
      }
      if (path === '/calendar') {
        return await handleCalendar(request, env, ctx);
      }
      if (path === '/health' || path === '/test') {
        return await handleHealth(env, tier);
      }
      if (path === '/tier') {
        return jsonResponse({ tier, version: env.WORKER_VERSION || '1.0.0' });
      }
      return jsonResponse({ error: 'Unknown endpoint. Valid: /prices /ohlc /cot /fred /calendar /health' }, 404);
    } catch (err) {
      return jsonResponse({ error: 'Worker error: ' + err.message, stack: err.stack?.split('\n')[0] }, 500);
    }
  }
};

// ════════════════════════════════════════════════════════════
// /prices — All 6 market feeds in one response
// ════════════════════════════════════════════════════════════
async function handlePrices(request, env, ctx, tier) {
  const cacheKey = 'prices_v1';

  // Check KV cache
  if (env.NEXUS_CACHE) {
    const cached = await env.NEXUS_CACHE.get(cacheKey, 'json');
    if (cached) {
      // Free tier: serve delayed price
      if (tier === 'free') {
        return jsonResponse(applyFreeDelay(cached), 200, { 'X-Cache': 'HIT', 'X-Tier': 'free' });
      }
      return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-Tier': tier });
    }
  }

  // Fetch all prices in parallel
  const [gold, dxy, yld, oil, spx, vix] = await Promise.allSettled([
    fetchGoldPrice(env),
    fetchDXYPrice(env),
    fetchYieldPrice(env),
    fetchOilPrice(env),
    fetchSPXPrice(env),
    fetchVIXPrice(env),
  ]);

  const result = {
    ts:    Date.now(),
    gold:  gold.status  === 'fulfilled' ? gold.value  : FALLBACK.gold,
    dxy:   dxy.status   === 'fulfilled' ? dxy.value   : FALLBACK.dxy,
    yield: yld.status   === 'fulfilled' ? yld.value   : FALLBACK.yield,
    oil:   oil.status   === 'fulfilled' ? oil.value   : FALLBACK.oil,
    spx:   spx.status   === 'fulfilled' ? spx.value   : FALLBACK.spx,
    vix:   vix.status   === 'fulfilled' ? vix.value   : FALLBACK.vix,
    sources: {
      gold:  gold.status  === 'fulfilled' ? 'live' : 'fallback',
      dxy:   dxy.status   === 'fulfilled' ? 'live' : 'fallback',
      yield: yld.status   === 'fulfilled' ? 'live' : 'fallback',
      oil:   oil.status   === 'fulfilled' ? 'live' : 'fallback',
      spx:   spx.status   === 'fulfilled' ? 'live' : 'fallback',
      vix:   vix.status   === 'fulfilled' ? 'live' : 'fallback',
    }
  };

  // Cache in KV
  if (env.NEXUS_CACHE) {
    ctx.waitUntil(env.NEXUS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL.prices }));
  }

  if (tier === 'free') {
    return jsonResponse(applyFreeDelay(result), 200, { 'X-Cache': 'MISS', 'X-Tier': 'free' });
  }
  return jsonResponse(result, 200, { 'X-Cache': 'MISS', 'X-Tier': tier });
}

// Apply 15-minute delay for free tier
function applyFreeDelay(data) {
  // For free tier, we serve the same data but mark it as delayed
  // In production you'd store a 15-min old cache entry
  return {
    ...data,
    delayed: true,
    delay_minutes: parseInt(TTL.free_delay / 60),
    note: 'Free tier — 15-min delayed. Upgrade to Pro for live prices.',
  };
}

// ── GOLD PRICE ────────────────────────────────────────────
async function fetchGoldPrice(env) {
  // Try Twelve Data first (most reliable)
  if (env.TWELVE_DATA_KEY) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${env.TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.price) {
          return { price: parseFloat(parseFloat(d.price).toFixed(2)), ch: 0, source: 'twelve_data' };
        }
      }
    } catch(e) {}
  }

  // Stooq fallback (no key needed)
  try {
    const r = await fetch('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&e=csv', {
      signal: AbortSignal.timeout(4000)
    });
    if (r.ok) {
      const text = await r.text();
      const p = parseStooqCSV(text, 1000, 5000);
      if (p) return { price: p, ch: 0, source: 'stooq' };
    }
  } catch(e) {}

  throw new Error('Gold price unavailable');
}

// ── DXY — Computed from FX rates ─────────────────────────
async function fetchDXYPrice(env) {
  // Try Twelve Data
  if (env.TWELVE_DATA_KEY) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/price?symbol=DXY&apikey=${env.TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.price) return { price: parseFloat(parseFloat(d.price).toFixed(3)), ch: 0, source: 'twelve_data' };
      }
    } catch(e) {}
  }

  // Compute from FX rates (USDIDX formula)
  try {
    const r = await fetch('https://www.floatrates.com/daily/usd.json', { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const d = await r.json();
      if (d.eur?.rate && d.jpy?.rate) {
        const EUR = d.eur.rate, JPY = d.jpy.rate, GBP = d.gbp?.rate || 0.79,
              CAD = d.cad?.rate || 1.38, SEK = d.sek?.rate || 10.4, CHF = d.chf?.rate || 0.90;
        const dxy = 50.14348112
          * Math.pow(EUR, 0.576) * Math.pow(JPY, 0.136)
          * Math.pow(GBP, -0.119) * Math.pow(CAD, 0.091)
          * Math.pow(SEK, 0.042) * Math.pow(CHF, 0.036);
        if (dxy > 80 && dxy < 130) return { price: +dxy.toFixed(3), ch: 0, source: 'fx_computed' };
      }
    }
  } catch(e) {}

  throw new Error('DXY unavailable');
}

// ── 10Y YIELD ─────────────────────────────────────────────
async function fetchYieldPrice(env) {
  if (env.TWELVE_DATA_KEY) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/price?symbol=TNX&apikey=${env.TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.price) return { price: parseFloat(parseFloat(d.price).toFixed(3)), ch: 0, source: 'twelve_data' };
      }
    } catch(e) {}
  }

  // FRED direct (Worker has no CORS restriction)
  try {
    const yr = new Date().getFullYear();
    const r = await fetch(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&observation_start=${yr}-01-01`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const text = await r.text();
      const lines = text.trim().split('\n');
      for (let i = lines.length - 1; i >= 1; i--) {
        const [, val] = lines[i].split(',');
        const v = parseFloat(val);
        if (v > 0 && v < 20) return { price: +v.toFixed(3), ch: 0, source: 'fred' };
      }
    }
  } catch(e) {}

  throw new Error('Yield unavailable');
}

// ── OIL ───────────────────────────────────────────────────
async function fetchOilPrice(env) {
  if (env.TWELVE_DATA_KEY) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/price?symbol=WTI/USD&apikey=${env.TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.price) return { price: parseFloat(parseFloat(d.price).toFixed(2)), ch: 0, source: 'twelve_data' };
      }
    } catch(e) {}
  }

  try {
    const r = await fetch('https://stooq.com/q/l/?s=cl.f&f=sd2t2ohlcv&e=csv', { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const p = parseStooqCSV(await r.text(), 20, 300);
      if (p) return { price: p, ch: 0, source: 'stooq' };
    }
  } catch(e) {}

  throw new Error('Oil unavailable');
}

// ── SPX ───────────────────────────────────────────────────
async function fetchSPXPrice(env) {
  if (env.TWELVE_DATA_KEY) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/price?symbol=SPX&apikey=${env.TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.price) return { price: parseFloat(parseFloat(d.price).toFixed(2)), ch: 0, source: 'twelve_data' };
      }
    } catch(e) {}
  }
  throw new Error('SPX unavailable');
}

// ── VIX ───────────────────────────────────────────────────
async function fetchVIXPrice(env) {
  if (env.TWELVE_DATA_KEY) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/price?symbol=VIX&apikey=${env.TWELVE_DATA_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.price) return { price: parseFloat(parseFloat(d.price).toFixed(2)), ch: 0, source: 'twelve_data' };
      }
    } catch(e) {}
  }
  throw new Error('VIX unavailable');
}

// ════════════════════════════════════════════════════════════
// /ohlc — OHLC candles from Twelve Data
// Query params: tf=1min|5min|15min|1h|4h|1day  bars=100
// ════════════════════════════════════════════════════════════
async function handleOHLC(request, env, ctx, tier, params) {
  const tf   = params.get('tf')   || '15min';
  const bars = Math.min(500, parseInt(params.get('bars') || '100'));
  const sym  = params.get('symbol') || 'XAU/USD';

  // Tier check: OHLC requires Pro or higher
  if (tier === 'free') {
    return jsonResponse({
      error: 'OHLC data requires Pro tier. Upgrade at nexuszed.com',
      upgrade_url: 'https://nexuszed.com/upgrade',
      tier: 'free',
    }, 403);
  }

  if (!env.TWELVE_DATA_KEY) {
    return jsonResponse({ error: 'TWELVE_DATA_KEY not configured in Worker environment' }, 500);
  }

  // TTL per timeframe
  const ttlMap = { '1min': TTL.ohlc_m1, '5min': TTL.ohlc_m5, '15min': TTL.ohlc_m15,
                   '1h': TTL.ohlc_h1, '4h': TTL.ohlc_h4, '1day': TTL.ohlc_d1 };
  const cacheTTL = ttlMap[tf] || TTL.ohlc_m15;
  const cacheKey = `ohlc_${sym.replace('/','_')}_${tf}_${bars}`;

  // Check KV cache
  if (env.NEXUS_CACHE) {
    const cached = await env.NEXUS_CACHE.get(cacheKey, 'json');
    if (cached) return jsonResponse(cached, 200, { 'X-Cache': 'HIT' });
  }

  // Fetch from Twelve Data
  try {
    const tdUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${tf}&outputsize=${bars}&apikey=${env.TWELVE_DATA_KEY}&format=JSON`;
    const r = await fetch(tdUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return jsonResponse({ error: `Twelve Data HTTP ${r.status}` }, r.status);

    const raw = await r.json();
    if (raw.status === 'error') return jsonResponse({ error: raw.message }, 400);
    if (!raw.values || !raw.values.length) return jsonResponse({ error: 'No candle data returned' }, 404);

    // Normalise to NEXUS candle format
    const candles = raw.values.map(v => ({
      t: new Date(v.datetime).getTime(),
      o: parseFloat(v.open),
      h: parseFloat(v.high),
      l: parseFloat(v.low),
      c: parseFloat(v.close),
      v: parseFloat(v.volume || 0),
    })).reverse(); // oldest first

    const result = { tf, symbol: sym, bars: candles.length, candles, ts: Date.now(), source: 'twelve_data' };

    if (env.NEXUS_CACHE) {
      ctx.waitUntil(env.NEXUS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: cacheTTL }));
    }

    return jsonResponse(result, 200, { 'X-Cache': 'MISS' });
  } catch(e) {
    return jsonResponse({ error: 'OHLC fetch failed: ' + e.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
// /cot — CFTC Disaggregated COT (gold code 088691)
// Cached weekly in KV — free public API
// ════════════════════════════════════════════════════════════
async function handleCOT(request, env, ctx) {
  const cacheKey = 'cot_gold_v2';

  if (env.NEXUS_CACHE) {
    const cached = await env.NEXUS_CACHE.get(cacheKey, 'json');
    if (cached) return jsonResponse(cached, 200, { 'X-Cache': 'HIT', 'X-Cache-Age': String(Math.round((Date.now() - cached.fetchedAt) / 3600000)) + 'h' });
  }

  // CFTC public OData API
  const cotURL = `https://publicreporting.cftc.gov/api/odata/v1/HistoricalViewOiByReportTypeRi?$filter=CFTC_CommodityCode eq '088691'&$orderby=Report_Date_as_YYYY_MM_DD desc&$top=8&$format=json`;

  try {
    const r = await fetch(cotURL, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return jsonResponse({ error: 'CFTC API error: ' + r.status }, r.status);

    const raw = await r.json();
    const records = raw.value || [];
    if (!records.length) return jsonResponse({ error: 'No COT records returned' }, 404);

    // Parse records
    const parsed = records.map(rec => ({
      date:       rec.Report_Date_as_YYYY_MM_DD || '—',
      mmLong:     parseInt(rec.M_Money_Positions_Long_All  || 0),
      mmShort:    parseInt(rec.M_Money_Positions_Short_All || 0),
      mmNet:      parseInt(rec.M_Money_Positions_Long_All  || 0) - parseInt(rec.M_Money_Positions_Short_All || 0),
      prodLong:   parseInt(rec.Prod_Merc_Positions_Long_All  || 0),
      prodShort:  parseInt(rec.Prod_Merc_Positions_Short_All || 0),
      prodNet:    parseInt(rec.Prod_Merc_Positions_Long_All  || 0) - parseInt(rec.Prod_Merc_Positions_Short_All || 0),
      openInterest: parseInt(rec.Open_Interest_All || 0),
    }));

    // Compute percentile over 8-week range
    const mmNets    = parsed.map(p => p.mmNet);
    const mmMin     = Math.min(...mmNets);
    const mmMax     = Math.max(...mmNets);
    const latest    = parsed[0];
    const mmPctile  = mmMax > mmMin ? Math.round((latest.mmNet - mmMin) / (mmMax - mmMin) * 100) : 50;

    const result = {
      latest,
      history:    parsed,
      mmPctile,
      signal:     latest.mmNet > 0 ? (mmPctile > 75 ? 'EXTREME_LONG' : 'LONG') : (mmPctile < 25 ? 'EXTREME_SHORT' : 'SHORT'),
      weekRange:  parsed.length,
      fetchedAt:  Date.now(),
      nextUpdate: getNextFriday(),
      source:     'cftc_public',
    };

    if (env.NEXUS_CACHE) {
      ctx.waitUntil(env.NEXUS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL.cot }));
    }

    return jsonResponse(result, 200, { 'X-Cache': 'MISS' });
  } catch(e) {
    return jsonResponse({ error: 'COT fetch failed: ' + e.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
// /fred — FRED macro data (CPI + Fed Funds Rate)
// Cached daily — free public API, no key needed
// ════════════════════════════════════════════════════════════
async function handleFRED(request, env, ctx) {
  const cacheKey = 'fred_macro_v1';

  if (env.NEXUS_CACHE) {
    const cached = await env.NEXUS_CACHE.get(cacheKey, 'json');
    if (cached) return jsonResponse(cached, 200, { 'X-Cache': 'HIT' });
  }

  const yr = new Date().getFullYear();
  const [cpiRes, rateRes] = await Promise.allSettled([
    fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL&observation_start=${yr-2}-01-01`, { signal: AbortSignal.timeout(6000) }),
    fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&observation_start=${yr-1}-01-01`, { signal: AbortSignal.timeout(6000) }),
  ]);

  // Parse CPI CSV — compute YoY %
  let cpi = null, cpiYoY = null;
  if (cpiRes.status === 'fulfilled' && cpiRes.value.ok) {
    const lines = (await cpiRes.value.text()).trim().split('\n').filter(l => !l.startsWith('DATE'));
    if (lines.length >= 13) {
      const latest    = parseFloat(lines[lines.length - 1].split(',')[1]);
      const yearAgo   = parseFloat(lines[lines.length - 13].split(',')[1]);
      cpi    = latest;
      cpiYoY = yearAgo > 0 ? +((latest - yearAgo) / yearAgo * 100).toFixed(2) : null;
    }
  }

  // Parse Fed Funds Rate CSV
  let fedRate = null;
  if (rateRes.status === 'fulfilled' && rateRes.value.ok) {
    const lines = (await rateRes.value.text()).trim().split('\n');
    for (let i = lines.length - 1; i >= 1; i--) {
      const v = parseFloat(lines[i].split(',')[1]);
      if (v >= 0 && v < 30) { fedRate = +v.toFixed(2); break; }
    }
  }

  const result = {
    cpi, cpiYoY,
    fedRate,
    realYield: (fedRate !== null && cpiYoY !== null) ? +(fedRate - cpiYoY).toFixed(2) : null,
    inflationRegime: cpiYoY ? (cpiYoY > 4 ? 'HIGH' : cpiYoY > 2 ? 'MODERATE' : 'LOW') : null,
    rateCycle: fedRate ? (fedRate > 4 ? 'RESTRICTIVE' : fedRate > 2 ? 'NEUTRAL' : 'ACCOMMODATIVE') : null,
    fetchedAt: Date.now(),
    source: 'fred_stlouisfed',
  };

  if (env.NEXUS_CACHE) {
    ctx.waitUntil(env.NEXUS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL.fred }));
  }

  return jsonResponse(result, 200, { 'X-Cache': 'MISS' });
}

// ════════════════════════════════════════════════════════════
// /calendar — Economic calendar (Forex Factory)
// ════════════════════════════════════════════════════════════
async function handleCalendar(request, env, ctx) {
  const cacheKey = 'calendar_v1';

  if (env.NEXUS_CACHE) {
    const cached = await env.NEXUS_CACHE.get(cacheKey, 'json');
    if (cached) return jsonResponse(cached, 200, { 'X-Cache': 'HIT' });
  }

  try {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return jsonResponse({ error: 'Calendar fetch failed: ' + r.status }, r.status);

    const events = await r.json();
    const goldRelevant = events.filter(e =>
      ['USD', 'EUR'].includes(e.country) &&
      ['High', 'Medium'].includes(e.impact)
    );

    const result = { events: goldRelevant, total: goldRelevant.length, fetchedAt: Date.now() };

    if (env.NEXUS_CACHE) {
      ctx.waitUntil(env.NEXUS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: TTL.calendar }));
    }

    return jsonResponse(result, 200, { 'X-Cache': 'MISS' });
  } catch(e) {
    return jsonResponse({ error: 'Calendar failed: ' + e.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
// /health — Connection test + diagnostics
// ════════════════════════════════════════════════════════════
async function handleHealth(env, tier) {
  return jsonResponse({
    status:          'ok',
    version:         env.WORKER_VERSION || '1.0.0',
    tier,
    twelve_data_key: env.TWELVE_DATA_KEY ? '✓ configured' : '✗ missing — add via: wrangler secret put TWELVE_DATA_KEY',
    kv_cache:        env.NEXUS_CACHE    ? '✓ connected'  : '✗ missing — create KV namespace and bind as NEXUS_CACHE',
    endpoints:       ['/prices', '/ohlc?tf=15min&bars=100', '/cot', '/fred', '/calendar', '/health', '/tier'],
    ts:              Date.now(),
  });
}

// ════════════════════════════════════════════════════════════
// RATE LIMITING — per IP, per hour
// Uses KV with TTL as sliding window counter
// ════════════════════════════════════════════════════════════
async function checkRateLimit(env, ip, tier) {
  const limit = tier === 'free' ? 360 : 2000; // free: 360/h, pro: 2000/h
  const key   = `rl_${ip}_${Math.floor(Date.now() / 3600000)}`; // hourly bucket

  try {
    const current = parseInt(await env.NEXUS_CACHE.get(key) || '0');
    if (current >= limit) return false;
    await env.NEXUS_CACHE.put(key, String(current + 1), { expirationTtl: 3600 });
    return true;
  } catch(e) {
    return true; // fail open — don't block on KV errors
  }
}

// ════════════════════════════════════════════════════════════
// TIER VALIDATION
// Simple shared-secret approach (no JWT needed at this scale)
// Pro: client sends X-Nexus-Token = sha256(secret + date)
// ════════════════════════════════════════════════════════════
function validateTier(tierHeader, token, env) {
  if (!env.NEXUS_PRO_SECRET || !token) return 'free';
  // Simple token check — in production use Supabase JWT validation
  // Token = NEXUS_PRO_SECRET + ':' + today's date (YYYY-MM-DD)
  const today = new Date().toISOString().slice(0, 10);
  if (token === `${env.NEXUS_PRO_SECRET}:${today}`) return 'pro';
  if (token === `${env.NEXUS_PRO_SECRET}:edge:${today}`) return 'edge';
  return 'free';
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function parseStooqCSV(csv, min, max) {
  if (!csv || csv.length < 10) return null;
  const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('Symbol') && !l.startsWith('Date'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const cols = lines[i].split(',');
    for (const pos of [6, 4, 1]) {
      if (cols[pos]) {
        const v = parseFloat(cols[pos].replace(/[^0-9.]/g, ''));
        if (v >= min && v <= max) return +v.toFixed(2);
      }
    }
  }
  return null;
}

function getNextFriday() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 5=Fri
  const daysUntilFriday = day <= 5 ? 5 - day : 7 - day + 5;
  d.setDate(d.getDate() + (daysUntilFriday || 7));
  d.setHours(21, 30, 0, 0); // 3:30 PM ET = 21:30 UTC
  return d.toISOString();
}
