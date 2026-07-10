// NEXUS ZED — Data Feed Waterfall v2
// Worker-first: uses Cloudflare Worker when URL configured in Settings
// Falls back to direct API chain when Worker unavailable
// ═══════════════════════════════════════════════════════════

const PROXY_CHAIN = [
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// ── WORKER TIER HEADER ────────────────────────────────────
// CFG is defined in nexus.ui.js (loads later), so we use window.CFG safely
function getWorkerHeaders() {
  const cfg = window.CFG || {};
  const tier = cfg.userTier || 'free';
  const secret = cfg.proSecret || '';
  const today = new Date().toISOString().slice(0, 10);
  const token = secret ? `${secret}:${today}` : '';
  return {
    'X-Nexus-Tier':  tier,
    'X-Nexus-Token': token,
  };
}

function workerURL(path) {
  const cfg = window.CFG || {};
  const base = (cfg.worker || '').replace(/\/$/, '');
  return base ? base + path : null;
}

// ── FETCH ALL (Worker aggregated call) ───────────────────
async function fetchAllFromWorker() {
  const url = workerURL('/prices');
  if (!url) return false;
  try {
    const r = await fetch(url, {
      headers: getWorkerHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (d.error) return false;

    const delayed = d.delayed || false;

    // Apply all 6 feeds at once
    if (d.gold?.price)  applyFeed('gold',  d.gold,  'fsGold',  delayed ? 'XAU: DELAYED' : 'XAU: LIVE',  delayed ? 'ld' : 'ok');
    if (d.dxy?.price)   applyFeed('dxy',   d.dxy,   'fsDXY',   delayed ? 'DXY: DELAYED' : 'DXY: LIVE',  delayed ? 'ld' : 'ok');
    if (d.yield?.price) applyFeed('yield', d.yield, 'fsYield', delayed ? '10Y: DELAYED' : '10Y: LIVE',  delayed ? 'ld' : 'ok');
    if (d.oil?.price)   applyFeed('oil',   d.oil,   'fsOil',   delayed ? 'OIL: DELAYED' : 'OIL: LIVE',  delayed ? 'ld' : 'ok');
    if (d.spx?.price)   applyFeed('spx',   d.spx,   'fsSPX',   delayed ? 'SPX: DELAYED' : 'SPX: LIVE',  delayed ? 'ld' : 'ok');
    if (d.vix?.price)   applyFeed('vix',   d.vix,   'fsVIX',   delayed ? 'VIX: DELAYED' : 'VIX: LIVE',  delayed ? 'ld' : 'ok');

    addAuditEntry('LIVE', `Worker: all feeds ${delayed ? 'DELAYED 15min (Free tier)' : 'LIVE'}`);
    return true;
  } catch(e) {
    addAuditEntry('ERR', 'Worker /prices failed: ' + e.message);
    return false;
  }
}

function applyFeed(key, data, fsId, label, cls) {
  const prev = S[key].price || data.price;
  S[key] = {
    price: +parseFloat(data.price).toFixed(2),
    ch:    +(data.price - prev).toFixed(2),
    prev,
  };
  S.feedOk[key] = true;
  STALE_CACHE[key] = { ...S[key], ts: Date.now() };
  setFeed(fsId, label, cls);
}

// ── WORKER OHLC FETCH ─────────────────────────────────────
async function fetchOHLCFromWorker(tf, bars = 100) {
  const url = workerURL(`/ohlc?tf=${tf}&bars=${bars}&symbol=XAU/USD`);
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: getWorkerHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      if (r.status === 403) {
        addAuditEntry('INFO', 'OHLC requires Pro tier — upgrade to unlock real candles');
      }
      return null;
    }
    const d = await r.json();
    if (d.error || !d.candles?.length) return null;
    addAuditEntry('LIVE', `Worker OHLC: ${tf} — ${d.candles.length} bars [${d.source}]`);
    return d.candles;
  } catch(e) {
    return null;
  }
}

// ── WORKER COT FETCH ──────────────────────────────────────
async function fetchCOTFromWorker() {
  const url = workerURL('/cot');
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: getWorkerHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.error) return null;
    addAuditEntry('LIVE', `Worker COT: MM Net ${d.latest?.mmNet > 0 ? '+' : ''}${d.latest?.mmNet?.toLocaleString()} (${d.mmPctile}th pctile)`);
    return d;
  } catch(e) {
    return null;
  }
}

