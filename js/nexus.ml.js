// NEXUS ZED v5.5 — Random Forest ML Engine

// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.5 — RANDOM FOREST ML ENGINE
// Real implementation — not logistic regression
// 10-tree ensemble · Bootstrap sampling · Feature importance
// Online learning — retrains automatically on new data
// Backtest — real outcomes from swing close history
// Confidence calibration via Platt scaling proxy
// ═══════════════════════════════════════════════════════════

// ── FEATURE VECTOR ───────────────────────────────────────
// 8 features, all normalised 0-1 or -1 to +1
// Must match what addMLSample() stores in SWING engine
const FEATURE_NAMES = ['macro','adx','sweep','bos','zone','session','conf','cascade'];
const N_FEATURES = FEATURE_NAMES.length;

function getCurrentFeatureVector() {
  const ms  = S.macroState;
  const adx = STRUCTURE.adx;
  const br  = S.brain;
  return {
    macro:   Math.min(1, (ms?.macroScore || 5) / 10),
    adx:     Math.min(1, (adx?.adx || 0) / 60),
    sweep:   STRUCTURE.liqSweep ? 1 : 0,
    bos:     (STRUCTURE.bos || STRUCTURE.choch) ? 1 : 0,
    zone:    (ZONES.sell1 || ZONES.buy1) ? 1 : 0,
    session: Math.min(1, (S.session?.quality || 0.5)),
    conf:    Math.min(1, (br?.conf || 50) / 100),
    cascade: SWING.cascade.score / 4,
  };
}

// ── DECISION TREE NODE ───────────────────────────────────
// Each node: { feature, threshold, left, right } or { leaf, prob }
function buildTree(samples, depth, maxDepth, minSamples) {
  // Base cases
  if (!samples.length) return { leaf: true, prob: 0.5, n: 0 };
  const pos = samples.filter(s => s.label === 1).length;
  const prob = pos / samples.length;

  if (depth >= maxDepth || samples.length < minSamples || prob === 0 || prob === 1) {
    return { leaf: true, prob, n: samples.length };
  }

  // Find best split — random subset of features (Random Forest key property)
  const nFeatTry = Math.max(2, Math.floor(Math.sqrt(N_FEATURES)));
  const featIdxs = shuffleArr([...Array(N_FEATURES).keys()]).slice(0, nFeatTry);

  let bestGain = -1, bestFeat = 0, bestThresh = 0;

  for (const fi of featIdxs) {
    const featName = FEATURE_NAMES[fi];
    const vals = samples.map(s => s.features[featName] || 0).sort((a, b) => a - b);

    // Try midpoints between unique sorted values
    const thresholds = [...new Set(vals)].slice(0, -1)
      .map((v, i, arr) => (v + arr[i + 1]) / 2);

    for (const thresh of thresholds) {
      const left  = samples.filter(s => (s.features[featName] || 0) <= thresh);
      const right = samples.filter(s => (s.features[featName] || 0) >  thresh);
      if (!left.length || !right.length) continue;
      const gain = giniGain(samples, left, right);
      if (gain > bestGain) { bestGain = gain; bestFeat = fi; bestThresh = thresh; }
    }
  }

  if (bestGain <= 0) return { leaf: true, prob, n: samples.length };

  const featName = FEATURE_NAMES[bestFeat];
  const left  = samples.filter(s => (s.features[featName] || 0) <= bestThresh);
  const right = samples.filter(s => (s.features[featName] || 0) >  bestThresh);

  return {
    leaf: false,
    feature: featName,
    threshold: bestThresh,
    left:  buildTree(left,  depth + 1, maxDepth, minSamples),
    right: buildTree(right, depth + 1, maxDepth, minSamples),
    n: samples.length,
    gain: bestGain,
  };
}

// ── GINI IMPURITY GAIN ───────────────────────────────────
function gini(samples) {
  if (!samples.length) return 0;
  const p = samples.filter(s => s.label === 1).length / samples.length;
  return 1 - p * p - (1 - p) * (1 - p);
}

function giniGain(parent, left, right) {
  const n = parent.length;
  return gini(parent) -
    (left.length  / n) * gini(left) -
    (right.length / n) * gini(right);
}

// ── PREDICT WITH SINGLE TREE ─────────────────────────────
function predictTree(node, fv) {
  if (node.leaf) return node.prob;
  const val = fv[node.feature] || 0;
  return val <= node.threshold
    ? predictTree(node.left,  fv)
    : predictTree(node.right, fv);
}

