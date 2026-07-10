// NEXUS ZED v5.4 — Swing Engine

// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.4 — SWING ENGINE
// Full stateful execution machine
// States: IDLE → PRIMED → ARMED → ACTIVE → EXHAUSTING → FLIPPING → RANGE → STANDBY
// Slice lifecycle: OPEN → PARTIAL → HEDGED → RUNNER → CLOSED
// Cascade tracker: M1/M3/M5/M15 health monitoring
// Three-candle trigger pattern on M5 frame
// News blackout gate integration
// ═══════════════════════════════════════════════════════════

// ── SWING STATE OBJECT ────────────────────────────────────
const SWING = {
  // State machine
  state: 'IDLE',       // IDLE|PRIMED|ARMED|ACTIVE|EXHAUSTING|FLIPPING|RANGE|STANDBY
  prevState: null,
  stateTs: Date.now(),
  stateAge: 0,         // seconds in current state

  // Direction
  direction: null,     // 'SELL'|'BUY'|null
  originEdge: null,    // price level that primed the swing
  targetEdge: null,    // primary target level
  originZone: null,    // zone object that triggered priming
  flipCount: 0,        // how many times direction has flipped

  // Slices (position lifecycle)
  slices: [],          // [{id,side,entry,sl,hedge,tp1,tp2,tp3,status,openedAt,pnl}]
  sliceCounter: 0,
  totalPnL: 0,
  dailyPnL: 0,

  // Cascade health (multi-TF alignment)
  cascade: {
    m1:  false,        // M1 aligned
    m3:  false,        // M3/M5 aligned
    m15: false,        // M15 aligned
    h1:  false,        // H1 aligned
    score: 0,          // 0-4
  },

  // Three-candle pattern detector
  pattern3: {
    candles: [],       // last 3 M5 candles
    detected: false,
    type: null,        // 'BEARISH_3C'|'BULLISH_3C'
    quality: 0,
  },

  // Zone priming tracker
  primeExpiry: 0,      // timestamp when prime expires
  PRIME_TTL: 4 * 3600 * 1000,   // 4 hours

  // Pyramid levels (grade A only)
  pyramid: [],         // [{level, lot, status}]

  // Event log
  log: [],             // [{ts, event, detail}]
  MAX_LOG: 100,

  // Performance
  wins: 0, losses: 0, partials: 0,
};

// ── PERSIST/RESTORE SWING STATE ──────────────────────────
function saveSwingState() {
  try {
    const snap = {
      state: SWING.state, direction: SWING.direction,
      originEdge: SWING.originEdge, targetEdge: SWING.targetEdge,
      slices: SWING.slices, totalPnL: SWING.totalPnL,
      dailyPnL: SWING.dailyPnL, flipCount: SWING.flipCount,
      wins: SWING.wins, losses: SWING.losses,
      log: SWING.log.slice(0, 20),
      ts: Date.now(),
    };
    localStorage.setItem('nexus_swing', JSON.stringify(snap));
  } catch(e) {}
}

function loadSwingState() {
  try {
    const raw = localStorage.getItem('nexus_swing');
    if (!raw) return;
    const snap = JSON.parse(raw);
    // Only restore if within 24h
    if (Date.now() - snap.ts > 86400000) return;
    Object.assign(SWING, snap);
    addSwingLog('SYS', 'Swing state restored from session');
  } catch(e) {}
}

// ── SWING LOG ─────────────────────────────────────────────
function addSwingLog(type, detail) {
  const ts = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  SWING.log.unshift({ ts, type, detail });
  if (SWING.log.length > SWING.MAX_LOG) SWING.log.pop();
  addAuditEntry('SIGNAL', `SWING [${type}] ${detail}`);
}

// ── STATE MACHINE TRANSITION ──────────────────────────────
function swingTransition(newState, reason) {
  if (SWING.state === newState) return;
  SWING.prevState = SWING.state;
  SWING.state = newState;
  SWING.stateTs = Date.now();
  addSwingLog('STATE', `${SWING.prevState} → ${newState} | ${reason}`);
  renderSwingNavigator();
}

