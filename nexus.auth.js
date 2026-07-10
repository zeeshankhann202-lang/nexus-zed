// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.9 — Auth + Payment Layer
// Supabase: user accounts, sessions, cross-device sync
// Stripe: subscription checkout, webhook tier upgrades
// Feature gates: Free / Pro / Edge enforcement
// Designed to be LIVE-READY the moment UK Stripe account exists
// ═══════════════════════════════════════════════════════════

// ── CONFIGURATION ─────────────────────────────────────────
// Replace these with your real values when accounts are live
const AUTH_CFG = {
  // Supabase (free tier — create project at supabase.com)
  SUPABASE_URL:    'YOUR_SUPABASE_URL',         // e.g. https://xxxx.supabase.co
  SUPABASE_ANON:   'YOUR_SUPABASE_ANON_KEY',    // safe to expose client-side

  // Stripe (add when UK account ready)
  STRIPE_PUB_KEY:  'YOUR_STRIPE_PUBLISHABLE_KEY',  // pk_live_... or pk_test_...
  PRICE_PRO:       'YOUR_STRIPE_PRICE_ID_PRO',     // price_... monthly Pro
  PRICE_EDGE:      'YOUR_STRIPE_PRICE_ID_EDGE',    // price_... monthly Edge

  // Your deployed Worker URL (set after Cloudflare deployment)
  WORKER_URL:      '',  // https://nexus-zed-worker.xxx.workers.dev

  // Mode: 'live' | 'test' | 'demo'
  // 'demo' = all features unlocked locally, no Stripe calls
  MODE: 'demo',
};

// ── TIER DEFINITIONS ──────────────────────────────────────
const TIERS = {
  free: {
    name:     'NEXUS Lite',
    label:    'Free',
    color:    'var(--t3)',
    features: {
      dashboard:      true,
      livePrice:      false,   // 15-min delay
      macro:          'limited',
      liquidity:      false,
      structure:      false,
      execution:      false,
      quant:          false,
      journal:        false,
      ml:             false,
      swing:          false,
      ohlcCandles:    false,
      oandaFlow:      false,
      alerts:         false,
      journalExport:  false,
      journalRows:    0,
      tradeCount:     0,
    }
  },
  pro: {
    name:     'NEXUS Pro',
    label:    'Pro',
    color:    'var(--buy)',
    price:    '$49/mo',
    features: {
      dashboard:      true,
      livePrice:      true,
      macro:          true,
      liquidity:      true,
      structure:      true,
      execution:      true,
      quant:          true,
      journal:        true,
      ml:             true,
      swing:          true,
      ohlcCandles:    true,
      oandaFlow:      false,   // Edge only
      alerts:         false,   // Edge only
      journalExport:  true,
      journalRows:    50,
      tradeCount:     200,
    }
  },
  edge: {
    name:     'NEXUS Edge',
    label:    'Edge',
    color:    'var(--gold)',
    price:    '$149/mo',
    features: {
      dashboard:      true,
      livePrice:      true,
      macro:          true,
      liquidity:      true,
      structure:      true,
      execution:      true,
      quant:          true,
      journal:        true,
      ml:             true,
      swing:          true,
      ohlcCandles:    true,
      oandaFlow:      true,
      alerts:         true,
      journalExport:  true,
      journalRows:    -1,   // unlimited
      tradeCount:     -1,
    }
  }
};

// ── AUTH STATE ────────────────────────────────────────────
const AUTH = {
  user:        null,   // Supabase user object
  session:     null,   // Supabase session
  tier:        'free', // 'free' | 'pro' | 'edge'
  tierExpiry:  null,
  isLoading:   false,
  supabase:    null,   // Supabase client instance
  stripe:      null,   // Stripe.js instance
  initialized: false,
};

// ════════════════════════════════════════════════════════════
// SUPABASE CLIENT INIT
// ════════════════════════════════════════════════════════════
function initSupabase() {
  if (AUTH_CFG.SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    addAuditEntry('INFO', 'Auth: running in DEMO mode — all features unlocked locally');
    AUTH.tier = 'edge'; // Demo mode = full access
    AUTH.initialized = true;
    applyFeatureGates();
    updateAuthUI();
    return;
  }

  // Load Supabase via CDN (no npm needed)
  if (window.supabase) {
    AUTH.supabase = window.supabase.createClient(AUTH_CFG.SUPABASE_URL, AUTH_CFG.SUPABASE_ANON);
    initAuthListeners();
    restoreSession();
  } else {
    // Supabase script not yet loaded — will be injected into index.html
    addAuditEntry('ERR', 'Supabase SDK not loaded. Add script tag to index.html.');
    AUTH.tier = 'free';
    AUTH.initialized = true;
    applyFeatureGates();
  }
}

