-- E20 №4 (owner, 29 Aug 2026): a bank account keeps a HISTORY of proof
-- photos (cheques/passbooks), not a single slot. Delete is soft — the photo
-- leaves every screen but its record survives (append-only philosophy).
-- customer_bank_account.cheque_file_id remains the "current proof" pointer
-- that bankPayable and the verify ceremony already read.
CREATE TABLE customer_bank_proof (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES customer_bank_account(id),
  file_id     bigint NOT NULL REFERENCES file_object(id),
  added_by    bigint REFERENCES employee(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  removed_by  bigint REFERENCES employee(id),
  removed_at  timestamptz
);
CREATE INDEX cbp_account_live ON customer_bank_proof(account_id) WHERE removed_at IS NULL;
-- carry every existing single cheque into the gallery
INSERT INTO customer_bank_proof (account_id, file_id, added_at)
SELECT id, cheque_file_id, now() FROM customer_bank_account WHERE cheque_file_id IS NOT NULL;
