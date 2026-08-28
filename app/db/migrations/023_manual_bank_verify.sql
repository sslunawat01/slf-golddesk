-- 023: On-screen manual verification for customer bank accounts (owner,
-- 28 Aug 2026). Until the penny-drop API (O11) is integrated, an operator who
-- has seen proof (passbook / cancelled cheque) may mark the account verified
-- on the screen. verify_method records 'manual' honestly, so post-API these
-- rows are distinguishable and re-verifiable. Recorded as weakening W9:
-- review manually-verified accounts once penny-drop is live.
ALTER TYPE verify_method ADD VALUE IF NOT EXISTS 'manual';