// ── CASCADE TRACKER ───────────────────────────────────────
function updateCascade() {
  const dir = SWING.direction;
  const br  = S.brain;
  const adx = STRUCTURE.adx;
  if (!dir || !br) return;

  const isBear = dir === 'SELL';

  // M1: short-term price slope
  const ph = S.ph;
  const slope3 = ph.length >= 4 ? (ph[ph.length-1] - ph[ph.length-4]) : 0;
  SWING.cascade.m1 = isBear ? slope3 < 0 : slope3 > 0;

  // M3/M5: structure aligned (BOS in correct direction)
  SWING.cascade.m3 = isBear
    ? STRUCTURE.bos === 'DOWN' || STRUCTURE.choch === 'BEARISH'
    : STRUCTURE.bos === 'UP'   || STRUCTURE.choch === 'BULLISH';

  // M15: ADX signal aligned
  SWING.cascade.m15 = adx.signal === (isBear ? 'SELL' : 'BUY') && adx.adx >= 20;

  // H1: macro + brain alignment
  SWING.cascade.h1 = br.direction === dir && (br.conf || 0) >= 55;

  SWING.cascade.score =
    (SWING.cascade.m1  ? 1 : 0) +
    (SWING.cascade.m3  ? 1 : 0) +
    (SWING.cascade.m15 ? 1 : 0) +
    (SWING.cascade.h1  ? 1 : 0);
}

// ── THREE-CANDLE PATTERN DETECTOR ────────────────────────
// Bearish 3C: bearish → bearish (lower) → bearish impulse (closing near low)
// Bullish 3C: bullish → bullish (higher) → bullish impulse (closing near high)
function detectThreeCandlePattern() {
  // Build pseudo-candles from M5 price history
  const ph = S.ph;
  if (ph.length < 12) return;

  const group = 4; // approx M5 from 5s ticks
  const candles = [];
  for (let i = Math.max(0, ph.length - group*4); i + group <= ph.length; i += group) {
    const seg = ph.slice(i, i + group);
    candles.push({ o: seg[0], h: Math.max(...seg), l: Math.min(...seg), c: seg[seg.length-1] });
  }
  if (candles.length < 3) return;

  const [c1, c2, c3] = candles.slice(-3);
  const atr = S.mem.atr.slice(-1)[0] || 15;
  const minBody = atr * 0.1;

  // Bearish 3-candle
  const b1Bear = c1.c < c1.o && (c1.o - c1.c) > minBody;
  const b2Bear = c2.c < c2.o && c2.h <= c1.h + atr*0.05;  // lower high
  const b3Bear = c3.c < c3.o && c3.c <= c2.l + atr*0.05   // closes below prior low
              && (c3.o - c3.c) > minBody * 1.5;             // strong close
  const bearish3C = b1Bear && b2Bear && b3Bear;

  // Bullish 3-candle
  const b1Bull = c1.c > c1.o && (c1.c - c1.o) > minBody;
  const b2Bull = c2.c > c2.o && c2.l >= c1.l - atr*0.05;  // higher low
  const b3Bull = c3.c > c3.o && c3.c >= c2.h - atr*0.05   // closes above prior high
              && (c3.c - c3.o) > minBody * 1.5;
  const bullish3C = b1Bull && b2Bull && b3Bull;

  const prevDetected = SWING.pattern3.detected;
  SWING.pattern3 = {
    candles: [c1, c2, c3],
    detected: bearish3C || bullish3C,
    type: bearish3C ? 'BEARISH_3C' : bullish3C ? 'BULLISH_3C' : null,
    quality: bearish3C || bullish3C ? Math.min(10, Math.round((atr > 0 ? Math.abs(c3.c - c3.o) / atr * 10 : 5))) : 0,
  };

  if (SWING.pattern3.detected && !prevDetected) {
    addSwingLog('TRIGGER', `3-candle pattern: ${SWING.pattern3.type} Q:${SWING.pattern3.quality}/10`);
  }
}

// ── SLICE MANAGEMENT ─────────────────────────────────────
function openSlice(direction, entry, sl, tp1, tp2, tp3) {
  const lot = S.posSize?.lot || 0.01;
  const id  = ++SWING.sliceCounter;
  const slice = {
    id,
    side: direction,
    entry: +entry.toFixed(2),
    sl:    +sl.toFixed(2),
    tp1:   +tp1.toFixed(2),
    tp2:   +tp2.toFixed(2),
    tp3:   +tp3.toFixed(2),
    lot,
    status: 'OPEN',       // OPEN|PARTIAL|HEDGED|RUNNER|CLOSED
    openedAt: Date.now(),
    partialTaken: false,
    hedgeHit: false,
    runnerActive: false,
    pnl: 0,
    closedAt: null,
  };
  SWING.slices.push(slice);
  addSwingLog('SLICE', `#${id} OPEN ${direction} @ ${entry.toFixed(2)} SL:${sl.toFixed(2)} TP1:${tp1.toFixed(2)}`);

  // Auto-log to journal
  const now = new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  ML.trades.unshift({
    ts: now, decision: direction, entry: entry, sl: sl,
    tp: tp1, grade: S.brain?.grade || 'B',
    prob: (S.brain?.conf || 50) / 100,
    sessName: S.session?.name || '—', outcome: 'OPEN',
  });
  if (ML.trades.length > 50) ML.trades.pop();
  saveSwingState();

  if (CFG.sndSignal) playSignalBeep(direction === 'SELL' ? 550 : 880);
  return slice;
}

