// NEXUS ZED — Chart Engine v2

// ═══════════════════════════════════════════════════════════
// NEXUS CHART ENGINE v2 — Production OHLC Renderer
// Real candles · Pan/Zoom · EMA · PDH/PDL · Zones · FVGs
// OBs · Equal H/L pools · Liquidity sweep markers
// Graceful: falls back to tick-built candles without API key
// ═══════════════════════════════════════════════════════════

// ── Chart viewport state ──────────────────────────────────
const CS = {
  // Pan/zoom
  offsetBars: 0,          // how many bars panned from right edge
  visibleBars: 60,        // bars visible (zoom level)
  minBars: 10,
  maxBars: 200,

  // Interaction
  dragging: false,
  dragStartX: 0,
  dragStartOffset: 0,
  lastPinchDist: 0,

  // Layout (pixels)
  PRICE_COL: 56,          // right-side price axis width
  TIME_ROW: 18,           // bottom time axis height
  PAD_TOP: 0.08,          // % of range padding top
  PAD_BOT: 0.08,          // % of range padding bottom

  // EMA state
  ema20: [],
  ema50: [],

  // Crosshair
  crossX: -1,
  crossY: -1,
  showCross: false,

  // Data source label
  dataSource: 'COMPUTING',
};

// ── EMA computation ───────────────────────────────────────
function computeEMA(prices, period) {
  if (!prices || prices.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (i === period - 1) { result.push(ema); continue; }
    ema = prices[i] * k + ema * (1 - k);
    result.push(+ema.toFixed(3));
  }
  return result;
}

// ── Canonical candle source — TF aware ───────────────────
function getCandlesForTF(tf) {
  const map = { '1m': 'm1', '5m': 'm5', '15m': 'm15', '1H': 'h1', '4H': 'h4', 'D': 'd1' };
  const key = map[tf] || 'm15';

  // Real OHLC from Twelve Data
  if (CANDLES[key] && CANDLES[key].length >= 5) {
    CS.dataSource = 'LIVE OHLC';
    return CANDLES[key];
  }

  // Real OANDA tick stream — build micro-candles from OF ticks
  if (OF && OF.connected && OF.ticks && OF.ticks.length >= 4) {
    const periodMs = { '1m': 60000, '5m': 300000, '15m': 900000, '1H': 3600000, '4H': 14400000, 'D': 86400000 }[tf] || 900000;
    const candles = buildCandlesFromTicks(OF.ticks, periodMs);
    if (candles.length >= 3) {
      CS.dataSource = 'OANDA TICKS';
      return candles;
    }
  }

  // Fallback: group price history into pseudo-candles
  const ph = S.ph;
  if (ph.length < 4) return [];
  const group = Math.max(2, Math.min(8, Math.floor(ph.length / 40)));
  const candles = [];
  for (let i = 0; i + group <= ph.length; i += group) {
    const seg = ph.slice(i, i + group);
    candles.push({
      o: seg[0], h: Math.max(...seg),
      l: Math.min(...seg), c: seg[seg.length - 1],
      t: Date.now() - (ph.length - i) * 5000,
    });
  }
  CS.dataSource = ph.length > 20 ? 'PRICE HISTORY' : 'COMPUTING';
  return candles;
}

// ── Build candles from OANDA tick array ───────────────────
function buildCandlesFromTicks(ticks, periodMs) {
  if (!ticks || !ticks.length) return [];
  const candles = [];
  let current = null;
  for (const tick of ticks) {
    const bucketTs = Math.floor(tick.t / periodMs) * periodMs;
    if (!current || current.t !== bucketTs) {
      if (current) candles.push(current);
      current = { t: bucketTs, o: tick.mid, h: tick.mid, l: tick.mid, c: tick.mid };
    } else {
      current.h = Math.max(current.h, tick.mid);
      current.l = Math.min(current.l, tick.mid);
      current.c = tick.mid;
    }
  }
  if (current) candles.push(current);
  return candles;
}

