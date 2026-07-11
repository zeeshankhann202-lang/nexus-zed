// ═══════════════════════════════════════════════════════════
// NEXUS ZED v5.11 — PWA Engine
// Service Worker registration + lifecycle management
// Push notification subscription + sending
// Background sync for journal + ML data
// Install prompt handling (Android "Add to Home Screen")
// iOS Safari install guidance
// Update detection + user prompt
// ═══════════════════════════════════════════════════════════

const PWA = {
  sw:              null,    // ServiceWorkerRegistration
  pushSub:         null,    // PushSubscription
  isInstalled:     false,
  isIOS:           /iphone|ipad|ipod/i.test(navigator.userAgent),
  isAndroid:       /android/i.test(navigator.userAgent),
  isStandalone:    window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true,
  deferredPrompt:  null,    // BeforeInstallPromptEvent
  updateAvailable: false,
  VAPID_PUBLIC_KEY: 'YOUR_VAPID_PUBLIC_KEY', // Replace when setting up push
};

// ════════════════════════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ════════════════════════════════════════════════════════════
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    addAuditEntry('INFO', 'PWA: Service Worker not supported in this browser');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none', // Always check for SW updates
    });

    PWA.sw = reg;
    addAuditEntry('SYS', 'PWA: Service Worker registered — scope: ' + reg.scope);

    // Check for updates immediately and every 30 minutes
    reg.update();
    setInterval(() => reg.update(), 30 * 60 * 1000);

    // Handle SW lifecycle states
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available
          PWA.updateAvailable = true;
          addAuditEntry('SYS', 'PWA: New version available — prompt user to update');
          showUpdateBanner();
        }
      });
    });

    // Handle controller change (after skipWaiting)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (PWA.updateAvailable) {
        addAuditEntry('SYS', 'PWA: Updated to new version — reloading');
        window.location.reload();
      }
    });

    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    // Get SW version
    if (reg.active) {
      reg.active.postMessage({ type: 'GET_VERSION' });
    }

    // Try push notification subscription (if permission already granted)
    if (Notification.permission === 'granted') {
      await subscribeToPush(reg);
    }

    return reg;
  } catch(e) {
    addAuditEntry('ERR', 'PWA: SW registration failed: ' + e.message);
  }
}

// ── Handle messages from Service Worker ──────────────────
function handleSWMessage(event) {
  const { type, data, version } = event.data || {};

  switch (type) {
    case 'SW_VERSION':
      addAuditEntry('SYS', 'PWA: SW version ' + version);
      break;

    case 'NOTIFICATION_CLICK':
      // SW told us a notification was clicked — navigate to relevant page
      if (data?.page) goPage(data.page);
      break;

    case 'SYNC_JOURNAL':
      // SW triggered background sync
      if (typeof syncJournalToCloud === 'function') {
        syncJournalToCloud().then(() => addAuditEntry('LIVE', 'PWA: Journal synced (background)'));
      }
      break;

    case 'SYNC_ML':
      if (typeof persistState === 'function') persistState();
      break;

    case 'CACHE_CLEARED':
      addAuditEntry('SYS', 'PWA: Cache cleared');
      break;
  }
}

// ════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ════════════════════════════════════════════════════════════

// Convert VAPID key for push subscription
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribeToPush(reg) {
  if (!('PushManager' in window)) return;
  if (PWA.VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY') return;

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(PWA.VAPID_PUBLIC_KEY),
    });

    PWA.pushSub = sub;
    addAuditEntry('LIVE', 'PWA: Push subscription active');

    // Store subscription in Supabase for server to use
    await storePushSubscription(sub);
    return sub;
  } catch(e) {
    if (e.name !== 'NotAllowedError') {
      addAuditEntry('ERR', 'PWA: Push subscription failed: ' + e.message);
    }
  }
}

