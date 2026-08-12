-- 013: Owner decision 12 Aug 2026 — store the employee's FULL 12-digit Aadhaar.
-- (Consequence stated and accepted: full-number storage carries UIDAI handling
-- obligations; the owner directed storage regardless. Customers are unchanged —
-- they remain last-4 only.)
ALTER TABLE employee ADD COLUMN IF NOT EXISTS aadhaar_no text;
-- one person, one Aadhaar — two employee rows may never share a number
CREATE UNIQUE INDEX IF NOT EXISTS employee_aadhaar_no_key
  ON employee (aadhaar_no) WHERE aadhaar_no IS NOT NULL;
