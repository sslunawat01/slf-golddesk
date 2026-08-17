-- 014: Overdue worklist support.
-- The frozen UX records HOW a customer was reached (method) and WHEN to try
-- again (next follow-up) — collection_call had neither. And the UX's own
-- caption ("every call, message, notice and saved follow-up stays on the loan
-- for audit") earns the same append-only trigger every other fact table has.

ALTER TABLE collection_call ADD COLUMN IF NOT EXISTS method         text;
ALTER TABLE collection_call ADD COLUMN IF NOT EXISTS next_follow_up date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_collection_call_frozen') THEN
    CREATE TRIGGER trg_collection_call_frozen
      BEFORE UPDATE OR DELETE ON collection_call
      FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation();
  END IF;
END $$;