function updateSlices() {
  const price = S.gold.price; if (!price) return;
  let changed = false;

  SWING.slices.filter(s => s.status !== 'CLOSED').forEach(sl => {
    const riskPts = Math.abs(sl.entry - sl.sl);

    // Partial at 1:1 (hedge)
    if (!sl.partialTaken) {
      const hitHedge = sl.side === 'SELL' ? price <= sl.entry - riskPts : price >= sl.entry + riskPts;
      if (hitHedge) {
        sl.partialTaken = true; sl.hedgeHit = true;
        sl.status = 'HEDGED'; sl.pnl = riskPts;
        addSwingLog('SLICE', `#${sl.id} HEDGED @ ${price.toFixed(2)} — 1R secured (${riskPts.toFixed(1)}pts)`);
        changed = true;
      }
    }

    // TP1 hit
    const hitTP1 = sl.side === 'SELL' ? price <= sl.tp1 : price >= sl.tp1;
    if (hitTP1 && sl.status === 'HEDGED' && !sl.runnerActive) {
      sl.runnerActive = true; sl.status = 'RUNNER';
      sl.pnl = Math.abs(sl.tp1 - sl.entry);
      addSwingLog('SLICE', `#${sl.id} TP1 HIT @ ${sl.tp1} — runner active to TP2:${sl.tp2}`);
      // Update journal
      const t = ML.trades.find(t => t.entry === sl.entry && t.outcome === 'OPEN');
      if (t) t.outcome = 'TP1';
      SWING.wins++; changed = true;
    }

    // SL hit — only if not hedged
    if (!sl.hedgeHit) {
      const hitSL = sl.side === 'SELL' ? price >= sl.sl : price <= sl.sl;
      if (hitSL) {
        sl.status = 'CLOSED'; sl.closedAt = Date.now();
        sl.pnl = -Math.abs(sl.sl - sl.entry);
        SWING.totalPnL += sl.pnl; SWING.dailyPnL += sl.pnl;
        addSwingLog('SLICE', `#${sl.id} SL HIT @ ${price.toFixed(2)} — loss ${sl.pnl.toFixed(1)}pts`);
        const t = ML.trades.find(t => t.entry === sl.entry && t.outcome === 'OPEN');
        if (t) t.outcome = 'SL';
        SWING.losses++; changed = true;
        // Add ML training sample
        addMLSample(sl.side, sl.entry, false);
      }
    }

    // Runner TP2 hit
    const hitTP2 = sl.side === 'SELL' ? price <= sl.tp2 : price >= sl.tp2;
    if (hitTP2 && sl.status === 'RUNNER') {
      sl.status = 'CLOSED'; sl.closedAt = Date.now();
      sl.pnl = Math.abs(sl.tp2 - sl.entry);
      SWING.totalPnL += sl.pnl; SWING.dailyPnL += sl.pnl;
      addSwingLog('SLICE', `#${sl.id} TP2 HIT @ ${sl.tp2} — full close ${sl.pnl.toFixed(1)}pts`);
      const t = ML.trades.find(t => t.entry === sl.entry);
      if (t) t.outcome = 'TP2';
      addMLSample(sl.side, sl.entry, true);
      changed = true;
    }
  });

  if (changed) {
    saveSwingState();
    renderSwingNavigator();
    renderJournalPage();
  }
}

