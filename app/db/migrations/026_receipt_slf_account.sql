-- E17 №2 (owner, 29 Aug 2026): a UPI/bank repayment must say WHICH SLF
-- account received the money. Cash receipts carry NULL. The schema already
-- had allow_collection on slf_bank_account waiting for this day.
ALTER TABLE receipt ADD COLUMN IF NOT EXISTS slf_bank_account_id bigint
  REFERENCES slf_bank_account(id);
ALTER TABLE receipt ADD CONSTRAINT receipt_noncash_needs_account
  CHECK (mode = 'cash' OR slf_bank_account_id IS NOT NULL) NOT VALID;
-- NOT VALID: existing test receipts predate the rule; every NEW row obeys it.
