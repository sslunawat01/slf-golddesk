import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validRoleName, normalizePermissions, validLoginWindow, validLimit, leavesAnAdmin }
  from "@/lib/roles.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "settings", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

// ————————————————————————— GET: everything the tab needs —————————————————————————

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const roles = await q(
    `SELECT r.id, r.name, r.is_system, r.active,
            r.login_from, r.login_to, r.login_days, r.grace_min, r.perm_version,
            (SELECT count(*) FROM employee_role er JOIN employee e ON e.id = er.employee_id
              WHERE er.role_id = r.id AND e.status = 'active'
                AND (er.effective_to IS NULL OR er.effective_to >= CURRENT_DATE))::int AS members
       FROM role r WHERE r.active ORDER BY r.id`);

  const perms = await q(`SELECT role_id, fn, level FROM role_permission`);
  const limits = await q(
    `SELECT role_id, limit_paise, is_unlimited, reason FROM sanction_limit
      WHERE role_id IS NOT NULL AND employee_id IS NULL
        AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`);
  const roleSchemes = await q(`SELECT role_id, scheme_id FROM role_scheme`);
  const schemes = await q(`SELECT id, code, name FROM scheme ORDER BY code`);

  const rows = roles.map(r => ({
    id: Number(r.id), name: r.name, isSystem: r.is_system, members: r.members,
    loginFrom: r.login_from ? String(r.login_from).slice(0, 5) : null,
    loginTo: r.login_to ? String(r.login_to).slice(0, 5) : null,
    loginDays: Number(r.login_days), graceMin: Number(r.grace_min),
    permissions: Object.fromEntries(
      perms.filter(p => Number(p.role_id) === Number(r.id)).map(p => [p.fn, p.level])),
    limit: (() => {
      const l = limits.find(x => Number(x.role_id) === Number(r.id));
      return l ? { limitPaise: Number(l.limit_paise), isUnlimited: l.is_unlimited, reason: l.reason }
               : { limitPaise: 0, isUnlimited: false, reason: null };   // absence = zero
    })(),
    schemeIds: roleSchemes.filter(s => Number(s.role_id) === Number(r.id))
      .map(s => Number(s.scheme_id)),
  }));

  return NextResponse.json({ ok: true, rows, schemes,
    canEdit: can(actor, "settings", { need: "full" }).ok });
}