async function restoreSession() {
  if (!AUTH.supabase) return;
  try {
    const { data: { session } } = await AUTH.supabase.auth.getSession();
    if (session) {
      AUTH.session = session;
      AUTH.user = session.user;
      await fetchUserTier(session.user.id);
      addAuditEntry('LIVE', `Auth: session restored — ${session.user.email}`);
    }
  } catch(e) {
    addAuditEntry('ERR', 'Auth restore failed: ' + e.message);
  }
  AUTH.initialized = true;
  applyFeatureGates();
  updateAuthUI();
}

function initAuthListeners() {
  if (!AUTH.supabase) return;
  AUTH.supabase.auth.onAuthStateChange(async (event, session) => {
    AUTH.session = session;
    AUTH.user = session?.user || null;

    if (event === 'SIGNED_IN') {
      await fetchUserTier(AUTH.user.id);
      addAuditEntry('LIVE', `Auth: signed in — ${AUTH.user.email} (${AUTH.tier})`);
      closeAuthModal();
      applyFeatureGates();
      updateAuthUI();
      syncJournalFromCloud();
    } else if (event === 'SIGNED_OUT') {
      AUTH.tier = 'free';
      addAuditEntry('SYS', 'Auth: signed out');
      applyFeatureGates();
      updateAuthUI();
    } else if (event === 'TOKEN_REFRESHED') {
      addAuditEntry('SYS', 'Auth: token refreshed');
    }
  });
}

// ════════════════════════════════════════════════════════════
// TIER MANAGEMENT
// ════════════════════════════════════════════════════════════
async function fetchUserTier(userId) {
  if (!AUTH.supabase) return;
  try {
    const { data, error } = await AUTH.supabase
      .from('users')
      .select('tier, tier_expiry, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error) {
      // User row doesn't exist yet — create it
      if (error.code === 'PGRST116') {
        await createUserRow(userId);
        AUTH.tier = 'free';
      }
      return;
    }

    // Check tier expiry
    if (data.tier_expiry && new Date(data.tier_expiry) < new Date()) {
      // Tier expired — downgrade to free
      AUTH.tier = 'free';
      await AUTH.supabase.from('users').update({ tier: 'free' }).eq('id', userId);
      addAuditEntry('SYS', 'Subscription expired — downgraded to Free tier');
    } else {
      AUTH.tier = data.tier || 'free';
      AUTH.tierExpiry = data.tier_expiry;
    }

    // Update CFG with tier for Worker header
    if (window.CFG) window.CFG.userTier = AUTH.tier;

  } catch(e) {
    AUTH.tier = 'free';
    addAuditEntry('ERR', 'Tier fetch failed: ' + e.message);
  }
}

async function createUserRow(userId) {
  if (!AUTH.supabase) return;
  try {
    await AUTH.supabase.from('users').insert({
      id:         userId,
      email:      AUTH.user?.email,
      tier:       'free',
      created_at: new Date().toISOString(),
    });
    addAuditEntry('SYS', 'User profile created');
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════
// AUTH FUNCTIONS
// ════════════════════════════════════════════════════════════
async function signUp(email, password) {
  if (!AUTH.supabase) return { error: 'Auth not configured' };
  setAuthLoading(true);
  try {
    const { data, error } = await AUTH.supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) return { error: error.message };
    if (data.user && !data.session) {
      return { needsConfirmation: true };
    }
    return { success: true };
  } catch(e) {
    return { error: e.message };
  } finally {
    setAuthLoading(false);
  }
}

async function signIn(email, password) {
  if (!AUTH.supabase) return { error: 'Auth not configured' };
  setAuthLoading(true);
  try {
    const { data, error } = await AUTH.supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { success: true };
  } catch(e) {
    return { error: e.message };
  } finally {
    setAuthLoading(false);
  }
}

async function signOut() {
  if (!AUTH.supabase) { AUTH.tier = 'free'; updateAuthUI(); return; }
  await AUTH.supabase.auth.signOut();
}

async function sendPasswordReset(email) {
  if (!AUTH.supabase) return;
  await AUTH.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=1'
  });
}

