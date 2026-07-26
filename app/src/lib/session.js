/**
 * SLF GoldDesk — sessions & actor loading
 *
 * Sessions live in the database (not JWTs) so that deactivating an employee,
 * changing a role, or pressing "force logout" takes effect immediately.
 */
import { cookies, headers } from "next/headers";
import { q, one, db } from "./db.js";
import { newSessionToken, sha256, verifyPassword, hashPassword } from "./password.js";
import { mergePermissions, withinLoginWindow, isLocked, attemptsLeft, MAX_FAILED } from "./policy.js";

export const COOKIE = "slf_session";
const IDLE_MIN = 30;        // signed out after this much inactivity (always)
const ABSOLUTE_H = 12;      // hard ceiling for one sign-in
const KEEP_DAYS = 7;        // "keep me signed in on this device"

/** Load everything the policy engine needs about an employee. */
export async function loadActor(employeeId, actingBranchId) {
  const emp = await one(
    `SELECT id, emp_code, full_name, username, status, force_change, primary_branch_id
       FROM employee WHERE id = $1`, [employeeId]);
  if (!emp || emp.status !== "active") return null;

  const roles = await q(
    `SELECT r.id AS "roleId", r.name, r.login_from AS "loginFrom", r.login_to AS "loginTo",
            r.login_days AS "loginDays", r.grace_min AS "graceMin", r.perm_version AS "permVersion"
       FROM employee_role er JOIN role r ON r.id = er.role_id
      WHERE er.employee_id = $1 AND r.active
        AND (er.effective_to IS NULL OR er.effective_to >= CURRENT_DATE)`, [employeeId]);

  const perms = await q(
    `SELECT rp.fn, rp.level FROM role_permission rp
      WHERE rp.role_id = ANY($1::bigint[])`, [roles.map(r => r.roleId)]);

  const branches = await q(
    `SELECT b.id, b.code, b.name, b.entity_id AS "entityId", b.is_ho AS "isHo"
       FROM employee_branch eb JOIN branch b ON b.id = eb.branch_id
      WHERE eb.employee_id = $1 AND b.active
        AND (eb.effective_to IS NULL OR eb.effective_to >= CURRENT_DATE)
      ORDER BY b.code`, [employeeId]);

  const schemes = await q(
    `SELECT DISTINCT scheme_id AS id FROM role_scheme WHERE role_id = ANY($1::bigint[])`,
    [roles.map(r => r.roleId)]);

  const limits = await q(
    `SELECT role_id AS "roleId", employee_id AS "employeeId", limit_paise AS "limitPaise",
            is_unlimited AS "isUnlimited"
       FROM sanction_limit
      WHERE (employee_id = $1 OR role_id = ANY($2::bigint[]))
        AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
    [employeeId, roles.map(r => r.roleId)]);

  const personRows = limits.filter(l => l.employeeId);
  const roleRows   = limits.filter(l => l.roleId && !l.employeeId);
  const personLimit = personRows.filter(l => !l.isUnlimited).map(l => l.limitPaise);
  const roleLimits  = roleRows.filter(l => !l.isUnlimited).map(l => l.limitPaise);

  const branch = branches.find(b => b.id === actingBranchId) || null;

  return {
    employeeId: emp.id,
    empCode: emp.emp_code,
    fullName: emp.full_name,
    username: emp.username,
    forceChange: emp.force_change,
    actingBranchId: branch?.id ?? null,
    actingBranch: branch,
    branches,
    branchIds: branches.map(b => b.id),
    entityIds: [...new Set(branches.map(b => b.entityId))],
    roles,
    roleNames: roles.map(r => r.name),
    permissions: mergePermissions(perms),
    schemeIds: schemes.map(s => s.id),
    personLimitPaise: personLimit.length ? Math.min(...personLimit) : null,
    roleLimitPaise:  roleLimits.length  ? Math.max(...roleLimits)  : null,
    personUnlimited: personRows.some(l => l.isUnlimited),
    roleUnlimited:   roleRows.some(l => l.isUnlimited),
    permVersion: Math.max(0, ...roles.map(r => r.permVersion || 0)),
  };
}

/** Verify credentials. Returns {ok} or {ok:false, reason, attemptsLeft?}. */
export async function authenticate(username, password) {
  const emp = await one(
    `SELECT id, username, password_hash, status, force_change FROM employee WHERE lower(username) = lower($1)`,
    [username || ""]);

  // Constant-ish work whether or not the user exists (don't leak which failed)
  const stored = emp?.password_hash || "scrypt$16384$8$1$AAAA$AAAA";
  const good = verifyPassword(password || "", stored);

  if (!emp) return { ok: false, reason: "Username or password is incorrect" };
  if (emp.status !== "active") return { ok: false, reason: "This account is inactive. Contact HO." };

  const fails = await failedCount(emp.id);
  if (isLocked(fails)) return { ok: false, reason: `Account locked after ${MAX_FAILED} failed attempts. HO must unlock.`, locked: true };

  if (!good) {
    await recordFailure(emp.id);
    const left = attemptsLeft(fails + 1);
    return { ok: false, reason: `Username or password is incorrect — ${left} attempt${left === 1 ? "" : "s"} left`, attemptsLeft: left };
  }

  const actor = await loadActor(emp.id, null);
  if (!actor) return { ok: false, reason: "This account is inactive. Contact HO." };
  if (actor.roles.length === 0) return { ok: false, reason: "No role assigned. Contact HO." };

  const win = withinLoginWindow(actor.roles);
  if (!win.ok) return { ok: false, reason: capitalise(win.reason) + ".", window: true };

  await clearFailures(emp.id);
  return { ok: true, employeeId: emp.id, forceChange: emp.force_change, branches: actor.branches };
}

/** Create a session row and return the cookie token. */
export async function createSession(employeeId, actingBranchId, meta = {}) {
  const actor = await loadActor(employeeId, actingBranchId);
  if (!actor) throw new Error("cannot create session for inactive employee");
  const { token, tokenHash } = newSessionToken();
  const ms = meta.keep ? KEEP_DAYS * 24 * 3600_000 : ABSOLUTE_H * 3600_000;
  const expires = new Date(Date.now() + ms);
  await q(
    `INSERT INTO session (token_hash, employee_id, acting_branch_id, perm_snapshot, perm_version,
                          device, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tokenHash, employeeId, actingBranchId,
     JSON.stringify({ permissions: actor.permissions, branchIds: actor.branchIds, schemeIds: actor.schemeIds }),
     actor.permVersion, meta.device ?? null, meta.ip ?? null, expires]);
  return { token, expires };
}

