-- 029 · per-metal rate snapshots on an application (A2, owner 30 Aug 2026;
-- resolves O7). An application snapshots the in-force pair of EVERY metal
-- that carries its own rates, so silver items price off the silver pair the
-- day the pledge started, exactly as gold always has. The old gold columns
-- on loan_application stay in place and keep being written (compatibility).
-- New table only — no locks on hot tables, no stop-service needed.

CREATE TABLE application_rate (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id bigint NOT NULL REFERENCES loan_application(id),
  metal_id       bigint NOT NULL REFERENCES metal(id),
  base_paise     bigint NOT NULL CHECK (base_paise > 0),
  funding_paise  bigint NOT NULL CHECK (funding_paise > 0 AND funding_paise <= base_paise),
  UNIQUE (application_id, metal_id)
);

COMMENT ON TABLE application_rate IS
  'Per-metal market/funding snapshot taken when the application started (A2/O7, 30 Aug 2026)';

-- backfill: every existing application''s gold pair moves in
INSERT INTO application_rate (application_id, metal_id, base_paise, funding_paise)
SELECT id, 1, base_paise_snapshot, coalesce(funding_paise_snapshot, base_paise_snapshot)
  FROM loan_application
 WHERE base_paise_snapshot IS NOT NULL;