// ── ML TRAINING SAMPLE ───────────────────────────────────
function addMLSample(direction, entry, won) {
  const fv = {
    macro:   S.macroState?.macroScore || 5,
    adx:     STRUCTURE.adx?.adx || 0,
    sweep:   STRUCTURE.liqSweep ? 1 : 0,
    bos:     STRUCTURE.bos ? 1 : 0,
    zone:    (ZONES.sell1 || ZONES.buy1) ? 1 : 0,
    session: S.session?.quality || 0.5,
    conf:    (S.brain?.conf || 50) / 100,
    cascade: SWING.cascade.score / 4,
  };
  ML.trainingData.push({ features: fv, label: won ? 1 : 0, ts: Date.now() });
  if (ML.trainingData.length > 200) ML.trainingData.shift();
  if (ML.trainingData.length >= 10) trainMLModel();
  persistState();
}

// ── FAILURE DETECTION (structure break) ──────────────────
function checkSwingFailure() {
  if (SWING.state !== 'ACTIVE') return;
  const price = S.gold.price; if (!price) return;

  const openSlices = SWING.slices.filter(s => s.status === 'OPEN' || s.status === 'HEDGED');
  if (!openSlices.length) return;

  // Failure: M15 structure break in opposite direction
  const isFailure = SWING.direction === 'SELL'
    ? STRUCTURE.bos === 'UP' && STRUCTURE.choch === 'BULLISH'
    : STRUCTURE.bos === 'DOWN' && STRUCTURE.choch === 'BEARISH';

  if (isFailure && SWING.cascade.score <= 1) {
    addSwingLog('ALERT', `Structure failure detected — cascade score ${SWING.cascade.score}/4. Consider closing unhedged slices.`);
    swingTransition('EXHAUSTING', 'Opposing structure break + low cascade');
  }
}

// ── FLIP DETECTION ────────────────────────────────────────
function checkSwingFlip() {
  if (SWING.state !== 'EXHAUSTING' && SWING.state !== 'ACTIVE') return;
  const br = S.brain;
  if (!br) return;

  // Flip: brain direction opposite to current swing direction
  const shouldFlip = br.direction !== 'WAIT' && br.direction !== SWING.direction
    && (br.conf || 0) >= 70
    && SWING.cascade.score >= 2;

  if (shouldFlip) {
    const newDir = br.direction;
    SWING.direction = newDir;
    SWING.flipCount++;
    swingTransition('FLIPPING', `Direction flip to ${newDir} — brain conf ${Math.round(br.conf)}%`);
    addSwingLog('FLIP', `Swing flipped to ${newDir} (flip #${SWING.flipCount})`);
    setTimeout(() => {
      if (SWING.state === 'FLIPPING') swingTransition('PRIMED', 'Post-flip priming');
    }, 2000);
  }
}