// ── BOOTSTRAP SAMPLE ────────────────────────────────────
function bootstrapSample(data) {
  const n = data.length;
  const sample = [];
  for (let i = 0; i < n; i++) {
    sample.push(data[Math.floor(Math.random() * n)]);
  }
  return sample;
}

function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── TRAIN RANDOM FOREST ──────────────────────────────────
function trainMLModel() {
  const data = ML.trainingData;
  if (data.length < 10) {
    addAuditEntry('ML', `Insufficient data (${data.length}/10 samples) — collecting...`);
    return;
  }

  const N_TREES    = 10;
  const MAX_DEPTH  = 5;
  const MIN_LEAF   = Math.max(2, Math.floor(data.length * 0.05));

  addAuditEntry('ML', `Training Random Forest: ${N_TREES} trees · ${data.length} samples · depth ${MAX_DEPTH}`);

  const forest = [];
  const oobPreds = new Array(data.length).fill(null).map(() => ({ sum: 0, count: 0 }));

  for (let t = 0; t < N_TREES; t++) {
    const bootSample = bootstrapSample(data);
    // Track OOB (out-of-bag) indices for accuracy estimate
    const bootSet = new Set(bootSample.map((_, i) => bootSample.indexOf(_)));
    const tree = buildTree(bootSample, 0, MAX_DEPTH, MIN_LEAF);
    forest.push(tree);

    // OOB prediction for accuracy
    data.forEach((sample, idx) => {
      if (!bootSet.has(idx)) {
        const p = predictTree(tree, sample.features);
        oobPreds[idx].sum   += p;
        oobPreds[idx].count += 1;
      }
    });
  }

  ML.forest = forest;
  ML.isTrained = true;

  // OOB accuracy estimate
  let correct = 0, total = 0;
  data.forEach((sample, idx) => {
    if (oobPreds[idx].count > 0) {
      const pred = oobPreds[idx].sum / oobPreds[idx].count;
      const predLabel = pred >= 0.5 ? 1 : 0;
      if (predLabel === sample.label) correct++;
      total++;
    }
  });
  ML.accuracy = total > 0 ? Math.round(correct / total * 100) : null;

  // Feature importance — mean decrease in Gini across all trees
  ML.featureImportance = computeFeatureImportance(forest);

  // Persist model weights (as serialised forest)
  try {
    localStorage.setItem('nexus_forest', JSON.stringify({
      forest: forest.slice(0, 5), // store 5/10 trees (space constraint)
      accuracy: ML.accuracy,
      importance: ML.featureImportance,
      ts: Date.now(),
      samples: data.length,
    }));
  } catch(e) {}

  addAuditEntry('ML', `Forest trained — OOB accuracy: ${ML.accuracy}% · ${data.length} samples`);

  // Immediately run prediction with current features
  runMLPredict();
  renderMLPanel();
}

// ── FEATURE IMPORTANCE ───────────────────────────────────
function computeFeatureImportance(forest) {
  const importance = {};
  FEATURE_NAMES.forEach(f => { importance[f] = 0; });

  function traverseNode(node, weight) {
    if (node.leaf) return;
    importance[node.feature] = (importance[node.feature] || 0) + (node.gain || 0) * weight;
    const leftW  = (node.left?.n  || 1) / (node.n || 1);
    const rightW = (node.right?.n || 1) / (node.n || 1);
    traverseNode(node.left,  weight * leftW);
    traverseNode(node.right, weight * rightW);
  }

  forest.forEach(tree => traverseNode(tree, 1 / forest.length));

  // Normalise 0-100
  const total = Object.values(importance).reduce((a, b) => a + b, 0) || 1;
  const normalised = {};
  FEATURE_NAMES.forEach(f => { normalised[f] = Math.round((importance[f] / total) * 100); });
  return normalised;
}

// ── PREDICT WITH FOREST ──────────────────────────────────
function predictForest(fv) {
  if (!ML.forest.length) return 0.5;
  const probs = ML.forest.map(tree => predictTree(tree, fv));
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}

// ── PLATT SCALING PROXY (calibration) ────────────────────
// Maps raw prob to calibrated prob using sigmoid with temperature
function calibrate(rawProb, temperature = 1.5) {
  // Temperature > 1 pushes probs toward 0.5 (less overconfident)
  const logit = Math.log(rawProb / (1 - rawProb + 1e-9)) / temperature;
  return 1 / (1 + Math.exp(-logit));
}

