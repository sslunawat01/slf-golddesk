-- 030 · payouts to UNVERIFIED bank accounts, with a signed acknowledgement
-- (E29, owner ruling 14 Oct 2026 — recorded with Claude's warning: R19 used
-- to REFUSE any payout to an account without verified_at; verification is
-- the only guard against a mistyped or swapped account number, and a wrong
-- bank transfer is usually unrecoverable. The owner ruled to allow it behind
-- a pop-up confirmation.)
--
-- The rule stays in the DATABASE, reshaped from "refuse" to "refuse unless
-- signed": a bank leg to an unverified account must carry the employee who
-- confirmed the pop-up, and that employee may NOT be the person who created
-- the loan file (owner, same ruling — maker ≠ checker extends to this).
--
-- disbursement_leg is append-only; adding a NULLable column rewrites
-- nothing. Ships with a STOP-SERVICE deploy block (ALTER waits on app locks).

ALTER TABLE disbursement_leg
  ADD COLUMN unverified_ack_by bigint REFERENCES employee(id);

COMMENT ON COLUMN disbursement_leg.unverified_ack_by IS
  'Who confirmed paying an UNVERIFIED account (E29). NULL = account was verified at payout.';

CREATE OR REPLACE FUNCTION public.fn_leg_requires_verified_bank()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE ok TIMESTAMPTZ; creator BIGINT;
BEGIN
  IF NEW.kind = 'bank' THEN
    SELECT verified_at INTO ok FROM customer_bank_account WHERE id = NEW.customer_bank_account_id;
    IF ok IS NULL THEN
      IF NEW.unverified_ack_by IS NULL THEN
        RAISE EXCEPTION 'disbursement to unverified bank account needs a signed confirmation (R19/E29)';
      END IF;
      SELECT la.created_by INTO creator
        FROM disbursement d
        JOIN loan l ON l.id = d.loan_id
        JOIN loan_application la ON la.id = l.application_id
       WHERE d.id = NEW.disbursement_id;
      IF creator IS NOT NULL AND creator = NEW.unverified_ack_by THEN
        RAISE EXCEPTION 'the creator of the loan file cannot confirm an unverified payout (E29)';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
