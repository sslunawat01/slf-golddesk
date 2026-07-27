-- 003 · rate carries forward until changed; single-person publish with sanity guard
BEGIN;

-- checker is no longer compulsory: with single-person publish, maker = checker.
ALTER TABLE daily_rate DROP CONSTRAINT IF EXISTS daily_rate_check;

-- who confirmed a large jump, and what it was measured against (audit trail)
ALTER TABLE daily_rate ADD COLUMN IF NOT EXISTS jump_pct NUMERIC(7,3);
ALTER TABLE daily_rate ADD COLUMN IF NOT EXISTS jump_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- drafts are no longer part of the flow
DROP TABLE IF EXISTS rate_draft;

-- how far a new rate may move before the screen asks for confirmation
INSERT INTO app_setting (key, value) VALUES ('rate_jump_warn_pct', '5')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO app_setting (key, value) VALUES ('rate_publish_requires_checker', 'false')
  ON CONFLICT (key) DO NOTHING;

-- the rate in force on a given date = the most recent one published on or before it
CREATE OR REPLACE FUNCTION rate_in_force(p_metal BIGINT, p_on DATE)
RETURNS TABLE (rate_date DATE, base_paise BIGINT, published_at TIMESTAMPTZ, maker_id BIGINT) 
LANGUAGE sql STABLE AS $$
  SELECT dr.rate_date, dr.base_paise, dr.published_at, dr.maker_id
    FROM daily_rate dr
   WHERE dr.metal_id = p_metal AND dr.rate_date <= p_on
   ORDER BY dr.rate_date DESC, dr.published_at DESC
   LIMIT 1;
$$;

COMMIT;