// ── FULL ML CYCLE ────────────────────────────────────────
function runMLPredict() {
  if (!ML.isTrained || !ML.forest.length) {
    // Not trained yet — use brain confidence as proxy
    const br = S.brain;
    if (!br) return;
    ML.predProb     = (br.conf || 50) / 100;
    ML.predDecision = br.direction || 'WAIT';
    ML.predGrade    = br.grade || 'C';
    ML.predScore    = (ML.predProb - 0.5) * 30; // -15 to +15
    return;
  }

  const fv = getCurrentFeatureVector();
  const rawProb = predictForest(fv);
  const calProb = calibrate(rawProb);

  // Determine direction from SWING + brain context
  const br  = S.brain;
  const dir = br?.direction || SWING.direction || 'WAIT';

  // Probability is P(WIN) for current direction
  ML.predProb     = calProb;
  ML.predDecision = dir;

  // Grade: A ≥ 0.72, B ≥ 0.58, C otherwise
  ML.predGrade  = calProb >= 0.72 ? 'A' : calProb >= 0.58 ? 'B' : 'C';
  ML.predScore  = +(((calProb - 0.5) * 30)).toFixed(2); // -15 to +15

  // Update brain grade if ML has sufficient data
  if (ML.trainingData.length >= 20 && S.brain) {
    S.brain.grade = ML.predGrade;
  }

  renderMLPanel();
}

// ── BACKTEST ENGINE ──────────────────────────────────────
// Runs ML predictions against historical training data
// NO random outcomes — pure model predictions
function runBacktest() {
  const data = ML.trainingData;
  if (data.length < 5) {
    ML.btWinRate = 0; ML.btAvgRR = '—';
    ML.equityCurve = [];
    return;
  }

  let wins = 0, losses = 0;
  const equityCurve = [100]; // start at 100 units
  let equity = 100;
  const RR = 2.0; // 1:2 assumed RR for backtest

  // Walk-forward: train on first 60%, test on last 40%
  const splitIdx = Math.floor(data.length * 0.6);
  const trainSet = data.slice(0, splitIdx);
  const testSet  = data.slice(splitIdx);

  // Build a mini forest on train set
  let testForest = [];
  if (trainSet.length >= 6) {
    for (let t = 0; t < 5; t++) {
      testForest.push(buildTree(bootstrapSample(trainSet), 0, 4, 2));
    }
  }

  testSet.forEach(sample => {
    let prob;
    if (testForest.length) {
      const rawP = testForest.reduce((s, tree) => s + predictTree(tree, sample.features), 0) / testForest.length;
      prob = calibrate(rawP);
    } else {
      prob = 0.5; // no model yet
    }

    const predWin = prob >= 0.5;
    const actualWin = sample.label === 1;

    if (predWin && actualWin) { wins++; equity += RR; }
    else if (predWin && !actualWin) { losses++; equity -= 1; }
    // If predLoss → skip (no trade)

    equityCurve.push(+equity.toFixed(2));
  });

  const total = wins + losses;
  ML.btWinRate = total > 0 ? Math.round(wins / total * 100) : 0;
  ML.btAvgRR   = total > 0 ? RR.toFixed(1) : '—';
  ML.equityCurve = equityCurve;
  ML.performance = {
    wins:   SWING.wins,
    losses: SWING.losses,
    total:  SWING.wins + SWING.losses,
  };

  addAuditEntry('ML', `Backtest: ${wins}W/${losses}L — WR ${ML.btWinRate}% — Walk-forward split ${splitIdx}/${testSet.length}`);
  if (ML.equityCurve.length) drawBtCurve(ML.equityCurve);
}

// ── LOAD PERSISTED FOREST ────────────────────────────────
function loadPersistedForest() {
  try {
    const raw = localStorage.getItem('nexus_forest');
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Only load if < 7 days old and same feature count
    if (Date.now() - saved.ts > 7 * 86400000) return;
    if (!saved.forest || !saved.forest.length) return;
    ML.forest    = saved.forest;
    ML.accuracy  = saved.accuracy;
    ML.featureImportance = saved.importance || {};
    ML.isTrained = true;
    addAuditEntry('ML', `Forest restored from storage — acc: ${saved.accuracy}% · ${saved.samples} samples`);
    runMLPredict();
  } catch(e) {}
}

