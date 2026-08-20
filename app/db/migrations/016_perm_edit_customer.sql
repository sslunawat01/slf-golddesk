-- 016: role_permission.fn is the ENUM perm_function (verified \d 20 Aug 2026).
-- The Edit-customer permission (№4, Patch C1) exists in the policy engine and
-- the Roles grid, but the enum must know the label before a grant can be saved.
-- PostgreSQL 12+ allows ADD VALUE inside a transaction; harmless if rerun.
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'edit_customer';
