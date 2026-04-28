// GET /api/check-subscription?email={email}
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

// Vercel native runtime uses res.setHeader(), NOT res.set() (that's Express-only)
function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    setCors(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    setCors(res);
    return res.status(400).json({ error: 'Valid email query parameter required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('plan, lemon_subscription_id, current_period_end, trial_ends_at, created_at')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error('[check-subscription] Supabase error:', error);
      setCors(res);
      return res.status(500).json({ error: 'Database error' });
    }

    const now = new Date();

    // ── No row found: brand-new user ─────────────────────────────────────────
    if (!data) {
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const { error: insertError } = await supabase
        .from('subscriptions')
        .insert({
          email: normalizedEmail,
          plan: 'free',
          trial_ends_at: trialEnd.toISOString(),
        });

      setCors(res);

      if (insertError) {
        console.error('[check-subscription] Insert error:', insertError);
        return res.status(200).json({
          plan: 'free',
          status: 'trial',
          trialDaysLeft: 7,
          trialEndsAt: trialEnd.toISOString(),
          isPro: false,
        });
      }

      return res.status(200).json({
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

      const isActive = !periodEnd || periodEnd > now;

      if (isActive) {
        setCors(res);
        return res.status(200).json({
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: data.current_period_end,
          isPro: true,
        });
      }

      // Pro lapsed — downgrade (fire and forget)
      supabase
        .from('subscriptions')
        .update({ plan: 'free' })
        .eq('email', normalizedEmail)
        .then(({ error: updateError }) => {
          if (updateError) {
            console.error('[check-subscription] Downgrade error:', updateError);
          }
        });

      setCors(res);
      return res.status(200).json({
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

        setCors(res);
        return res.status(200).json({
          plan: 'free',
          status: 'trial',
          trialDaysLeft,
          trialEndsAt: data.trial_ends_at,
          isPro: false,
        });
      }
    }

    // ── Free tier, trial expired ─────────────────────────────────────────────
    setCors(res);
    return res.status(200).json({
      plan: 'free',
      status: 'free',
      isPro: false,
    });

  } catch (err) {
    console.error('[check-subscription] Unexpected error:', err);
    setCors(res);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
