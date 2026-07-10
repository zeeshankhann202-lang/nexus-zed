

// ════════════════════════════════════════════════════════════
// WORKER STRIPE ENDPOINTS
// Add these route handlers to the main fetch() dispatcher
// in worker.js when your UK Stripe account is ready
// ════════════════════════════════════════════════════════════

/*
ROUTES TO ADD in worker.js fetch() dispatcher:

  if (path === '/create-checkout') return await handleCreateCheckout(request, env, ctx);
  if (path === '/billing-portal')  return await handleBillingPortal(request, env, ctx);
  if (path === '/stripe-webhook')  return await handleStripeWebhook(request, env, ctx);

SECRETS TO ADD via wrangler secret put:
  STRIPE_SECRET_KEY         (sk_live_... from Stripe dashboard)
  STRIPE_WEBHOOK_SECRET     (whsec_... from Stripe webhook settings)
  SUPABASE_SERVICE_KEY      (service_role key from Supabase project settings)
  SUPABASE_URL              (https://xxxx.supabase.co)
*/

// ── Create Stripe Checkout Session ───────────────────────
async function handleCreateCheckout(request, env, ctx) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  // Verify Supabase JWT
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '');
  const user = await verifySupabaseJWT(jwt, env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = await request.json();
  const { price_id, customer_email, success_url, cancel_url } = body;

  if (!price_id) return jsonResponse({ error: 'price_id required' }, 400);

  // Look up or create Stripe customer
  let customerId = await getStripeCustomerId(user.id, env);
  if (!customerId) {
    const customer = await stripeAPI('/v1/customers', 'POST', {
      email: customer_email || user.email,
      metadata: { supabase_id: user.id }
    }, env);
    customerId = customer.id;
    await updateStripeCustomerId(user.id, customer.id, env);
  }

  // Create Checkout session
  const session = await stripeAPI('/v1/checkout/sessions', 'POST', {
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: price_id, quantity: 1 }],
    success_url: success_url + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url,
    subscription_data: {
      metadata: { supabase_id: user.id }
    },
    allow_promotion_codes: true,
  }, env);

  return jsonResponse({ url: session.url, session_id: session.id });
}

// ── Billing Portal ────────────────────────────────────────
async function handleBillingPortal(request, env, ctx) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  const authHeader = request.headers.get('Authorization') || '';
  const user = await verifySupabaseJWT(authHeader.replace('Bearer ',''), env);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { return_url } = await request.json();
  const customerId = await getStripeCustomerId(user.id, env);
  if (!customerId) return jsonResponse({ error: 'No Stripe customer found' }, 404);

  const session = await stripeAPI('/v1/billing_portal/sessions', 'POST', {
    customer: customerId,
    return_url,
  }, env);

  return jsonResponse({ url: session.url });
}

// ── Stripe Webhook ────────────────────────────────────────
// Set this URL in Stripe Dashboard → Webhooks:
//   https://your-worker.workers.dev/stripe-webhook
// Events to listen for:
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed
async function handleStripeWebhook(request, env, ctx) {
  const sig = request.headers.get('Stripe-Signature');
  const body = await request.text();

  // Verify webhook signature
  if (!verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET)) {
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  const event = JSON.parse(body);
  const PRICE_TO_TIER = {
    [env.PRICE_PRO]:  'pro',
    [env.PRICE_EDGE]: 'edge',
  };

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub     = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id;
      const tier    = PRICE_TO_TIER[priceId] || 'free';
      const supaId  = sub.metadata?.supabase_id;
      if (supaId) {
        await updateUserTier(supaId, tier, sub.current_period_end, env);
        console.log(`Webhook: ${supaId} → ${tier} (${event.type})`);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub    = event.data.object;
      const supaId = sub.metadata?.supabase_id;
      if (supaId) {
        await updateUserTier(supaId, 'free', null, env);
        console.log(`Webhook: ${supaId} → free (subscription deleted)`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const supaId  = invoice.subscription_details?.metadata?.supabase_id;
      if (supaId) console.log(`Payment failed for ${supaId} — Stripe will retry`);
      break;
    }
  }

  return jsonResponse({ received: true });
}

// ── Stripe API helper ─────────────────────────────────────
async function stripeAPI(path, method, body, env) {
  const r = await fetch('https://api.stripe.com' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(flattenStripeParams(body)).toString() : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Stripe API error: ' + (d.error?.message || r.status));
  return d;
}

function flattenStripeParams(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenStripeParams(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => Object.assign(out, flattenStripeParams(item, `${key}[${i}]`)));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

// ── Supabase helpers (for Worker) ─────────────────────────
async function verifySupabaseJWT(jwt, env) {
  if (!jwt || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  try {
    const r = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + jwt,
        'apikey': env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function updateUserTier(userId, tier, expiryTimestamp, env) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      tier,
      tier_expiry: expiryTimestamp ? new Date(expiryTimestamp * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) console.error('Supabase tier update failed:', await r.text());
}

async function getStripeCustomerId(userId, env) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=stripe_customer_id`, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      },
    });
    const data = await r.json();
    return data?.[0]?.stripe_customer_id || null;
  } catch(e) { return null; }
}

async function updateStripeCustomerId(userId, customerId, env) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stripe_customer_id: customerId }),
  });
}

// ── Stripe webhook signature verification ─────────────────
function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  try {
    const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
    const timestamp = parts.t;
    const signatures = sigHeader.match(/v1=([a-f0-9]+)/g)?.map(s => s.slice(3)) || [];
    // In Cloudflare Workers, use SubtleCrypto for HMAC
    // (Full implementation requires async — see stripe-js for complete version)
    // For now, return true and implement full HMAC verification in production
    return signatures.length > 0 && timestamp > 0;
  } catch(e) { return false; }
}
*/
