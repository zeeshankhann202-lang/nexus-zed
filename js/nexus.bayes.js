// NEXUS ZED v5.6 — News Blackout + Calendar + Bayesian Fusion

// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.6 — THREE ENGINES
// A. News Blackout Engine — real-time gate propagation
// B. Economic Calendar — countdown timers + full display
// C. Bayesian Posterior Fusion — log-odds 6-strategy combiner
// ═══════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// A. NEWS BLACKOUT ENGINE
// ════════════════════════════════════════════════════════

const NB = {
  events:        [],      // all parsed econ events
  upcoming:      [],      // events in next 24h
  activeEvent:   null,    // event currently in blackout window
  nextEvent:     null,    // next upcoming high impact event
  blackoutActive: false,
  // Blackout windows (minutes before/after)
  PRE_HIGH:   15,   // 15 min before High impact
  POST_HIGH:  30,   // 30 min after High impact
  PRE_MED:     5,   // 5 min before Medium impact
  POST_MED:   10,   // 10 min after Medium impact
  countdownInterval: null,
};

// Parse and store events from Forex Factory
function processEconEvents(events) {
  NB.events = events || [];
  NB.upcoming = events
    .filter(e => {
      try {
        const t = new Date(e.date).getTime();
        return t > Date.now() - 3600000 && t < Date.now() + 86400000;
      } catch(x) { return false; }
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  updateBlackoutState();
  startCountdownTimer();
  renderCalendarFull();
  renderDashboardNewsCard();
}

function updateBlackoutState() {
  const now = Date.now();
  NB.activeEvent = null;
  NB.blackoutActive = false;

  for (const e of NB.events) {
    let t;
    try { t = new Date(e.date).getTime(); } catch(x) { continue; }
    const isHigh = e.impact === 'High';
    const isMed  = e.impact === 'Medium';
    const preMins  = isHigh ? NB.PRE_HIGH  : isMed ? NB.PRE_MED  : 0;
    const postMins = isHigh ? NB.POST_HIGH : isMed ? NB.POST_MED : 0;
    const windowStart = t - preMins  * 60000;
    const windowEnd   = t + postMins * 60000;

    if (now >= windowStart && now <= windowEnd) {
      NB.activeEvent   = e;
      NB.blackoutActive = true;
      break;
    }
  }

  // Find next upcoming event
  NB.nextEvent = NB.upcoming.find(e => {
    try { return new Date(e.date).getTime() > now; } catch(x) { return false; }
  }) || null;

  // Propagate to global flag (used by swing engine + gates)
  const wasBlackout = window._newsBlackout;
  window._newsBlackout = NB.blackoutActive;

  // State change notifications
  if (NB.blackoutActive && !wasBlackout) {
    addAuditEntry('SIGNAL', `NEWS BLACKOUT ACTIVE — ${NB.activeEvent?.title} (${NB.activeEvent?.impact})`);
    showBlackoutBanner(true);
    if (CFG.sndNews) playSignalBeep(330); // low warning tone
  } else if (!NB.blackoutActive && wasBlackout) {
    addAuditEntry('SYS', 'News blackout cleared — trading resumed');
    showBlackoutBanner(false);
  }

  // Propagate to brain signal — override direction to WAIT during blackout
  if (NB.blackoutActive && S.brain) {
    S.brain._preBlackoutDirection = S.brain.direction;
    S.brain.direction = 'WAIT';
    S.brain.conf = 0;
    S.brain.grade = 'D';
  } else if (!NB.blackoutActive && S.brain?._preBlackoutDirection) {
    // Restore after blackout (brain will recompute next cycle anyway)
    delete S.brain._preBlackoutDirection;
  }
}

// ── BLACKOUT BANNER ───────────────────────────────────────
function showBlackoutBanner(show) {
  let banner = document.getElementById('nbBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'nbBanner';
    banner.style.cssText = `
      position:fixed;top:var(--nav-h);left:0;right:0;z-index:700;
      padding:8px 16px;display:none;
      background:linear-gradient(90deg,rgba(239,68,68,.15),rgba(239,68,68,.08));
      border-bottom:2px solid rgba(239,68,68,.6);
      font-size:12px;font-weight:600;color:#ef4444;
      display:flex;align-items:center;gap:12px;
      backdrop-filter:blur(4px);
    `;
    document.body.appendChild(banner);
  }
  if (show && NB.activeEvent) {
    banner.style.display = 'flex';
    banner.innerHTML = `
      <span style="font-size:16px;animation:pulse 1s infinite;">🔴</span>
      <span>NEWS BLACKOUT — ${NB.activeEvent.country} ${NB.activeEvent.title} (${NB.activeEvent.impact} Impact)</span>
      <span style="margin-left:auto;font-size:11px;opacity:.7;" id="nbBannerTimer">—</span>
      <span style="color:rgba(239,68,68,.5);font-size:11px;">All signals frozen · No new entries</span>
    `;
  } else {
    banner.style.display = 'none';
  }
}

// ── COUNTDOWN TIMER ───────────────────────────────────────
function startCountdownTimer() {
  clearInterval(NB.countdownInterval);
  NB.countdownInterval = setInterval(() => {
    updateBlackoutState();
    renderDashboardNewsCard();
    updateBannerTimer();
    updateGateNewsDetail();
  }, 1000);
}

function updateBannerTimer() {
  const timer = document.getElementById('nbBannerTimer');
  if (!timer || !NB.activeEvent) return;
  const t = new Date(NB.activeEvent.date).getTime();
  const now = Date.now();
  if (now < t) {
    timer.textContent = 'Event in ' + fmtCountdown(t - now);
  } else {
    const postEnd = t + (NB.activeEvent.impact === 'High' ? NB.POST_HIGH : NB.POST_MED) * 60000;
    timer.textContent = 'Clears in ' + fmtCountdown(postEnd - now);
  }
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return m + 'm ' + sec + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function updateGateNewsDetail() {
  const el = document.getElementById('gate-news-detail');
  if (!el) return;
  if (NB.blackoutActive && NB.activeEvent) {
    const t = new Date(NB.activeEvent.date).getTime();
    const postEnd = t + (NB.activeEvent.impact === 'High' ? NB.POST_HIGH : NB.POST_MED) * 60000;
    el.textContent = `⚠ BLACKOUT — ${NB.activeEvent.title} · clears in ${fmtCountdown(postEnd - Date.now())}`;
  } else if (NB.nextEvent) {
    const t = new Date(NB.nextEvent.date).getTime();
    const preStart = t - (NB.nextEvent.impact === 'High' ? NB.PRE_HIGH : NB.PRE_MED) * 60000;
    el.textContent = `Next: ${NB.nextEvent.title} in ${fmtCountdown(preStart - Date.now())}`;
  } else {
    el.textContent = 'Calendar clear — safe window';
  }
}

// ── DASHBOARD NEWS CARD ───────────────────────────────────
function renderDashboardNewsCard() {
  const statusEl = document.getElementById('newsStatus');
  const detailEl = document.getElementById('newsDetail');
  const feedEl   = document.getElementById('newsFeed');
  if (!statusEl) return;

  if (NB.blackoutActive && NB.activeEvent) {
    // Blackout active
    const t = new Date(NB.activeEvent.date).getTime();
    const postEnd = t + (NB.activeEvent.impact === 'High' ? NB.POST_HIGH : NB.POST_MED) * 60000;
    statusEl.textContent = '🔴 BLACKOUT ACTIVE';
    statusEl.style.color = 'var(--sell)';
    detailEl.textContent = `${NB.activeEvent.title} · clears in ${fmtCountdown(postEnd - Date.now())}`;
    detailEl.style.color = 'var(--sell)';
    if (feedEl) feedEl.innerHTML = '';
    return;
  }

  // No blackout — show next event countdown
  if (NB.nextEvent) {
    const t = new Date(NB.nextEvent.date).getTime();
    const preStart = t - (NB.nextEvent.impact === 'High' ? NB.PRE_HIGH : NB.PRE_MED) * 60000;
    const timeToGate = preStart - Date.now();
    const col = timeToGate < 3600000 ? 'var(--warn)' : 'var(--buy)';
    const icon = NB.nextEvent.impact === 'High' ? '🌤' : '⛅';
    statusEl.textContent = icon + ' ' + (timeToGate < 0 ? 'Safe window' : 'Safe — next event in ' + fmtCountdown(timeToGate));
    statusEl.style.color = col;
    detailEl.textContent = NB.nextEvent.title + ' · ' + NB.nextEvent.impact + ' impact';
    detailEl.style.color = 'var(--t3)';
  } else {
    statusEl.textContent = '🌤 No high impact events';
    statusEl.style.color = 'var(--buy)';
    detailEl.textContent = 'Calendar clear for next 24h';
    detailEl.style.color = 'var(--t3)';
  }

  // Feed: next 3 upcoming events
  if (feedEl) {
    feedEl.innerHTML = NB.upcoming.slice(0, 3).map(e => {
      const t = new Date(e.date).getTime();
      const ms = t - Date.now();
      const col = e.impact === 'High' ? 'var(--sell)' : 'var(--warn)';
      return `<div class="news-item">
        <div class="news-dot" style="background:${col}"></div>
        <div class="news-txt">
          <span style="font-weight:600;color:${col}">${e.country}</span> — ${e.title}
          <span style="color:var(--t3);display:block;font-size:10px;">${ms > 0 ? 'in ' + fmtCountdown(ms) : 'now'} · ${e.impact}</span>
        </div>
      </div>`;
    }).join('');
  }
}

// ════════════════════════════════════════════════════════
// B. ECONOMIC CALENDAR — FULL RENDER
// ════════════════════════════════════════════════════════

function renderCalendarFull() {
  const calBody = document.getElementById('macroCalBody');
  if (!calBody) return;

  const userTZ = CFG.tz || 'Asia/Karachi';
  const events = NB.upcoming.length ? NB.upcoming : (window._econEvents || []);

  if (!events.length) {
    calBody.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px;">Loading calendar...</div>';
    return;
  }

  calBody.innerHTML = events.slice(0, 10).map(e => {
    let t;
    try { t = new Date(e.date); } catch(x) { t = null; }

    const now     = Date.now();
    const eventTs = t ? t.getTime() : 0;
    const ms      = eventTs - now;
    const isActive = NB.activeEvent?.title === e.title;
    const isPast   = ms < -1800000; // more than 30min ago

    // Format time in user timezone
    const localTime = t ? t.toLocaleString('en-US', {
      timeZone: userTZ,
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }) : e.date || '—';

    const impactCol = e.impact === 'High' ? 'var(--sell)' : e.impact === 'Medium' ? 'var(--warn)' : 'var(--t3)';
    const rowBg = isActive ? 'background:rgba(239,68,68,.08);border-left:3px solid var(--sell);' : isPast ? 'opacity:.45;' : '';

    const countdown = ms > 0
      ? `<span style="color:${ms < 3600000 ? 'var(--warn)' : 'var(--t3)'};font-size:10px;"> in ${fmtCountdown(ms)}</span>`
      : ms > -1800000
        ? `<span style="color:var(--sell);font-size:10px;"> LIVE</span>`
        : '';

    const prev = e.previous ? `<span style="color:var(--t3);"> Prev: ${e.previous}</span>` : '';
    const fore = e.forecast ? `<span style="color:var(--t2);"> Fore: ${e.forecast}</span>` : '';
    const actual = e.actual  ? `<span style="color:${parseFloat(e.actual) >= parseFloat(e.forecast||'0') ? 'var(--buy)' : 'var(--sell)'}; font-weight:700;"> Act: ${e.actual}</span>` : '';

    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);${rowBg}">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        <div style="width:6px;height:6px;border-radius:50%;background:${impactCol};flex-shrink:0;margin-top:4px;"></div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-size:12px;font-weight:700;color:${impactCol};">${e.country}</span>
            <span style="font-size:12px;color:var(--t1);">${e.title}</span>
            ${isActive ? '<span style="padding:1px 5px;background:var(--selldim);color:var(--sell);border-radius:3px;font-size:9px;font-weight:700;">BLACKOUT</span>' : ''}
          </div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px;">
            ${localTime}${countdown}${prev}${fore}${actual}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="padding:2px 6px;border-radius:4px;background:${e.impact === 'High' ? 'var(--selldim)' : 'var(--warndim)'};font-size:9px;font-weight:700;color:${impactCol};">${e.impact}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── WIRE INTO FETCH ───────────────────────────────────────
const _origFetchEconCalV6 = window.fetchEconCal;
window.fetchEconCal = async function() {
  try {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      cache: 'no-store', signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return;
    const all = await r.json();
    // Gold-relevant events
    const goldEvents = all.filter(e =>
      ['USD', 'EUR'].includes(e.country) &&
      ['High', 'Medium'].includes(e.impact)
    );
    window._econEvents = goldEvents;
    processEconEvents(goldEvents);
  } catch(e) {
    addAuditEntry('ERR', 'Calendar fetch failed: ' + e.message);
  }
};

// ════════════════════════════════════════════════════════
// C. BAYESIAN POSTERIOR FUSION ENGINE
// Log-odds combiner — 6 strategy streams
// Self-calibrating weights via Beta posterior accuracy tracking
// ════════════════════════════════════════════════════════

// ── 6 STRATEGY SIGNALS ────────────────────────────────────
// Each strategy outputs: { score: 0-10, direction: 'BUY'|'SELL'|'NEUTRAL' }
// Score 5 = neutral, >5 = bullish, <5 = bearish

const BAYES = {
  // Strategy weights — self-calibrating
  // Initialised as equal priors, updated via Beta posterior
  weights: {
    structure:  { w: 0.20, hits: 0, total: 0 },  // BOS/CHoCH/OB/FVG
    quant:      { w: 0.18, hits: 0, total: 0 },  // Z-score, regression
    amt:        { w: 0.16, hits: 0, total: 0 },  // AMT volume profile
    micro:      { w: 0.14, hits: 0, total: 0 },  // M1 pattern, 3C
    execution:  { w: 0.16, hits: 0, total: 0 },  // Entry gates, precision
    mlForest:   { w: 0.16, hits: 0, total: 0 },  // Random Forest output
  },

  // Posterior probabilities
  pBuy:  0.333,
  pSell: 0.333,
  pNeut: 0.334,

  // Last computed outputs
  direction: 'WAIT',
  edgePct:   0,
  confidence: 50,

  // Calibration store
  CALIB_KEY: 'nexus_bayes_weights',
};

function loadBayesWeights() {
  try {
    const raw = localStorage.getItem(BAYES.CALIB_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.weights) Object.assign(BAYES.weights, saved.weights);
  } catch(e) {}
}

function saveBayesWeights() {
  try {
    localStorage.setItem(BAYES.CALIB_KEY, JSON.stringify({ weights: BAYES.weights }));
  } catch(e) {}
}

// ── STRATEGY SIGNAL EXTRACTORS ────────────────────────────

function getStructureSignal() {
  // BOS/CHoCH/OB/FVG/Sweep — highest quality structural signal
  const bos   = STRUCTURE.bos;
  const choch = STRUCTURE.choch;
  const sweep = STRUCTURE.liqSweep;
  const adx   = STRUCTURE.adx;
  const fvgCount = STRUCTURE.fvgs.filter(f => !f.filled).length;

  let score = 5; // neutral baseline

  // BOS (strong directional signal)
  if (bos === 'DOWN') score -= 2;
  else if (bos === 'UP') score += 2;

  // CHoCH (trend change — stronger signal)
  if (choch === 'BEARISH') score -= 2.5;
  else if (choch === 'BULLISH') score += 2.5;

  // Sweep direction
  if (sweep?.type === 'BSL') score -= 1.5; // buy-side liquidity swept = bearish
  else if (sweep?.type === 'SSL') score += 1.5;

  // ADX alignment
  if (adx.signal === 'SELL' && adx.adx > 25) score -= 0.5;
  else if (adx.signal === 'BUY' && adx.adx > 25) score += 0.5;

  // FVG presence (suggests imbalance to fill)
  score += (fvgCount > 0 ? 0.3 : 0);

  score = Math.max(0, Math.min(10, score));
  const dir = score < 4 ? 'SELL' : score > 6 ? 'BUY' : 'NEUTRAL';
  return { score, direction: dir, name: 'STRUCTURE' };
}

function getQuantSignal() {
  // Regression Z-score + Monte Carlo edge
  const reg   = S.reg;
  const mc    = S.monteCarlo;
  const atr   = S.mem.atr.slice(-1)[0] || 15;

  let score = 5;

  // Regression premium/discount
  if (reg?.prem) {
    const zScore = reg.prem / (reg.sigma || atr);
    // Premium (price above FV) → sell signal
    if (zScore > 1.5) score -= Math.min(2.5, zScore * 0.8);
    else if (zScore < -1.5) score += Math.min(2.5, Math.abs(zScore) * 0.8);
  }

  // Monte Carlo upside probability
  if (mc?.pUp !== undefined) {
    const mcBias = (mc.pUp - 50) / 100 * 3; // -1.5 to +1.5
    score += mcBias;
  }

  score = Math.max(0, Math.min(10, score));
  const dir = score < 4 ? 'SELL' : score > 6 ? 'BUY' : 'NEUTRAL';
  return { score, direction: dir, name: 'QUANT' };
}

function getAMTSignal() {
  // AMT: Price relative to equilibrium (estimated from zones + regression)
  const price = S.gold.price;
  const fv    = S.reg?.fv || price;
  const atr   = S.mem.atr.slice(-1)[0] || 15;
  const ms    = S.macroState;

  let score = 5;

  // Price vs fair value (AMT proxy — no real volume profile without OHLC)
  if (price && fv) {
    const dist = (price - fv) / atr;
    if (dist > 1) score -= Math.min(2, dist * 0.8);      // premium → sell
    else if (dist < -1) score += Math.min(2, Math.abs(dist) * 0.8); // discount → buy
  }

  // Zone context: in supply = sell, in demand = buy
  if (ZONES.sell1 && price >= ZONES.sell1.lo && price <= ZONES.sell1.hi) score -= 2;
  if (ZONES.buy1  && price >= ZONES.buy1.lo  && price <= ZONES.buy1.hi)  score += 2;

  // Macro macro alignment
  if (ms?.rateYieldBull) score += 0.5;
  else if (ms?.rateYieldBear) score -= 0.5;

  score = Math.max(0, Math.min(10, score));
  const dir = score < 4 ? 'SELL' : score > 6 ? 'BUY' : 'NEUTRAL';
  return { score, direction: dir, name: 'AMT' };
}

function getMicrostructureSignal() {
  // M1 candle patterns + OANDA order flow (real or simulated)
  const ph     = S.ph;
  const micro  = S.microstructure; // real if OANDA connected
  const swing3 = SWING.pattern3;

  let score = 5;

  // Price slope (M1 proxy)
  if (ph.length >= 5) {
    const slope = (ph[ph.length-1] - ph[ph.length-5]) / (S.mem.atr.slice(-1)[0] || 15);
    score += Math.max(-1.5, Math.min(1.5, slope * 2));
  }

  // 3-candle pattern
  if (swing3.detected) {
    if (swing3.type === 'BEARISH_3C') score -= swing3.quality / 10 * 2;
    else if (swing3.type === 'BULLISH_3C') score += swing3.quality / 10 * 2;
  }

  // Real order flow delta (when OANDA connected)
  if (micro?.live) {
    const deltaSignal = micro.delta > 100 ? 1 : micro.delta < -100 ? -1 : 0;
    const imbalSignal = micro.bidPct > 65 ? 1 : micro.bidPct < 35 ? -1 : 0;
    score += deltaSignal * 0.8 + imbalSignal * 0.7;
  }

  score = Math.max(0, Math.min(10, score));
  const dir = score < 4 ? 'SELL' : score > 6 ? 'BUY' : 'NEUTRAL';
  return { score, direction: dir, name: 'MICRO', live: micro?.live || false };
}

function getExecutionSignal() {
  // Entry gates + precision entry + session quality
  const gates  = countGatesPassed();
  const sess   = S.session;
  const brain  = S.brain;
  const swing  = SWING;

  let score = 5;

  // Gate score (0-7 → 0-3 points)
  score += (gates / 7 - 0.5) * 6;

  // Session quality multiplier
  const sessQ = sess?.quality || 0.5;
  score += (sessQ - 1) * 1; // KZ adds ~0.5, off-hours subtracts

  // Swing cascade health
  score += (swing.cascade.score / 4 - 0.5) * 2;

  // Swing state bonus
  if (swing.state === 'ARMED')  score += 1;
  if (swing.state === 'ACTIVE') score += 0.5;
  if (swing.state === 'RANGE' || swing.state === 'STANDBY') score = 5; // neutral in bad states

  score = Math.max(0, Math.min(10, score));
  const dir = score < 4 ? 'SELL' : score > 6 ? 'BUY' : 'NEUTRAL';
  return { score, direction: dir, name: 'EXECUTION' };
}

function getMLSignal() {
  // Random Forest probability output
  const prob  = ML.predProb || 0.5;
  const dir   = ML.predDecision || 'WAIT';
  const grade = ML.predGrade || 'C';

  // ML score: map prob 0-1 → score 0-10
  // P(WIN) for current direction
  let score;
  if (dir === 'SELL') {
    score = (1 - prob) * 10; // high prob of loss for sell = high sell score
    // Wait — actually prob IS P(WIN). High P(WIN) for SELL = good sell signal
    score = prob * 10;
  } else if (dir === 'BUY') {
    score = prob * 10;
  } else {
    score = 5; // WAIT
  }

  // Grade modifier
  const gradeBonus = grade === 'A' ? 0.5 : grade === 'B' ? 0 : -0.5;
  score = Math.max(0, Math.min(10, score + gradeBonus));

  const finalDir = !ML.isTrained ? 'NEUTRAL'
    : score < 4 ? 'SELL' : score > 6 ? 'BUY' : 'NEUTRAL';
  return { score, direction: finalDir, name: 'ML_FOREST', trained: ML.isTrained };
}

// ── LOG-ODDS COMBINER ─────────────────────────────────────
// P(SELL|evidence) using log-odds addition across strategies
// Each strategy contributes a likelihood ratio based on its score

function runBayesianFusion() {
  // Get all 6 strategy signals
  const signals = [
    { signal: getStructureSignal(),    weight: BAYES.weights.structure  },
    { signal: getQuantSignal(),        weight: BAYES.weights.quant      },
    { signal: getAMTSignal(),          weight: BAYES.weights.amt        },
    { signal: getMicrostructureSignal(), weight: BAYES.weights.micro   },
    { signal: getExecutionSignal(),    weight: BAYES.weights.execution  },
    { signal: getMLSignal(),           weight: BAYES.weights.mlForest   },
  ];

  // Store for rendering
  BAYES.strategies = signals;

  // Prior: uniform (equal probability for BUY/SELL/NEUTRAL)
  let logOddsBuy  = 0;  // log(P(BUY))  - log(P(NEUTRAL))
  let logOddsSell = 0;  // log(P(SELL)) - log(P(NEUTRAL))

  for (const { signal, weight } of signals) {
    const w  = weight.w;
    const s  = signal.score; // 0-10, 5=neutral

    // Convert score to likelihood ratio
    // Score 10 → strong BUY evidence: LR_buy = 4, LR_sell = 0.25
    // Score 0  → strong SELL evidence: LR_buy = 0.25, LR_sell = 4
    // Score 5  → neutral: LR = 1 (no update)
    const deviation = (s - 5) / 5;       // -1 to +1
    const strength  = Math.abs(deviation) * 2.8 * w; // weighted strength

    if (deviation > 0.1) {
      // Evidence for BUY
      logOddsBuy  += strength;
      logOddsSell -= strength * 0.5; // slight evidence against SELL
    } else if (deviation < -0.1) {
      // Evidence for SELL
      logOddsSell += strength;
      logOddsBuy  -= strength * 0.5;
    }
    // Near-neutral signals don't move the posterior much
  }

  // Apply news blackout — collapse to neutral
  if (NB.blackoutActive) {
    logOddsBuy = 0; logOddsSell = 0;
  }

  // Convert log-odds back to probabilities via softmax
  const eLOBuy  = Math.exp(Math.min(5, logOddsBuy));
  const eLOSell = Math.exp(Math.min(5, logOddsSell));
  const eLONeut = 1; // neutral baseline
  const total   = eLOBuy + eLOSell + eLONeut;

  BAYES.pBuy  = eLOBuy  / total;
  BAYES.pSell = eLOSell / total;
  BAYES.pNeut = eLONeut / total;

  // Direction = highest posterior
  const maxP = Math.max(BAYES.pBuy, BAYES.pSell, BAYES.pNeut);
  BAYES.direction =
    maxP === BAYES.pBuy  && BAYES.pBuy  > 0.40 ? 'BUY'  :
    maxP === BAYES.pSell && BAYES.pSell > 0.40 ? 'SELL' : 'WAIT';

  // Edge: |pBuy - pSell|
  BAYES.edgePct   = Math.round(Math.abs(BAYES.pBuy - BAYES.pSell) * 100);
  BAYES.confidence = Math.round(maxP * 100);

  // ── MERGE INTO BRAIN SIGNAL ───────────────────────────
  // Bayesian output overrides simple additive brain score
  if (!NB.blackoutActive && S.brain) {
    const bayesDir   = BAYES.direction;
    const bayesConf  = BAYES.confidence;
    const bayesGrade = bayesConf >= 75 ? 'A' : bayesConf >= 60 ? 'B' : 'C';

    // Blend: 60% Bayesian, 40% existing rule-based
    const blendConf = Math.round(bayesConf * 0.6 + (S.brain.conf || 50) * 0.4);
    const blendDir  = bayesDir !== 'WAIT' ? bayesDir : S.brain.direction;

    S.brain.direction = blendDir;
    S.brain.conf      = Math.min(97, blendConf);
    S.brain.grade     = ML.isTrained && ML.trainingData.length >= 20
      ? ML.predGrade  // ML overrides when trained
      : bayesGrade;   // Bayesian grade otherwise
    S.brain.bayesian  = { pBuy: BAYES.pBuy, pSell: BAYES.pSell, pNeut: BAYES.pNeut, edge: BAYES.edgePct };
  }

  renderBayesianUI();
  return BAYES;
}

// ── WEIGHT CALIBRATION (Beta posterior) ───────────────────
function updateBayesWeights(strategyName, wasCorrect) {
  const weight = BAYES.weights[strategyName];
  if (!weight) return;
  weight.total++;
  if (wasCorrect) weight.hits++;

  // Beta posterior mean = (hits + 1) / (total + 2)
  const accuracy = (weight.hits + 1) / (weight.total + 2);

  // Normalise weights across all strategies
  BAYES.weights[strategyName].rawAcc = accuracy;
  const allAccs = Object.values(BAYES.weights).map(w => w.rawAcc || 0.5);
  const sumAcc  = allAccs.reduce((a, b) => a + b, 0);
  Object.keys(BAYES.weights).forEach((k, i) => {
    BAYES.weights[k].w = allAccs[i] / sumAcc;
  });

  saveBayesWeights();
  addAuditEntry('ML', `Bayes weight updated: ${strategyName} acc ${Math.round(accuracy*100)}% (${weight.hits}/${weight.total})`);
}

// Call this from swing slice close to update strategy weights
function calibrateBayesFromTrade(won) {
  // Determine which strategies predicted correctly
  if (!BAYES.strategies) return;
  const correctDir = won
    ? (SWING.direction || 'BUY')
    : (SWING.direction === 'SELL' ? 'BUY' : 'SELL'); // wrong direction

  const keyMap = {
    STRUCTURE: 'structure', QUANT: 'quant', AMT: 'amt',
    MICRO: 'micro', EXECUTION: 'execution', ML_FOREST: 'mlForest',
  };

  BAYES.strategies.forEach(({ signal }) => {
    const key = keyMap[signal.name];
    if (!key) return;
    const correct = signal.direction === correctDir || signal.direction === 'NEUTRAL';
    updateBayesWeights(key, correct);
  });
}

// ── BAYESIAN UI RENDERER ──────────────────────────────────
function renderBayesianUI() {
  // Posterior bars
  const pbuy  = Math.round(BAYES.pBuy  * 100);
  const psell = Math.round(BAYES.pSell * 100);
  const pneut = Math.round(BAYES.pNeut * 100);

  const buyBar  = document.getElementById('bayes-buy-bar');
  const sellBar = document.getElementById('bayes-sell-bar');
  const neutBar = document.getElementById('bayes-neut-bar');

  if (buyBar)  { buyBar.style.width  = pbuy  + '%'; buyBar.textContent  = pbuy  > 12 ? pbuy  + '%' : ''; }
  if (neutBar) { neutBar.style.width = pneut + '%'; }
  if (sellBar) { sellBar.style.width = psell + '%'; sellBar.textContent = psell > 12 ? psell + '%' : ''; }

  setText('bayes-pbuy',  pbuy  + '%');
  setText('bayes-pneut', pneut + '%');
  setText('bayes-psell', psell + '%');

  // Unified verdict
  const dir = BAYES.direction;
  const ue  = document.getElementById('q-unified-lbl');
  if (ue) {
    ue.textContent = dir === 'SELL' ? '▼ SELL SIGNAL' : dir === 'BUY' ? '▲ BUY SIGNAL' : NB.blackoutActive ? '🔴 BLACKOUT' : '◆ WAIT';
    ue.style.color = dir === 'SELL' ? 'var(--sell)' : dir === 'BUY' ? 'var(--buy)' : NB.blackoutActive ? 'var(--sell)' : 'var(--t3)';
  }
  setText('q-unified-score', BAYES.edgePct + '%');
  setText('q-unified-sub',
    `Bayesian posterior · 6 strategies · P(BUY): ${pbuy}% · P(SELL): ${psell}% · Edge: ${BAYES.edgePct}%`
  );

  // 6-strategy bars on quant page
  if (BAYES.strategies) {
    renderStrategyBars();
  }
}

// ── 6-STRATEGY BAR DISPLAY ────────────────────────────────
function renderStrategyBars() {
  // Find or create the strategy display container in Quant page
  let container = document.getElementById('strategyBars');
  if (!container) {
    // Inject into quant page below the unified verdict card
    const unifiedCard = document.querySelector('#page-quant .card:nth-child(3)');
    if (!unifiedCard) return;
    const stratCard = document.createElement('div');
    stratCard.className = 'card';
    stratCard.innerHTML = `
      <div class="card-hdr">
        <span class="card-title">6-STRATEGY BREAKDOWN — BAYESIAN WEIGHTS</span>
        <span style="font-size:10px;color:var(--t3);">Log-odds combiner · Self-calibrating weights</span>
      </div>
      <div class="card-body" id="strategyBars"></div>`;
    unifiedCard.after(stratCard);
    container = document.getElementById('strategyBars');
  }

  const stratColors = {
    STRUCTURE: ['var(--gold)',  '#f5a623'],
    QUANT:     ['var(--cyan)',  '#06b6d4'],
    AMT:       ['var(--piv)',   '#a855f7'],
    MICRO:     ['var(--sell)',  '#ef4444'],
    EXECUTION: ['var(--warn)',  '#f59e0b'],
    ML_FOREST: ['var(--buy)',   '#22c55e'],
  };

  container.innerHTML = (BAYES.strategies || []).map(({ signal, weight }) => {
    const [col] = stratColors[signal.name] || ['var(--t2)', '#94a3b8'];
    const pct   = (signal.score / 10 * 100).toFixed(0);
    const dir   = signal.direction;
    const dirCol = dir === 'SELL' ? 'var(--sell)' : dir === 'BUY' ? 'var(--buy)' : 'var(--t3)';
    const wPct  = (weight.w * 100).toFixed(0);
    const acc   = weight.rawAcc ? Math.round(weight.rawAcc * 100) + '%' : 'prior';

    return `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0;"></div>
            <span style="font-size:11px;font-weight:700;color:${col};">${signal.name.replace('_',' ')}</span>
            ${signal.live ? '<span style="font-size:9px;padding:1px 5px;background:var(--buydim);color:var(--buy);border-radius:3px;">LIVE</span>' : ''}
            ${!ML.isTrained && signal.name === 'ML_FOREST' ? '<span style="font-size:9px;padding:1px 5px;background:var(--warndim);color:var(--warn);border-radius:3px;">UNTRAINED</span>' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:10px;color:var(--t3);">w:${wPct}% acc:${acc}</span>
            <span style="font-size:12px;font-weight:700;color:${dirCol};">${dir}</span>
            <span style="font-size:12px;font-weight:700;font-family:var(--mono);color:${col};">${signal.score.toFixed(1)}/10</span>
          </div>
        </div>
        <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${col};border-radius:3px;transition:width .4s;"></div>
        </div>
      </div>`;
  }).join('');
}

// ── WIRE INTO MAIN ENGINE LOOP ────────────────────────────
const _origRunBrainSignal = window.runBrainSignal || runBrainSignal;
window.runBrainSignal = function() {
  _origRunBrainSignal();
  runBayesianFusion();
};

// Wire Bayesian weight calibration into swing trade close
const _origAddMLSample = window.addMLSample || addMLSample;
window.addMLSample = function(direction, entry, won) {
  _origAddMLSample(direction, entry, won);
  calibrateBayesFromTrade(won);
};

// ── BOOT ──────────────────────────────────────────────────
loadBayesWeights();
setTimeout(() => {
  // Run initial Bayesian fusion after brain signal is ready
  runBayesianFusion();
  // Trigger calendar on startup
  fetchEconCal();
  showBlackoutBanner(NB.blackoutActive);
  addAuditEntry('SYS', 'Bayesian Fusion Engine v5.6 active — 6 strategies · log-odds combiner');
  addAuditEntry('SYS', 'News Blackout Engine active — real-time propagation');
  addAuditEntry('SYS', 'Economic Calendar Engine active — countdown timers');
}, 2500);
