-- 021 (D-B part 1): per-verb permissions + per-tab settings functions.
-- role_permission grows four booleans; existing None/View/Full levels convert:
--   full → view+add+edit+delete · view → view only · none/absent → nothing.
-- Eight new perm_function labels are ADDED here but not used until 022
-- (PostgreSQL forbids using a new enum value in its own transaction).
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_charges';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_branches';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_schemes';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_roles';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_employees';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_metals';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_items';
ALTER TYPE perm_function ADD VALUE IF NOT EXISTS 'set_banks';

ALTER TABLE role_permission ADD COLUMN IF NOT EXISTS can_view   boolean NOT NULL DEFAULT false;
ALTER TABLE role_permission ADD COLUMN IF NOT EXISTS can_add    boolean NOT NULL DEFAULT false;
ALTER TABLE role_permission ADD COLUMN IF NOT EXISTS can_edit   boolean NOT NULL DEFAULT false;
ALTER TABLE role_permission ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false;

UPDATE role_permission SET
  can_view   = (level IN ('view','full')),
  can_add    = (level = 'full'),
  can_edit   = (level = 'full'),
  can_delete = (level = 'full');
