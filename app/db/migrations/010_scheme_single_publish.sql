-- 010_scheme_single_publish.sql
-- ⚠ TESTING WEAKENING W6 — RESTORE BEFORE REAL STAFF USE THE SYSTEM
--
-- The owner chose (27 Jul 2026) to publish schemes single-handed until the
-- maker/checker approval strip is built. The original rule — a published
-- version must carry a maker AND a different checker — is relaxed to
-- maker-only.
--
-- To restore the original control later:
--   ALTER TABLE scheme_version DROP CONSTRAINT scheme_version_check;
--   ALTER TABLE scheme_version ADD CONSTRAINT scheme_version_check
--     CHECK (status <> 'published' OR (maker_id IS NOT NULL
--            AND checker_id IS NOT NULL AND maker_id <> checker_id));
-- (Existing single-signed rows must be given a checker first.)

BEGIN;

ALTER TABLE scheme_version DROP CONSTRAINT IF EXISTS scheme_version_check;
ALTER TABLE scheme_version ADD CONSTRAINT scheme_version_check
  CHECK (status <> 'published' OR maker_id IS NOT NULL);

COMMIT;
