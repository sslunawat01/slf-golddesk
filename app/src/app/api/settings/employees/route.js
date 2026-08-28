import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { hashPassword } from "@/lib/password.js";
import { titleCaseName } from "@/lib/format.js";
import { validIdentity, validKyc, validEmployment, validAccess, validSuspension,
  canSuspend, wouldRemoveLastAdmin } from "@/lib/employees.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "settings", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

/** Enum labels straight from the database — never guessed. */
async function enums() {
  const r = await one(
    `SELECT enum_range(NULL::gender_kind)::text[]      AS genders,
            enum_range(NULL::employment_type)::text[]  AS types,
            enum_range(NULL::emp_status)::text[]       AS statuses`);
  return { genders: r.genders, types: r.types, statuses: r.statuses };
}

/** Active employees holding settings=full through active roles. */
async function adminIds(cl = null) {
  const run = cl ? (t, p) => cl.query(t, p).then(x => x.rows) : q;
  const rows = await run(
    `SELECT DISTINCT er.employee_id AS id
       FROM employee_role er
       JOIN role r ON r.id = er.role_id AND r.active
       JOIN role_permission rp ON rp.role_id = r.id AND rp.fn = 'settings' AND rp.level = 'full'
       JOIN employee e ON e.id = er.employee_id AND e.status = 'active'
      WHERE er.effective_to IS NULL OR er.effective_to >= CURRENT_DATE`, []);
  return rows.map(x => Number(x.id));
}

// ————————————————————————— GET —————————————————————————

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const emps = await q(
    `SELECT e.id, e.emp_code, e.full_name, e.gender::text, e.dob, e.mobile, e.alt_mobile,
            e.personal_email, e.blood_group, e.father_spouse_name,
            e.aadhaar_last4, e.aadhaar_no, e.pan_no, e.designation, e.department, e.doj, e.dol,
            e.reports_to, e.employment_type::text, e.primary_branch_id,
            e.username, e.official_email, e.status::text, e.force_change
       FROM employee e ORDER BY e.status, e.full_name`);
  const memRoles = await q(
    `SELECT employee_id, role_id FROM employee_role
      WHERE effective_to IS NULL OR effective_to >= CURRENT_DATE`);
  const memBranches = await q(
    `SELECT employee_id, branch_id FROM employee_branch
      WHERE effective_to IS NULL OR effective_to >= CURRENT_DATE`);
  const roles = await q(`SELECT id, name FROM role WHERE active ORDER BY id`);
  const designations = (await q(
    `SELECT DISTINCT designation AS v FROM employee
      WHERE designation IS NOT NULL AND designation <> '' ORDER BY 1`)).map(r => r.v);
  const departments = (await q(
    `SELECT DISTINCT department AS v FROM employee
      WHERE department IS NOT NULL AND department <> '' ORDER BY 1`)).map(r => r.v);
  const branches = await q(
    `SELECT id, code, name, is_ho FROM branch WHERE active ORDER BY code`);
  const en = await enums();

  const rows = emps.map(e => ({
    id: Number(e.id), empCode: e.emp_code, fullName: e.full_name, gender: e.gender,
    dob: e.dob, mobile: e.mobile, altMobile: e.alt_mobile, personalEmail: e.personal_email,
    bloodGroup: e.blood_group, fatherSpouseName: e.father_spouse_name,
    aadhaarLast4: e.aadhaar_last4, aadhaarNo: e.aadhaar_no, panNo: e.pan_no,
    designation: e.designation, department: e.department, doj: e.doj, dol: e.dol,
    reportsTo: e.reports_to ? Number(e.reports_to) : null,
    employmentType: e.employment_type, primaryBranchId: e.primary_branch_id ? Number(e.primary_branch_id) : null,
    username: e.username, officialEmail: e.official_email, status: e.status,
    forceChange: e.force_change,
    roleIds: memRoles.filter(m => Number(m.employee_id) === Number(e.id)).map(m => Number(m.role_id)),
    branchIds: memBranches.filter(m => Number(m.employee_id) === Number(e.id)).map(m => Number(m.branch_id)),
  }));

  return NextResponse.json({ ok: true, rows,
    roles: roles.map(r => ({ id: Number(r.id), name: r.name })),
    branches: branches.map(b => ({ id: Number(b.id), code: b.code, name: b.name, isHo: b.is_ho })),
    enums: en, selfId: actor.employeeId, designations, departments,
    canEdit: can(actor, "settings", { need: "full" }).ok });
}

