/**
 * NEXUS ZED — Service Worker v1.0
 * ════════════════════════════════════════════════════════════
 * Cache Strategy:
 *   App Shell  → Cache First (instant load)
 *   API Data   → Network First + stale fallback (fresh prices)
 *   Static     → Cache First with background update
 *
 * Push Notifications:
 *   Grade A signal  → immediate push
 *   Zone approach   → push with price + zone info
 *   News blackout   → warning push
 *   Daily digest    → scheduled push (if subscribed)
 *
 * Background Sync:
 *   Journal entries → sync to Supabase when back online
 * ════════════════════════════════════════════════════════════
 */

const SW_VERSION    = 'nexus-v5-sw-1.0.0';
const CACHE_SHELL   = `${SW_VERSION}-shell`;
const CACHE_STATIC  = `${SW_VERSION}-static`;
const CACHE_DATA    = `${SW_VERSION}-data`;

// ── APP SHELL — cached on install, served instantly ───────
const SHELL_URLS = [
  '/index.html',
  '/landing.html',
  '/js/nexus.state.js',
  '/js/nexus.helpers.js',
  '/js/nexus.session.js',
  '/js/nexus.feeds.js',
  '/js/nexus.engines.js',
  '/js/nexus.chart.js',
  '/js/nexus.render.js',
  '/js/nexus.ui.js',
  '/js/nexus.oanda.js',
  '/js/nexus.swing.js',
  '/js/nexus.ml.js',
  '/js/nexus.bayes.js',
  '/js/nexus.auth.js',
  '/js/nexus.pwa.js',
  '/manifest.json',
];

// ── STATIC ASSETS — cached on first use ──────────────────
const STATIC_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdn\.jsdelivr\.net\/npm\/@supabase/,
  /\.png$/,
  /\.ico$/,
  /\.svg$/,
];

// ── API PATTERNS — network first, cache fallback ─────────
const API_PATTERNS = [
  /stooq\.com/,
  /floatrates\.com/,
  /fred\.stlouisfed\.org/,
  /nfs\.faireconomy\.media/,
  /publicreporting\.cftc\.gov/,
  /twelvedata\.com/,
  /workers\.dev/,      // Cloudflare Worker
  /yahoo\.com/,
  /allorigins/,
  /corsproxy/,
];

// ── NEVER CACHE ───────────────────────────────────────────
const NEVER_CACHE = [
  /supabase\.co/,      // Auth tokens must be fresh
  /stripe\.com/,       // Payment endpoints
  /oanda\.com\/v3\/accounts/, // Live order flow stream
];

// ════════════════════════════════════════════════════════════
// INSTALL — cache app shell
// ════════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  console.log('[SW] Installing:', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then(cache => cache.addAll(SHELL_URLS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => {
        console.log('[SW] Shell cached:', SHELL_URLS.length, 'files');
        return self.skipWaiting(); // Activate immediately
      })
      .catch(err => {
        console.warn('[SW] Shell cache partial failure:', err.message);
        // Don't block install on partial failure
        return self.skipWaiting();
      })
  );
});

// ════════════════════════════════════════════════════════════
// ACTIVATE — clean old caches
// ════════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  console.log('[SW] Activating:', SW_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(SW_VERSION))
            .map(k => {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
      ))
      .then(() => self.clients.claim()) // Take control immediately
  );
});

// ════════════════════════════════════════════════════════════
// FETCH — routing logic
// ════════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Never cache auth/payment/stream endpoints
  if (NEVER_CACHE.some(p => p.test(req.url))) return;

  // API data → Network First
  if (API_PATTERNS.some(p => p.test(req.url))) {
    event.respondWith(networkFirst(req, CACHE_DATA, 8000));
    return;
  }

  // Static assets → Cache First with background update
  if (STATIC_PATTERNS.some(p => p.test(req.url))) {
    event.respondWith(cacheFirstWithUpdate(req, CACHE_STATIC));
    return;
  }

  // App shell (same origin) → Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, CACHE_SHELL));
    return;
  }

  // Everything else → Network with cache fallback
  event.respondWith(networkFirst(req, CACHE_DATA, 6000));
});