// ── MAIN SWING ENGINE ─────────────────────────────────────
function runSwingEngine() {
  const price = S.gold.price; if (!price) return;
  const br    = S.brain;
  const atr   = S.mem.atr.slice(-1)[0] || 15;
  const ts    = S.tradeSetup;

  // Update state age
  SWING.stateAge = Math.round((Date.now() - SWING.stateTs) / 1000);

  // News blackout gate — freeze signals
  if (window._newsBlackout && SWING.state !== 'ACTIVE') {
    if (SWING.state !== 'STANDBY') {
      swingTransition('STANDBY', 'News blackout active — all signals frozen');
    }
    updateCascade();
    updateSlices();
    renderSwingNavigator();
    return;
  }

  // Exit standby after blackout clears
  if (SWING.state === 'STANDBY' && !window._newsBlackout) {
    swingTransition('IDLE', 'News blackout cleared');
  }

  updateCascade();
  detectThreeCandlePattern();
  updateSlices();
  checkSwingFailure();
  checkSwingFlip();

  // ── STATE TRANSITIONS ──────────────────────────────────

  switch (SWING.state) {
    case 'IDLE': {
      // Prime when brain has a direction + price near a zone
      const nearZone = br?.direction === 'SELL'
        ? (ZONES.sell1 && Math.abs(price - ZONES.sell1.lo) < atr * 2)
        : (ZONES.buy1  && Math.abs(price - ZONES.buy1.hi)  < atr * 2);

      if (br?.direction && br.direction !== 'WAIT' && (br.conf || 0) >= 50 && nearZone) {
        SWING.direction  = br.direction;
        SWING.originEdge = price;
        SWING.originZone = br.direction === 'SELL' ? ZONES.sell1 : ZONES.buy1;
        SWING.primeExpiry = Date.now() + SWING.PRIME_TTL;
        swingTransition('PRIMED', `Brain ${br.direction} ${Math.round(br.conf)}% conf — price near zone`);
      }
      break;
    }

    case 'PRIMED': {
      // Expire prime if too old
      if (Date.now() > SWING.primeExpiry) {
        swingTransition('IDLE', 'Prime expired (4h TTL)');
        SWING.direction = null;
        break;
      }

      // Arm when sweep + cascade ≥ 2
      const hasSweep = !!STRUCTURE.liqSweep;
      const goodCascade = SWING.cascade.score >= 2;
      const brAligned = br?.direction === SWING.direction && (br?.conf || 0) >= 60;

      if (hasSweep && goodCascade && brAligned) {
        SWING.targetEdge = SWING.direction === 'SELL'
          ? (ZONES.buy1?.hi || price - atr * 4)
          : (ZONES.sell1?.lo || price + atr * 4);
        swingTransition('ARMED', `Sweep ${STRUCTURE.liqSweep.type} + cascade ${SWING.cascade.score}/4`);
      }
      break;
    }

    case 'ARMED': {
      // Trigger: 3-candle pattern OR gates ≥ 6 → open slice
      const gatesPassed = countGatesPassed();
      const triggerPattern = SWING.pattern3.detected &&
        ((SWING.direction === 'SELL' && SWING.pattern3.type === 'BEARISH_3C') ||
         (SWING.direction === 'BUY'  && SWING.pattern3.type === 'BULLISH_3C'));
      const triggerGates = gatesPassed >= 6;

      if ((triggerPattern || triggerGates) && ts) {
        const entry = ts.entry, sl = ts.sl;
        const risk  = Math.abs(entry - sl);
        const tp1   = ts.tp1, tp2 = ts.tp2, tp3 = ts.tp3;

        openSlice(SWING.direction, entry, sl, tp1, tp2, tp3);

        // Pyramid (Grade A only)
        if ((br?.grade || 'C') === 'A' && SWING.cascade.score >= 3) {
          SWING.pyramid = [
            { level: entry, lot: S.posSize?.lot || 0.01, status: 'FILLED' },
            { level: SWING.direction === 'SELL' ? entry - risk * 0.5 : entry + risk * 0.5, lot: (S.posSize?.lot || 0.01) * 0.5, status: 'PENDING' },
            { level: SWING.direction === 'SELL' ? entry - risk        : entry + risk,       lot: (S.posSize?.lot || 0.01) * 0.5, status: 'PENDING' },
          ];
          addSwingLog('PYRAMID', `Grade A — 3-slice pyramid queued`);
        }

        swingTransition('ACTIVE', `${triggerPattern ? '3C pattern' : 'Gates 6/7'} trigger — slice #${SWING.sliceCounter} opened`);
      }
      break;
    }

    case 'ACTIVE': {
      // Activate pending pyramid slices
      if (SWING.pyramid.length) {
        SWING.pyramid.filter(p => p.status === 'PENDING').forEach(p => {
          const hit = SWING.direction === 'SELL' ? price <= p.level : price >= p.level;
          if (hit && ts) {
            openSlice(SWING.direction, p.level, ts.sl, ts.tp1, ts.tp2, ts.tp3);
            p.status = 'FILLED';
            addSwingLog('PYRAMID', `Pyramid slice filled @ ${p.level.toFixed(2)}`);
          }
        });
      }

      // Go to EXHAUSTING if no open slices left
      const openCount = SWING.slices.filter(s => s.status !== 'CLOSED').length;
      if (!openCount) {
        swingTransition('EXHAUSTING', 'All slices closed');
      }
      break;
    }

    case 'EXHAUSTING': {
      // Wait for slices to close, then reset
      const openCount = SWING.slices.filter(s => s.status !== 'CLOSED').length;
      if (!openCount) {
        // Cool-down then back to IDLE (or flip if signal exists)
        setTimeout(() => {
          if (SWING.state === 'EXHAUSTING') {
            SWING.slices = []; SWING.pyramid = [];
            swingTransition('IDLE', 'Cool-down complete — ready for next setup');
          }
        }, 30000); // 30s cool-down
      }
      break;
    }

    case 'RANGE': {
      // Zone bounce setups only — standard swing temporarily disabled
      if (SWING.cascade.score >= 3 && STRUCTURE.adx.adx >= 25) {
        swingTransition('IDLE', 'Trend returned — range mode exiting');
      }
      break;
    }
  }

  // Range detection
  if (SWING.state === 'IDLE' && STRUCTURE.adx.adx < 18 && S.ph.length > 20) {
    swingTransition('RANGE', `Low ADX ${STRUCTURE.adx.adx.toFixed(1)} — range mode`);
  }

  saveSwingState();
  renderSwingNavigator();
}

