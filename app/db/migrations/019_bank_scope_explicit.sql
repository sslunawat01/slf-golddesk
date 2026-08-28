-- 019: Bank account branch scope made EXPLICIT (owner №3, 28 Aug 2026).
-- Until now, zero junction rows silently meant "all branches", which made it
-- impossible to deselect every branch. scope_all now says it out loud:
--   scope_all = true  → usable at every branch (junction ignored)
--   scope_all = false → usable ONLY at junction branches (zero rows = nowhere,
--                       a deliberate parking state the owner asked for)
-- Existing rows: accounts with no junction rows were "all" → scope_all=true;
-- accounts with junction rows were specific → scope_all=false. HO may now be
-- ticked like any branch.

ALTER TABLE slf_bank_account ADD COLUMN IF NOT EXISTS scope_all boolean NOT NULL DEFAULT true;

UPDATE slf_bank_account a SET scope_all = NOT EXISTS
  (SELECT 1 FROM slf_bank_account_branch ab WHERE ab.account_id = a.id);
