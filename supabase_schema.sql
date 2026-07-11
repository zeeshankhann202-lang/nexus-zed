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