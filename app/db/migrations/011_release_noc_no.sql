-- 011_release_noc_no.sql
-- The NOC issued at gold release needs a number the customer can quote and an
-- auditor can find. The noc number series already exists (migration 005);
-- this gives the number a home.

BEGIN;
ALTER TABLE release ADD COLUMN IF NOT EXISTS noc_no text;
CREATE UNIQUE INDEX IF NOT EXISTS release_noc_no_key ON release (noc_no) WHERE noc_no IS NOT NULL;
COMMIT;
