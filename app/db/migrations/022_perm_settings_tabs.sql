-- 022 (D-B part 2): every role's legacy umbrella 'settings' grant fans out
-- into the eight per-tab functions with the same bits, so nobody loses access
-- on upgrade day. The legacy 'settings' rows stay behind as an inert safety
-- net; the engine reads the per-tab rows from now on.
INSERT INTO role_permission (role_id, fn, level, can_view, can_add, can_edit, can_delete)
SELECT rp.role_id, t.fn::perm_function, rp.level,
       rp.can_view, rp.can_add, rp.can_edit, rp.can_delete
  FROM role_permission rp
  CROSS JOIN (VALUES ('set_charges'),('set_branches'),('set_schemes'),('set_roles'),
                     ('set_employees'),('set_metals'),('set_items'),('set_banks')) AS t(fn)
 WHERE rp.fn = 'settings'
   AND NOT EXISTS (SELECT 1 FROM role_permission x
                    WHERE x.role_id = rp.role_id AND x.fn = t.fn::perm_function);