// ── WORKER FRED FETCH ─────────────────────────────────────
async function fetchFREDFromWorker() {
  const url = workerURL('/fred');
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: getWorkerHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.error) return null;
    // Apply to state
    if (d.cpiYoY !== null) S.cpi = d.cpiYoY;
    if (d.fedRate !== null) S.fedRate = d.fedRate;
    if (d.realYield !== null) S.realYield = d.realYield;
    addAuditEntry('LIVE', `Worker FRED: CPI ${d.cpiYoY}% YoY · Fed ${d.fedRate}%`);
    return d;
  } catch(e) {
    return null;
  }
}

// ── WORKER CALENDAR FETCH ─────────────────────────────────
async function fetchCalendarFromWorker() {
  const url = workerURL('/calendar');
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: getWorkerHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.error || !d.events) return null;
    return d.events;
  } catch(e) {
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// DIRECT API FALLBACK CHAIN
// Used when Worker URL not configured
// ════════════════════════════════════════════════════════════

async function fetchYahoo(sym, key, fsId, label) {
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}`,
  ];
  for (const url of urls) {
    for (const proxy of PROXY_CHAIN) {
      try {
        const r = await fetch(proxy(url), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const txt = await r.text();
        let d;
        try { d = JSON.parse(txt); }
        catch(e) {
          try { d = JSON.parse(JSON.parse(txt.replace(/^[^{]*/, '')).contents); }
          catch(e2) { continue; }
        }
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice
               || d?.quoteResponse?.result?.[0]?.regularMarketPrice
               || d?.contents?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (p && p > 0) {
          const prev = S[key].price || p;
          S[key] = { price: +p.toFixed(2), ch: +(p-prev).toFixed(2), prev };
          S.feedOk[key] = true;
          STALE_CACHE[key] = { ...S[key], ts: Date.now() };
          setFeed(fsId, label + ': LIVE', 'ok');
          return true;
        }
      } catch(e) {}
    }
  }
  return false;
}

function _parseStooqCSV(csv, mn, mx) {
  if (!csv || csv.length < 10) return null;
  const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('Symbol') && !l.startsWith('Date'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const cols = lines[i].split(',');
    for (const pos of [6, 4, 1]) {
      if (cols[pos]) {
        const v = parseFloat(cols[pos].replace(/[^0-9.]/g, ''));
        if (v >= mn && v <= mx) return v;
      }
    }
  }
  return null;
}

async function fetchGold() {
  try {
    const r = await fetch('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&e=csv', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const p = _parseStooqCSV(await r.text(), 1000, 5000);
      if (p) { applyFeed('gold', { price: p }, 'fsGold', 'XAU: LIVE', 'ok'); return true; }
    }
  } catch(e) {}
  for (const proxy of PROXY_CHAIN) {
    try {
      const r = await fetch(proxy('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&e=csv'), { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const txt = await r.text();
        const p = _parseStooqCSV(txt, 1000, 5000) || _parseStooqCSV(JSON.parse(txt).contents || '', 1000, 5000);
        if (p) { applyFeed('gold', { price: p }, 'fsGold', 'XAU: LIVE', 'ok'); return true; }
      }
    } catch(e) {}
  }
  const ok = await fetchYahoo('GC%3DF', 'gold', 'fsGold', 'XAU'); if (ok) return true;
  if (STALE_CACHE.gold) { S.gold = STALE_CACHE.gold; setFeed('fsGold', 'XAU: STALE', 'ld'); return false; }
  S.gold = FALLBACK.gold; setFeed('fsGold', 'XAU: FALLBACK', 'err'); return false;
}

async function fetchDXY() {
  try {
    const r = await fetch('https://www.floatrates.com/daily/usd.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      if (d.eur?.rate && d.jpy?.rate && d.gbp?.rate) {
        const EUR = d.eur.rate, JPY = d.jpy.rate, GBP = d.gbp.rate,
              CAD = d.cad?.rate || 1.38, SEK = d.sek?.rate || 10.4, CHF = d.chf?.rate || 0.90;
        const dxy = 50.14348112 * Math.pow(EUR,0.576) * Math.pow(JPY,0.136)
          * Math.pow(GBP,-0.119) * Math.pow(CAD,0.091) * Math.pow(SEK,0.042) * Math.pow(CHF,0.036);
        if (dxy > 80 && dxy < 130) { applyFeed('dxy', { price: +dxy.toFixed(3) }, 'fsDXY', 'DXY: LIVE', 'ok'); return true; }
      }
    }
  } catch(e) {}
  const ok = await fetchYahoo('DX-Y.NYB', 'dxy', 'fsDXY', 'DXY'); if (ok) return true;
  if (STALE_CACHE.dxy) { S.dxy = STALE_CACHE.dxy; setFeed('fsDXY', 'DXY: STALE', 'ld'); return false; }
  S.dxy = FALLBACK.dxy; setFeed('fsDXY', 'DXY: FALLBACK', 'err'); return false;
}

async function fetchYield(){
  const yr = new Date().getFullYear();
  const FRED_URL = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&observation_start=${yr}-01-01`;
  function parseFred(txt){
    const lines = txt.trim().split('\n');
    for(let i=lines.length-1; i>=1; i--){
      const p = lines[i].split(',');
      const r = parseFloat(p[1]);
      if(r>0 && r<20) return r;
    }
    return null;
  }

  // Try FRED direct (has CORS headers)
  try {
    const r = await fetch(FRED_URL, {cache:'no-store', signal:AbortSignal.timeout(7000)});
    if(r.ok){ const v=parseFred(await r.text()); if(v){ const prev=S.yield.price||v;
      S.yield={price:+v.toFixed(3),ch:+(v-prev).toFixed(3),prev};
      S.feedOk.yield=true; STALE_CACHE.yield={...S.yield,ts:Date.now()}; setFeed('fsYield','10Y: LIVE','ok'); return true; } }
  } catch(e) {}

  // FRED via proxy
  for(const proxy of PROXY_CHAIN.slice(0,2)){
    try {
      const r = await fetch(proxy(FRED_URL), {cache:'no-store', signal:AbortSignal.timeout(8000)});
      if(!r.ok) continue;
      let txt = await r.text();
      try { txt = JSON.parse(txt).contents || txt; } catch(e2) {}
      const v = parseFred(txt);
      if(v){ const prev=S.yield.price||v;
        S.yield={price:+v.toFixed(3),ch:+(v-prev).toFixed(3),prev};
        S.feedOk.yield=true; STALE_CACHE.yield={...S.yield,ts:Date.now()}; setFeed('fsYield','10Y: LIVE','ok'); return true; }
    } catch(e) {}
  }

  // Yahoo fallback
  const ok = await fetchYahoo('%5ETNX','yield','fsYield','10Y'); if(ok) return true;
  if(STALE_CACHE.yield){ S.yield=STALE_CACHE.yield; setFeed('fsYield','10Y: STALE','ld'); return false; }
  S.yield=FALLBACK.yield; setFeed('fsYield','10Y: FALLBACK','err'); return false;
}