// ── Format timestamp for time axis ───────────────────────
function fmtCandleTime(ts, tf) {
  if (!ts) return '';
  const d = new Date(ts);
  if (tf === 'D') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Main chart render ─────────────────────────────────────
function renderChart() {
  if (showingTV) return;
  const canvas = el('mainCanvas'); if (!canvas) return;
  const area = el('ourChartArea');
  const dpr = window.devicePixelRatio || 1;
  const W = area.offsetWidth  || 600;
  const H = area.offsetHeight || 320;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Layout
  const PC = CS.PRICE_COL;   // right price axis
  const TR = CS.TIME_ROW;    // bottom time axis
  const CW = W - PC;         // chart width
  const CH = H - TR;         // chart height

  // Get candles
  const allCandles = getCandlesForTF(activeTF);

  // Draw loading state if no data
  if (!allCandles || allCandles.length < 2) {
    ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(148,163,184,.25)';
    ctx.font = '12px Inter'; ctx.textAlign = 'center';
    ctx.fillText(CS.dataSource === 'COMPUTING' ? 'Fetching price data...' : 'Loading ' + activeTF + ' candles...', W / 2, H / 2 - 10);
    ctx.fillStyle = 'rgba(245,166,35,.4)'; ctx.font = '10px Inter';
    ctx.fillText('Add Twelve Data key in ⚙ Settings for real OHLC', W / 2, H / 2 + 10);
    return;
  }

  // Viewport: rightmost bars
  const totalBars = allCandles.length;
  CS.offsetBars = Math.max(0, Math.min(totalBars - CS.visibleBars, CS.offsetBars));
  const endIdx   = Math.max(CS.visibleBars, totalBars - CS.offsetBars);
  const startIdx = Math.max(0, endIdx - CS.visibleBars);
  const visible  = allCandles.slice(startIdx, endIdx);
  if (!visible.length) return;

  // Y range from visible candles + active zones
  const highs = visible.map(c => c.h);
  const lows  = visible.map(c => c.l);
  let yMax = Math.max(...highs);
  let yMin = Math.min(...lows);
  // Expand to include zones
  if (ZONES.sell1) yMax = Math.max(yMax, ZONES.sell1.hi);
  if (ZONES.buy1)  yMin = Math.min(yMin, ZONES.buy1.lo);
  const yRng = yMax - yMin || 10;
  yMax += yRng * CS.PAD_TOP;
  yMin -= yRng * CS.PAD_BOT;

  // Coordinate transforms
  const toX = i => (i / visible.length) * CW;
  const toY = p => CH - ((p - yMin) / (yMax - yMin)) * CH;
  const candleW = Math.max(1, (CW / visible.length) * 0.75);

  // EMA computation from closes
  const closes = allCandles.map(c => c.c);
  CS.ema20 = computeEMA(closes, 20);
  CS.ema50 = computeEMA(closes, 50);

  // ── Background ──────────────────────────────────────────
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H);

  // ── Price axis background ──
  ctx.fillStyle = '#111118'; ctx.fillRect(CW, 0, PC, H);
  ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CW, 0); ctx.lineTo(CW, H); ctx.stroke();

  // ── Time axis background ──
  ctx.fillStyle = '#111118'; ctx.fillRect(0, CH, CW, TR);
  ctx.beginPath(); ctx.moveTo(0, CH); ctx.lineTo(CW, CH); ctx.stroke();

  // ── Horizontal grid lines + price labels ──────────────
  const gridCount = 6;
  ctx.font = '9px JetBrains Mono';
  for (let i = 0; i <= gridCount; i++) {
    const pct  = i / gridCount;
    const pval = yMax - pct * (yMax - yMin);
    const y    = toY(pval);
    if (y < 0 || y > CH) continue;
    // Grid line
    ctx.strokeStyle = 'rgba(42,42,58,.6)'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    ctx.setLineDash([]);
    // Price label
    ctx.fillStyle = '#475569'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(pval).toLocaleString(), W - 4, y + 3);
  }

  // ── Time axis labels ──────────────────────────────────
  ctx.font = '8px JetBrains Mono'; ctx.fillStyle = '#374151'; ctx.textAlign = 'center';
  const timeStep = Math.max(1, Math.floor(visible.length / 8));
  visible.forEach((c, i) => {
    if (i % timeStep !== 0) return;
    const x = toX(i) + candleW / 2;
    ctx.fillText(fmtCandleTime(c.t, activeTF), x, H - 4);
    // Vertical grid tick
    ctx.strokeStyle = 'rgba(42,42,58,.4)'; ctx.lineWidth = 1; ctx.setLineDash([2,6]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); ctx.setLineDash([]);
  });

  // ── ZONE RENDERING ────────────────────────────────────
  function drawZoneRect(lo, hi, color, label, alpha) {
    const y1 = toY(hi), y2 = toY(lo);
    // Clip to chart area
    const cy1 = Math.max(0, Math.min(CH, y1));
    const cy2 = Math.max(0, Math.min(CH, y2));
    if (cy1 >= CH && cy2 >= CH) return;
    if (cy1 <= 0  && cy2 <= 0)  return;
    const h = Math.abs(cy2 - cy1);
    if (h < 1) return;
    // Fill
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, Math.min(cy1, cy2), CW, h);
    ctx.globalAlpha = 1;
    // Top border line
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(0, cy1); ctx.lineTo(CW, cy1); ctx.stroke();
    ctx.globalAlpha = 1;
    // Label
    if (showZoneLabels && label && cy1 > 4 && cy1 < CH - 4) {
      ctx.font = 'bold 9px Inter'; ctx.fillStyle = color; ctx.textAlign = 'left';
      ctx.globalAlpha = 0.9;
      ctx.fillText(label, 4, Math.min(cy1, cy2) + 12);
      ctx.globalAlpha = 1;
    }
  }

  // Supply zones (red)
  if (ZONES.sell1) drawZoneRect(ZONES.sell1.lo, ZONES.sell1.hi, '#ef4444', '▼ ' + (ZONES.sell1.tf || '4H') + ' SUPPLY', 0.10);
  if (ZONES.sell2) drawZoneRect(ZONES.sell2.lo, ZONES.sell2.hi, '#f59e0b', '▼ ' + (ZONES.sell2.tf || 'H1') + ' SUPPLY', 0.07);

  // Demand zones (green)
  if (ZONES.buy1) drawZoneRect(ZONES.buy1.lo, ZONES.buy1.hi, '#22c55e', '▲ ' + (ZONES.buy1.tf || '4H') + ' DEMAND', 0.09);
  if (ZONES.buy2) drawZoneRect(ZONES.buy2.lo, ZONES.buy2.hi, '#06b6d4', '▲ ' + (ZONES.buy2.tf || 'H1') + ' DEMAND', 0.07);

  // FVG zones (thinner)
  STRUCTURE.fvgs.slice(-4).forEach((f, i) => {
    const col = f.type === 'BEARISH' ? '#ef4444' : '#22c55e';
    drawZoneRect(f.lo, f.hi, col, i === 0 ? (f.type === 'BEARISH' ? '▼ FVG' : '▲ FVG') : null, 0.05);
  });

  // ── ORDER BLOCK MARKERS ──────────────────────────────
  STRUCTURE.obs && STRUCTURE.obs.slice(-4).forEach(ob => {
    const col = ob.type === 'BEARISH' ? '#ef4444' : '#22c55e';
    const y1 = toY(ob.hi), y2 = toY(ob.lo);
    if (y1 > CH || y2 < 0) return;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(0, Math.min(y1,y2), CW, Math.abs(y2-y1));
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (showZoneLabels) {
      ctx.font = '8px Inter'; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.globalAlpha = 0.7;
      ctx.fillText('OB', 4, Math.min(y1,y2) + 10); ctx.globalAlpha = 1;
    }
  });

  // ── PDH / PDL LINES ──────────────────────────────────
  if (CANDLES.pdh && CANDLES.pdh > yMin && CANDLES.pdh < yMax) {
    const py = toY(CANDLES.pdh);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (showZoneLabels) {
      ctx.font = '9px Inter'; ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.8;
      ctx.fillText('PDH ' + Math.round(CANDLES.pdh).toLocaleString(), 4, py - 3); ctx.globalAlpha = 1;
    }
  }
  if (CANDLES.pdl && CANDLES.pdl > yMin && CANDLES.pdl < yMax) {
    const py = toY(CANDLES.pdl);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (showZoneLabels) {
      ctx.font = '9px Inter'; ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.8;
      ctx.fillText('PDL ' + Math.round(CANDLES.pdl).toLocaleString(), 4, py + 11); ctx.globalAlpha = 1;
    }
  }

  // ── EQUAL HIGHS / LOWS MARKERS ───────────────────────
  (CANDLES.equalHighs || []).forEach(eq => {
    if (eq.level < yMin || eq.level > yMax) return;
    const py = toY(eq.level);
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (showZoneLabels) {
      ctx.font = '8px Inter'; ctx.fillStyle = '#a855f7'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.7;
      ctx.fillText('EQH ×' + (eq.count || 2), 4, py - 2); ctx.globalAlpha = 1;
    }
  });
  (CANDLES.equalLows || []).forEach(eq => {
    if (eq.level < yMin || eq.level > yMax) return;
    const py = toY(eq.level);
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (showZoneLabels) {
      ctx.font = '8px Inter'; ctx.fillStyle = '#a855f7'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.7;
      ctx.fillText('EQL ×' + (eq.count || 2), 4, py + 10); ctx.globalAlpha = 1;
    }
  });

  // ── LIQUIDITY SWEEP MARKER ───────────────────────────
  if (STRUCTURE.liqSweep && showZoneLabels) {
    const sw = STRUCTURE.liqSweep;
    if (sw.level > yMin && sw.level < yMax) {
      const py = toY(sw.level);
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = 'bold 9px Inter'; ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'left';
      ctx.fillText('⚡ SWEEP ' + sw.type + ' Q:' + sw.quality, 4, py - 3);
    }
  }

  // ── REGRESSION / FAIR VALUE LINE ─────────────────────
  if (CFG.regLine !== false && closes.length >= 10) {
    const sliceCloses = closes.slice(startIdx, endIdx);
    const n = sliceCloses.length;
    const xs = sliceCloses.map((_, i) => i);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = sliceCloses.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (sliceCloses[i] - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = den ? num / den : 0;
    const intercept = my - slope * mx;
    ctx.strokeStyle = 'rgba(6,182,212,.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath();
    visible.forEach((_, i) => {
      const ry = toY(slope * i + intercept);
      i === 0 ? ctx.moveTo(toX(i), ry) : ctx.lineTo(toX(i), ry);
    });
    ctx.stroke(); ctx.setLineDash([]);
    // FV label on price axis
    const fvNow = slope * (n - 1) + intercept;
    if (fvNow > yMin && fvNow < yMax) {
      const fy = toY(fvNow);
      ctx.fillStyle = 'rgba(6,182,212,.6)'; ctx.fillRect(CW, fy - 7, PC, 14);
      ctx.font = '8px JetBrains Mono'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText('FV ' + Math.round(fvNow), CW + PC / 2, fy + 3);
    }
  }

  // ── EMA LINES ────────────────────────────────────────
  const drawEMA = (emaArr, color, label) => {
    const slice = emaArr.slice(startIdx, endIdx);
    let started = false;
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    slice.forEach((v, i) => {
      if (v === null) return;
      const x = toX(i) + candleW / 2;
      const y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.globalAlpha = 1;
    // Label on price axis
    const last = slice.filter(v => v !== null).slice(-1)[0];
    if (last && last > yMin && last < yMax) {
      const ly = toY(last);
      ctx.fillStyle = color; ctx.globalAlpha = 0.7;
      ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'left';
      ctx.fillText(label, CW + 2, ly + 3); ctx.globalAlpha = 1;
    }
  };
  drawEMA(CS.ema20, '#f59e0b', 'E20');
  drawEMA(CS.ema50, '#06b6d4', 'E50');

  // ── CANDLE RENDERING ─────────────────────────────────
  const bodyMin = 1.5; // minimum body height px
  visible.forEach((c, i) => {
    const x   = toX(i);
    const mid  = x + candleW / 2;
    const up   = c.c >= c.o;
    const col  = up ? '#22c55e' : '#ef4444';
    const wickCol = up ? 'rgba(34,197,94,.7)' : 'rgba(239,68,68,.7)';

    // Wick
    const wickTop = toY(c.h), wickBot = toY(c.l);
    ctx.strokeStyle = wickCol; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mid, wickTop); ctx.lineTo(mid, wickBot); ctx.stroke();

    // Body
    const bodyTop = toY(Math.max(c.o, c.c));
    const bodyBot = toY(Math.min(c.o, c.c));
    const bodyH   = Math.max(bodyMin, bodyBot - bodyTop);
    const bodyX   = x + (candleW - candleW * 0.85) / 2;
    const bodyW   = candleW * 0.85;

    if (up) {
      // Bullish: filled green or hollow based on size
      ctx.fillStyle = candleW > 5 ? col : col;
      ctx.fillRect(bodyX, bodyTop, bodyW, bodyH);
    } else {
      // Bearish: filled red
      ctx.fillStyle = col;
      ctx.fillRect(bodyX, bodyTop, bodyW, bodyH);
    }

    // Doji: just a line
    if (bodyH <= bodyMin) {
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bodyX, bodyTop); ctx.lineTo(bodyX + bodyW, bodyTop); ctx.stroke();
    }
  });

  // ── LIVE PRICE LINE + LABEL ───────────────────────────
  const price = S.gold.price || (visible.length ? visible[visible.length - 1].c : 0);
  if (price) {
    const py = toY(price);
    const isInView = py >= 0 && py <= CH;

    if (isInView) {
      // Dashed price line
      ctx.strokeStyle = 'rgba(245,166,35,.8)'; ctx.lineWidth = 1; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
      ctx.setLineDash([]);

      // Animated price badge on axis
      const priceTxt = price.toFixed(2);
      const badgeW = 52;
      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(CW, py - 9, badgeW, 18, 2) : ctx.rect(CW, py - 9, badgeW, 18);
      ctx.fill();
      ctx.font = 'bold 9px JetBrains Mono'; ctx.fillStyle = '#000'; ctx.textAlign = 'center';
      ctx.fillText(priceTxt, CW + badgeW / 2, py + 3);
    } else {
      // Off-screen arrow indicator
      const arrowY = py < 0 ? 12 : CH - 12;
      ctx.fillStyle = '#f5a623'; ctx.font = 'bold 9px Inter'; ctx.textAlign = 'right';
      ctx.fillText((py < 0 ? '▲ ' : '▼ ') + price.toFixed(2), CW - 4, arrowY + 3);
    }

    // Update HTML overlay (hidden — using canvas label now)
    const lbl = el('chartPriceLbl');
    if (lbl) { lbl.style.display = 'none'; }
  }

  // ── CROSSHAIR (mouse/touch) ───────────────────────────
  if (CS.showCross && CS.crossX >= 0 && CS.crossX <= CW && CS.crossY >= 0 && CS.crossY <= CH) {
    ctx.strokeStyle = 'rgba(148,163,184,.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(CS.crossX, 0); ctx.lineTo(CS.crossX, CH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, CS.crossY); ctx.lineTo(CW, CS.crossY); ctx.stroke();
    ctx.setLineDash([]);
    // Price label at crosshair
    const crossPrice = yMax - (CS.crossY / CH) * (yMax - yMin);
    ctx.fillStyle = '#334155'; ctx.fillRect(CW, CS.crossY - 9, PC, 18);
    ctx.font = '8px JetBrains Mono'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(crossPrice).toLocaleString(), CW + PC / 2, CS.crossY + 3);
    // Candle tooltip
    const barIdx = Math.floor(CS.crossX / CW * visible.length);
    const hoverCandle = visible[Math.min(barIdx, visible.length - 1)];
    if (hoverCandle) {
      const tw = 140, th = 68, tx = Math.min(CS.crossX + 8, CW - tw - 4), ty = Math.max(4, CS.crossY - th - 4);
      ctx.fillStyle = 'rgba(17,17,24,.95)'; ctx.strokeStyle = '#2a2a3a';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(tx, ty, tw, th, 4) : ctx.rect(tx, ty, tw, th);
      ctx.fill(); ctx.stroke();
      const oc = hoverCandle.c >= hoverCandle.o ? '#22c55e' : '#ef4444';
      ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'left';
      ctx.fillStyle = '#64748b'; ctx.fillText(fmtCandleTime(hoverCandle.t, activeTF), tx + 8, ty + 14);
      const rows = [['O', hoverCandle.o.toFixed(2)], ['H', hoverCandle.h.toFixed(2)], ['L', hoverCandle.l.toFixed(2)], ['C', hoverCandle.c.toFixed(2)]];
      rows.forEach(([k, v], i) => {
        ctx.fillStyle = '#64748b'; ctx.fillText(k, tx + 8, ty + 26 + i * 11);
        ctx.fillStyle = k === 'C' ? oc : '#e2e8f0'; ctx.fillText(v, tx + 28, ty + 26 + i * 11);
      });
    }
  }

  // ── DATA SOURCE + CANDLE COUNT BADGE ─────────────────
  ctx.font = '8px JetBrains Mono'; ctx.fillStyle = 'rgba(71,85,105,.7)'; ctx.textAlign = 'left';
  ctx.fillText(CS.dataSource + ' · ' + visible.length + ' bars · ' + activeTF, 6, 12);
}