// ── Cache First ───────────────────────────────────────────
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(req);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, response.clone());
    }
    return response;
  } catch(e) {
    // Offline — return offline page for navigation requests
    if (req.mode === 'navigate') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

// ── Network First (with timeout) ─────────────────────────
async function networkFirst(req, cacheName, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(req, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req.url, response.clone()); // Cache for fallback
    }
    return response;
  } catch(e) {
    clearTimeout(timeoutId);
    // Network failed → try cache
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'Offline — cached data unavailable', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Cache First with Background Update (stale-while-revalidate) ─
async function cacheFirstWithUpdate(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  // Fetch in background to update cache
  const networkPromise = fetch(req).then(response => {
    if (response.ok) cache.put(req, response.clone());
    return response;
  }).catch(() => null);

  return cached || await networkPromise || new Response('Not found', { status: 404 });
}

// ════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// Receives push events from the NEXUS server/Worker
// Payload format: { type, title, body, data }
// ════════════════════════════════════════════════════════════
self.addEventListener('push', event => {
  let payload;
  try {
    payload = event.data?.json() || {};
  } catch(e) {
    payload = { type: 'SIGNAL', title: 'NEXUS Signal', body: event.data?.text() || '' };
  }

  const { type, title, body, data = {} } = payload;

  const icons = {
    SIGNAL_A:  { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: 'nexus-signal' },
    SIGNAL_B:  { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: 'nexus-signal' },
    ZONE:      { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: 'nexus-zone' },
    BLACKOUT:  { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: 'nexus-blackout' },
    DIGEST:    { icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: 'nexus-digest' },
  };

  const typeConfig = icons[type] || icons.SIGNAL_A;

  // Notification options
  const options = {
    body,
    icon:    typeConfig.icon,
    badge:   typeConfig.badge,
    tag:     typeConfig.tag,     // Replace previous notification of same type
    renotify: type === 'SIGNAL_A', // Vibrate/sound even if same tag (Grade A only)
    requireInteraction: type === 'SIGNAL_A', // Grade A stays until dismissed
    silent:  type === 'DIGEST',  // Digest notifications are silent
    data: {
      url:      '/index.html?page=' + (data.page || 'dashboard') + '&pwa=1',
      type,
      ...data,
    },
    actions: [],
  };

  // Action buttons by notification type
  if (type === 'SIGNAL_A' || type === 'SIGNAL_B') {
    options.actions = [
      { action: 'open',    title: '📊 Open Dashboard' },
      { action: 'dismiss', title: '✕ Dismiss' },
    ];
  } else if (type === 'BLACKOUT') {
    options.actions = [
      { action: 'open', title: '📅 View Calendar' },
    ];
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click handler ────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action = event.action;
  const data   = event.notification.data || {};

  if (action === 'dismiss') return;

  // Determine URL to open
  const targetURL = data.url || '/index.html?pwa=1';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Focus existing window if open
        for (const client of clientList) {
          if (client.url.includes('index.html') && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', data });
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) return clients.openWindow(targetURL);
      })
  );
});

// ════════════════════════════════════════════════════════════
// BACKGROUND SYNC — journal entries when back online
// ════════════════════════════════════════════════════════════
self.addEventListener('sync', event => {
  if (event.tag === 'nexus-journal-sync') {
    event.waitUntil(syncPendingJournalEntries());
  }
  if (event.tag === 'nexus-ml-sync') {
    event.waitUntil(syncMLData());
  }
});

async function syncPendingJournalEntries() {
  // Notify the main page to trigger sync
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    client.postMessage({ type: 'SYNC_JOURNAL' });
  }
}

async function syncMLData() {
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    client.postMessage({ type: 'SYNC_ML' });
  }
}

// ════════════════════════════════════════════════════════════
// MESSAGE HANDLER — communication from main page
// ════════════════════════════════════════════════════════════
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_URLS':
      // Main page can request caching of additional URLs
      if (payload?.urls) {
        caches.open(CACHE_STATIC).then(cache => cache.addAll(payload.urls));
      }
      break;

    case 'CLEAR_CACHE':
      // Force cache clear (e.g., after upgrade)
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
      event.source.postMessage({ type: 'CACHE_CLEARED' });
      break;

    case 'GET_VERSION':
      event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
      break;
  }
});

console.log('[SW] Service Worker loaded:', SW_VERSION);
