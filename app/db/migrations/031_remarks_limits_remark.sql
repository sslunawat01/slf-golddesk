-- 031 (E32, owner 15 Oct 2026) — customer warning / blacklist remarks, a
-- remark on the loan application, cash limits as settings, two new
-- permission functions. Structure only; 032 seeds the permissions (an enum
-- value added here cannot be referenced in the same transaction).

-- —— permissions: blacklist remarks are a granted right; Settings gets a Limits tab ——
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'blacklist';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_limits';

-- —— item 4: a free-text remark on every loan file ——
ALTER TABLE loan_application ADD COLUMN IF NOT EXISTS remark text;

-- —— item 5: warning and blacklist remarks on the customer ——
ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS warning_remark    text,
  ADD COLUMN IF NOT EXISTS warning_set_by    bigint REFERENCES employee(id),
  ADD COLUMN IF NOT EXISTS warning_set_at    timestamptz,
  ADD COLUMN IF NOT EXISTS blacklist_remark  text,
  ADD COLUMN IF NOT EXISTS blacklist_set_by  bigint REFERENCES employee(id),
  ADD COLUMN IF NOT EXISTS blacklist_set_at  timestamptz;
-- a blacklist remark blacklists on its own: everything that already honours
-- is_blacklisted (lending block, search chip, 360 banner) follows automatically
ALTER TABLE customer DROP COLUMN is_blacklisted;
ALTER TABLE customer ADD COLUMN is_blacklisted boolean
  GENERATED ALWAYS AS (max_open_loans = 0 OR max_outstanding_paise = 0 OR blacklist_remark IS NOT NULL) STORED;

-- —— item 6: cash limits live in settings (owner override of the fixed figures) ——
-- cash paid out per loan must be BELOW this (Sec 269SS says ₹20,000);
-- cash received from one customer in a day may be AT MOST this (Sec 269ST says ₹2,00,000).
INSERT INTO app_setting (key, value) VALUES ('cash_disburse_below_paise', '2000000')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO app_setting (key, value) VALUES ('cash_receipt_day_max_paise', '20000000')
  ON CONFLICT (key) DO NOTHING;
-- the fixed CHECK on cash payout legs becomes a trigger that reads the setting
ALTER TABLE disbursement_leg DROP CONSTRAINT IF EXISTS disbursement_leg_check;
CREATE OR REPLACE FUNCTION fn_leg_cash_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap bigint;
BEGIN
  IF NEW.kind = 'cash' THEN
    SELECT (value #>> '{}')::bigint INTO cap FROM app_setting WHERE key = 'cash_disburse_below_paise';
    IF cap IS NULL THEN cap := 2000000; END IF;
    IF NEW.amount_paise >= cap THEN
      RAISE EXCEPTION 'cash payout must be below ₹% (Settings · Limits)', cap / 100;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_leg_cash_cap ON disbursement_leg;
CREATE TRIGGER trg_leg_cash_cap BEFORE INSERT ON disbursement_leg
  FOR EACH ROW EXECUTE FUNCTION fn_leg_cash_cap();