// ════════════════════════════════════════════════════════════
// STRIPE CHECKOUT
// ════════════════════════════════════════════════════════════
async function startCheckout(targetTier) {
  // Demo mode — show "coming soon"
  if (AUTH_CFG.MODE === 'demo') {
    showUpgradeModal(targetTier, true);
    return;
  }

  if (!AUTH.user) {
    showAuthModal('signup');
    return;
  }

  if (AUTH_CFG.STRIPE_PUB_KEY === 'YOUR_STRIPE_PUBLISHABLE_KEY') {
    showToast('Payment system not yet configured. UK company registration in progress.', 'warn');
    return;
  }

  setAuthLoading(true);
  try {
    // Call our Worker to create a Stripe Checkout session
    const workerBase = (window.CFG?.worker || AUTH_CFG.WORKER_URL || '').replace(/\/$/, '');
    if (!workerBase) throw new Error('Worker URL not configured');

    const r = await fetch(workerBase + '/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + (AUTH.session?.access_token || ''),
      },
      body: JSON.stringify({
        tier:          targetTier,
        price_id:      targetTier === 'pro' ? AUTH_CFG.PRICE_PRO : AUTH_CFG.PRICE_EDGE,
        customer_email: AUTH.user.email,
        success_url:   window.location.origin + '?upgraded=1',
        cancel_url:    window.location.origin,
      }),
    });

    if (!r.ok) throw new Error('Checkout session creation failed: ' + r.status);
    const { url } = await r.json();
    if (!url) throw new Error('No checkout URL returned');

    // Redirect to Stripe Checkout
    window.location.href = url;
  } catch(e) {
    showToast('Checkout failed: ' + e.message, 'err');
    addAuditEntry('ERR', 'Stripe checkout failed: ' + e.message);
  } finally {
    setAuthLoading(false);
  }
}

async function openCustomerPortal() {
  if (!AUTH.user || AUTH_CFG.MODE === 'demo') {
    showToast('Billing portal available after UK Stripe account setup.', 'info');
    return;
  }
  const workerBase = (window.CFG?.worker || '').replace(/\/$/, '');
  if (!workerBase) return;
  try {
    const r = await fetch(workerBase + '/billing-portal', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + (AUTH.session?.access_token || ''),
      },
      body: JSON.stringify({ return_url: window.location.origin }),
    });
    const { url } = await r.json();
    if (url) window.location.href = url;
  } catch(e) {
    showToast('Billing portal failed: ' + e.message, 'err');
  }
}

