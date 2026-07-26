/**
 * SLF GoldDesk — POLICY ENGINE
 * The single place that answers "may this person do this?".
 *
 * Principles (locked with the owner):
 *  · Roles are renamable permission bundles — never branch on a role NAME.
 *  · Rules attach to ACTIONS, not to screens. Hiding a button is not security;
 *    every mutation asks can() on the server.
 *  · Deny by default. An action with no explicit grant fails.
 *  · Sanction ceiling = MIN(person override, highest role limit). Above it,
 *    the file routes to HO — it is never simply blocked.
 *
 * Pure functions: the caller loads rows from the database and passes them in.
 * That keeps this file unit-testable with no database at all.
 */

export const FUNCTIONS = [
  "appraise", "sanction", "vault", "disburse", "collect", "renew", "release",
  "dayend", "cash_transfer", "rate_maker", "rate_checker", "reports", "settings",
];

const RANK = { none: 0, view: 1, full: 2 };

/**
 * @typedef {Object} Actor
 * @property {number} employeeId
 * @property {string} username
 * @property {number} actingBranchId
 * @property {{roleId:number, name:string, loginFrom?:string|null, loginTo?:string|null,
 *             loginDays?:number, graceMin?:number}[]} roles
 * @property {Record<string, 'none'|'view'|'full'>} permissions  // merged, highest wins
 * @property {number[]} branchIds        // branches this employee may operate in
 * @property {number[]} schemeIds        // schemes their roles may lend on
 * @property {number|null} personLimitPaise
 * @property {number|null} roleLimitPaise
 */

/** Merge role_permission rows into one map, highest level winning. */
export function mergePermissions(rows) {
  const out = {};
  for (const fn of FUNCTIONS) out[fn] = "none";
  for (const r of rows || []) {
    if (!FUNCTIONS.includes(r.fn)) continue;
    if (RANK[r.level] > RANK[out[r.fn]]) out[r.fn] = r.level;
  }
  return out;
}

/**
 * May the actor perform `fn` at `need` level?
 * @param {Actor} actor
 * @param {string} fn
 * @param {{need?:'view'|'full', branchId?:number, schemeId?:number}} [ctx]
 * @returns {{ok:boolean, reason?:string}}
 */
export function can(actor, fn, ctx = {}) {
  const need = ctx.need || "full";
  if (!actor) return { ok: false, reason: "not signed in" };
  if (!FUNCTIONS.includes(fn)) return { ok: false, reason: `unknown function ${fn}` };

  const have = actor.permissions?.[fn] || "none";
  if (RANK[have] < RANK[need]) return { ok: false, reason: `no ${need} permission for ${fn}` };

  const branchId = ctx.branchId ?? actor.actingBranchId;
  if (branchId && !(actor.branchIds || []).includes(branchId))
    return { ok: false, reason: "not posted to this branch" };

  if (ctx.schemeId && !(actor.schemeIds || []).includes(ctx.schemeId))
    return { ok: false, reason: "your role may not lend on this scheme" };

  return { ok: true };
}

/** Throwing form for server actions — keeps call sites short. */
export function assertCan(actor, fn, ctx) {
  const r = can(actor, fn, ctx);
  if (!r.ok) { const e = new Error(r.reason); e.code = "FORBIDDEN"; throw e; }
  return true;
}

/**
 * Effective sanction authority — DENY BY DEFAULT.
 *
 * The absence of a limit row is NOT permission; it is zero. "Unlimited" exists
 * only where someone deliberately set `is_unlimited` on a sanction_limit row.
 *
 * @returns {{ceilingPaise:number, unlimited:boolean, reason:string}}
 *   ceilingPaise is meaningless when unlimited is true.
 */
export function sanctionAuthority(actor) {
  if (!actor || !can(actor, "sanction", { need: "full" }).ok)
    return { ceilingPaise: 0, unlimited: false, reason: "not a sanctioning role" };

  if (actor.personUnlimited || actor.roleUnlimited)
    return { ceilingPaise: 0, unlimited: true, reason: "unlimited authority (explicit grant)" };

  const p = actor.personLimitPaise ?? null;   // person override
  const r = actor.roleLimitPaise ?? null;     // highest role limit

  if (p == null && r == null)
    return { ceilingPaise: 0, unlimited: false, reason: "no limit configured — contact HO" };

  const ceiling = (p == null) ? r : (r == null) ? p : Math.min(p, r);
  return {
    ceilingPaise: ceiling,
    unlimited: false,
    reason: (p != null && (r == null || p < r)) ? "person override" : "role limit",
  };
}

/** Ceiling in paise, or null when explicitly unlimited. Kept for call-site brevity. */
export function sanctionCeiling(actor) {
  const a = sanctionAuthority(actor);
  return a.unlimited ? null : a.ceilingPaise;
}

/** Does an amount need Head-Office approval? Zero authority ⇒ always yes. */
export function needsHoApproval(actor, amountPaise) {
  const a = sanctionAuthority(actor);
  if (a.unlimited) return false;
  return amountPaise > a.ceilingPaise;
}

/**
 * Login window check. days bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
 * A role with no window (null from/to) may sign in at any time.
 * The actor passes if ANY of their roles allows the moment.
 * @param {{loginFrom?:string|null, loginTo?:string|null, loginDays?:number, graceMin?:number}[]} roles
 * @param {Date} at
 */
export function withinLoginWindow(roles, at = new Date()) {
  if (!roles || roles.length === 0) return { ok: false, reason: "no role assigned" };
  const dayBit = [64, 1, 2, 4, 8, 16, 32][at.getDay()];   // getDay: 0=Sun
  const minutes = at.getHours() * 60 + at.getMinutes();
  let closest = null;

  for (const r of roles) {
    const days = r.loginDays ?? 127;
    if (!(days & dayBit)) continue;
    if (!r.loginFrom || !r.loginTo) return { ok: true };
    const from = hm(r.loginFrom);
    const to = hm(r.loginTo) + (r.graceMin ?? 0);
    if (minutes >= from && minutes <= to) return { ok: true };
    closest = closest || `${r.loginFrom.slice(0,5)}–${r.loginTo.slice(0,5)}`;
  }
  return {
    ok: false,
    reason: closest ? `your role may sign in ${closest}` : "sign-in not allowed today",
  };
}
function hm(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); }

/** Failed-attempt lockout policy. */
export const MAX_FAILED = 5;
export function attemptsLeft(failedCount) { return Math.max(0, MAX_FAILED - failedCount); }
export function isLocked(failedCount) { return failedCount >= MAX_FAILED; }

/**
 * Which desks the UI should render. Mirrors the frozen "Who sees what" map —
 * derived from permissions, never hardcoded per role name.
 */
export function visibleDesks(actor) {
  const p = (fn, lvl = "view") => can(actor, fn, { need: lvl }).ok;
  return {
    counterHome:  p("appraise") || p("collect") || p("disburse"),
    overdue:      p("collect"),
    dayCycle:     p("dayend"),
    cashTransfer: p("cash_transfer"),
    vault:        p("vault"),
    reports:      p("reports"),
    hqDashboard:  p("reports", "full") && p("settings", "view"),
    approvals:    p("sanction", "full") && p("settings", "view"),
    dailyRate:    p("rate_maker") || p("rate_checker"),
    settings:     p("settings", "full"),
  };
}
