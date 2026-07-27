-- 008_vault_in_mismatch.sql
-- Vault-in (Sprint 2): packet custody status, repeatable checks, mismatch evidence.
-- Resolves O10. Adds no new movement reason: a mismatch means the packet never
-- enters a safe, so no vault_movement row is written.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Where a packet is, right now
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE packet_status AS ENUM ('at_counter', 'in_safe', 'frozen', 'out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vault_mismatch_reason AS ENUM
    ('seal_broken', 'item_count', 'weight', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE packet
  ADD COLUMN IF NOT EXISTS status             packet_status NOT NULL DEFAULT 'at_counter',
  ADD COLUMN IF NOT EXISTS seal_photo_file_id bigint REFERENCES file_object(id),
  ADD COLUMN IF NOT EXISTS frozen_at          timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_by          bigint REFERENCES employee(id);

-- A frozen packet must say when it was frozen and by whom.
ALTER TABLE packet DROP CONSTRAINT IF EXISTS packet_frozen_needs_stamp;
ALTER TABLE packet ADD CONSTRAINT packet_frozen_needs_stamp
  CHECK (status <> 'frozen' OR (frozen_at IS NOT NULL AND frozen_by IS NOT NULL));

-- A packet in a safe must have been sealed and photographed first.
ALTER TABLE packet DROP CONSTRAINT IF EXISTS packet_in_safe_needs_seal;
ALTER TABLE packet ADD CONSTRAINT packet_in_safe_needs_seal
  CHECK (status <> 'in_safe' OR (sealed_at IS NOT NULL AND seal_photo_file_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_packet_status ON packet (status);

-- ---------------------------------------------------------------------------
-- 2 · A packet may be checked more than once
--     The old UNIQUE(packet_id) meant one check ever: a failed check would
--     have locked the packet out of every safe permanently.
-- ---------------------------------------------------------------------------
ALTER TABLE vault_in_check DROP CONSTRAINT IF EXISTS vault_in_check_packet_id_key;
CREATE INDEX IF NOT EXISTS idx_vic_packet_at ON vault_in_check (packet_id, checked_at DESC);

-- ---------------------------------------------------------------------------
-- 3 · What a mismatch records
-- ---------------------------------------------------------------------------
ALTER TABLE vault_in_check
  ADD COLUMN IF NOT EXISTS mismatch_reason vault_mismatch_reason,
  ADD COLUMN IF NOT EXISTS note            text,
  ADD COLUMN IF NOT EXISTS photo_file_id   bigint REFERENCES file_object(id);

-- A failed check is worthless without a reason and a written narration.
ALTER TABLE vault_in_check DROP CONSTRAINT IF EXISTS vic_mismatch_needs_evidence;
ALTER TABLE vault_in_check ADD CONSTRAINT vic_mismatch_needs_evidence
  CHECK (ok OR (mismatch_reason IS NOT NULL AND btrim(coalesce(note, '')) <> ''));

-- A passed check cannot carry a mismatch reason.
ALTER TABLE vault_in_check DROP CONSTRAINT IF EXISTS vic_ok_has_no_reason;
ALTER TABLE vault_in_check ADD CONSTRAINT vic_ok_has_no_reason
  CHECK (NOT ok OR mismatch_reason IS NULL);

-- ---------------------------------------------------------------------------
-- 4 · Checks are evidence — they cannot be edited or deleted
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_vault_in_check_frozen ON vault_in_check;
CREATE TRIGGER trg_vault_in_check_frozen
  BEFORE DELETE OR UPDATE ON vault_in_check
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation();

COMMIT;
