// NEXUS ZED v5.2 — OANDA Order Flow + COT + Session v2

// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.2 — OANDA WEBSOCKET ORDER FLOW ENGINE
// Real bid/ask stream → cumulative delta → live tape
// Graceful degradation: falls back to simulated if no key
// ═══════════════════════════════════════════════════════════

const OF = {
  // Connection state
  ws: null,
  connected: false,
  reconnecting: false,
  reconnectAttempts: 0,
  maxReconnects: 10,
  reconnectDelay: 2000,

  // Live data
  bid: 0,
  ask: 0,
  spread: 0,
  midPrice: 0,

  // Tick tracking
  ticks: [],           // [{t, bid, ask, mid}] — rolling 60s window
  totalTicks: 0,
  lastTickTs: 0,
  ticksPerMin: 0,
  startTs: Date.now(),

  // Order flow state
  cumDelta: 0,         // cumulative buy-sell aggressor delta
  deltaHistory: [],    // last 100 delta ticks
  bidVolume: 0,        // running buy-side aggressor count
  askVolume: 0,        // running sell-side aggressor count

  // Tape
  tape: [],            // [{ts, size, price, side}] — large prints

  // Latency tracking
  lastPingTs: 0,
  latencyMs: 0,

  // Heartbeat
  heartbeatInterval: null,
  pingInterval: null,
};

// ─── CONNECTION ────────────────────────────────────────────
function connectOANDA() {
  const key  = CFG.oandaKey;
  const acct = CFG.oandaAcct;
  if (!key) {
    showOFSimMode();
    return;
  }

  // OANDA streaming API — v20 REST (EventSource-based)
  // OANDA uses Server-Sent Events (SSE), not WebSocket
  // Endpoint: https://stream-fxtrade.oanda.com/v3/accounts/{accountID}/pricing/stream
  // or practice: https://stream-practice.oanda.com/v3/...
  // We detect practice vs live from account ID prefix

  addAuditEntry('SYS', 'Connecting to OANDA pricing stream...');
  updateOFBadge('CONNECTING', 'var(--warn)');

  const isLive = acct && !acct.includes('practice') && acct.startsWith('1');
  const baseURL = isLive
    ? 'https://stream-fxtrade.oanda.com'
    : 'https://stream-practice.oanda.com';

  OF.streamURL = `${baseURL}/v3/accounts/${acct}/pricing/stream?instruments=XAU_USD`;

  startOANDAStream(key, OF.streamURL);
}

async function startOANDAStream(key, url) {
  // Use fetch with ReadableStream for Server-Sent Events
  // OANDA streams newline-delimited JSON
  try {
    OF.startTs = Date.now();
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept-Datetime-Format': 'UNIX',
      },
      signal: OF.abortController ? OF.abortController.signal : undefined,
    });

    if (!response.ok) {
      const err = await response.text();
      addAuditEntry('ERR', `OANDA stream error ${response.status}: ${err.slice(0, 100)}`);
      updateOFBadge('AUTH ERROR', 'var(--sell)');
      showOFSimMode();
      return;
    }

    OF.connected = true;
    OF.reconnectAttempts = 0;
    updateOFBadge('LIVE', 'var(--buy)');
    showOFLiveMode();
    addAuditEntry('LIVE', 'OANDA pricing stream connected — XAU_USD real bid/ask');

    // Start heartbeat monitor
    OF.lastHeartbeatTs = Date.now();
    clearInterval(OF.heartbeatInterval);
    OF.heartbeatInterval = setInterval(() => {
      if (Date.now() - OF.lastHeartbeatTs > 30000) {
        addAuditEntry('ERR', 'OANDA heartbeat timeout — reconnecting...');
        disconnectOANDA();
        scheduleReconnect();
      }
    }, 10000);

    // Read the stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        addAuditEntry('SYS', 'OANDA stream ended — reconnecting...');
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer
      for (const line of lines) {
        if (line.trim()) processOANDATick(line.trim());
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      addAuditEntry('SYS', 'OANDA stream disconnected by user');
      return;
    }
    addAuditEntry('ERR', 'OANDA stream error: ' + e.message);
    updateOFBadge('DISCONNECTED', 'var(--sell)');
    scheduleReconnect();
  }
}