// ── Chart interaction: Pan ────────────────────────────────
function initChartInteraction() {
  const canvas = el('mainCanvas'); if (!canvas) return;

  // Mouse pan
  canvas.addEventListener('mousedown', e => {
    CS.dragging = true;
    CS.dragStartX = e.clientX;
    CS.dragStartOffset = CS.offsetBars;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!CS.dragging) {
      // Crosshair
      const rect = canvas.getBoundingClientRect();
      CS.crossX = e.clientX - rect.left;
      CS.crossY = e.clientY - rect.top;
      CS.showCross = CS.crossX >= 0 && CS.crossX <= rect.width - CS.PRICE_COL;
      renderChart();
      return;
    }
    const dx = e.clientX - CS.dragStartX;
    const area = el('ourChartArea');
    const pxPerBar = (area.offsetWidth - CS.PRICE_COL) / CS.visibleBars;
    CS.offsetBars = Math.max(0, CS.dragStartOffset + Math.round(dx / pxPerBar));
    renderChart();
  });
  window.addEventListener('mouseup', () => {
    CS.dragging = false;
    canvas.style.cursor = 'crosshair';
  });
  canvas.addEventListener('mouseleave', () => {
    CS.showCross = false; renderChart();
  });

  // Scroll wheel zoom
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 5 : -5;
    CS.visibleBars = Math.max(CS.minBars, Math.min(CS.maxBars, CS.visibleBars + delta));
    renderChart();
  }, { passive: false });

  // Touch pan
  let touchStartX = 0, touchStartOffset = 0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartOffset = CS.offsetBars;
    } else if (e.touches.length === 2) {
      CS.lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX;
      const area = el('ourChartArea');
      const pxPerBar = (area.offsetWidth - CS.PRICE_COL) / CS.visibleBars;
      CS.offsetBars = Math.max(0, touchStartOffset + Math.round(dx / pxPerBar));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = CS.lastPinchDist / dist;
      CS.visibleBars = Math.max(CS.minBars, Math.min(CS.maxBars, Math.round(CS.visibleBars * scale)));
      CS.lastPinchDist = dist;
    }
    e.preventDefault();
    renderChart();
  }, { passive: false });

  canvas.style.cursor = 'crosshair';
}

// Init chart interactions on load
setTimeout(initChartInteraction, 500);



// ── Chart zoom/reset helpers ──────────────────────────────
function chartZoom(delta){
  CS.visibleBars = Math.max(CS.minBars, Math.min(CS.maxBars, CS.visibleBars + delta));
  renderChart();
}
function chartReset(){
  CS.visibleBars = 60; CS.offsetBars = 0;
  CS.showCross = false;
  renderChart();
}
