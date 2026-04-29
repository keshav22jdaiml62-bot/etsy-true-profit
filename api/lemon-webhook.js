// POST /api/lemon-webhook
// Receives Lemon Squeezy subscription lifecycle webhooks.
// Verifies HMAC SHA-256 signature before processing any event.
//
// Events handled:
//   subscription_created  → upsert row, set plan=pro
//   subscription_updated  → update period_end / status
//   subscription_cancelled → keep pro until period_end
//   subscription_expired  → downgrade to free

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Vercel: disable built-in body parser so we can read the raw bytes
// needed for HMAC verification.
export const config = {
  api: { bodyParser: false },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the full raw body from the request stream and return it as a Buffer.
 */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Verify the X-Signature header against the raw body using HMAC SHA-256.
 * Returns true if valid, false otherwise.
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// ── Event handlers ───────────────────────────────────────────────────────────

/**
 * subscription_created / subscription_updated
 * Sets the row to pro with the latest billing period and customer IDs.
 */
async function handleSubscriptionActive(attrs) {
  const email =
    attrs.user_email ||
    attrs.billing_anchor?.email ||
    attrs.customer_email ||
    null;

  if (!email) {
    console.warn('[lemon-webhook] No email in subscription_created payload');
    return;
  }

  const periodEnd = attrs.renews_at
    ? new Date(attrs.renews_at).toISOString()
    : null;

  const trialEndsAt = attrs.trial_ends_at
    ? new Date(attrs.trial_ends_at).toISOString()
    : null;

  const { error } = await supabase.from('subscriptions').upsert(
    {
      email: email.trim().toLowerCase(),
      plan: 'pro',
      lemon_subscription_id: String(attrs.id),
      lemon_customer_id: attrs.customer_id ? String(attrs.customer_id) : null,
      current_period_end: periodEnd,
      trial_ends_at: trialEndsAt,
    },
    { onConflict: 'email' }
  );

  if (error) {
    console.error('[lemon-webhook] Upsert error (active):', error);
    throw error;
  }
}

/**
 * subscription_cancelled
 * The user cancelled but still has access until period end.
 * Keep plan=pro, just note the end date doesn't auto-renew.
 */
async function handleSubscriptionCancelled(attrs) {
  const subscriptionId = String(attrs.id);

  // endsAt is the last day of access
  const endsAt = attrs.ends_at
    ? new Date(attrs.ends_at).toISOString()
    : attrs.renews_at
    ? new Date(attrs.renews_at).toISOString()
    : null;

  const { error } = await supabase
    .from('subscriptions')
    .update({
      current_period_end: endsAt,
      // Keep plan=pro — access continues until period_end
    })
    .eq('lemon_subscription_id', subscriptionId);

  if (error) {
    console.error('[lemon-webhook] Update error (cancelled):', error);
    throw error;
  }
}

/**
 * subscription_expired
 * Period has ended — downgrade to free.
 */
async function handleSubscriptionExpired(attrs) {
  const subscriptionId = String(attrs.id);

  const { error } = await supabase
    .from('subscriptions')
    .update({
      plan: 'free',
      current_period_end: null,
    })
    .eq('lemon_subscription_id', subscriptionId);

  if (error) {
    console.error('[lemon-webhook] Update error (expired):', error);
    throw error;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Read raw body for signature verification
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error('[lemon-webhook] Failed to read body:', err);
    return res.status(400).json({ error: 'Could not read request body' });
  }

  // 2. Verify HMAC signature
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  if (!verifySignature(rawBody, signature, secret)) {
    console.warn('[lemon-webhook] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 3. Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    console.error('[lemon-webhook] JSON parse error:', err);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = payload?.meta?.event_name;
  const attrs = payload?.data?.attributes;

  if (!eventName || !attrs) {
    return res.status(400).json({ error: 'Missing event_name or attributes' });
  }

  console.log(`[lemon-webhook] Received event: ${eventName}`);

  // 4. Dispatch to correct handler
  try {
    switch (eventName) {
      case 'subscription_created':
      case 'subscription_updated':
        await handleSubscriptionActive(attrs);
        break;

      case 'subscription_cancelled':
        await handleSubscriptionCancelled(attrs);
        break;

      case 'subscription_expired':
        await handleSubscriptionExpired(attrs);
        break;

      default:
        // Unknown event — acknowledge without processing
        console.log(`[lemon-webhook] Unhandled event type: ${eventName}`);
    }

    return res.status(200).json({ received: true, event: eventName });
  } catch (err) {
    console.error(`[lemon-webhook] Handler error for ${eventName}:`, err);
    // Return 500 so Lemon Squeezy retries the webhook
    return res.status(500).json({ error: 'Handler failed' });
  }
}
