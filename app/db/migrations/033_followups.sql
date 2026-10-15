-- 033 (E33, owner 15 Oct 2026) — Follow-ups.
-- collection_call stays the table (append-only, trigger-frozen) and GROWS:
-- a typed follow-up with a channel, a promise amount, and the NEXT step
-- (date, type, assignee). "Due" items are derived — the latest row of a loan
-- that names a next_follow_up and has no later row — never stored.
CREATE TYPE followup_type    AS ENUM ('interest','ptp','overdue','renewal','notice','kyc','other');
CREATE TYPE followup_channel AS ENUM ('call','visit','sms','whatsapp','email','ai_call','notice');
-- outcomes the owner's follow-up screen offers beyond the original six
-- (app code references them; nothing in this migration does)
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'will_renew';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'not_at_home';
ALTER TYPE call_outcome ADD VALUE IF NOT EXISTS 'notice_sent';

ALTER TABLE collection_call
  ADD COLUMN IF NOT EXISTS fu_type          followup_type NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS channel          followup_channel,
  ADD COLUMN IF NOT EXISTS ptp_amount_paise bigint,
  ADD COLUMN IF NOT EXISTS next_type        followup_type,
  ADD COLUMN IF NOT EXISTS assigned_to      bigint REFERENCES employee(id);

-- the rows that exist were logged with a free-text method: map it once.
-- (the append-only guard is lifted inside this transaction only)
ALTER TABLE collection_call DISABLE TRIGGER trg_collection_call_frozen;
UPDATE collection_call SET channel = CASE
    WHEN method ILIKE '%visit%' OR method ILIKE '%walked%' THEN 'visit'::followup_channel
    WHEN method ILIKE '%whatsapp%' THEN 'whatsapp'::followup_channel
    WHEN method ILIKE '%sms%' THEN 'sms'::followup_channel
    WHEN method ILIKE '%post%' OR method ILIKE '%courier%' THEN 'notice'::followup_channel
    ELSE 'call'::followup_channel END
  WHERE channel IS NULL;
ALTER TABLE collection_call ENABLE TRIGGER trg_collection_call_frozen;

-- the worklist asks "latest row per loan" and "what is due on a date" — both tiny today, indexed for the 10-year scale
CREATE INDEX IF NOT EXISTS idx_cc_loan_at ON collection_call (loan_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_next ON collection_call (next_follow_up) WHERE next_follow_up IS NOT NULL;
