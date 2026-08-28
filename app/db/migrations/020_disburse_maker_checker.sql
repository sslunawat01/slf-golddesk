-- 020: Maker ≠ checker on DISBURSEMENT (owner decision, 28 Aug 2026).
-- Whoever moved an application into 'approved' (branch sanction or HO
-- approval — any loan_state_history row with to_state='approved') can never
-- be the one who creates the loan. Enforced here as a trigger so no code
-- path, present or future, can slip past it; the API refuses first with a
-- friendlier message.
--
-- Testing note: with a single operator this makes solo pledge→disburse
-- impossible by design — sanction with one login, disburse with the other
-- (same two-employee dance as the two-valuer rule).

CREATE OR REPLACE FUNCTION fn_forbid_self_disburse() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM loan_state_history h
              WHERE h.application_id = NEW.application_id
                AND h.to_state = 'approved'
                AND h.by_employee = NEW.created_by) THEN
    RAISE EXCEPTION 'maker-checker: the approver of application % cannot disburse it', NEW.application_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forbid_self_disburse ON loan;
CREATE TRIGGER trg_forbid_self_disburse
  BEFORE INSERT ON loan
  FOR EACH ROW EXECUTE FUNCTION fn_forbid_self_disburse();