async function storePushSubscription(sub) {
  if (!window.AUTH?.supabase || !window.AUTH?.user) return;
  try {
    await window.AUTH.supabase.from('push_subscriptions').upsert({
      user_id:      window.AUTH.user.id,
      endpoint:     sub.endpoint,
      p256dh:       btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
      auth:         btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
      user_agent:   navigator.userAgent.slice(0, 200),
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch(e) {}
}

// ── Request permission and subscribe ─────────────────────
async function requestPushPermission() {
  if (!('Notification' in window)) {
    showToast('Push notifications not supported in this browser.', 'warn');
    return false;
  }

  if (Notification.permission === 'granted') {
    if (PWA.sw) await subscribeToPush(PWA.sw);
    return true;
  }

  if (Notification.permission === 'denied') {
    showToast('Notifications blocked. Enable in browser settings.', 'warn');
    return false;
  }

  // Request permission
  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    if (PWA.sw) await subscribeToPush(PWA.sw);
    showToast('✓ Push alerts enabled — Grade A signals will notify you', 'ok');
    addAuditEntry('LIVE', 'PWA: Push notifications enabled');
    return true;
  }

  addAuditEntry('INFO', 'PWA: Push notification permission denied');
  return false;
}

// ── Local notification (no server needed) ────────────────
// Used for in-app alerts when the app is open
function sendLocalNotification(type, title, body, data = {}) {
  if (Notification.permission !== 'granted') return;

  const n = new Notification(title, {
    body,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag:   'nexus-' + type.toLowerCase(),
    data,
    requireInteraction: type === 'SIGNAL_A',
    silent: type === 'DIGEST',
  });

  n.onclick = () => {
    window.focus();
    if (data.page) goPage(data.page);
    n.close();
  };

  // Auto-close after 8s for non-Grade-A
  if (type !== 'SIGNAL_A') setTimeout(() => n.close(), 8000);
}

// ── Send alert from brain signal ─────────────────────────
function sendSignalAlert(direction, grade, conf, entry, sl, tp1) {
  if (!can('alerts')) return; // Edge tier only

  const emoji = direction === 'SELL' ? '▼' : '▲';
  const gradeLabel = grade === 'A' ? '⭐ GRADE A' : 'GRADE ' + grade;

  // Try push notification first (works when app is closed)
  if (PWA.pushSub) {
    // In production: POST to your Worker endpoint to trigger server push
    // For now: use local notification (app must be open)
  }

  // Local notification (app is open)
  sendLocalNotification(
    'SIGNAL_' + grade,
    `NEXUS ${gradeLabel} — ${direction}`,
    `${emoji} ${direction} XAU/USD at ${entry?.toFixed?.(2) || '—'}\nSL: ${sl?.toFixed?.(2) || '—'} · TP1: ${tp1?.toFixed?.(2) || '—'} · Conf: ${conf}%`,
    { page: 'execution', direction, grade, entry, sl, tp1 }
  );
}

function sendZoneAlert(zoneType, price, level) {
  if (!can('alerts') && !CFG?.sndZone) return;

  sendLocalNotification(
    'ZONE',
    `NEXUS — Price at ${zoneType}`,
    `XAU/USD ${price?.toFixed?.(2) || '—'} approaching ${zoneType} at ${level?.toFixed?.(2) || '—'}`,
    { page: 'liquidity' }
  );
}

function sendBlackoutAlert(eventTitle, impact, minutesBefore) {
  if (Notification.permission !== 'granted') return;

  sendLocalNotification(
    'BLACKOUT',
    `🔴 NEXUS — News Blackout in ${minutesBefore}min`,
    `${impact} Impact: ${eventTitle} — Close new positions or wait.`,
    { page: 'macro' }
  );
}

// ── Wire alerts into existing engines ────────────────────

// Grade A/B signal detection — hook into brain render
const _origRenderSignalCard = window.renderSignalCard;
window.renderSignalCard = function() {
  _origRenderSignalCard?.();

  const br = S.brain;
  if (!br || !br.direction || br.direction === 'WAIT') return;

  // Only alert on Grade A (and B for Edge)
  const minGrade = CFG?.minGrade || 'B';
  const gradeOrder = { A: 0, B: 1, C: 2 };
  if (gradeOrder[br.grade] > gradeOrder[minGrade]) return;

  // Debounce — don't alert twice for same signal
  const sigKey = `${br.direction}|${br.grade}|${Math.round(br.conf)}`;
  if (PWA._lastSigKey === sigKey) return;
  PWA._lastSigKey = sigKey;

  const ts = S.tradeSetup;
  sendSignalAlert(br.direction, br.grade, Math.round(br.conf), ts?.entry, ts?.sl, ts?.tp1);
};

// Zone approach detection — hook into main fetch cycle
const _origFetchAllPWA = window.fetchAll;
window.fetchAll = async function() {
  await _origFetchAllPWA();

  const price = S.gold.price;
  if (!price) return;

  // Zone approach: within 1×ATR of sell/buy zone
  const atr = S.mem.atr.slice(-1)[0] || 15;
  if (ZONES.sell1 && Math.abs(price - ZONES.sell1.lo) < atr) {
    if (!PWA._zoneAlerted || Date.now() - PWA._zoneAlerted > 300000) {
      PWA._zoneAlerted = Date.now();
      sendZoneAlert('4H SUPPLY', price, ZONES.sell1.lo);
    }
  } else if (ZONES.buy1 && Math.abs(price - ZONES.buy1.hi) < atr) {
    if (!PWA._zoneAlerted || Date.now() - PWA._zoneAlerted > 300000) {
      PWA._zoneAlerted = Date.now();
      sendZoneAlert('4H DEMAND', price, ZONES.buy1.hi);
    }
  }

  // Pre-event blackout warning (15 min warning)
  const nb = window.NB;
  if (nb?.nextEvent && !nb?.blackoutActive) {
    try {
      const t = new Date(nb.nextEvent.date).getTime();
      const minsUntil = (t - Date.now()) / 60000;
      if (minsUntil > 0 && minsUntil <= 15 && !PWA._blackoutWarned) {
        PWA._blackoutWarned = true;
        sendBlackoutAlert(nb.nextEvent.title, nb.nextEvent.impact, Math.round(minsUntil));
      } else if (minsUntil > 15) {
        PWA._blackoutWarned = false;
      }
    } catch(e) {}
  }
};

// Background sync registration
async function registerBackgroundSync() {
  if (!PWA.sw || !('sync' in PWA.sw)) return;
  try {
    await PWA.sw.sync.register('nexus-journal-sync');
    addAuditEntry('SYS', 'PWA: Background sync registered');
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════
// INSTALL PROMPT
// ════════════════════════════════════════════════════════════

// Capture the browser's install prompt (Chrome/Android/Edge)
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  PWA.deferredPrompt = e;
  addAuditEntry('SYS', 'PWA: Install prompt available');
  showInstallBanner();
});

window.addEventListener('appinstalled', () => {
  PWA.isInstalled = true;
  PWA.deferredPrompt = null;
  document.getElementById('installBanner')?.remove();
  addAuditEntry('SYS', 'PWA: App installed to home screen');
  showToast('✓ NEXUS installed — find it on your home screen', 'ok');
});

async function triggerInstallPrompt() {
  if (PWA.deferredPrompt) {
    // Android/Chrome: use native prompt
    PWA.deferredPrompt.prompt();
    const { outcome } = await PWA.deferredPrompt.userChoice;
    addAuditEntry('SYS', 'PWA: Install prompt outcome: ' + outcome);
    PWA.deferredPrompt = null;
  } else if (PWA.isIOS) {
    // iOS: show manual instructions
    showIOSInstallGuide();
  } else {
    showToast('Open this site in Chrome or Edge for the best install experience.', 'info');
  }
}

// ── iOS Install Guide ─────────────────────────────────────
function showIOSInstallGuide() {
  const existing = document.getElementById('iosGuide');
  if (existing) { existing.remove(); return; }

  const guide = document.createElement('div');
  guide.id = 'iosGuide';
  guide.style.cssText = `
    position:fixed;bottom:calc(var(--bottom-h) + 12px);left:50%;
    transform:translateX(-50%);z-index:800;
    background:var(--bg1);border:1px solid var(--border2);border-radius:14px;
    padding:16px 20px;max-width:320px;width:calc(100% - 32px);
    box-shadow:0 8px 32px rgba(0,0,0,.5);
    animation:fadeIn .3s ease;
  `;
  guide.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:700;color:var(--t1);">Install NEXUS on iPhone</div>
      <div onclick="document.getElementById('iosGuide').remove()"
        style="cursor:pointer;color:var(--t3);font-size:18px;line-height:1;">✕</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--t2);">
        <div style="width:28px;height:28px;background:var(--golddim);border-radius:6px;
          display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">⬆</div>
        <span>Tap the <strong style="color:var(--gold)">Share</strong> button in Safari's toolbar</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--t2);">
        <div style="width:28px;height:28px;background:var(--golddim);border-radius:6px;
          display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">➕</div>
        <span>Scroll down and tap <strong style="color:var(--gold)">Add to Home Screen</strong></span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;color:var(--t2);">
        <div style="width:28px;height:28px;background:var(--golddim);border-radius:6px;
          display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">✓</div>
        <span>Tap <strong style="color:var(--gold)">Add</strong> — NEXUS opens like a native app</span>
      </div>
    </div>
    <div style="margin-top:12px;font-size:10px;color:var(--t3);">
      Works on iOS 16.4+ · Full-screen · No browser chrome
    </div>
  `;
  document.body.appendChild(guide);

  // Auto-dismiss after 12s
  setTimeout(() => guide.remove(), 12000);
}

// ── Install Banner ────────────────────────────────────────
function showInstallBanner() {
  if (PWA.isStandalone) return; // Already installed
  if (document.getElementById('installBanner')) return;

  // Don't show if dismissed recently
  try {
    const dismissed = localStorage.getItem('nexus_install_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 86400000) return;
  } catch(e) {}

  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.style.cssText = `
    position:fixed;bottom:calc(var(--bottom-h) + 12px);left:16px;right:16px;z-index:800;
    background:var(--bg1);border:1px solid var(--goldborder);border-radius:12px;
    padding:12px 14px;display:flex;align-items:center;gap:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.4),0 0 0 1px rgba(245,166,35,.1);
    animation:fadeIn .3s ease;
  `;
  banner.innerHTML = `
    <div style="width:36px;height:36px;background:var(--gold);border-radius:8px;
      display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;
      color:#000;flex-shrink:0;">N</div>
    <div style="flex:1;">
      <div style="font-size:12px;font-weight:700;color:var(--t1);">Install NEXUS</div>
      <div style="font-size:11px;color:var(--t3);">Add to home screen for instant access</div>
    </div>
    <button onclick="triggerInstallPrompt()" style="padding:7px 14px;background:var(--gold);
      border:none;border-radius:7px;color:#000;font-weight:700;font-size:12px;
      cursor:pointer;font-family:var(--font);flex-shrink:0;">Install</button>
    <div onclick="dismissInstallBanner()" style="cursor:pointer;color:var(--t3);
      font-size:18px;padding:4px;flex-shrink:0;">✕</div>
  `;
  document.body.appendChild(banner);
}

function dismissInstallBanner() {
  document.getElementById('installBanner')?.remove();
  try { localStorage.setItem('nexus_install_dismissed', Date.now().toString()); } catch(e) {}
}

// ── Update Banner ─────────────────────────────────────────
function showUpdateBanner() {
  const existing = document.getElementById('updateBanner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.style.cssText = `
    position:fixed;top:calc(var(--nav-h) + 8px);left:50%;transform:translateX(-50%);
    z-index:900;background:var(--bg1);border:1px solid var(--buyborder);border-radius:10px;
    padding:10px 16px;display:flex;align-items:center;gap:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:12px;
  `;
  banner.innerHTML = `
    <span style="color:var(--buy);">🔄 New version available</span>
    <button onclick="applyUpdate()" style="padding:5px 12px;background:var(--buy);
      border:none;border-radius:6px;color:#000;font-weight:700;font-size:11px;cursor:pointer;
      font-family:var(--font);">Update Now</button>
    <div onclick="this.parentElement.remove()" style="cursor:pointer;color:var(--t3);">✕</div>
  `;
  document.body.appendChild(banner);
}

function applyUpdate() {
  if (PWA.sw?.waiting) {
    PWA.sw.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  document.getElementById('updateBanner')?.remove();
}

// ════════════════════════════════════════════════════════════
// PWA SETTINGS UI INJECTION
// Adds PWA section to the Settings modal Alerts tab
// ════════════════════════════════════════════════════════════
function injectPWASettings() {
  const alertsTab = document.getElementById('stab-alerts');
  if (!alertsTab || document.getElementById('pwaSettingsSection')) return;

  const section = document.createElement('div');
  section.id = 'pwaSettingsSection';
  section.innerHTML = `
    <div class="smod-divider"></div>
    <div class="smod-section">
      <div class="smod-section-title">App & Notifications</div>

      <!-- Install row -->
      <div class="smod-row" id="pwaInstallRow">
        <div>
          <div class="smod-label">Install to Home Screen</div>
          <div class="smod-sublabel">Use NEXUS like a native app — works offline</div>
        </div>
        <button class="smod-btn smod-btn-secondary" style="width:auto;padding:6px 14px;font-size:12px;"
          onclick="triggerInstallPrompt()">
          ${PWA.isStandalone ? '✓ Installed' : PWA.isIOS ? '📱 iPhone Guide' : '⬇ Install'}
        </button>
      </div>

      <!-- Push alerts row -->
      <div class="smod-row">
        <div>
          <div class="smod-label">Push Notifications</div>
          <div class="smod-sublabel">Grade A signals even when app is closed (Edge tier)</div>
        </div>
        <button class="smod-btn smod-btn-secondary" style="width:auto;padding:6px 14px;font-size:12px;"
          onclick="requestPushPermission()" id="pushPermBtn">
          ${Notification.permission === 'granted' ? '✓ Enabled' : 'Enable'}
        </button>
      </div>

      <!-- App info -->
      <div style="padding:8px 10px;background:var(--bg2);border-radius:6px;font-size:11px;color:var(--t3);line-height:1.7;">
        <div>PWA Status: <span style="color:${PWA.isStandalone ? 'var(--buy)' : 'var(--t2)'};">${PWA.isStandalone ? '✓ Installed as app' : 'Running in browser'}</span></div>
        <div>Notifications: <span style="color:${Notification.permission === 'granted' ? 'var(--buy)' : 'var(--t3)'};">${Notification.permission}</span></div>
        <div>Offline cache: <span id="swCacheStatus" style="color:var(--t2);">Checking...</span></div>
      </div>
    </div>
  `;

  alertsTab.appendChild(section);

  // Check cache size
  caches.keys().then(keys => {
    const el = document.getElementById('swCacheStatus');
    if (el) el.textContent = keys.length + ' cache(s) active';
  }).catch(() => {
    const el = document.getElementById('swCacheStatus');
    if (el) el.textContent = 'Not available';
  });
}

// Wire PWA settings into settings modal open
const _origOpenSettings = window.openSettings;
window.openSettings = function() {
  _origOpenSettings();
  setTimeout(injectPWASettings, 100);
};

// ── Shortcut navigation from manifest shortcuts ───────────
(function handlePWAShortcuts() {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page');
  if (page && typeof goPage === 'function') {
    setTimeout(() => goPage(page), 600); // After init
  }
  if (params.get('pwa') === '1') {
    addAuditEntry('SYS', 'PWA: Launched from home screen shortcut' + (page ? ' → ' + page : ''));
  }
})();

// ════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════
async function initPWA() {
  // Register Service Worker
  await registerServiceWorker();

  // Show install banner if not installed
  if (!PWA.isStandalone) {
    // On iOS, show guide after a short delay if they've visited before
    if (PWA.isIOS) {
      try {
        const visits = parseInt(localStorage.getItem('nexus_visits') || '0') + 1;
        localStorage.setItem('nexus_visits', visits);
        if (visits === 3) showInstallBanner(); // Show on 3rd visit
      } catch(e) {}
    }
  }

  // Register background sync
  await registerBackgroundSync();

  addAuditEntry('SYS', `PWA v5.11 active — ${PWA.isStandalone ? 'standalone' : 'browser'} · ${PWA.isIOS ? 'iOS' : PWA.isAndroid ? 'Android' : 'desktop'}`);
}

// Init after DOM is ready
setTimeout(initPWA, 1000);
