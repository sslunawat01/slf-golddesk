-- 017: Company bank accounts — store the FULL account number, and allocate
-- to MULTIPLE branches (owner decision, 27 Aug 2026, reversing the D1
-- masked-only rule; system is pre-production so existing rows are backfilled
-- with random digits that keep each account's real last-4).
--
-- Multi-branch: slf_bank_account_branch junction. NO rows for an account
-- means "usable at every branch" (same meaning branch_id NULL had).
-- The old branch_id column stays for history but is no longer written.

ALTER TABLE slf_bank_account ADD COLUMN IF NOT EXISTS account_no text;

UPDATE slf_bank_account
   SET account_no = lpad(floor(random() * 1e10)::bigint::text, 10, '0')
                    || right(account_no_masked, 4)
 WHERE account_no IS NULL;

ALTER TABLE slf_bank_account ALTER COLUMN account_no SET NOT NULL;

CREATE TABLE IF NOT EXISTS slf_bank_account_branch (
  account_id bigint NOT NULL REFERENCES slf_bank_account(id) ON DELETE CASCADE,
  branch_id  bigint NOT NULL REFERENCES branch(id),
  PRIMARY KEY (account_id, branch_id)
);

INSERT INTO slf_bank_account_branch (account_id, branch_id)
  SELECT id, branch_id FROM slf_bank_account WHERE branch_id IS NOT NULL
  ON CONFLICT DO NOTHING;
