-- 018: Branch master upgrade (owner decisions D-C + №5–8, 28 Aug 2026).
--  · Two phones, email, latitude/longitude on every branch (compulsory for
--    every save from now on — enforced in validation, columns stay nullable
--    so historical rows don't block the migration).
--  · Branch code: exactly 2 characters, A–Z or 0–9, stored uppercase.
--    Head office keeps its historical 999. Codes are now EDITABLE; on a code
--    change the API refreshes this financial year's number-series prefixes so
--    documents issued after the change carry the new code, counters continue,
--    and already-issued numbers stay as printed forever.

ALTER TABLE branch ADD COLUMN IF NOT EXISTS phone2 text;
ALTER TABLE branch ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE branch ADD COLUMN IF NOT EXISTS latitude  numeric(9,6);
ALTER TABLE branch ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

ALTER TABLE branch DROP CONSTRAINT IF EXISTS branch_code_2char;
ALTER TABLE branch ADD CONSTRAINT branch_code_2char
  CHECK (is_ho OR code ~ '^[A-Z0-9]{2}$');

ALTER TABLE branch DROP CONSTRAINT IF EXISTS branch_lat_range;
ALTER TABLE branch ADD CONSTRAINT branch_lat_range
  CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90));
ALTER TABLE branch DROP CONSTRAINT IF EXISTS branch_lng_range;
ALTER TABLE branch ADD CONSTRAINT branch_lng_range
  CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180));
