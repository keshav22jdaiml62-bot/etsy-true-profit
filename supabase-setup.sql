-- EtsyTrue — Supabase subscription table
-- Run in: Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email                 text        UNIQUE NOT NULL,
  plan                  text        DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  lemon_subscription_id text,
  lemon_customer_id     text,
  current_period_end    timestamp,
  trial_ends_at         timestamp,
  created_at            timestamp   DEFAULT now(),
  updated_at            timestamp   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_email    ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_lemon_id ON subscriptions(lemon_subscription_id);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON subscriptions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
