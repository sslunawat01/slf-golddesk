-- №7 (owner, 28 Aug 2026): an employee holds exactly ONE role.
-- The application already refuses more; this makes the database agree.
-- Existing data complies (verified before writing this migration).
CREATE UNIQUE INDEX IF NOT EXISTS employee_role_one_per_employee
  ON employee_role (employee_id) WHERE effective_to IS NULL;
