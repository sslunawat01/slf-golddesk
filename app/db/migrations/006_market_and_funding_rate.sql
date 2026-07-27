-- 006 · two rates per metal: market (what the ornament is worth) and funding
--       (what we lend against). The funding rate must sit below the market rate;
--       the gap is our haircut, taken BEFORE the scheme's funding % applies.
BEGIN;

-- daily_rate is append-only by design: a trigger refuses UPDATE and DELETE.
-- A schema migration is a legitimate exception, so we lift the guard for this
-- statement only and put it straight back. Existing rows had a single rate, so
-- the funding rate starts equal to the market rate — no lending behaviour changes
-- until head office sets a real funding rate.
ALTER TABLE daily_rate ADD COLUMN IF NOT EXISTS funding_paise BIGINT;
ALTER TABLE daily_rate DISABLE TRIGGER trg_daily_rate_frozen;
UPDATE daily_rate SET funding_paise = base_paise WHERE funding_paise IS NULL;
ALTER TABLE daily_rate ENABLE TRIGGER trg_daily_rate_frozen;
ALTER TABLE daily_rate ALTER COLUMN funding_paise SET NOT NULL;
ALTER TABLE daily_rate ADD CONSTRAINT daily_rate_funding_below_market
  CHECK (funding_paise > 0 AND funding_paise <= base_paise);
ALTER TABLE daily_rate ADD COLUMN IF NOT EXISTS reference_paise BIGINT;   -- IBJA, for the record
COMMENT ON COLUMN daily_rate.base_paise IS 'market rate per gram, 24K';
COMMENT ON COLUMN daily_rate.funding_paise IS 'funding rate per gram, 24K — what we lend against';

-- the rate in force now carries both figures. Postgres will not let a function
-- change the columns it returns, so the old one is dropped first.
DROP FUNCTION IF EXISTS rate_in_force(BIGINT, DATE);
CREATE FUNCTION rate_in_force(p_metal BIGINT, p_on DATE)
RETURNS TABLE (rate_date DATE, base_paise BIGINT, funding_paise BIGINT,
               published_at TIMESTAMPTZ, maker_id BIGINT) LANGUAGE sql STABLE AS $$
  SELECT dr.rate_date, dr.base_paise, dr.funding_paise, dr.published_at, dr.maker_id
    FROM daily_rate dr
   WHERE dr.metal_id = p_metal AND dr.rate_date <= p_on
   ORDER BY dr.rate_date DESC, dr.published_at DESC
   LIMIT 1;
$$;

-- an application must remember BOTH rates it was priced at
ALTER TABLE loan_application ADD COLUMN IF NOT EXISTS funding_paise_snapshot BIGINT;
UPDATE loan_application SET funding_paise_snapshot = base_paise_snapshot
 WHERE funding_paise_snapshot IS NULL AND base_paise_snapshot IS NOT NULL;

INSERT INTO app_setting (key, value) VALUES ('ibja_reference_note', '"fetched for the record only"')
  ON CONFLICT (key) DO NOTHING;
COMMIT;
