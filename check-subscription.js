// GET /api/check-subscription?email={email}
// Returns subscription status for a given email address.
// Used by the Chrome extension on startup and by the landing page.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res
      .status(405)
      .set(CORS_HEADERS)
      .json({ error: 'Method not allowed' });
  }

  const { email } = req.query;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res
      .status(400)
      .set(CORS_HEADERS)
      .json({ error: 'Valid email query parameter required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select(
        'plan, lemon_subscription_id, current_period_end, trial_ends_at, created_at'
      )
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error('[check-subscription] Supabase error:', error);
      return res
        .status(500)
        .set(CORS_HEADERS)
        .json({ error: 'Database error' });
    }

    const now = new Date();

    // ── No row found: brand-new user ─────────────────────────────────────────
    if (!data) {
      // Create a free-tier row with a 7-day trial
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const { error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          email: normalizedEmail,
          plan: 'free',
          trial_ends_at: trialEnd.toISOString(),
        });

      if (insertError) {
        console.error('[check-subscription] Insert error:', insertError);
        // Return a graceful fallback — don't block the user
        return res.status(200).set(CORS_HEADERS).json({
          plan: 'free',
          status: 'trial',
          trialDaysLeft: 7,
          trialEndsAt: trialEnd.toISOString(),
          isPro: false,
        });
      }

      return res.status(200).set(CORS_HEADERS).json({
        plan: 'free',
        status: 'trial',
        trialDaysLeft: 7,
        trialEndsAt: trialEnd.toISOString(),
        isPro: false,
      });
    }

    // ── Active Pro subscription ──────────────────────────────────────────────
    if (data.plan === 'pro') {
      const periodEnd = data.current_period_end
        ? new Date(data.current_period_end)
        : null;

      // Treat as active even if period_end is null (lifetime / grandfathered)
      const isActive = !periodEnd || periodEnd > now;

      if (isActive) {
        return res.status(200).set(CORS_HEADERS).json({
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: data.current_period_end,
          isPro: true,
        });
      }

      // Pro period has lapsed — downgrade to free in DB (fire and forget)
      supabase
        .from('subscriptions')
        .update({ plan: 'free' })
        .eq('email', normalizedEmail)
        .then(({ error: updateError }) => {
          if (updateError) {
            console.error('[check-subscription] Downgrade error:', updateError);
          }
        });

      return res.status(200).set(CORS_HEADERS).json({
        plan: 'free',
        status: 'expired',
        isPro: false,
      });
    }

    // ── Free tier — check trial window ──────────────────────────────────────
    if (data.trial_ends_at) {
      const trialEnd = new Date(data.trial_ends_at);

      if (trialEnd > now) {
        const msLeft = trialEnd - now;
        const trialDaysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

        return res.status(200).set(CORS_HEADERS).json({
          plan: 'free',
          status: 'trial',
          trialDaysLeft,
          trialEndsAt: data.trial_ends_at,
          isPro: false,
        });
      }
    }

    // ── Free tier, trial expired ─────────────────────────────────────────────
    return res.status(200).set(CORS_HEADERS).json({
      plan: 'free',
      status: 'free',
      isPro: false,
    });
  } catch (err) {
    console.error('[check-subscription] Unexpected error:', err);
    return res
      .status(500)
      .set(CORS_HEADERS)
      .json({ error: 'Internal server error' });
  }
}
