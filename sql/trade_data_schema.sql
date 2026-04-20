-- Trade aggregates and sync checkpoint schema for Supabase (PostgreSQL).
-- Run as-is in the Supabase SQL Editor.
-- Requires PostgreSQL 13+ for gen_random_uuid() without extensions.

-- ---------------------------------------------------------------------------
-- trade_data: monthly import/export values per HS code and country
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_code varchar(10) NOT NULL,
  country_code char(2) NOT NULL,
  yymm char(6) NOT NULL,
  import_val bigint NOT NULL DEFAULT 0,
  export_val bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trade_data_hs_country_yymm_unique UNIQUE (hs_code, country_code, yymm)
);

CREATE INDEX IF NOT EXISTS idx_trade_data_hs_yymm ON public.trade_data (hs_code, yymm);
CREATE INDEX IF NOT EXISTS idx_trade_data_country_yymm ON public.trade_data (country_code, yymm);

COMMENT ON TABLE public.trade_data IS 'Monthly trade aggregates keyed by HS code, ISO-like country code, and YYYYMM.';
COMMENT ON COLUMN public.trade_data.id IS 'Primary key; server-generated UUID.';
COMMENT ON COLUMN public.trade_data.hs_code IS 'Harmonized System code segment (up to 10 chars).';
COMMENT ON COLUMN public.trade_data.country_code IS 'Two-letter country or region code.';
COMMENT ON COLUMN public.trade_data.yymm IS 'Calendar month as YYYYMM (six digits).';
COMMENT ON COLUMN public.trade_data.import_val IS 'Import side aggregate (application-defined unit).';
COMMENT ON COLUMN public.trade_data.export_val IS 'Export side aggregate (application-defined unit).';
COMMENT ON COLUMN public.trade_data.created_at IS 'Row insert time (UTC).';

-- ---------------------------------------------------------------------------
-- sync_progress: per (hs_code, country_code) fetch checkpoint and job status
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_progress (
  hs_code varchar(10) NOT NULL,
  country_code char(2) NOT NULL,
  last_fetched_yymm char(6) NOT NULL DEFAULT '200401',
  status varchar(20) NOT NULL DEFAULT 'pending',
  last_updated timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hs_code, country_code),
  CONSTRAINT sync_progress_status_chk CHECK (
    status IN ('pending', 'running', 'completed', 'failed')
  )
);

COMMENT ON TABLE public.sync_progress IS 'Sync checkpoint and status for each HS code and country pair.';
COMMENT ON COLUMN public.sync_progress.hs_code IS 'HS code segment matching trade_data.hs_code.';
COMMENT ON COLUMN public.sync_progress.country_code IS 'Country code matching trade_data.country_code.';
COMMENT ON COLUMN public.sync_progress.last_fetched_yymm IS 'Last successfully processed month as YYYYMM; default seed 200401.';
COMMENT ON COLUMN public.sync_progress.status IS 'Job state: pending, running, completed, or failed.';
COMMENT ON COLUMN public.sync_progress.last_updated IS 'Last write to this checkpoint row (UTC).';
