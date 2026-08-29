-- E21 №2 (owner, 29 Aug 2026): identity numbers never repeat across customers.
-- OWNER OVERRIDE, recorded with warning: full Aadhaar stored in PLAIN TEXT and
-- displayed fully (Claude flagged UIDAI vault/masking rules; owner's call).
-- Mobile absolutely unique — future app login. Employee-customer overlap stays
-- legal (cross-table checks remain confirmations, not refusals).
ALTER TABLE customer ADD COLUMN aadhaar_no varchar(12);
ALTER TABLE customer ADD CONSTRAINT customer_aadhaar_digits
  CHECK (aadhaar_no IS NULL OR aadhaar_no ~ '^[0-9]{12}$');
CREATE UNIQUE INDEX customer_aadhaar_unique ON customer(aadhaar_no) WHERE aadhaar_no IS NOT NULL;
CREATE UNIQUE INDEX customer_mobile_unique  ON customer(mobile);
CREATE UNIQUE INDEX customer_pan_unique     ON customer(upper(pan_no)) WHERE pan_no IS NOT NULL;
-- existing rows keep last-4 only until someone retypes the full number;
-- every entry from today onward carries and enforces all 12 digits.
