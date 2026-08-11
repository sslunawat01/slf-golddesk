/**
 * SLF GoldDesk — ROLE ADMINISTRATION RULES
 * Pure validation for the Roles settings tab. Rows in, verdicts out — no
 * database, same discipline as policy.js and masters.js.
 *
 * Owner-accepted decisions (11 Aug 2026), recorded:
 *  · Permission levels stay none/view/full (the frozen UX's view/add/edit/delete
 *    grid maps onto them; a four-way CRUD would rewrite the engine for no gain).
 *  · A missing sanction-limit row means ZERO, never unlimited. The frozen UX's
 *    "unlimited if blank" wording loses to the deny-by-default schema; unlimited
 *    is an explicit tick that demands a written reason.
 *  · The "screens this role sees" tick block is deferred until those screens exist.
 *  · Per-scheme amount caps are deferred (role_scheme has no cap column);
 *    scheme TICKS are built now.
 */

import { FUNCTIONS } from "./policy.js";

/** English labels, taken from the frozen UX OPS list. */
export const FUNCTION_LABELS = {
  appraise: "Appraise",
  sanction: "Sanction loans",
  vault: "Vault in / out",
  disburse: "Disburse",
  collect: "Collect repayments",
  renew: "Renew",
  release: "Gold release",
  dayend: "Day-end",
  cash_transfer: "Cash / bank transfer",
  rate_maker: "Daily rate — maker",
  rate_checker: "Daily rate — checker",
  reports: "Reports",
  settings: "Settings & admin",
};

export const LEVELS = ["none", "view", "full"];

/**
 * Day bitmask convention — MUST match policy.js withinLoginWindow:
 * dayBit = [64,1,2,4,8,16,32][getDay()], getDay 0 = Sunday.
 * So Mon=1 Tue=2 Wed=4 Thu=8 Fri=16 Sat=32 Sun=64.
 * (The frozen UX's "2nd/4th Sat off" preset cannot be expressed in a weekly
 * bitmask — deferred with the owner's knowledge; use Mon–Sat and manage
 * exceptions by the holiday table.)
 */
export const DAY_PRESETS = [
  ["Mon–Sat", 63],
  ["Mon–Fri", 31],
  ["All days", 127],
];
export function presetForDays(bits) {
  const hit = DAY_PRESETS.find(([, b]) => b === Number(bits));
  return hit ? hit[0] : "Custom";
}

// ————————————————————————— name —————————————————————————

/** @param {string} name @param {{id?:number,name:string}[]} existing @param {number|null} selfId */
export function validRoleName(name, existing = [], selfId = null) {
  const problems = [];
  const n = String(name || "").trim();
  if (n.length < 3) problems.push("Give the role a name of at least 3 characters");
  if (n.length > 40) problems.push("Keep the role name under 40 characters");
  const dup = existing.find(r => r.name.trim().toLowerCase() === n.toLowerCase()
    && (selfId == null || Number(r.id) !== Number(selfId)));
  if (dup) problems.push("Another role already has that name");
  return { ok: problems.length === 0, problems, name: n };
}

// ————————————————————————— permissions —————————————————————————

/**
 * Normalise a fn→level map. Unknown functions are dropped; 'none' rows are
 * dropped too — absence IS none, the deny-by-default way.
 * @param {Record<string,string>} perms
 * @returns {{ok:boolean, problems:string[], rows:{fn:string,level:'view'|'full'}[]}}
 */
export function normalizePermissions(perms = {}) {
  const problems = [];
  const rows = [];
  for (const [fn, level] of Object.entries(perms)) {
    if (!FUNCTIONS.includes(fn)) continue;            // silently drop unknowns
    if (level === "none" || level == null || level === "") continue;
    if (!LEVELS.includes(level)) { problems.push(`Unknown level "${level}" for ${fn}`); continue; }
    rows.push({ fn, level });
  }
  return { ok: problems.length === 0, problems, rows };
}

// ————————————————————————— login window —————————————————————————

/** @param {{from?:string|null,to?:string|null,days?:number,graceMin?:number}} w */
export function validLoginWindow(w = {}) {
  const problems = [];
  const from = w.from || null, to = w.to || null;
  if ((from && !to) || (!from && to))
    problems.push("Give both a From and a To time, or leave both empty for any time");
  if (from && to) {
    if (!/^\d{2}:\d{2}/.test(from) || !/^\d{2}:\d{2}/.test(to))
      problems.push("Times must look like 09:30");
    else if (hm(from) >= hm(to))
      problems.push("The From time must be earlier than the To time");
  }
  const days = Number(w.days ?? 127);
  if (!Number.isInteger(days) || days < 1 || days > 127)
    problems.push("Pick at least one allowed day");
  const grace = Number(w.graceMin ?? 0);
  if (!Number.isInteger(grace) || grace < 0 || grace > 240)
    problems.push("Grace minutes must be between 0 and 240");
  return { ok: problems.length === 0, problems, from, to, days, graceMin: grace };
}
function hm(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); }

// ————————————————————————— sanction limit —————————————————————————

/**
 * Blank = ₹0 (everything routes to HO). Unlimited is explicit and needs a
 * written reason. DB CHECK: is_unlimited ⇒ limit_paise = 0.
 * @param {{limitRs?:string|number|null, isUnlimited?:boolean, reason?:string}} l
 */
export function validLimit(l = {}) {
  const problems = [];
  const unlimited = !!l.isUnlimited;
  const raw = l.limitRs === "" || l.limitRs == null ? 0 : Number(l.limitRs);
  if (Number.isNaN(raw) || raw < 0) problems.push("The limit must be zero or a positive rupee amount");
  if (unlimited && raw > 0)
    problems.push("Unlimited and a rupee limit cannot both be set — clear one");
  if (!unlimited && raw > 0 && raw % 100 !== 0)
    problems.push("A sanction limit is set in whole multiples of ₹100");
  if (unlimited && String(l.reason || "").trim().length < 5)
    problems.push("Unlimited authority needs a written reason of at least 5 characters");
  return {
    ok: problems.length === 0, problems,
    limitPaise: unlimited ? 0 : Math.round(raw * 100),
    isUnlimited: unlimited,
    reason: String(l.reason || "").trim() || null,
  };
}

// ————————————————————————— the no-lockout guard —————————————————————————

/**
 * Would this permission change leave the business with NOBODY who can
 * administer settings? Pure: the route passes in the current holders.
 * @param {{roleId:number, hasSettingsFull:boolean, activeMembers:number}[]} holders
 *        one row per ACTIVE role, with its live settings grant and member count
 * @param {number} editedRoleId
 * @param {boolean} editedWillHaveSettingsFull
 * @returns {{ok:boolean, reason?:string}}
 */
export function leavesAnAdmin(holders = [], editedRoleId, editedWillHaveSettingsFull) {
  let people = 0;
  for (const h of holders) {
    const grants = Number(h.roleId) === Number(editedRoleId)
      ? editedWillHaveSettingsFull
      : h.hasSettingsFull;
    if (grants) people += Number(h.activeMembers) || 0;
  }
  if (people > 0) return { ok: true };
  return {
    ok: false,
    reason: "This change would leave no active employee able to administer settings — grant Settings & admin to someone else first",
  };
}