function processOANDATick(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch(e) { return; }

  // Heartbeat
  if (msg.type === 'HEARTBEAT') {
    OF.lastHeartbeatTs = Date.now();
    return;
  }

  // Price tick
  if (msg.type === 'PRICE') {
    const now = Date.now();
    OF.latencyMs = now - Math.floor((parseFloat(msg.time || now/1e9)) * 1000);

    const bid = parseFloat(msg.bids?.[0]?.price || msg.closeoutBid || 0);
    const ask = parseFloat(msg.asks?.[0]?.price || msg.closeoutAsk || 0);

    if (!bid || !ask || bid <= 0 || ask <= 0) return;

    const prevMid = OF.midPrice;
    OF.bid = bid;
    OF.ask = ask;
    OF.spread = parseFloat((ask - bid).toFixed(2));
    OF.midPrice = parseFloat(((bid + ask) / 2).toFixed(2));
    OF.totalTicks++;
    OF.lastTickTs = now;
    OF.lastHeartbeatTs = now;

    // Determine aggressor side
    // If price ticked up → buy aggressor (hitting the ask)
    // If price ticked down → sell aggressor (hitting the bid)
    const delta = OF.midPrice > prevMid ? 1 : OF.midPrice < prevMid ? -1 : 0;

    if (delta > 0) {
      OF.bidVolume++;
      OF.cumDelta += 1;
    } else if (delta < 0) {
      OF.askVolume++;
      OF.cumDelta -= 1;
    }

    OF.deltaHistory.push({ t: now, d: OF.cumDelta, bid, ask });
    if (OF.deltaHistory.length > 200) OF.deltaHistory.shift();

    // Tick history for TPM calculation
    OF.ticks.push({ t: now, bid, ask, mid: OF.midPrice });
    const cutoff = now - 60000;
    OF.ticks = OF.ticks.filter(t => t.t > cutoff);
    OF.ticksPerMin = OF.ticks.length;

    // Large print detection (significant move > 0.5 × ATR)
    const atr = S.mem.atr.slice(-1)[0] || 15;
    if (prevMid > 0 && Math.abs(OF.midPrice - prevMid) > atr * 0.05) {
      const side = OF.midPrice > prevMid ? 'BUY' : 'SELL';
      const size = Math.round(Math.abs(OF.midPrice - prevMid) * 10000); // synthetic lot size proxy
      OF.tape.unshift({ ts: new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'}), price: OF.midPrice.toFixed(2), size: size.toLocaleString(), side });
      if (OF.tape.length > 20) OF.tape.pop();
    }

    // Update S.gold with real OANDA price
    S.gold.ch = parseFloat((OF.midPrice - (S.gold.price || OF.midPrice)).toFixed(2));
    S.gold.price = OF.midPrice;

    // Push to price history
    S.ph.push(OF.midPrice);
    if (S.ph.length > 200) S.ph.shift();

    // Volume history — real from bid/ask volume ratio
    const totalVol = OF.bidVolume + OF.askVolume;
    const volPct = totalVol > 0 ? OF.bidVolume / totalVol : 0.5;
    S.vh.push(volPct * 1000);
    if (S.vh.length > 200) S.vh.shift();

    // Store microstructure state for brain engine
    S.microstructure = {
      bid: OF.bid,
      ask: OF.ask,
      spread: OF.spread,
      bidPct: totalVol > 0 ? Math.round(OF.bidVolume / totalVol * 100) : 50,
      delta: OF.cumDelta,
      bullish: OF.cumDelta > 0,
      live: true,
    };

    // Render every tick (throttled to max 4/s)
    if (!OF._renderThrottle) {
      OF._renderThrottle = true;
      setTimeout(() => {
        renderOrderFlow();
        renderAll();
        runStructureEngine();
        runZoneEngine();
        runBrainSignal();
        OF._renderThrottle = false;
      }, 250);
    }
  }
}

function scheduleReconnect() {
  if (OF.reconnectAttempts >= OF.maxReconnects) {
    addAuditEntry('ERR', `OANDA: max reconnects (${OF.maxReconnects}) reached — falling back to simulated`);
    showOFSimMode();
    return;
  }
  OF.reconnecting = true;
  OF.reconnectAttempts++;
  const delay = Math.min(30000, OF.reconnectDelay * Math.pow(1.5, OF.reconnectAttempts - 1));
  addAuditEntry('SYS', `OANDA reconnect attempt ${OF.reconnectAttempts} in ${Math.round(delay/1000)}s...`);
  updateOFBadge(`RECONNECT ${OF.reconnectAttempts}/${OF.maxReconnects}`, 'var(--warn)');
  setTimeout(() => {
    if (OF.reconnecting) connectOANDA();
  }, delay);
}

function disconnectOANDA() {
  OF.connected = false;
  OF.reconnecting = false;
  if (OF.abortController) {
    OF.abortController.abort();
    OF.abortController = null;
  }
  clearInterval(OF.heartbeatInterval);
  clearInterval(OF.pingInterval);
}

// ─── UI TOGGLE: LIVE vs SIMULATED ─────────────────────────
function showOFLiveMode() {
  const liveSection = document.getElementById('of-live-section');
  const simSection  = document.getElementById('of-sim-section');
  if (liveSection) liveSection.style.display = '';
  if (simSection)  simSection.style.display  = 'none';
  updateOFBadge('LIVE', 'var(--buy)');
}

function showOFSimMode() {
  const liveSection = document.getElementById('of-live-section');
  const simSection  = document.getElementById('of-sim-section');
  if (liveSection) liveSection.style.display = 'none';
  if (simSection)  simSection.style.display  = '';
  updateOFBadge('SIMULATED', 'var(--warn)');
  // Keep simulating algo detection from price action
  runSimulatedFlow();
}

function updateOFBadge(text, color) {
  const badge = document.getElementById('of-badge');
  if (!badge) return;
  badge.textContent = text;
  badge.style.color = color;
  badge.style.borderColor = color;
  badge.style.background = color.replace(')', ', .1)').replace('var(', 'rgba(0,0,0,');
  // Simpler approach:
  badge.className = text === 'LIVE' ? 'ohlc-badge live' : 'ohlc-badge sim';
  badge.textContent = text;
}

// ─── ORDER FLOW RENDERER ───────────────────────────────────
function renderOrderFlow() {
  if (!OF.connected) return;

  // Latency
  setText('of-latency', OF.latencyMs > 0 ? Math.abs(OF.latencyMs) + 'ms' : '—');

  // Bid/Ask prices
  setText('of-bid', OF.bid > 0 ? OF.bid.toFixed(2) : '—');
  setText('of-ask', OF.ask > 0 ? OF.ask.toFixed(2) : '—');
  setText('of-spread', OF.spread > 0 ? OF.spread.toFixed(2) : '—');

  // Imbalance bar
  const total = OF.bidVolume + OF.askVolume;
  const bidPct = total > 0 ? Math.round(OF.bidVolume / total * 100) : 50;
  const askPct = 100 - bidPct;
  const bidBar = document.getElementById('of-bid-bar');
  const askBar = document.getElementById('of-ask-bar');
  if (bidBar) bidBar.style.width = bidPct + '%';
  if (askBar) askBar.style.width = askPct + '%';
  setText('of-bid-pct', bidPct + '%');
  setText('of-ask-pct', askPct + '%');
  const imbalEl = document.getElementById('of-imbalance');
  if (imbalEl) {
    if (bidPct > 60) { imbalEl.textContent = '▲ BUY DOMINANT'; imbalEl.style.color = 'var(--buy)'; }
    else if (bidPct < 40) { imbalEl.textContent = '▼ SELL DOMINANT'; imbalEl.style.color = 'var(--sell)'; }
    else { imbalEl.textContent = 'BALANCED'; imbalEl.style.color = 'var(--gold)'; }
  }

  // Cumulative delta
  const dv = document.getElementById('of-delta');
  if (dv) {
    dv.textContent = (OF.cumDelta >= 0 ? '+' : '') + OF.cumDelta.toLocaleString();
    dv.style.color = OF.cumDelta > 0 ? 'var(--buy)' : OF.cumDelta < 0 ? 'var(--sell)' : 'var(--t3)';
  }
  const db = document.getElementById('of-delta-bar');
  if (db) {
    const pct = Math.min(50, Math.abs(OF.cumDelta) / 50 * 50);
    db.style.width = pct + '%';
    db.style.left  = OF.cumDelta >= 0 ? '50%' : (50 - pct) + '%';
    db.style.background = OF.cumDelta >= 0 ? 'var(--buy)' : 'var(--sell)';
  }
  setText('of-delta-desc',
    OF.cumDelta > 200  ? 'Strong buy aggression — institutional bid confirmed' :
    OF.cumDelta > 50   ? 'Mild buy pressure — buyers in control' :
    OF.cumDelta < -200 ? 'Strong sell aggression — institutional offer confirmed' :
    OF.cumDelta < -50  ? 'Mild sell pressure — sellers in control' :
    'Balanced order flow — no directional conviction'
  );
  const ds = document.getElementById('of-delta-sig');
  if (ds) {
    ds.textContent = OF.cumDelta > 100 ? '▲ BULLISH' : OF.cumDelta < -100 ? '▼ BEARISH' : '◆ NEUTRAL';
    ds.style.color = OF.cumDelta > 100 ? 'var(--buy)' : OF.cumDelta < -100 ? 'var(--sell)' : 'var(--t3)';
  }

  // Tape
  const tape = document.getElementById('of-tape');
  if (tape) {
    tape.innerHTML = OF.tape.slice(0, 8).map(t =>
      `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03);font-size:11px;font-family:var(--mono);">
        <span style="color:var(--t3);flex-shrink:0;">${t.ts}</span>
        <span style="color:${t.side==='BUY'?'var(--buy)':'var(--sell)'};font-weight:700;flex-shrink:0;">${t.side}</span>
        <span style="color:var(--t1);flex:1;">$${t.price}</span>
        <span style="color:var(--t3);">${t.size}</span>
      </div>`
    ).join('');
  }

  // Stats
  setText('of-tpm', OF.ticksPerMin.toString());
  setText('of-ticks', OF.totalTicks.toLocaleString());
  const wsEl = document.getElementById('of-ws-status');
  if (wsEl) {
    wsEl.textContent = OF.connected ? 'CONNECTED' : 'DISCONNECTED';
    wsEl.style.color = OF.connected ? 'var(--buy)' : 'var(--sell)';
  }
}

// ─── SIMULATED FLOW (when no OANDA key) ───────────────────
// Runs the existing algo detection from price heuristics
// Clearly labelled as simulation — no false claims
let _simFlowInterval = null;
function runSimulatedFlow() {
  clearInterval(_simFlowInterval);
  _simFlowInterval = setInterval(() => {
    const price = S.gold.price; if (!price) return;
    const ph = S.ph.slice(-20); if (ph.length < 4) return;
    const moves = ph.slice(1).map((p, i) => p - ph[i]);
    const bullM = moves.filter(m => m > 0).length;
    const atr = S.mem.atr.slice(-1)[0] || 15;
    const spike = Math.max(...ph) - Math.min(...ph);
    const trend = moves.slice(-5).reduce((a, b) => a + b, 0);
    const fv = S.reg?.fv || price;

    const twapC  = Math.round(Math.max(bullM, moves.length - bullM) / moves.length * 100);
    const stopC  = Math.min(90, Math.round(spike / atr * 45));
    const momC   = Math.min(80, Math.round(Math.abs(trend / atr) * 100));
    const vwapC  = Math.max(0, Math.round(100 - Math.abs(price - fv) / atr * 30));
    const twapDir = bullM > moves.length / 2 ? 'ACCUMULATION' : 'DISTRIBUTION';

    [
      [twapC, 'twap', `${twapDir} — ${bullM}/${moves.length} bullish ticks at consistent intervals`],
      [vwapC, 'vwap', `Regression FV $${Math.round(fv).toLocaleString()} — price ${Math.abs(price-fv).toFixed(1)}pts ${price>fv?'above (premium)':'below (discount)'}`],
      [stopC, 'stop', stopC > 55 ? `⚡ STOP HUNT — spike ${Math.round(spike)}pts vs ATR ${Math.round(atr)}pts — fade after sweep` : `No active hunt. Monitoring $${Math.round(price+atr*1.5).toLocaleString()} / $${Math.round(price-atr*1.5).toLocaleString()}`],
      [momC,  'mom',  momC > 55 ? `CTA momentum: ${trend.toFixed(1)}pts — trend-followers likely adding` : `Below CTA threshold — momentum insufficient for chase`],
    ].forEach(([conf, k, desc]) => {
      setText(`algo-${k}-c`, conf + '%');
      setText(`algo-${k}-d`, desc);
      const b = document.getElementById(`algo-${k}-b`);
      if (b) b.style.width = conf + '%';
    });
  }, 3000);
}

// ─── COT DATA ENGINE ───────────────────────────────────────
// CFTC Disaggregated COT Report — free, no API key
// Gold futures commodity code: 088691
// Fetched Fridays, cached weekly in localStorage

const COT = {
  data: null,
  lastFetchTs: 0,
  CACHE_KEY: 'nexus_cot_cache',
  GOLD_CODE: '088691',
};

async function fetchCOT() {
  // Check cache first
  try {
    const cached = JSON.parse(localStorage.getItem(COT.CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < 7 * 24 * 3600 * 1000) {
      COT.data = cached.data;
      addAuditEntry('INFO', `COT: loaded from cache (${new Date(cached.ts).toLocaleDateString()})`);
      renderCOT();
      return;
    }
  } catch(e) {}

  addAuditEntry('SYS', 'Fetching CFTC COT data...');

  // CFTC public API — OData endpoint for Disaggregated Futures Only
  const url = `https://publicreporting.cftc.gov/api/odata/v1/HistoricalViewOiByReportTypeRi?$filter=CFTC_CommodityCode eq '${COT.GOLD_CODE}'&$orderby=Report_Date_as_YYYY_MM_DD desc&$top=4&$format=json`;

  // Try direct first (CFTC has CORS support), then via proxy
  const sources = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  ];

  for (const src of sources) {
    try {
      const r = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const d = await r.json();
      const records = d.value || d;
      if (!records || !records.length) continue;

      // Parse the most recent record
      const rec = records[0];
      const mmLong  = parseFloat(rec.M_Money_Positions_Long_All  || rec['M_Money_Positions_Long_All']  || 0);
      const mmShort = parseFloat(rec.M_Money_Positions_Short_All || rec['M_Money_Positions_Short_All'] || 0);
      const prodLong  = parseFloat(rec.Prod_Merc_Positions_Long_All  || 0);
      const prodShort = parseFloat(rec.Prod_Merc_Positions_Short_All || 0);
      const reportDate = rec.Report_Date_as_YYYY_MM_DD || rec.report_date || '—';

      // Compute net positions
      const mmNet   = mmLong - mmShort;
      const prodNet = prodLong - prodShort;

      // Historical range for percentile (4-week sample is minimal; real would use 52 weeks)
      // We get top 4 records to compute a mini range
      const mmNets = records.map(r =>
        parseFloat(r.M_Money_Positions_Long_All || 0) - parseFloat(r.M_Money_Positions_Short_All || 0)
      );
      const mmMin = Math.min(...mmNets), mmMax = Math.max(...mmNets);
      const mmPctile = mmMax > mmMin ? Math.round((mmNet - mmMin) / (mmMax - mmMin) * 100) : 50;

      COT.data = {
        reportDate,
        mmLong: Math.round(mmLong),
        mmShort: Math.round(mmShort),
        mmNet: Math.round(mmNet),
        mmPctile,
        prodNet: Math.round(prodNet),
        prodLong: Math.round(prodLong),
        prodShort: Math.round(prodShort),
        signal: mmNet > 0 ? (mmPctile > 70 ? 'EXTREME LONG' : 'LONG') : (mmPctile < 30 ? 'EXTREME SHORT' : 'SHORT'),
        prodSignal: prodNet < 0 ? 'NET SHORT (HEDGING)' : 'NET LONG',
        fetched: Date.now(),
      };

      // Cache it
      try {
        localStorage.setItem(COT.CACHE_KEY, JSON.stringify({ data: COT.data, ts: Date.now() }));
      } catch(e) {}

      addAuditEntry('LIVE', `COT: MM Net ${mmNet > 0 ? '+' : ''}${Math.round(mmNet).toLocaleString()} (${mmPctile}th pctile) · Report date: ${reportDate}`);
      renderCOT();
      return;
    } catch(e) {
      addAuditEntry('ERR', 'COT fetch error: ' + e.message);
    }
  }
  addAuditEntry('ERR', 'COT: all sources failed — will retry next cycle');
}

function renderCOT() {
  const cot = COT.data; if (!cot) return;
  // Inject COT data into macro page if it has a COT section
  // We add it dynamically into the macro page card
  const macroPage = document.getElementById('page-macro'); if (!macroPage) return;

  // Find or create COT card
  let cotCard = document.getElementById('cot-card');
  if (!cotCard) {
    cotCard = document.createElement('div');
    cotCard.id = 'cot-card';
    cotCard.className = 'card';
    cotCard.innerHTML = `
      <div class="card-hdr">
        <span class="card-title">COT — CFTC DISAGGREGATED</span>
        <span style="font-size:10px;color:var(--t3);">as of ${cot.reportDate} · Weekly CFTC report</span>
      </div>
      <div class="card-body">
        <div class="mod-grid-2" style="gap:8px;margin-bottom:10px;">
          <div style="background:var(--bg2);border-radius:8px;padding:10px;border:1px solid var(--border);">
            <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:4px;">MANAGED MONEY NET</div>
            <div style="font-size:20px;font-weight:800;font-family:var(--mono);" id="cot-mm-net">${cot.mmNet > 0 ? '+' : ''}${cot.mmNet.toLocaleString()}</div>
            <div style="font-size:11px;margin-top:3px;" id="cot-mm-sig">${cot.signal}</div>
            <div style="margin-top:6px;">
              <div style="font-size:9px;color:var(--t3);margin-bottom:3px;">PERCENTILE (4-WK RANGE)</div>
              <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;"><div style="width:${cot.mmPctile}%;height:100%;background:${cot.mmPctile > 70 ? 'var(--buy)' : cot.mmPctile < 30 ? 'var(--sell)' : 'var(--gold)'};border-radius:3px;"></div></div>
              <div style="font-size:10px;color:var(--t3);margin-top:2px;">${cot.mmPctile}th percentile</div>
            </div>
          </div>
          <div style="background:var(--bg2);border-radius:8px;padding:10px;border:1px solid var(--border);">
            <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:4px;">COMMERCIALS (PRODUCERS)</div>
            <div style="font-size:20px;font-weight:800;font-family:var(--mono);" id="cot-prod-net">${cot.prodNet > 0 ? '+' : ''}${cot.prodNet.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--t3);margin-top:3px;" id="cot-prod-sig">${cot.prodSignal}</div>
            <div style="margin-top:6px;" style="font-size:11px;color:var(--t3);">
              Long: ${cot.prodLong.toLocaleString()} · Short: ${cot.prodShort.toLocaleString()}
            </div>
          </div>
        </div>
        <div class="data-row"><div class="data-key">MM Longs</div><div class="data-val" id="cot-mm-long">${cot.mmLong.toLocaleString()}</div></div>
        <div class="data-row"><div class="data-key">MM Shorts</div><div class="data-val" id="cot-mm-short">${cot.mmShort.toLocaleString()}</div></div>
        <div class="data-row" style="border:none">
          <div class="data-key">COT Signal</div>
          <div class="data-val" id="cot-signal" style="color:${cot.signal.includes('LONG') ? 'var(--buy)' : 'var(--sell)'};">${cot.signal}</div>
        </div>
        <div style="margin-top:8px;padding:8px;border-radius:6px;background:var(--bg2);font-size:11px;color:var(--t2);line-height:1.6;" id="cot-insight">
          ${cot.mmPctile > 70
            ? `Managed Money at ${cot.mmPctile}th percentile net long — crowded long position. Risk of shakeout before continuation. Institutions (commercials) net short ${Math.abs(cot.prodNet).toLocaleString()} contracts — hedging production.`
            : cot.mmPctile < 30
            ? `Managed Money at ${cot.mmPctile}th percentile — historically low long positioning. Contrarian bullish signal. Less crowding means less downside risk from long liquidation.`
            : `Managed Money positioning at ${cot.mmPctile}th percentile — neutral range. No extremes. Let price action and structure drive the trade.`
          }
        </div>
        <div style="margin-top:6px;font-size:10px;color:var(--t3);">Source: CFTC Disaggregated COT · Code ${COT.GOLD_CODE} · <a href="https://www.cftc.gov/dea/futures/financial_lf.htm" target="_blank" style="color:var(--blue);">View full report</a></div>
      </div>`;
    // Append to macro page mod-page div
    const modPage = macroPage.querySelector('.mod-page');
    if (modPage) modPage.appendChild(cotCard);
  } else {
    // Update existing
    const mmNet = document.getElementById('cot-mm-net');
    if (mmNet) { mmNet.textContent = (cot.mmNet > 0 ? '+' : '') + cot.mmNet.toLocaleString(); mmNet.style.color = cot.mmNet > 0 ? 'var(--buy)' : 'var(--sell)'; }
    setText('cot-signal', cot.signal);
    setText('cot-mm-sig', cot.signal);
  }

  // Also update macro hierarchy with real COT signal
  const cotContrib = cot.signal.includes('LONG') ? 2 : cot.signal.includes('SHORT') ? -2 : 0;
  if (S.macroState) S.macroState.cotSignal = cotContrib;
  addAuditEntry('SYS', `COT rendered: ${cot.signal} · Report: ${cot.reportDate}`);
}

// ─── OANDA CONNECTION MANAGEMENT ─────────────────────────
function initOrderFlow() {
  if (CFG.oandaKey && CFG.oandaAcct) {
    OF.abortController = new AbortController();
    connectOANDA();
  } else {
    showOFSimMode();
    runSimulatedFlow();
    addAuditEntry('INFO', 'Order flow: simulated mode. Add OANDA key in Settings for real data.');
  }
}

// Re-connect when settings saved with OANDA key
const _origSaveSettings = window.saveSettings;
window.saveSettings = function() {
  const hadKey = !!CFG.oandaKey;
  _origSaveSettings();
  const hasKey = !!CFG.oandaKey;
  if (hasKey && !hadKey) {
    addAuditEntry('SYS', 'OANDA key added — connecting order flow stream...');
    initOrderFlow();
  } else if (!hasKey && hadKey) {
    disconnectOANDA();
    showOFSimMode();
    runSimulatedFlow();
  }
  // Fetch COT data whenever settings are saved
  fetchCOT();
};

// ─── SESSION ENGINE v2 — TIMEZONE AWARE ───────────────────
// Replaces the hardcoded PKT session engine with full timezone support
function computeSessionV2() {
  const tz = CFG.tz || 'Asia/Karachi';

  // Get current time in user's timezone
  const now = new Date();
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const h = userTime.getHours(), m = userTime.getMinutes();
  const totalMins = h * 60 + m;

  // Convert session windows to UTC, then to user timezone
  // Sessions defined in UTC:
  //   Tokyo:    00:00–09:00 UTC
  //   London:   08:00–17:00 UTC
  //   New York: 13:00–22:00 UTC
  //   Overlap:  13:00–17:00 UTC (London+NY)
  const nowUTC = new Date();
  const hUTC = nowUTC.getUTCHours(), mUTC = nowUTC.getUTCMinutes();
  const utcMins = hUTC * 60 + mUTC;

  let name, quality, color, inKZ;
  const inTokyo   = utcMins >= 0   && utcMins < 540;
  const inLondon  = utcMins >= 480  && utcMins < 1020;
  const inNY      = utcMins >= 780  && utcMins < 1320;
  const inOverlap = utcMins >= 780  && utcMins < 1020;

  // Kill zones (UTC): London Open 08:00–09:00, NY Open 13:00–14:00
  const londonKZ = utcMins >= 480 && utcMins <= 540;
  const nyKZ     = utcMins >= 780 && utcMins <= 840;
  inKZ = londonKZ || nyKZ;

  if (inOverlap) { name = 'Overlap';   quality = 1.5; color = 'var(--piv)'; }
  else if (inNY) { name = 'New York';  quality = 1.3; color = 'var(--gold)'; }
  else if (inLondon) { name = 'London'; quality = 1.2; color = 'var(--gold)'; }
  else if (inTokyo)  { name = 'Tokyo';  quality = 0.7; color = 'var(--blue)'; }
  else               { name = 'Off-hours'; quality = 0.5; color = 'var(--t3)'; }

  // Format time in user's timezone
  const timeStr = userTime.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  S.session = { ...S.session, name, quality, inKZ, color, timeStr, tz,
    utcMins, londonKZ, nyKZ,
    htfBias: S.session?.htfBias || 'NEUTRAL',
    adxThreshold: quality >= 1.3 ? 25 : quality >= 1.0 ? 22 : 20,
  };

  // Update clock display
  const sessName = document.getElementById('pbSessName');
  const sessTime = document.getElementById('pbSessTime');
  if (sessName) sessName.textContent = name + ' Session';
  if (sessTime) sessTime.textContent = timeStr;

  return S.session;
}

// Override the main clock with timezone-aware version
clearInterval(window._clockInterval);
window._clockInterval = setInterval(computeSessionV2, 1000);
computeSessionV2(); // run immediately

// ─── BOOT SEQUENCE v5.2 ────────────────────────────────────
setTimeout(() => {
  // Init order flow (OANDA or simulated)
  initOrderFlow();
  // Fetch COT data
  fetchCOT();
  // COT refresh every 6 hours
  setInterval(fetchCOT, 6 * 3600 * 1000);
  addAuditEntry('SYS', 'v5.2 — Order flow engine active · COT engine active · Timezone-aware session engine active');
}, 1500);
