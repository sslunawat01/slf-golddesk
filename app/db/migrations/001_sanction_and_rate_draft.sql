-- 001 · deny-by-default sanction ceilings + rate maker/checker drafts
-- Fixes: absence of a limit row previously read as "unlimited" (dangerous).
BEGIN;

-- Unlimited must be an explicit, deliberate grant — never an accident of absence.
ALTER TABLE sanction_limit ADD COLUMN IF NOT EXISTS is_unlimited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sanction_limit ADD CONSTRAINT sanction_limit_unlimited_zero
  CHECK (NOT is_unlimited OR limit_paise = 0);

-- Owner role: explicit unlimited grant (id 1 = Owner in seed)
INSERT INTO sanction_limit (role_id, employee_id, limit_paise, is_unlimited, reason, approved_by)
SELECT 1, NULL, 0, TRUE, 'Owner — unlimited sanction authority (explicit grant)', 1
 WHERE NOT EXISTS (SELECT 1 FROM sanction_limit WHERE role_id = 1 AND employee_id IS NULL);

-- A rate awaiting its checker. daily_rate is append-only and requires both
-- signatures, so the pending state needs its own short-lived table.
CREATE TABLE IF NOT EXISTS rate_draft (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_date   DATE NOT NULL,
  metal_id    BIGINT NOT NULL REFERENCES metal(id),
  base_paise  BIGINT NOT NULL CHECK (base_paise > 0),
  source_ref  TEXT,
  maker_id    BIGINT NOT NULL REFERENCES employee(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rate_date, metal_id)
);

COMMIT;