// ── GATE COUNT HELPER ─────────────────────────────────────
function countGatesPassed() {
  const adx = STRUCTURE.adx;
  return [
    !!STRUCTURE.bos || !!STRUCTURE.choch,
    adx.adx >= 25,
    !!(ZONES.sell1 || ZONES.buy1),
    !!STRUCTURE.liqSweep,
    S.brain?.checks?.macro || false,
    S.session?.inKZ || false,
    !window._newsBlackout,
  ].filter(Boolean).length;
}

// ── SWING NAVIGATOR RENDERER ──────────────────────────────
function renderSwingNavigator() {
  const nav = document.getElementById('swingNavigator');
  if (!nav) return;

  const stateColors = {
    IDLE: 'var(--t3)', PRIMED: 'var(--warn)', ARMED: 'var(--gold)',
    ACTIVE: 'var(--buy)', EXHAUSTING: 'var(--piv)',
    FLIPPING: 'var(--cyan)', RANGE: 'var(--blue)', STANDBY: 'var(--sell)',
  };
  const stateColor = stateColors[SWING.state] || 'var(--t3)';

  const openSlices   = SWING.slices.filter(s => s.status !== 'CLOSED');
  const closedSlices = SWING.slices.filter(s => s.status === 'CLOSED');
  const totalPnL     = SWING.slices.reduce((sum, s) => sum + (s.pnl || 0), 0);

  // State age display
  const age = SWING.stateAge;
  const ageStr = age < 60 ? age + 's' : age < 3600 ? Math.floor(age/60) + 'm' : Math.floor(age/3600) + 'h';

  nav.innerHTML = `
    <!-- STATE HEADER -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px;background:var(--bg2);border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:4px;">SWING STATE</div>
        <div style="font-size:22px;font-weight:800;color:${stateColor};letter-spacing:1px;">${SWING.state}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px;">${ageStr} in state${SWING.direction ? ' · ' + SWING.direction : ''}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:var(--t3);margin-bottom:4px;">SESSION P&L</div>
        <div style="font-size:20px;font-weight:800;font-family:var(--mono);color:${totalPnL >= 0 ? 'var(--buy)' : 'var(--sell)'};">
          ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(1)} pts
        </div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;">${SWING.wins}W · ${SWING.losses}L · Flip#${SWING.flipCount}</div>
      </div>
    </div>

    <!-- CASCADE HEALTH -->
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);">
      <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:8px;">CASCADE HEALTH — ${SWING.cascade.score}/4 TFs ALIGNED</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        ${[['M1', SWING.cascade.m1], ['M5', SWING.cascade.m3], ['M15', SWING.cascade.m15], ['H1', SWING.cascade.h1]].map(([tf, ok]) => `
          <div style="text-align:center;padding:6px 4px;border-radius:6px;background:${ok ? 'var(--buydim)' : 'var(--bg3)'};border:1px solid ${ok ? 'var(--buyborder)' : 'var(--border)'};">
            <div style="font-size:9px;font-weight:700;color:${ok ? 'var(--buy)' : 'var(--t3)'};">${tf}</div>
            <div style="font-size:14px;margin-top:2px;">${ok ? '✅' : '⬜'}</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:6px;">
        <div style="height:4px;background:var(--bg3);border-radius:2px;overflow:hidden;">
          <div style="width:${SWING.cascade.score/4*100}%;height:100%;background:${SWING.cascade.score>=3?'var(--buy)':SWING.cascade.score>=2?'var(--gold)':'var(--warn)'};border-radius:2px;transition:width .4s;"></div>
        </div>
      </div>
    </div>

    <!-- 3-CANDLE PATTERN -->
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:3px;">3-CANDLE TRIGGER</div>
        <div style="font-size:13px;font-weight:700;color:${SWING.pattern3.detected ? (SWING.pattern3.type === 'BEARISH_3C' ? 'var(--sell)' : 'var(--buy)') : 'var(--t3)'};">
          ${SWING.pattern3.detected ? SWING.pattern3.type.replace('_',' ') : 'NOT DETECTED'}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:var(--t3);">QUALITY</div>
        <div style="font-size:20px;font-weight:800;color:${SWING.pattern3.quality >= 7 ? 'var(--buy)' : SWING.pattern3.quality >= 4 ? 'var(--gold)' : 'var(--t3)'};">
          ${SWING.pattern3.detected ? SWING.pattern3.quality + '/10' : '—'}
        </div>
      </div>
    </div>

    <!-- ORIGIN / TARGET EDGES -->
    ${SWING.state !== 'IDLE' && SWING.state !== 'RANGE' ? `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <div style="font-size:10px;color:var(--t3);margin-bottom:3px;">ORIGIN EDGE</div>
        <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:var(--gold);">
          ${SWING.originEdge ? '$' + Math.round(SWING.originEdge).toLocaleString() : '—'}
        </div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;">${SWING.originZone?.type || '—'}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--t3);margin-bottom:3px;">TARGET EDGE</div>
        <div style="font-size:14px;font-weight:700;font-family:var(--mono);color:${SWING.direction === 'SELL' ? 'var(--sell)' : 'var(--buy)'};">
          ${SWING.targetEdge ? '$' + Math.round(SWING.targetEdge).toLocaleString() : '—'}
        </div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px;">
          ${SWING.targetEdge && S.gold.price ? Math.round(Math.abs(S.gold.price - SWING.targetEdge)) + ' pts away' : '—'}
        </div>
      </div>
    </div>` : ''}

    <!-- OPEN SLICES TABLE -->
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);">
      <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:8px;">
        ACTIVE SLICES (${openSlices.length}) · CLOSED (${closedSlices.length})
      </div>
      ${openSlices.length ? `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="color:var(--t3);font-size:9px;letter-spacing:.5px;">
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid var(--border);">#</th>
              <th style="padding:4px 6px;text-align:left;border-bottom:1px solid var(--border);">SIDE</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">ENTRY</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">SL</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">TP1</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">STATUS</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:1px solid var(--border);">P&L</th>
            </tr>
          </thead>
          <tbody>
            ${openSlices.map(s => {
              const liveP = S.gold.price || s.entry;
              const livePnL = s.side === 'SELL' ? s.entry - liveP : liveP - s.entry;
              const pnlCol = livePnL >= 0 ? 'var(--buy)' : 'var(--sell)';
              const statCols = { OPEN:'var(--gold)', PARTIAL:'var(--warn)', HEDGED:'var(--cyan)', RUNNER:'var(--buy)', CLOSED:'var(--t3)' };
              return `<tr style="border-bottom:1px solid rgba(255,255,255,.03);">
                <td style="padding:5px 6px;color:var(--t3);">${s.id}</td>
                <td style="padding:5px 6px;font-weight:700;color:${s.side==='SELL'?'var(--sell)':'var(--buy)'};">${s.side}</td>
                <td style="padding:5px 6px;text-align:right;font-family:var(--mono);">${s.entry.toFixed(2)}</td>
                <td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--sell);">${s.sl.toFixed(2)}</td>
                <td style="padding:5px 6px;text-align:right;font-family:var(--mono);color:var(--buy);">${s.tp1.toFixed(2)}</td>
                <td style="padding:5px 6px;text-align:right;"><span style="padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.05);color:${statCols[s.status]||'var(--t3)'};font-size:9px;font-weight:700;">${s.status}</span></td>
                <td style="padding:5px 6px;text-align:right;font-family:var(--mono);font-weight:700;color:${pnlCol};">${livePnL >= 0 ? '+' : ''}${livePnL.toFixed(1)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `<div style="color:var(--t3);font-size:12px;padding:8px 0;">No open slices — ${SWING.state === 'IDLE' ? 'waiting for setup' : SWING.state === 'PRIMED' ? 'primed — awaiting sweep' : SWING.state === 'ARMED' ? '⚡ ARMED — trigger imminent' : 'monitoring...'}.</div>`}
    </div>

    <!-- PYRAMID LEVELS -->
    ${SWING.pyramid.length ? `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border);">
      <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:6px;">PYRAMID SLICES — GRADE A</div>
      ${SWING.pyramid.map((p, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03);">
          <div style="font-size:11px;color:var(--t3);">Slice ${i+1}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--gold);">$${p.level.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--t3);">${p.lot} lots</div>
          <span style="padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;background:${p.status==='FILLED'?'var(--buydim)':'var(--bg3)'};color:${p.status==='FILLED'?'var(--buy)':'var(--t3)'};">${p.status}</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- SWING LOG -->
    <div style="padding:10px 14px;">
      <div style="font-size:10px;color:var(--t3);letter-spacing:.8px;margin-bottom:6px;">SWING EVENT LOG</div>
      <div style="max-height:120px;overflow-y:auto;">
        ${SWING.log.slice(0, 15).map(e => {
          const typeCol = { STATE:'var(--piv)', SLICE:'var(--gold)', TRIGGER:'var(--cyan)', FLIP:'var(--warn)', ALERT:'var(--sell)', PYRAMID:'var(--buy)', SYS:'var(--t3)' };
          return `<div style="display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.03);font-size:10px;">
            <span style="color:var(--t3);flex-shrink:0;font-family:var(--mono);">${e.ts}</span>
            <span style="padding:0 5px;border-radius:3px;background:rgba(255,255,255,.04);color:${typeCol[e.type]||'var(--t2)'};font-size:9px;font-weight:700;flex-shrink:0;">${e.type}</span>
            <span style="color:var(--t2);line-height:1.4;">${e.detail}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ── INJECT SWING NAVIGATOR INTO EXECUTION PAGE ────────────
function injectSwingNavigator() {
  // Find execution page and add Swing Navigator card after existing content
  const execPage = document.getElementById('page-execution');
  if (!execPage || document.getElementById('swingNavigator')) return;

  const modPage = execPage.querySelector('.mod-page');
  if (!modPage) return;

  // Create the swing navigator card
  const navCard = document.createElement('div');
  navCard.className = 'card';
  navCard.style.cssText = 'border-color:var(--goldborder);';
  navCard.innerHTML = `
    <div class="card-hdr" style="background:var(--golddim);">
      <span class="card-title" style="color:var(--gold);">⚡ SWING NAVIGATOR v1.0</span>
      <div style="display:flex;gap:6px;align-items:center;">
        <div id="sw-state-pill" style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:var(--bg3);color:var(--t3);">IDLE</div>
        <button onclick="swingManualReset()" style="padding:3px 8px;border-radius:5px;background:var(--bg3);border:1px solid var(--border2);color:var(--t3);font-size:10px;cursor:pointer;font-family:var(--font);">Reset</button>
      </div>
    </div>
    <div id="swingNavigator"></div>
  `;
  modPage.appendChild(navCard);
  renderSwingNavigator();
}

function swingManualReset() {
  if (!confirm('Reset swing state? All open slices will be marked as manually closed.')) return;
  SWING.slices.forEach(s => { if (s.status !== 'CLOSED') { s.status = 'CLOSED'; s.closedAt = Date.now(); } });
  SWING.state = 'IDLE'; SWING.prevState = null;
  SWING.stateTs = Date.now(); SWING.direction = null;
  SWING.originEdge = null; SWING.targetEdge = null;
  SWING.pyramid = []; SWING.pattern3 = { candles:[], detected:false, type:null, quality:0 };
  addSwingLog('SYS', 'Manual reset by user');
  saveSwingState(); renderSwingNavigator();
}

// ── WIRE INTO PAGE NAVIGATION ─────────────────────────────
const _origGoPageSwing = window.goPage;
window.goPage = function(name) {
  _origGoPageSwing(name);
  if (name === 'execution') {
    injectSwingNavigator();
    renderSwingNavigator();
  }
};

// ── WIRE INTO MAIN RENDER LOOP ────────────────────────────
const _origRenderAll = window.renderAll;
window.renderAll = function() {
  _origRenderAll();
  // Update swing state pill
  const pill = document.getElementById('sw-state-pill');
  if (pill) {
    const stateColors = { IDLE:'#475569', PRIMED:'#f59e0b', ARMED:'#f5a623',
      ACTIVE:'#22c55e', EXHAUSTING:'#a855f7', FLIPPING:'#06b6d4',
      RANGE:'#3b82f6', STANDBY:'#ef4444' };
    pill.textContent = SWING.state;
    pill.style.background = (stateColors[SWING.state] || '#475569') + '22';
    pill.style.color = stateColors[SWING.state] || '#475569';
  }
};

// ── BOOT ─────────────────────────────────────────────────
loadSwingState();
injectSwingNavigator();

// Run swing engine every 5 seconds
setInterval(runSwingEngine, 5000);
runSwingEngine(); // immediate first run

addAuditEntry('SYS', 'Swing Engine v1.0 active — state: ' + SWING.state);