async function fetchOil() {
  try {
    const r = await fetch('https://stooq.com/q/l/?s=cl.f&f=sd2t2ohlcv&e=csv', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const p = _parseStooqCSV(await r.text(), 20, 300);
      if (p) { applyFeed('oil', { price: p }, 'fsOil', 'OIL: LIVE', 'ok'); return true; }
    }
  } catch(e) {}
  if (STALE_CACHE.oil) { S.oil = STALE_CACHE.oil; setFeed('fsOil', 'OIL: STALE', 'ld'); return false; }
  S.oil = FALLBACK.oil; setFeed('fsOil', 'OIL: FALLBACK', 'err'); return false;
}

async function fetchSPX(){
  // Try Stooq (more reliable than Yahoo)
  try {
    const r = await fetch('https://stooq.com/q/l/?s=^spx&f=sd2t2ohlcv&e=csv',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(r.ok){ const p=_parseStooqCSV(await r.text(),1000,10000);
      if(p){ const prev=S.spx.price||p; S.spx={price:+p.toFixed(2),ch:+(p-prev).toFixed(2),prev};
        S.feedOk.spx=true; STALE_CACHE.spx={...S.spx,ts:Date.now()}; setFeed('fsSPX','SPX: LIVE','ok'); return true; } }
  } catch(e) {}
  const ok=await fetchYahoo('%5EGSPC','spx','fsSPX','SPX'); if(ok) return true;
  if(STALE_CACHE.spx){ S.spx=STALE_CACHE.spx; setFeed('fsSPX','SPX: STALE','ld'); return false; }
  S.spx=FALLBACK.spx; setFeed('fsSPX','SPX: FALLBACK','err'); return false;
}

async function fetchVIX(){
  // Try Stooq first
  try {
    const r = await fetch('https://stooq.com/q/l/?s=^vix&f=sd2t2ohlcv&e=csv',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(r.ok){ const p=_parseStooqCSV(await r.text(),5,150);
      if(p){ const prev=S.vix.price||p; S.vix={price:+p.toFixed(2),ch:+(p-prev).toFixed(2),prev};
        S.feedOk.vix=true; STALE_CACHE.vix={...S.vix,ts:Date.now()}; setFeed('fsVIX','VIX: LIVE','ok'); return true; } }
  } catch(e) {}
  const ok=await fetchYahoo('%5EVIX','vix','fsVIX','VIX'); if(ok) return true;
}

async function fetchEconCal(){
  const CAL_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  let events = null;

  // Try direct first
  try {
    const r = await fetch(CAL_URL, {cache:'no-store', signal:AbortSignal.timeout(8000)});
    if(r.ok) events = await r.json();
  } catch(e) {}

  // Proxy fallback
  if(!events) {
    for(const proxy of PROXY_CHAIN.slice(0,2)) {
      try {
        const r = await fetch(proxy(CAL_URL), {cache:'no-store', signal:AbortSignal.timeout(8000)});
        if(!r.ok) continue;
        const txt = await r.text();
        try { events = JSON.parse(txt); } catch(e2) {
          try { events = JSON.parse(JSON.parse(txt).contents); } catch(e3) {}
        }
        if(events) break;
      } catch(e) {}
    }
  }

  if(!events || !events.length) {
    // Show "calendar unavailable" message gracefully
    const calEl = document.getElementById('calBody') || document.getElementById('macroCalBody');
    if(calEl) calEl.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px;">Calendar unavailable — check connection</div>';
    const newsEl = document.getElementById('newsStatus');
    if(newsEl) { newsEl.textContent = '📅 Calendar fetch failed'; newsEl.style.color = 'var(--t3)'; }
    return;
  }

  // Wider filter — all USD/EUR High/Medium events (not keyword-restricted)
  const gold = events.filter(e =>
    ['USD','EUR'].includes(e.country) && ['High','Medium'].includes(e.impact)
  );

  if(typeof renderNewsFeed === 'function') renderNewsFeed(gold);
  if(typeof processEconEvents === 'function') processEconEvents(gold);
}

// ── MAIN FETCH CYCLE ──────────────────────────────────────
async function fetchAll(){
  S.cycle++;
  setText('cycleCount','Cycle '+S.cycle);
  await Promise.allSettled([fetchGold(),fetchDXY(),fetchYield(),fetchOil(),fetchSPX(),fetchVIX()]);
  computeSession();
  runStructureEngine();
  runZoneEngine();
  runRegression();
  runADX();
  runBrainSignal();
  runPositionSize();
  renderAll();
  if(typeof renderAllModules==='function') renderAllModules();
  persistState();
  // Countdown
  let t=10;
  const tick=setInterval(()=>{ t--; setText('nextUpd','· upd in '+t+'s'); if(t<=0) clearInterval(tick); },1000);
}
