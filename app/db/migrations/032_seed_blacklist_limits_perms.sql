-- 032 (E32) — seed the two permission functions added in 031 so nobody is
-- locked out on upgrade day:
--   set_limits  ← every role's 'settings' umbrella bits (like the other tabs, 022)
--   blacklist   ← every role that may edit customers with FULL rights
-- (the owner tightens these in Settings · Roles afterwards)
INSERT INTO role_permission (role_id, fn, level, can_view, can_add, can_edit, can_delete)
SELECT rp.role_id, 'set_limits'::perm_function, rp.level,
       rp.can_view, rp.can_add, rp.can_edit, rp.can_delete
  FROM role_permission rp
 WHERE rp.fn = 'settings'
   AND NOT EXISTS (SELECT 1 FROM role_permission x
                    WHERE x.role_id = rp.role_id AND x.fn = 'set_limits'::perm_function);

INSERT INTO role_permission (role_id, fn, level, can_view, can_add, can_edit, can_delete)
SELECT rp.role_id, 'blacklist'::perm_function, rp.level,
       rp.can_view, rp.can_add, rp.can_edit, rp.can_delete
  FROM role_permission rp
 WHERE rp.fn = 'edit_customer' AND rp.can_add
   AND NOT EXISTS (SELECT 1 FROM role_permission x
                    WHERE x.role_id = rp.role_id AND x.fn = 'blacklist'::perm_function);

-- the owner's role holds the 'settings' umbrella (edit_customer only View) —
-- settings-full may edit customers everywhere, so it may blacklist too
INSERT INTO role_permission (role_id, fn, level, can_view, can_add, can_edit, can_delete)
SELECT rp.role_id, 'blacklist'::perm_function, rp.level,
       rp.can_view, rp.can_add, rp.can_edit, rp.can_delete
  FROM role_permission rp
 WHERE rp.fn = 'settings' AND rp.can_add
   AND NOT EXISTS (SELECT 1 FROM role_permission x
                    WHERE x.role_id = rp.role_id AND x.fn = 'blacklist'::perm_function);