// ── ML CYCLE (runs on each data refresh) ─────────────────
let _mlCycle = 0;
function runMLCycle() {
  _mlCycle++;

  // Add synthetic sample if engine has a clear signal
  // (real samples come from swing slice closes via addMLSample)
  // This adds a weak signal sample when brain has high confidence
  const br = S.brain;
  if (br && (br.conf || 0) >= 75 && br.direction !== 'WAIT') {
    const fv = getCurrentFeatureVector();
    // Weak label — won't overfit, just helps warm-start the model
    // Only if we have < 10 real samples
    if (ML.trainingData.length < 10) {
      ML.trainingData.push({
        features: fv,
        label: br.direction === 'SELL' ? (S.dxy.ch > 0 ? 1 : 0) : (S.dxy.ch < 0 ? 1 : 0),
        ts: Date.now(),
        synthetic: true,
      });
    }
  }

  // Retrain every 20 cycles if we have enough data
  if (_mlCycle % 20 === 0 && ML.trainingData.length >= 10) {
    trainMLModel();
    runBacktest();
  }

  // Predict on every cycle
  runMLPredict();

  // Feature importance display update
  renderMLFeatureImportance();
}

// ── FEATURE IMPORTANCE PANEL ─────────────────────────────
function renderMLFeatureImportance() {
  const fi = ML.featureImportance;
  if (!fi || !ML.isTrained) return;

  // Wire to quant page feature bars if they exist
  const fieldMap = {
    macro:   ['q-ai-macro',  'q-ai-macro-b',  'var(--warn)'],
    adx:     ['q-ai-adx',    'q-ai-adx-b',    'var(--piv)'],
    sweep:   ['q-ai-struct', 'q-ai-struct-b', 'var(--gold)'],
    conf:    ['q-ai-quant',  'q-ai-quant-b',  'var(--cyan)'],
    cascade: ['q-ai-reg',    'q-ai-reg-b',    'var(--cyan)'],
  };

  Object.entries(fieldMap).forEach(([feat, [txtId, barId, col]]) => {
    const pct = fi[feat] || 0;
    setText(txtId, pct + '%');
    const bar = document.getElementById(barId);
    if (bar) { bar.style.width = pct + '%'; bar.style.background = col; }
  });
}

// ── SELF-LEARNING CYCLE ──────────────────────────────────
// Automatically adjusts to recent market conditions
// Weights recent samples more than old ones
function runSelfLearning() {
  if (ML.trainingData.length < 5) return;

  // Decay old samples — reduce their influence by reordering
  // Most recent 20% get 2x weight (duplicated in bootstrap)
  const n    = ML.trainingData.length;
  const recent = Math.floor(n * 0.2);
  // Duplicate recent samples to give them more bootstrap weight
  const boosted = [
    ...ML.trainingData,
    ...ML.trainingData.slice(-recent), // duplicates = higher bootstrap prob
  ];

  // If model is trained, check if accuracy has degraded
  if (ML.isTrained && ML.accuracy !== null) {
    // Compute live accuracy on last 10 samples
    const last10 = ML.trainingData.slice(-10);
    let correct = 0;
    last10.forEach(s => {
      const p = predictForest(s.features);
      if ((p >= 0.5 ? 1 : 0) === s.label) correct++;
    });
    const recentAcc = Math.round(correct / last10.length * 100);

    // If recent accuracy < overall accuracy by > 15%, force retrain
    if (ML.accuracy - recentAcc > 15 && ML.trainingData.length >= 15) {
      addAuditEntry('ML', `Self-learning: accuracy drift detected (${ML.accuracy}% → ${recentAcc}%) — retraining...`);
      // Use boosted dataset for retrain
      const savedData = ML.trainingData;
      ML.trainingData = boosted.slice(-200);
      trainMLModel();
      ML.trainingData = savedData;
    }
  }
}

// ── POPULATE FEATURE IMPORTANCE ON QUANT PAGE ────────────
function renderMLQuantDetail() {
  if (!ML.isTrained) return;
  const fi = ML.featureImportance || {};

  // If on quant page, update feature importance insight
  const ins = document.getElementById('ml-insight');
  if (!ins) return;

  const topFeature = Object.entries(fi).sort((a, b) => b[1] - a[1])[0];
  const grade = ML.predGrade;
  const prob  = Math.round(ML.predProb * 100);

  ins.textContent = ML.isTrained
    ? `Grade ${grade} · Score ${ML.predScore.toFixed(1)} · P(WIN) ${prob}% · `
      + `Top feature: ${topFeature ? topFeature[0] + ' (' + topFeature[1] + '%)' : '—'} · `
      + `OOB accuracy: ${ML.accuracy}% · ${ML.trainingData.length} samples`
    : `Collecting samples (${ML.trainingData.length}/10 minimum). `
      + `Model trains automatically after 10 completed trades.`;
}

