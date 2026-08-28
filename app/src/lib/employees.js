/**
 * SLF GoldDesk — EMPLOYEE ADMINISTRATION RULES
 * Pure validation for the Employees settings tab. No database.
 *
 * Privacy rule, owner-locked style: the FULL Aadhaar number is NEVER accepted
 * and never stored — only its last 4 digits (the column is aadhaar_last4).
 * Enum labels (gender, employment type, status) are read from the database at
 * runtime and passed IN to these validators — never hardcoded here, because
 * guessing enum labels has broken scripts before.
 */

import { checkPasswordPolicy } from "./password.js";
import { titleCaseName } from "./format.js";

// ————————————————————————— step 1 · identity —————————————————————————

export function validIdentity(b = {}) {
  const problems = [];
  const name = String(b.fullName || "").trim();
  if (name.length < 3) problems.push("Give the employee's full name (at least 3 characters)");
  const mobile = String(b.mobile || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile))
    problems.push("Mobile must be a 10-digit Indian number starting 6–9");
  if (b.altMobile) {
    const alt = String(b.altMobile).replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(alt)) problems.push("The alternate mobile is not a valid 10-digit number");
    if (alt === mobile) problems.push("The alternate mobile is the same as the main mobile");
  }
  if (b.dob) {
    const age = (Date.now() - new Date(b.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (Number.isNaN(age)) problems.push("The date of birth is not a real date");
    else if (age < 18) problems.push("An employee must be at least 18");
    else if (age > 70) problems.push("Check the date of birth — it says the person is over 70");
  }
  if (b.personalEmail && !/^\S+@\S+\.\S+$/.test(String(b.personalEmail).trim()))
    problems.push("The personal email does not look like an email address");
  return { ok: problems.length === 0, problems,
    fullName: titleCaseName(name), mobile,
    altMobile: b.altMobile ? String(b.altMobile).replace(/\D/g, "") : null };
}

// ————————————————————————— step 2 · KYC —————————————————————————

export function validKyc(b = {}) {
  const problems = [];
  // Owner decision 12 Aug 2026 (supersedes same-day amendment): the FULL
  // 12-digit Aadhaar is accepted AND STORED (column aadhaar_no, migration 013),
  // with last-4 kept alongside for display. Consequence stated and accepted.
  const typed = String(b.aadhaarLast4 || "").replace(/\s/g, "");
  let last4 = null, full = null;
  if (typed) {
    if (/^\d{12}$/.test(typed)) { full = typed; last4 = typed.slice(-4); }
    else if (/^\d{4}$/.test(typed)) last4 = typed;
    else problems.push("Aadhaar: type the full 12 digits (4444 4444 4444) or just the last 4");
  }
  const pan = String(b.panNo || "").replace(/\s/g, "").toUpperCase();
  if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan))
    problems.push("PAN must look like BIWPK2312M — 5 letters, 4 digits, 1 letter");
  if (!last4 && !pan)
    problems.push("Record at least one identity document — Aadhaar or PAN");
  return { ok: problems.length === 0, problems, aadhaarLast4: last4, aadhaarNo: full, panNo: pan || null };
}

// ————————————————————————— step 3 · employment —————————————————————————

/** @param {object} b @param {string[]} employmentTypes enum labels from the DB */
export function validEmployment(b = {}, employmentTypes = []) {
  const problems = [];
  if (String(b.designation || "").trim().length < 2)
    problems.push("Give a designation (e.g. Counter Operator, Valuer)");
  if (!b.doj) problems.push("Date of joining is required");
  else {
    const d = new Date(b.doj), soon = new Date(Date.now() + 31 * 24 * 3600 * 1000);
    if (Number.isNaN(d.getTime())) problems.push("The date of joining is not a real date");
    else if (d > soon) problems.push("The date of joining is more than a month in the future — check it");
  }
  if (b.employmentType && employmentTypes.length && !employmentTypes.includes(b.employmentType))
    problems.push("Unknown employment type");
  const roleIds = (b.roleIds || []).map(Number).filter(Boolean);
  const branchIds = (b.branchIds || []).map(Number).filter(Boolean);
  if (roleIds.length === 0)
    problems.push("Tick at least one role — with no role the person can sign in but do nothing");
  // owner (28 Aug 2026): branch posting is OPTIONAL — an unposted employee
  // exists but cannot sign in anywhere until posted.
  const primary = Number(b.primaryBranchId || 0);
  if (primary && !branchIds.includes(primary))
    problems.push("The primary branch must be one of the ticked branches");
  return { ok: problems.length === 0, problems, roleIds, branchIds,
    primaryBranchId: primary || branchIds[0] || null };
}

// ————————————————————————— step 4 · system access —————————————————————————

export function validAccess(b = {}, { requirePassword = true } = {}) {
  const problems = [];
  const username = String(b.username || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9._]{2,19}$/.test(username))
    problems.push("Username: 3–20 characters, letters/numbers/dot/underscore, starting with a letter");
  if (b.officialEmail && !/^\S+@\S+\.\S+$/.test(String(b.officialEmail).trim()))
    problems.push("The official email does not look like an email address");
  if (requirePassword) {
    const pol = checkPasswordPolicy(b.password || "", username);
    if (!pol.ok)
      problems.push("Password needs: " + pol.checks.filter(c => !c.pass).map(c => c.label).join(", "));
    if ((b.password || "") !== (b.confirm || ""))
      problems.push("The two passwords do not match");
  }
  return { ok: problems.length === 0, problems, username };
}

// ————————————————————————— suspend / reactivate —————————————————————————

export function validSuspension(b = {}) {
  const problems = [];
  if (!b.dol) problems.push("A date of leaving is required to suspend — the DB refuses without it");
  else if (Number.isNaN(new Date(b.dol).getTime())) problems.push("The date of leaving is not a real date");
  if (String(b.reason || "").trim().length < 5)
    problems.push("Give a written reason of at least 5 characters");
  return { ok: problems.length === 0, problems };
}

/** Nobody may suspend themself — a second person must do it. */
export function canSuspend(actorEmployeeId, targetEmployeeId) {
  if (Number(actorEmployeeId) === Number(targetEmployeeId))
    return { ok: false, reason: "You cannot suspend your own account — another administrator must do it" };
  return { ok: true };
}

/**
 * Would suspending this person leave nobody able to administer settings?
 * @param {number[]} adminEmployeeIds ACTIVE employees holding settings=full via active roles
 */
export function wouldRemoveLastAdmin(adminEmployeeIds = [], targetEmployeeId) {
  const rest = adminEmployeeIds.filter(id => Number(id) !== Number(targetEmployeeId));
  if (rest.length > 0) return { ok: true };
  return { ok: false,
    reason: "This person is the only active administrator — grant Settings & admin to someone else first" };
}
