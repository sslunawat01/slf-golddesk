-- 012: Employees screen support.
-- 1) Staff contact columns the frozen UX wizard asks for and the table lacks.
-- 2) Belt-and-braces: if the effective-dated membership tables have an
--    effective_from column, make sure it defaults to CURRENT_DATE so plain
--    (employee_id, role_id/branch_id) inserts always work.

ALTER TABLE employee ADD COLUMN IF NOT EXISTS mobile             text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS alt_mobile         text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS personal_email     text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS blood_group        text;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS father_spouse_name text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'employee_role' AND column_name = 'effective_from') THEN
    ALTER TABLE employee_role ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'employee_branch' AND column_name = 'effective_from') THEN
    ALTER TABLE employee_branch ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;
  END IF;
END $$;