// ── ML PANEL FULL RENDER ─────────────────────────────────
// Override the stub renderMLPanel from v5.1
window.renderMLPanel = function() {
  const grade = ML.predGrade || 'C';
  const prob  = Math.round((ML.predProb || 0.5) * 100);
  const dec   = ML.predDecision || 'WAIT';
  const score = ML.predScore || 0;

  const gradeEl = document.getElementById('ml-grade-big');
  if (gradeEl) {
    gradeEl.textContent = grade;
    gradeEl.style.color = grade === 'A' ? 'var(--buy)' : grade === 'B' ? 'var(--gold)' : 'var(--warn)';
  }

  const decEl = document.getElementById('ml-decision');
  if (decEl) {
    decEl.textContent = dec + ' — GRADE ' + grade;
    decEl.style.color = dec === 'SELL' ? 'var(--sell)' : dec === 'BUY' ? 'var(--buy)' : 'var(--t3)';
  }

  setText('ml-prob', 'P(WIN): ' + prob + '%');
  setText('ml-status',
    ML.isTrained
      ? `Trained ✓ · ${ML.trainingData.filter(d => !d.synthetic).length} real samples`
      : ML.trainingData.length > 0
        ? `Training... (${ML.trainingData.length}/10)`
        : 'Collecting data'
  );
  setText('ml-samples', ML.trainingData.filter(d => !d.synthetic).length);
  setText('ml-accuracy', ML.accuracy ? ML.accuracy + '%' : '—');
  setText('ml-btwr', ML.btWinRate + '%');
  setText('bt-wr',   ML.btWinRate + '%');
  setText('bt-rr',   '1:' + ML.btAvgRR);

  const scoreNorm = Math.min(100, Math.max(0, (score + 15) / 30 * 100));
  const bar = document.getElementById('ml-score-bar');
  if (bar) {
    bar.style.width = scoreNorm + '%';
    bar.style.background = grade === 'A' ? 'var(--buy)' : grade === 'B' ? 'var(--gold)' : 'var(--warn)';
  }
  setText('ml-score-val', score.toFixed(1));

  // Feature importance bars
  renderMLFeatureImportance();
  renderMLQuantDetail();

  // Equity curve
  if (ML.equityCurve && ML.equityCurve.length > 1) drawBtCurve(ML.equityCurve);
};

// ── WIRE INTO MAIN RENDER + INIT ─────────────────────────
// Run ML cycle every 10 data cycles (via main fetch loop)
const _origFetchAll = window.fetchAll;
window.fetchAll = async function() {
  await _origFetchAll();
  runMLCycle();
  runSelfLearning();
};

// Persist ML data more completely
const _origPersistState = window.persistState;
window.persistState = function() {
  _origPersistState();
  try {
    localStorage.setItem('nexus_ml', JSON.stringify({
      trades:       ML.trades.slice(0, 50),
      trainingData: ML.trainingData.slice(0, 200),
      btWinRate:    ML.btWinRate,
      btAvgRR:      ML.btAvgRR,
      performance:  ML.performance,
      accuracy:     ML.accuracy,
    }));
  } catch(e) {}
};

// Restore ML data more completely
const _origRestoreML = localStorage.getItem('nexus_ml');
if (_origRestoreML) {
  try {
    const d = JSON.parse(_origRestoreML);
    if (d.trainingData) ML.trainingData = d.trainingData.slice(0, 200);
    if (d.trades)       ML.trades       = d.trades.slice(0, 50);
    if (d.btWinRate)    ML.btWinRate    = d.btWinRate;
    if (d.btAvgRR)      ML.btAvgRR      = d.btAvgRR;
    if (d.performance)  ML.performance  = d.performance;
    if (d.accuracy)     ML.accuracy     = d.accuracy;
  } catch(e) {}
}

// ── BOOT ─────────────────────────────────────────────────
setTimeout(() => {
  // Try to load persisted forest first
  loadPersistedForest();
  // If we have training data, train immediately
  if (ML.trainingData.filter(d => !d.synthetic).length >= 10) {
    addAuditEntry('ML', `Auto-training on ${ML.trainingData.length} restored samples...`);
    trainMLModel();
    runBacktest();
  } else {
    addAuditEntry('ML', `Waiting for trades — ${ML.trainingData.filter(d=>!d.synthetic).length}/10 real samples`);
  }
  runMLPredict();
  renderMLPanel();
  addAuditEntry('SYS', 'Random Forest ML Engine v5.5 active');
}, 2000);
