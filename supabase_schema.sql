-- nexus-zed Supabase Schema
-- Auto-generated from live database by ZED HQ Lead audit
-- Last updated: 2026-10-10
-- Total tables: 32 (key tables shown; full list in Supabase dashboard)
-- ══════════════════════════════════════════════════════════════════

-- ── Core user tables ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id                        UUID REFERENCES auth.users(id) PRIMARY KEY,
  email                     TEXT,
  tier                      TEXT DEFAULT 'free' CHECK (tier IN ('free','pro','edge')),
  tier_expiry               TIMESTAMPTZ,
  stripe_customer_id        TEXT,
  stripe_subscription_id    TEXT,
  stripe_price_id           TEXT,
  stripe_subscription_status TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.journal (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES public.users(id) ON DELETE CASCADE,
  trade_idx   INT,
  ts          TEXT,
  direction   TEXT,
  entry       FLOAT,  sl FLOAT,  tp FLOAT,
  tp1 FLOAT,  tp2 FLOAT,  tp3 FLOAT,
  conf        FLOAT,
  bos         TEXT,   choch TEXT,
  h4_trend    TEXT,   h1_trend TEXT,  m15_trend TEXT,  d1_trend TEXT,
  macro_regime TEXT,  macro_score FLOAT,
  in_kill_zone BOOLEAN,
  tp1_hit     BOOLEAN, tp2_hit BOOLEAN, tp3_hit BOOLEAN, sl_hit BOOLEAN,
  exit_price  FLOAT,  exit_at TIMESTAMPTZ,
  pnl_r       FLOAT,  pnl_pts FLOAT,
  buee_gates  INT,    buee_detail JSONB,  brain_checks JSONB,
  liq_sweep   JSONB,  smc_score FLOAT,
  source      TEXT,
  outcome     TEXT,
  synced_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, trade_idx)
);

CREATE TABLE IF NOT EXISTS public.htf_levels (
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
  levels     JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ZED HQ governance tables (written by ZED HQ, read by engine) ──

CREATE TABLE IF NOT EXISTS public.zed_hq_controls (
  id         TEXT PRIMARY KEY,
  halt       BOOLEAN DEFAULT FALSE,
  reason     TEXT,
  issued_by  TEXT,
  issued_at  TIMESTAMPTZ,
  action     TEXT
);

-- Seed: insert the execution_control row on first deploy
INSERT INTO public.zed_hq_controls (id, halt, reason)
VALUES ('execution_control', FALSE, 'Initialized')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.zed_hq_halt_keys (
  id          SMALLINT PRIMARY KEY,
  key_sha256  TEXT NOT NULL,
  rotated_at  TIMESTAMPTZ NOT NULL
);

-- ── ZED-X tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.zedx_decisions (
  id          BIGSERIAL PRIMARY KEY,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode        TEXT,
  action      TEXT NOT NULL,
  direction   TEXT,
  score       NUMERIC,
  price       NUMERIC,
  h4_bias     TEXT,
  h1_bias     TEXT,
  m15_trigger TEXT,
  reasons     JSONB,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.zedx_paper_state (
  id          SMALLINT PRIMARY KEY,
  state       JSONB NOT NULL,
  saved_by    TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.zedx_trade_events (
  id          BIGSERIAL PRIMARY KEY,
  event_kind  TEXT NOT NULL,
  event_ts    TIMESTAMPTZ NOT NULL,
  account_env TEXT NOT NULL,
  symbol      TEXT,
  direction   TEXT,
  volume      NUMERIC,
  entry       NUMERIC,
  sl          NUMERIC,
  tp1         NUMERIC,
  tp2         NUMERIC,
  ticket      TEXT,
  conviction  NUMERIC,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.zedx_ingest_keys (
  id          SMALLINT PRIMARY KEY,
  key_sha256  TEXT NOT NULL,
  rotated_at  TIMESTAMPTZ NOT NULL
);

-- ── Server engine tables (32 total — see Supabase dashboard for complete list) ──

CREATE TABLE IF NOT EXISTS public.server_journal_runtime (
  id                   SMALLINT PRIMARY KEY DEFAULT 1,
  status               TEXT NOT NULL,
  total_trades         INT NOT NULL DEFAULT 0,
  wins                 INT NOT NULL DEFAULT 0,
  losses               INT NOT NULL DEFAULT 0,
  total_r              FLOAT NOT NULL DEFAULT 0,
  active_trade_id      BIGINT,
  last_invoked_at      TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  consecutive_errors   INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error           TEXT
);

CREATE TABLE IF NOT EXISTS public.server_engine_registry (
  engine_id        TEXT NOT NULL,
  engine_version   TEXT NOT NULL,
  scope            TEXT,
  current_stage    TEXT,
  authoritative    BOOLEAN,
  enabled          BOOLEAN,
  evidence_since   TIMESTAMPTZ,
  manifest         JSONB,
  evaluation_policy JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (engine_id, engine_version)
);

CREATE TABLE IF NOT EXISTS public.server_engine_evidence (
  id               BIGSERIAL PRIMARY KEY,
  engine_id        TEXT NOT NULL,
  engine_version   TEXT NOT NULL,
  scope            TEXT NOT NULL,
  stage            TEXT NOT NULL,
  observed_at      TIMESTAMPTZ NOT NULL,
  direction        TEXT NOT NULL,
  confidence       FLOAT NOT NULL,
  features         JSONB NOT NULL,
  output           JSONB NOT NULL,
  resolved_at      TIMESTAMPTZ,
  outcome_price    FLOAT,
  correct          BOOLEAN,
  signed_return_bps FLOAT,
  admissible       BOOLEAN NOT NULL DEFAULT TRUE,
  exclusion_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.server_market_snapshots (
  snapshot_at  TIMESTAMPTZ NOT NULL PRIMARY KEY,
  gold         FLOAT NOT NULL,
  dxy          FLOAT,
  yield10y     FLOAT,
  oil          FLOAT,
  spx          FLOAT,
  vix          FLOAT,
  gold_source  TEXT NOT NULL,
  sources      JSONB NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  truth        JSONB NOT NULL
);

-- ── Row Level Security ────────────────────────────────────────────

ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.htf_levels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zed_hq_controls    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own data"    ON public.users    FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users see own journal" ON public.journal  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own levels"  ON public.htf_levels FOR ALL USING (auth.uid() = user_id);

-- zed_hq_controls: anyone can READ, only ZED HQ halt key can WRITE (via RPC)
CREATE POLICY "Anyone can read halt"  ON public.zed_hq_controls FOR SELECT USING (true);
CREATE POLICY "Only ZED HQ can write halt" ON public.zed_hq_controls
  FOR ALL USING (false) WITH CHECK (false); -- writes only via zed_hq_set_halt() RPC