// ── Handle return from Stripe Checkout ───────────────────
async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('upgraded') === '1') {
    // Refresh tier from Supabase (webhook will have updated it)
    setTimeout(async () => {
      if (AUTH.user) {
        await fetchUserTier(AUTH.user.id);
        applyFeatureGates();
        updateAuthUI();
        showToast('🎉 Upgrade successful! Welcome to ' + TIERS[AUTH.tier]?.name, 'ok');
        addAuditEntry('SYS', 'Stripe upgrade confirmed — tier: ' + AUTH.tier);
      }
    }, 2000); // Give webhook 2s to fire
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }
  if (params.get('reset') === '1') {
    showAuthModal('reset');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ════════════════════════════════════════════════════════════
// FEATURE GATES
// ════════════════════════════════════════════════════════════
function can(feature) {
  const tier = AUTH_CFG.MODE === 'demo' ? 'edge' : AUTH.tier;
  const tierFeatures = TIERS[tier]?.features || TIERS.free.features;
  return tierFeatures[feature] === true || tierFeatures[feature] === -1;
}

function applyFeatureGates() {
  const tier = AUTH_CFG.MODE === 'demo' ? 'edge' : AUTH.tier;
  const features = TIERS[tier]?.features || TIERS.free.features;

  // Nav tab gating — lock icons on restricted tabs
  const gatedTabs = {
    liquidity:  features.liquidity,
    structure:  features.structure,
    execution:  features.execution,
    quant:      features.quant,
    journal:    features.journal,
  };

  document.querySelectorAll('[data-page]').forEach(btn => {
    const page = btn.getAttribute('data-page');
    if (gatedTabs[page] === false) {
      btn.classList.add('gated');
      if (!btn.querySelector('.gate-lock')) {
        const lock = document.createElement('span');
        lock.className = 'gate-lock';
        lock.textContent = ' 🔒';
        lock.style.cssText = 'font-size:9px;opacity:.6;';
        btn.appendChild(lock);
      }
    } else {
      btn.classList.remove('gated');
      btn.querySelector('.gate-lock')?.remove();
    }
  });

  // Live price indicator
  const priceBar = document.getElementById('priceBar');
  if (priceBar) {
    const liveEl = priceBar.querySelector('.pb-livetxt');
    if (liveEl && !features.livePrice) {
      liveEl.textContent = 'DELAYED 15M';
      liveEl.style.color = 'var(--warn)';
      const dotEl = priceBar.querySelector('.pb-livedot');
      if (dotEl) dotEl.style.background = 'var(--warn)';
    }
  }

  // Journal row limit
  if (features.journalRows > 0 && ML.trades.length > features.journalRows) {
    ML.trades = ML.trades.slice(0, features.journalRows);
  }

  // OANDA order flow gate
  if (!features.oandaFlow && typeof showOFSimMode === 'function') {
    showOFSimMode();
  }

  // CFG tier for Worker headers
  if (window.CFG) window.CFG.userTier = tier;

  addAuditEntry('SYS', `Feature gates applied — tier: ${tier.toUpperCase()}`);
}

// ── Page-level gate intercept ─────────────────────────────
const _origGoPageAuth = window.goPage;
window.goPage = function(name) {
  const tier = AUTH_CFG.MODE === 'demo' ? 'edge' : AUTH.tier;
  const features = TIERS[tier]?.features || TIERS.free.features;
  const gatedPages = ['liquidity','structure','execution','quant','journal'];

  if (gatedPages.includes(name) && features[name] === false) {
    showUpgradeModal(name);
    return;
  }
  _origGoPageAuth(name);
};

// ════════════════════════════════════════════════════════════
// CLOUD JOURNAL SYNC
// ════════════════════════════════════════════════════════════
async function syncJournalToCloud() {
  if (!AUTH.supabase || !AUTH.user || !can('journal')) return;
  try {
    const rows = ML.trades.slice(0, can('journalRows') === -1 ? 1000 : TIERS[AUTH.tier].features.journalRows);
    const { error } = await AUTH.supabase.from('journal').upsert(
      rows.map((t, i) => ({
        user_id:   AUTH.user.id,
        trade_idx: i,
        ts:        t.ts,
        decision:  t.decision,
        entry:     t.entry,
        sl:        t.sl,
        tp:        t.tp,
        grade:     t.grade,
        prob:      t.prob,
        outcome:   t.outcome,
        sess_name: t.sessName,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,trade_idx' }
    );
    if (error) addAuditEntry('ERR', 'Journal sync failed: ' + error.message);
    else addAuditEntry('LIVE', `Journal synced: ${rows.length} trades to cloud`);
  } catch(e) {
    addAuditEntry('ERR', 'Journal sync error: ' + e.message);
  }
}

async function syncJournalFromCloud() {
  if (!AUTH.supabase || !AUTH.user || !can('journal')) return;
  try {
    const { data, error } = await AUTH.supabase
      .from('journal')
      .select('*')
      .eq('user_id', AUTH.user.id)
      .order('trade_idx', { ascending: true })
      .limit(TIERS[AUTH.tier]?.features?.journalRows === -1 ? 1000 : (TIERS[AUTH.tier]?.features?.journalRows || 0));

    if (error || !data?.length) return;

    // Merge with local trades
    const cloud = data.map(r => ({
      ts: r.ts, decision: r.decision, entry: r.entry,
      sl: r.sl, tp: r.tp, grade: r.grade, prob: r.prob,
      outcome: r.outcome, sessName: r.sess_name,
    }));

    // Deduplicate by ts+entry
    const existing = new Set(ML.trades.map(t => `${t.ts}|${t.entry}`));
    const newTrades = cloud.filter(t => !existing.has(`${t.ts}|${t.entry}`));
    ML.trades = [...newTrades, ...ML.trades].slice(0, 500);

    addAuditEntry('LIVE', `Journal: ${newTrades.length} trades loaded from cloud`);
    if (typeof renderJournalPage === 'function') renderJournalPage();
  } catch(e) {
    addAuditEntry('ERR', 'Journal cloud load failed: ' + e.message);
  }
}

// Sync HTF levels across devices (Edge tier)
async function syncHTFLevels() {
  if (!AUTH.supabase || !AUTH.user || AUTH.tier !== 'edge') return;
  try {
    const localLevels = { supply: CFG.htfSupply || [], demand: CFG.htfDemand || [] };
    const { error } = await AUTH.supabase.from('htf_levels').upsert({
      user_id: AUTH.user.id,
      levels:  JSON.stringify(localLevels),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (!error) addAuditEntry('LIVE', 'HTF levels synced to cloud (Edge)');
  } catch(e) {}
}

async function loadHTFLevels() {
  if (!AUTH.supabase || !AUTH.user || AUTH.tier !== 'edge') return;
  try {
    const { data } = await AUTH.supabase
      .from('htf_levels')
      .select('levels')
      .eq('user_id', AUTH.user.id)
      .single();
    if (data?.levels) {
      const parsed = JSON.parse(data.levels);
      if (window.CFG) { CFG.htfSupply = parsed.supply; CFG.htfDemand = parsed.demand; }
      addAuditEntry('LIVE', 'HTF levels loaded from cloud (Edge)');
    }
  } catch(e) {}
}

// ── Auto-sync triggers ───────────────────────────────────
// Sync journal every 5 minutes when user is logged in
setInterval(() => {
  if (AUTH.user && can('journal')) syncJournalToCloud();
}, 300000);

// ════════════════════════════════════════════════════════════
// AUTH MODAL UI
// ════════════════════════════════════════════════════════════
function buildAuthModal() {
  if (document.getElementById('authModal')) return;

  const modal = document.createElement('div');
  modal.id = 'authModal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9000;
    background:rgba(0,0,0,.8);backdrop-filter:blur(12px);
    display:none;align-items:center;justify-content:center;padding:20px;
  `;
  modal.innerHTML = `
    <div style="background:var(--bg1);border:1px solid var(--border2);border-radius:12px;
      width:100%;max-width:400px;overflow:hidden;">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:18px 20px;background:var(--bg2);border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:30px;height:30px;background:var(--gold);border-radius:7px;
            display:flex;align-items:center;justify-content:center;font-weight:700;color:#000;">N</div>
          <div id="authModalTitle" style="font-size:15px;font-weight:700;">Sign In</div>
        </div>
        <div onclick="closeAuthModal()" style="cursor:pointer;color:var(--t3);font-size:18px;
          width:28px;height:28px;display:flex;align-items:center;justify-content:center;">✕</div>
      </div>

      <!-- Tab switcher -->
      <div id="authTabs" style="display:flex;border-bottom:1px solid var(--border);background:var(--bg2);">
        <div class="auth-tab active" data-tab="signin" onclick="switchAuthTab('signin')"
          style="flex:1;padding:10px;text-align:center;font-size:12px;font-weight:600;
          cursor:pointer;color:var(--gold);border-bottom:2px solid var(--gold);">Sign In</div>
        <div class="auth-tab" data-tab="signup" onclick="switchAuthTab('signup')"
          style="flex:1;padding:10px;text-align:center;font-size:12px;font-weight:500;
          cursor:pointer;color:var(--t3);border-bottom:2px solid transparent;">Create Account</div>
      </div>

      <div style="padding:20px;display:flex;flex-direction:column;gap:12px;">
        <input id="authEmail" type="email" placeholder="Email address"
          style="width:100%;padding:10px 12px;background:var(--bg3);border:1px solid var(--border2);
          border-radius:8px;color:var(--t1);font-size:13px;font-family:var(--font);outline:none;"
          onkeydown="if(event.key==='Enter')submitAuth()">
        <input id="authPassword" type="password" placeholder="Password"
          style="width:100%;padding:10px 12px;background:var(--bg3);border:1px solid var(--border2);
          border-radius:8px;color:var(--t1);font-size:13px;font-family:var(--font);outline:none;"
          onkeydown="if(event.key==='Enter')submitAuth()">
        <div id="authError" style="display:none;padding:8px 10px;background:var(--selldim);
          border:1px solid var(--sellborder);border-radius:6px;font-size:12px;color:var(--sell);"></div>
        <div id="authSuccess" style="display:none;padding:8px 10px;background:var(--buydim);
          border:1px solid var(--buyborder);border-radius:6px;font-size:12px;color:var(--buy);"></div>
        <button id="authSubmitBtn" onclick="submitAuth()"
          style="width:100%;padding:11px;background:var(--gold);border:none;border-radius:8px;
          color:#000;font-weight:700;font-size:14px;cursor:pointer;font-family:var(--font);">
          Sign In
        </button>
        <div style="text-align:center;">
          <span id="authForgotLink" onclick="submitForgotPassword()"
            style="font-size:11px;color:var(--t3);cursor:pointer;text-decoration:underline;">
            Forgot password?
          </span>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:10px;text-align:center;
          font-size:11px;color:var(--t3);">
          Free tier includes Dashboard + delayed prices.<br>
          Upgrade to Pro for all 6 modules + live data.
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeAuthModal(); });
}

function showAuthModal(tab = 'signin') {
  buildAuthModal();
  const modal = document.getElementById('authModal');
  if (modal) { modal.style.display = 'flex'; switchAuthTab(tab); }
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
}

function switchAuthTab(tab) {
  const isSignIn = tab === 'signin';
  document.querySelectorAll('.auth-tab').forEach(t => {
    const active = t.getAttribute('data-tab') === tab;
    t.style.color  = active ? 'var(--gold)' : 'var(--t3)';
    t.style.borderBottomColor = active ? 'var(--gold)' : 'transparent';
  });
  const btn = document.getElementById('authSubmitBtn');
  if (btn) btn.textContent = isSignIn ? 'Sign In' : 'Create Account';
  const forgot = document.getElementById('authForgotLink');
  if (forgot) forgot.style.display = isSignIn ? '' : 'none';
  clearAuthMessages();
  window._authTab = tab;
}

async function submitAuth() {
  const email    = document.getElementById('authEmail')?.value?.trim();
  const password = document.getElementById('authPassword')?.value;
  if (!email || !password) { showAuthError('Please enter email and password.'); return; }

  const btn = document.getElementById('authSubmitBtn');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  const tab    = window._authTab || 'signin';
  const result = tab === 'signup' ? await signUp(email, password) : await signIn(email, password);

  if (btn) { btn.textContent = tab === 'signup' ? 'Create Account' : 'Sign In'; btn.disabled = false; }

  if (result.error) {
    showAuthError(result.error);
  } else if (result.needsConfirmation) {
    showAuthSuccess('Check your email to confirm your account, then sign in.');
    switchAuthTab('signin');
  } else {
    closeAuthModal();
  }
}

async function submitForgotPassword() {
  const email = document.getElementById('authEmail')?.value?.trim();
  if (!email) { showAuthError('Enter your email address first.'); return; }
  await sendPasswordReset(email);
  showAuthSuccess('Password reset email sent. Check your inbox.');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.style.display = ''; }
  const ok = document.getElementById('authSuccess');
  if (ok) ok.style.display = 'none';
}

function showAuthSuccess(msg) {
  const el = document.getElementById('authSuccess');
  if (el) { el.textContent = msg; el.style.display = ''; }
  const err = document.getElementById('authError');
  if (err) err.style.display = 'none';
}

function clearAuthMessages() {
  ['authError','authSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ════════════════════════════════════════════════════════════
// UPGRADE MODAL
// ════════════════════════════════════════════════════════════
function showUpgradeModal(context, isDemo = false) {
  const existing = document.getElementById('upgradeModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'upgradeModal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:8500;
    background:rgba(0,0,0,.75);backdrop-filter:blur(8px);
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;

  const contextNames = {
    liquidity: 'ZED Liquidity', structure: 'ZED Structure',
    execution: 'ZED Execution', quant: 'ZED Quant',
    journal: 'ZED Journal',
  };

  modal.innerHTML = `
    <div style="background:var(--bg1);border:1px solid var(--goldborder);border-radius:12px;
      width:100%;max-width:440px;padding:28px;text-align:center;">
      <div style="font-size:36px;margin-bottom:12px;">🔒</div>
      <div style="font-size:18px;font-weight:700;color:var(--t1);margin-bottom:6px;">
        ${contextNames[context] || 'This Feature'} — Pro Required
      </div>
      <div style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:20px;">
        ${isDemo
          ? 'NEXUS is in demo mode — payment system activates when UK company registration is complete. All features are currently unlocked for development.'
          : 'Upgrade to NEXUS Pro to unlock all 6 analytical modules, live data, ML engine, swing navigator, and cross-device journal sync.'}
      </div>

      ${!isDemo ? `
      <!-- Tier cards -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <div style="background:var(--bg2);border:1px solid var(--buyborder);border-radius:10px;padding:14px;">
          <div style="font-size:11px;font-weight:700;color:var(--buy);letter-spacing:.8px;margin-bottom:6px;">PRO</div>
          <div style="font-size:22px;font-weight:800;color:var(--t1);">$49<span style="font-size:12px;color:var(--t3)">/mo</span></div>
          <div style="font-size:11px;color:var(--t3);margin-top:4px;line-height:1.6;">All 6 modules · Live data · ML · Swing · Journal</div>
          <button onclick="startCheckout('pro');closeUpgradeModal()"
            style="width:100%;margin-top:10px;padding:8px;background:var(--buy);border:none;
            border-radius:6px;color:#000;font-weight:700;font-size:12px;cursor:pointer;">
            Upgrade Pro
          </button>
        </div>
        <div style="background:var(--bg2);border:1px solid var(--goldborder);border-radius:10px;padding:14px;">
          <div style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:.8px;margin-bottom:6px;">EDGE</div>
          <div style="font-size:22px;font-weight:800;color:var(--t1);">$149<span style="font-size:12px;color:var(--t3)">/mo</span></div>
          <div style="font-size:11px;color:var(--t3);margin-top:4px;line-height:1.6;">Everything + Real order flow · Alerts · Unlimited journal</div>
          <button onclick="startCheckout('edge');closeUpgradeModal()"
            style="width:100%;margin-top:10px;padding:8px;background:var(--gold);border:none;
            border-radius:6px;color:#000;font-weight:700;font-size:12px;cursor:pointer;">
            Upgrade Edge
          </button>
        </div>
      </div>` : `
      <div style="background:var(--golddim);border:1px solid var(--goldborder);border-radius:8px;
        padding:10px;font-size:12px;color:var(--gold);margin-bottom:16px;">
        🚧 Demo mode — All features unlocked for development & testing
      </div>`}

      <div style="display:flex;gap:8px;justify-content:center;">
        ${!AUTH.user && !isDemo ? `
        <button onclick="closeUpgradeModal();showAuthModal('signup')"
          style="padding:8px 16px;background:var(--bg3);border:1px solid var(--border2);
          border-radius:6px;color:var(--t2);font-size:12px;cursor:pointer;font-family:var(--font);">
          Create Free Account
        </button>` : ''}
        <button onclick="closeUpgradeModal()"
          style="padding:8px 16px;background:var(--bg3);border:1px solid var(--border2);
          border-radius:6px;color:var(--t2);font-size:12px;cursor:pointer;font-family:var(--font);">
          Maybe Later
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeUpgradeModal(); });
}

function closeUpgradeModal() {
  document.getElementById('upgradeModal')?.remove();
}

// ════════════════════════════════════════════════════════════
// AUTH UI — NAV AVATAR BUTTON
// ════════════════════════════════════════════════════════════
function updateAuthUI() {
  const avatar = document.querySelector('.nav-avatar');
  if (!avatar) return;

  const tier = AUTH_CFG.MODE === 'demo' ? 'edge' : AUTH.tier;
  const tierInfo = TIERS[tier] || TIERS.free;

  if (AUTH.user) {
    const initial = AUTH.user.email?.[0]?.toUpperCase() || 'Z';
    avatar.textContent = initial;
    avatar.title = `${AUTH.user.email}\n${tierInfo.name}`;
    avatar.style.borderColor = tierInfo.color;
    // Add tier badge
    let badge = document.getElementById('tierBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'tierBadge';
      badge.style.cssText = `
        position:absolute;top:-6px;left:-6px;
        padding:1px 5px;border-radius:4px;font-size:8px;font-weight:700;
        pointer-events:none;
      `;
      avatar.style.position = 'relative';
      avatar.appendChild(badge);
    }
    badge.textContent = tier.toUpperCase();
    badge.style.background = tierInfo.color;
    badge.style.color = tier === 'free' ? 'var(--t1)' : '#000';

    // Avatar click = account menu
    avatar.onclick = showAccountMenu;
  } else {
    avatar.textContent = '?';
    avatar.title = 'Sign in to NEXUS';
    avatar.style.borderColor = 'var(--border)';
    document.getElementById('tierBadge')?.remove();
    avatar.onclick = () => showAuthModal('signin');
  }
}

function showAccountMenu() {
  const existing = document.getElementById('accountMenu');
  if (existing) { existing.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'accountMenu';
  const tier = AUTH_CFG.MODE === 'demo' ? 'edge' : AUTH.tier;
  const tierInfo = TIERS[tier] || TIERS.free;
  menu.style.cssText = `
    position:fixed;top:calc(var(--nav-h) + 8px);right:16px;z-index:600;
    background:var(--bg1);border:1px solid var(--border2);border-radius:10px;
    min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;
  `;
  menu.innerHTML = `
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);background:var(--bg2);">
      <div style="font-size:12px;font-weight:700;color:var(--t1);">${AUTH.user?.email || 'Demo Mode'}</div>
      <div style="font-size:11px;margin-top:2px;color:${tierInfo.color};">${tierInfo.name}</div>
      ${AUTH.tierExpiry ? `<div style="font-size:10px;color:var(--t3);margin-top:1px;">
        Renews ${new Date(AUTH.tierExpiry).toLocaleDateString()}</div>` : ''}
    </div>
    ${tier === 'free' ? `
    <div onclick="closeMenu();showUpgradeModal('pro')" style="padding:10px 14px;
      cursor:pointer;font-size:12px;color:var(--gold);font-weight:600;
      border-bottom:1px solid var(--border);">⬆ Upgrade to Pro</div>` : ''}
    ${tier !== 'free' ? `
    <div onclick="closeMenu();openCustomerPortal()" style="padding:10px 14px;
      cursor:pointer;font-size:12px;color:var(--t2);border-bottom:1px solid var(--border);">
      💳 Manage Subscription</div>` : ''}
    <div onclick="closeMenu();openSettings()" style="padding:10px 14px;
      cursor:pointer;font-size:12px;color:var(--t2);border-bottom:1px solid var(--border);">
      ⚙ Settings</div>
    <div onclick="closeMenu();syncJournalToCloud()" style="padding:10px 14px;
      cursor:pointer;font-size:12px;color:var(--t2);border-bottom:1px solid var(--border);">
      ☁ Sync Journal</div>
    <div onclick="closeMenu();signOut()" style="padding:10px 14px;
      cursor:pointer;font-size:12px;color:var(--sell);">
      ↩ Sign Out</div>
  `;
  document.body.appendChild(menu);

  function closeMenu() { menu.remove(); }
  window._closeAccountMenu = closeMenu;
  setTimeout(() => document.addEventListener('click', function handler(e) {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
  }), 100);
}

// ════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
  const colors = { ok: 'var(--buy)', err: 'var(--sell)', warn: 'var(--warn)', info: 'var(--blue)' };
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:calc(var(--bottom-h) + 16px);left:50%;transform:translateX(-50%);
    z-index:9999;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;
    background:var(--bg1);border:1px solid ${colors[type] || colors.info};
    color:${colors[type] || colors.info};
    box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:320px;text-align:center;
    animation:fadeIn .2s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ════════════════════════════════════════════════════════════
// LOADING STATE
// ════════════════════════════════════════════════════════════
function setAuthLoading(loading) {
  AUTH.isLoading = loading;
  const btn = document.getElementById('authSubmitBtn');
  if (btn) btn.disabled = loading;
}

// ════════════════════════════════════════════════════════════
// SUPABASE DATABASE SCHEMA
// (Run this SQL in your Supabase SQL editor)
// ════════════════════════════════════════════════════════════
const SUPABASE_SCHEMA = `
-- Run this in Supabase SQL Editor → New Query

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id                UUID REFERENCES auth.users(id) PRIMARY KEY,
  email             TEXT,
  tier              TEXT DEFAULT 'free' CHECK (tier IN ('free','pro','edge')),
  tier_expiry       TIMESTAMPTZ,
  stripe_customer_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Trade journal
CREATE TABLE IF NOT EXISTS public.journal (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
  trade_idx   INT,
  ts          TEXT,
  decision    TEXT,
  entry       FLOAT,
  sl          FLOAT,
  tp          FLOAT,
  grade       TEXT,
  prob        FLOAT,
  outcome     TEXT,
  sess_name   TEXT,
  synced_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, trade_idx)
);

-- HTF levels (Edge tier cross-device sync)
CREATE TABLE IF NOT EXISTS public.htf_levels (
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
  levels     JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (RLS) — users only see their own data
ALTER TABLE public.users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.htf_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own data" ON public.users
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "Users see own journal" ON public.journal
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own levels" ON public.htf_levels
  FOR ALL USING (auth.uid() = user_id);

-- Trigger: update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`;

// Log schema for reference
addAuditEntry('INFO', 'Auth module loaded. Run SUPABASE_SCHEMA in Supabase SQL Editor to init DB.');

// ════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════
// Handle Stripe return params before anything else
handleStripeReturn();

// Init Supabase after a short delay (DOM + other modules loaded)
setTimeout(() => {
  initSupabase();
  buildAuthModal();
  updateAuthUI();
  addAuditEntry('SYS', `Auth layer v5.9 active — mode: ${AUTH_CFG.MODE.toUpperCase()}`);
}, 500);