/** Read the current actor from the cookie. Null when signed out/expired. */
export async function currentActor() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const s = await one(
    `SELECT id, employee_id, acting_branch_id, perm_version, last_seen, expires_at, revoked_at
       FROM session WHERE token_hash = $1`, [sha256(token)]);
  if (!s || s.revoked_at) return null;
  if (new Date(s.expires_at) < new Date()) return null;
  if (Date.now() - new Date(s.last_seen).getTime() > IDLE_MIN * 60_000) {
    await q(`UPDATE session SET revoked_at = now() WHERE id = $1`, [s.id]);
    return null;
  }

  const actor = await loadActor(s.employee_id, s.acting_branch_id);
  if (!actor) return null;

  // permissions changed since sign-in ⇒ session picks them up silently
  await q(`UPDATE session SET last_seen = now(), perm_version = $2 WHERE id = $1`, [s.id, actor.permVersion]);
  actor.sessionId = s.id;
  return actor;
}

export async function revokeSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await q(`UPDATE session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
}

/** Set a new password (first login / after HO reset). */
export async function setPassword(employeeId, plain) {
  await q(`UPDATE employee SET password_hash = $2, force_change = FALSE, updated_at = now() WHERE id = $1`,
    [employeeId, hashPassword(plain)]);
  await q(`UPDATE session SET revoked_at = now() WHERE employee_id = $1 AND revoked_at IS NULL`, [employeeId]);
}

// —— failed attempts (kept in audit_log so there is no extra table to reconcile) ——
async function failedCount(employeeId) {
  const r = await one(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE entity_table = 'employee' AND entity_id = $1 AND action = 'login_failed'
        AND at > now() - interval '30 minutes'`, [employeeId]);
  return r?.n ?? 0;
}
async function recordFailure(employeeId) {
  await q(`INSERT INTO audit_log (employee_id, entity_table, entity_id, action) VALUES ($1,'employee',$1,'login_failed')`,
    [employeeId]);
}
async function clearFailures(employeeId) {
  await q(`INSERT INTO audit_log (employee_id, entity_table, entity_id, action) VALUES ($1,'employee',$1,'login_ok')`,
    [employeeId]);
}
function capitalise(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

export async function clientMeta() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    device: h.get("user-agent")?.slice(0, 200) ?? null,
  };
}