// ————————————————————————— POST: create · rename · clone · update —————————————————————————

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "full");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

    const b = await req.json().catch(() => ({}));
    const existing = await q(`SELECT id, name FROM role WHERE active`);

    // ——— create: born with nothing, the deny-by-default way ———
    if (b.action === "create") {
      const v = validRoleName(b.name, existing);
      if (!v.ok) return bad(v.problems);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO role (name, created_by) VALUES ($1, $2) RETURNING id`,
          [v.name, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "role", entityId: r.rows[0].id, action: "create", after: { name: v.name } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    // everything below needs an existing role
    const role = b.id ? await one(`SELECT * FROM role WHERE id = $1 AND active`, [b.id]) : null;
    if (!role) return NextResponse.json({ ok: false, reason: "Role not found" }, { status: 404 });

    // ——— rename ———
    if (b.action === "rename") {
      const v = validRoleName(b.name, existing, role.id);
      if (!v.ok) return bad(v.problems);
      await tx(async (cl) => {
        await cl.query(`UPDATE role SET name = $2, updated_by = $3 WHERE id = $1`,
          [role.id, v.name, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "role", entityId: role.id, action: "rename",
          before: { name: role.name }, after: { name: v.name } });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— clone: permissions + window + schemes + limit, zero members ———
    if (b.action === "clone") {
      const v = validRoleName(b.name || `Copy of ${role.name}`, existing);
      if (!v.ok) return bad(v.problems);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO role (name, login_from, login_to, login_days, grace_min, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [v.name, role.login_from, role.login_to, role.login_days, role.grace_min,
           actor.employeeId]);
        const newId = r.rows[0].id;
        await cl.query(
          `INSERT INTO role_permission (role_id, fn, level)
           SELECT $2, fn, level FROM role_permission WHERE role_id = $1`, [role.id, newId]);
        await cl.query(
          `INSERT INTO role_scheme (role_id, scheme_id)
           SELECT $2, scheme_id FROM role_scheme WHERE role_id = $1`, [role.id, newId]);
        await cl.query(
          `INSERT INTO sanction_limit (role_id, limit_paise, is_unlimited, reason, approved_by)
           SELECT $2, limit_paise, is_unlimited,
                  'Cloned from ' || $3 || ' — ' || COALESCE(reason, 'no reason recorded'), $4
             FROM sanction_limit
            WHERE role_id = $1 AND employee_id IS NULL
              AND effective_from <= CURRENT_DATE
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
          [role.id, newId, role.name, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "role", entityId: newId, action: "clone", before: { from: role.name },
          after: { name: v.name } });
        return { id: newId };
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    // ——— update: permissions + login window + limit + schemes, atomically ———
    if (b.action === "update") {
      const p = normalizePermissions(b.permissions || {});
      if (!p.ok) return bad(p.problems);
      const w = validLoginWindow(b.window || {});
      if (!w.ok) return bad(w.problems);
      const l = validLimit(b.limit || {});
      if (!l.ok) return bad(l.problems);
      const schemeIds = Array.isArray(b.schemeIds) ? b.schemeIds.map(Number).filter(Boolean) : [];

      // the no-lockout guard: never leave the business without an administrator
      const holders = await q(
        `SELECT r.id AS "roleId",
                EXISTS (SELECT 1 FROM role_permission rp
                         WHERE rp.role_id = r.id AND rp.fn = 'settings' AND rp.level = 'full')
                  AS "hasSettingsFull",
                (SELECT count(*) FROM employee_role er JOIN employee e ON e.id = er.employee_id
                  WHERE er.role_id = r.id AND e.status = 'active'
                    AND (er.effective_to IS NULL OR er.effective_to >= CURRENT_DATE))::int
                  AS "activeMembers"
           FROM role r WHERE r.active`);
      const willHave = p.rows.some(r => r.fn === "settings" && r.level === "full");
      const adminOk = leavesAnAdmin(holders, role.id, willHave);
      if (!adminOk.ok)
        return NextResponse.json({ ok: false, reason: adminOk.reason }, { status: 409 });

      await tx(async (cl) => {
        // permissions: replace wholesale — absence is 'none'
        await cl.query(`DELETE FROM role_permission WHERE role_id = $1`, [role.id]);
        for (const r of p.rows)
          await cl.query(`INSERT INTO role_permission (role_id, fn, level) VALUES ($1,$2,$3)`,
            [role.id, r.fn, r.level]);

        // login window + perm_version bump — live sessions pick it up in seconds
        await cl.query(
          `UPDATE role SET login_from=$2, login_to=$3, login_days=$4, grace_min=$5,
                  perm_version = perm_version + 1, updated_by=$6 WHERE id=$1`,
          [role.id, w.from, w.to, w.days, w.graceMin, actor.employeeId]);

        // sanction limit, effective-dated: close history, write today's truth
        await cl.query(
          `UPDATE sanction_limit SET effective_to = CURRENT_DATE - 1
            WHERE role_id = $1 AND employee_id IS NULL
              AND effective_from < CURRENT_DATE
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`, [role.id]);
        await cl.query(
          `DELETE FROM sanction_limit
            WHERE role_id = $1 AND employee_id IS NULL AND effective_from = CURRENT_DATE`,
          [role.id]);
        if (l.limitPaise > 0 || l.isUnlimited) {
          await cl.query(
            `INSERT INTO sanction_limit (role_id, limit_paise, is_unlimited, reason, approved_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [role.id, l.limitPaise, l.isUnlimited,
             l.reason || `Set from Settings → Roles by ${actor.username}`, actor.employeeId]);
        } // blank stays absent — absence = ₹0, everything routes to HO

        // schemes: replace wholesale
        await cl.query(`DELETE FROM role_scheme WHERE role_id = $1`, [role.id]);
        for (const sid of schemeIds)
          await cl.query(`INSERT INTO role_scheme (role_id, scheme_id) VALUES ($1,$2)`,
            [role.id, sid]);

        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "role", entityId: role.id, action: "update_access",
          after: { permissions: p.rows, window: w,
                   limit: { paise: l.limitPaise, unlimited: l.isUnlimited }, schemeIds } });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e.code === "FORBIDDEN" ? e.message : "The change could not be saved" },
      { status: e.code === "FORBIDDEN" ? 403 : 500 });
  }
}

function bad(problems) {
  return NextResponse.json({ ok: false, reason: problems[0], problems }, { status: 400 });
}
