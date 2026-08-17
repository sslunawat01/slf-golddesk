/**
 * SLF GoldDesk — OVERDUE WORKLIST RULES
 * Pure classification and validation. The worklist is PROACTIVE, exactly as
 * the frozen UX designs it: it surfaces loans APPROACHING trouble (a slab
 * boundary, tenure) alongside loans already past it, and loans whose saved
 * follow-up has come due again.
 *
 * Schema notes (verified \d 13 Aug 2026):
 *  · collection_call.outcome is a DB ENUM — labels are introspected at
 *    runtime, never hardcoded. The frozen "pick or type" outcome becomes
 *    "pick from the list"; typed nuance goes in the narration. Owner-noted.
 *  · method + next_follow_up added by migration 014; rows are append-only.
 */

export const METHODS = ["Phone call", "Home visit", "SMS/WhatsApp",
  "Post/courier", "Customer walked-in"];

/** Whole days since disbursement, day 0 = the disbursement day. */
export function loanDay(disbursedAt, today) {
  const d = new Date(disbursedAt), t = new Date(today);
  return Math.floor((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())
    - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
}

/**
 * The next slab boundary AHEAD of the loan's current day, if any.
 * @param {number} day @param {{fromDay:number}[]} slabs scheme_slab rows
 * @returns {number|null} days until the next boundary (0 = boundary today)
 */
export function daysToNextSlab(day, slabs = []) {
  const boundaries = slabs.map(s => Number(s.fromDay)).filter(b => b > 0 && b > day)
    .sort((a, b) => a - b);
  return boundaries.length ? boundaries[0] - day : null;
}

/**
 * Which buckets a loan belongs to. A loan can sit in several; "All" is implicit.
 * @param {{day:number, tenureDays:number, slabs?:{fromDay:number}[],
 *          nextFollowUp?:string|null, today:string}} L
 */
export function bucketsFor(L) {
  const out = new Set();
  const toTenure = Number(L.tenureDays) - Number(L.day);
  if (toTenure < 0) out.add("past");
  else {
    if (toTenure <= 5) out.add("t5");
    if (toTenure <= 15) out.add("t15");
  }
  const slabIn = daysToNextSlab(L.day, L.slabs || []);
  if (slabIn !== null && slabIn <= 5 && toTenure >= 0) out.add("slab");
  if (L.nextFollowUp && String(L.nextFollowUp) <= String(L.today)) out.add("refu");
  return [...out];
}

/** Chip tone for the Day-N age pill: red past tenure, amber inside 15 days, grey otherwise. */
export function ageTone(day, tenureDays) {
  const toTenure = Number(tenureDays) - Number(day);
  if (toTenure < 0) return "bad";
  if (toTenure <= 15) return "warn";
  return "mut";
}

export const BUCKETS = [
  ["all", "All"], ["refu", "Re-follow-up due"], ["slab", "Slab change ≤5d"],
  ["t15", "Tenure in ≤15d"], ["t5", "Tenure in ≤5d"], ["past", "Past tenure"]];

// ————————————————————————— saving a follow-up —————————————————————————

/**
 * @param {object} b @param {string[]} outcomes enum labels from the DB
 * @param {string} today ISO date
 */
export function validFollowUp(b = {}, outcomes = [], today) {
  const problems = [];
  if (!METHODS.includes(b.method))
    problems.push("Pick how the customer was reached — " + METHODS.join(", "));
  if (!outcomes.includes(b.outcome))
    problems.push("Pick an outcome from the list");
  const t = String(today);
  if (b.ptpDate && String(b.ptpDate) < t)
    problems.push("A promise-to-pay date cannot be in the past");
  if (b.nextFollowUp && String(b.nextFollowUp) < t)
    problems.push("The next follow-up cannot be in the past");
  const narration = String(b.narration || "").trim() || null;
  return { ok: problems.length === 0, problems,
    method: b.method, outcome: b.outcome,
    ptpDate: b.ptpDate || null, nextFollowUp: b.nextFollowUp || null, narration };
}