// ————————————————————————— POST —————————————————————————

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "full");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

    const b = await req.json().catch(() => ({}));
    const en = await enums();

    // ——— create: the six-step wizard lands here as one atomic insert ———
    if (b.action === "create") {
      const v1 = validIdentity(b);
      const v2 = validKyc(b);
      const v3 = validEmployment(b, en.types);
      const v4 = validAccess(b, { requirePassword: true });
      const problems = [...v1.problems, ...v2.problems, ...v3.problems, ...v4.problems];
      if (problems.length) return bad(problems);
      if (b.gender && !en.genders.includes(b.gender)) return bad(["Unknown gender option"]);

      const photoId = Number(b.photoFileId?.fileId ?? b.photoFileId) || null;
      const dup = await one(`SELECT id FROM employee WHERE lower(username) = lower($1)`, [v4.username]);
      if (dup) return bad(["That username is already taken"], 409);

      // duplicate identity checks — same table refuses; employee↔customer asks to confirm
      const dupCheck = await identityDuplicates({ panNo: v2.panNo, aadhaarNo: v2.aadhaarNo,
        aadhaarLast4: v2.aadhaarLast4, excludeEmployeeId: null });
      if (dupCheck.refuse) return bad([dupCheck.refuse], 409);
      if (dupCheck.confirm && !b.dupAcknowledged)
        return NextResponse.json({ ok: false, needsDupConfirm: true,
          reason: dupCheck.confirm }, { status: 409 });

      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO employee
             (emp_code, full_name, gender, dob, photo_file_id, mobile, alt_mobile,
              personal_email, blood_group, father_spouse_name,
              aadhaar_last4, aadhaar_no, pan_no, address_json,
              designation, department, doj, reports_to, employment_type,
              primary_branch_id, username, official_email, password_hash, force_change,
              created_by)
           VALUES ('PENDING', $1, $2::gender_kind, $3, $4, $5, $6, $7, $8, $9,
                   $10, $11, $12, $13::jsonb,
                   $14, $15, $16, $17, COALESCE($18, 'permanent')::employment_type,
                   $19, $20, $21, $22, FALSE, $23)
           RETURNING id`,
          [v1.fullName, b.gender || null, b.dob || null, photoId,
           v1.mobile, v1.altMobile, b.personalEmail || null, b.bloodGroup || null,
           titleCaseName(b.fatherSpouseName) || null,
           v2.aadhaarLast4, v2.aadhaarNo, v2.panNo, JSON.stringify(b.address || {}),
           String(b.designation).trim(), b.department || null, b.doj,
           b.reportsTo || null, b.employmentType || null,
           v3.primaryBranchId, v4.username, b.officialEmail || null,
           hashPassword(b.password), actor.employeeId]);
        const id = Number(r.rows[0].id);
        await cl.query(
          `UPDATE employee SET emp_code = 'EMP' || lpad($1::text, 4, '0') WHERE id = $1`, [id]);
        for (const rid of v3.roleIds)
          await cl.query(`INSERT INTO employee_role (employee_id, role_id) VALUES ($1,$2)`, [id, rid]);
        for (const bid of v3.branchIds)
          await cl.query(`INSERT INTO employee_branch (employee_id, branch_id) VALUES ($1,$2)`, [id, bid]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "employee", entityId: id, action: "create",
          after: { name: v1.fullName, username: v4.username,
                   roleIds: v3.roleIds, branchIds: v3.branchIds } });
        return { id };
      });
      return NextResponse.json({ ok: true, id: row.id,
        empCode: "EMP" + String(row.id).padStart(4, "0"), username: v4.username });
    }

    // everything below needs an existing employee
    const emp = b.id ? await one(`SELECT * FROM employee WHERE id = $1`, [b.id]) : null;
    if (!emp) return NextResponse.json({ ok: false, reason: "Employee not found" }, { status: 404 });

    // ——— update: identity, KYC and employment basics (never username, never password) ———
    if (b.action === "update") {
      const v1 = validIdentity(b);
      const v2 = validKyc(b);
      const problems = [...v1.problems, ...v2.problems];
      if (String(b.designation || "").trim().length < 2)
        problems.push("Give a designation");
      if (problems.length) return bad(problems);
      if (b.gender && !en.genders.includes(b.gender)) return bad(["Unknown gender option"]);
      if (b.employmentType && !en.types.includes(b.employmentType)) return bad(["Unknown employment type"]);

      const dupCheck = await identityDuplicates({ panNo: v2.panNo, aadhaarNo: v2.aadhaarNo,
        aadhaarLast4: v2.aadhaarLast4, excludeEmployeeId: emp.id });
      if (dupCheck.refuse) return bad([dupCheck.refuse], 409);
      if (dupCheck.confirm && !b.dupAcknowledged)
        return NextResponse.json({ ok: false, needsDupConfirm: true,
          reason: dupCheck.confirm }, { status: 409 });

      await tx(async (cl) => {
        await cl.query(
          `UPDATE employee SET full_name=$2, gender=$3::gender_kind, dob=$4, mobile=$5,
              alt_mobile=$6, personal_email=$7, blood_group=$8, father_spouse_name=$9,
              aadhaar_last4=$10, aadhaar_no=COALESCE($11, aadhaar_no), pan_no=$12,
              designation=$13, department=$14,
              reports_to=$15, employment_type=COALESCE($16, employment_type)::employment_type,
              official_email=$17, photo_file_id=COALESCE($18, photo_file_id), updated_by=$19
            WHERE id=$1`,
          [emp.id, v1.fullName, b.gender || null, b.dob || null, v1.mobile, v1.altMobile,
           b.personalEmail || null, b.bloodGroup || null, titleCaseName(b.fatherSpouseName) || null,
           v2.aadhaarLast4, v2.aadhaarNo, v2.panNo, String(b.designation).trim(),
           b.department || null, b.reportsTo || null, b.employmentType || null,
           b.officialEmail || null, Number(b.photoFileId?.fileId ?? b.photoFileId) || null, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "employee", entityId: emp.id, action: "update",
          before: { name: emp.full_name }, after: { name: v1.fullName } });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— membership: replace role and branch ticks ———
    if (b.action === "membership") {
      const roleIds = (b.roleIds || []).map(Number).filter(Boolean);
      const branchIds = (b.branchIds || []).map(Number).filter(Boolean);
      if (roleIds.length === 0) return bad(["Tick at least one role"]);
      if (branchIds.length === 0) return bad(["Tick at least one branch"]);
      const primary = Number(b.primaryBranchId || 0) || branchIds[0];
      if (!branchIds.includes(primary)) return bad(["The primary branch must be one of the ticked branches"]);

      // no-lockout: if this person is currently an admin and the new roles drop it
      const admins = await adminIds();
      if (admins.includes(Number(emp.id))) {
        const keeps = await q(
          `SELECT 1 FROM role_permission
            WHERE role_id = ANY($1::bigint[]) AND fn='settings' AND level='full' LIMIT 1`,
          [roleIds]);
        if (keeps.length === 0) {
          const gate = wouldRemoveLastAdmin(admins, emp.id);
          if (!gate.ok) return NextResponse.json({ ok: false, reason: gate.reason }, { status: 409 });
        }
      }

      await tx(async (cl) => {
        await cl.query(`DELETE FROM employee_role WHERE employee_id=$1`, [emp.id]);
        for (const rid of roleIds)
          await cl.query(`INSERT INTO employee_role (employee_id, role_id) VALUES ($1,$2)`, [emp.id, rid]);
        await cl.query(`DELETE FROM employee_branch WHERE employee_id=$1`, [emp.id]);
        for (const bid of branchIds)
          await cl.query(`INSERT INTO employee_branch (employee_id, branch_id) VALUES ($1,$2)`, [emp.id, bid]);
        await cl.query(`UPDATE employee SET primary_branch_id=$2, updated_by=$3 WHERE id=$1`,
          [emp.id, primary, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "employee", entityId: emp.id, action: "membership",
          before: {}, after: { roleIds, branchIds, primary } });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— reset password: HO types a new temporary one, force-change comes on ———
    if (b.action === "reset_password") {
      const v = validAccess({ username: emp.username, password: b.password, confirm: b.confirm },
        { requirePassword: true });
      if (!v.ok) return bad(v.problems);
      await tx(async (cl) => {
        await cl.query(
          `UPDATE employee SET password_hash=$2, force_change=FALSE, updated_by=$3 WHERE id=$1`,
          [emp.id, hashPassword(b.password), actor.employeeId]);
        await cl.query(`DELETE FROM session WHERE employee_id=$1`, [emp.id]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "employee", entityId: emp.id, action: "reset_password" });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— suspend ———
    if (b.action === "suspend") {
      const self = canSuspend(actor.employeeId, emp.id);
      if (!self.ok) return NextResponse.json({ ok: false, reason: self.reason }, { status: 409 });
      const v = validSuspension(b);
      if (!v.ok) return bad(v.problems);
      const gate = wouldRemoveLastAdmin(await adminIds(), emp.id);
      if (!gate.ok) return NextResponse.json({ ok: false, reason: gate.reason }, { status: 409 });
      const suspendedLabel = en.statuses.find(s => s !== "active");
      if (!suspendedLabel)
        return NextResponse.json({ ok: false, reason: "No non-active status exists in the database" }, { status: 500 });
      await tx(async (cl) => {
        await cl.query(
          `UPDATE employee SET status=$2::emp_status, dol=$3, updated_by=$4 WHERE id=$1`,
          [emp.id, b.status && en.statuses.includes(b.status) && b.status !== "active"
            ? b.status : suspendedLabel, b.dol, actor.employeeId]);
        await cl.query(`DELETE FROM session WHERE employee_id=$1`, [emp.id]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "employee", entityId: emp.id, action: "suspend",
          after: { dol: b.dol, reason: String(b.reason).trim() } });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— reactivate ———
    if (b.action === "reactivate") {
      await tx(async (cl) => {
        await cl.query(
          `UPDATE employee SET status='active'::emp_status, dol=NULL, updated_by=$2 WHERE id=$1`,
          [emp.id, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "employee", entityId: emp.id, action: "reactivate" });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[employees] SAVE FAILED:", e.message);
    if (String(e.message || "").includes("employee_username_key"))
      return NextResponse.json({ ok: false, reason: "That username is already taken" }, { status: 409 });
    if (String(e.message || "").includes("employee_aadhaar_no_key"))
      return NextResponse.json({ ok: false, reason: "Another employee already has that Aadhaar number" }, { status: 409 });
    return NextResponse.json({ ok: false, reason: "The change could not be saved" }, { status: 500 });
  }
}

function bad(problems, status = 400) {
  return NextResponse.json({ ok: false, reason: problems[0], problems }, { status });
}


/** Duplicate identity scan for an employee being created/updated.
 *  Same-table (employee) PAN/Aadhaar → hard refusal.
 *  Cross-table (customer) PAN exact or Aadhaar last-4 → confirmation message
 *  (an employee may legitimately also be a customer; last-4 can collide).  */
async function identityDuplicates({ panNo, aadhaarNo, aadhaarLast4, excludeEmployeeId }) {
  const notSelf = excludeEmployeeId ? ` AND id <> ${Number(excludeEmployeeId)}` : "";
  if (panNo) {
    const e = await one(
      `SELECT full_name, emp_code FROM employee WHERE upper(pan_no) = upper($1)` + notSelf, [panNo]);
    if (e) return { refuse: `Another employee already has that PAN — ${e.full_name} (${e.emp_code})` };
  }
  if (aadhaarNo) {
    const e = await one(
      `SELECT full_name, emp_code FROM employee WHERE aadhaar_no = $1` + notSelf, [aadhaarNo]);
    if (e) return { refuse: `Another employee already has that Aadhaar — ${e.full_name} (${e.emp_code})` };
  }
  const hits = [];
  if (panNo) {
    const c = await one(
      `SELECT full_name, cust_no FROM customer WHERE upper(pan_no) = upper($1) LIMIT 1`, [panNo]);
    if (c) hits.push(`a customer has the same PAN — ${c.full_name} (${c.cust_no})`);
  }
  if (aadhaarLast4) {
    const c = await one(
      `SELECT full_name, cust_no FROM customer WHERE aadhaar_last4 = $1 LIMIT 1`, [aadhaarLast4]);
    if (c) hits.push(`a customer's Aadhaar ends in the same 4 digits — ${c.full_name} (${c.cust_no})`);
  }
  if (hits.length) return { confirm:
    `Possible duplicate: ${hits.join("; ")}. If this employee is genuinely the same person ` +
    `(or genuinely different), confirm to save anyway.` };
  return {};
}
