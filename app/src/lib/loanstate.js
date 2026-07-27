/**
 * SLF GoldDesk — LOAN STATE BRIDGE
 *
 * The engine (src/lib/engine.js) is a pure fold over events. The database
 * stores those events — receipts and charges — and never stores the running
 * position, because a stored running total drifts silently and a replayed one
 * cannot. `loan_accrual_cache` is a cache and is always rebuildable from here.
 *
 * This file does exactly two things:
 *   1 · turn a scheme_version row (+ its slabs) into the engine's scheme shape
 *   2 · replay a loan's immutable history into the engine's live state
 *
 * Pure functions — rows come in as arguments, nothing here touches the database.
 */

import { openLoan, addCharge, applyPayment, validateScheme } from "./engine.js";

/** Stamped on every receipt so a future engine change stays traceable. */
export const ENGINE_VERSION = "1.0.0";

/** The engine rounds to ₹10. A scheme that says otherwise must not be guessed at. */
const ROUND_STEP_PAISE = 1000;

/**
 * scheme_version row + scheme_slab rows → the engine's Scheme.
 * @param {object} sv   a scheme_version row (snake_case, as it comes from pg)
 * @param {object[]} slabs  scheme_slab rows, any order
 * @param {string} code the scheme code, for the working line
 */
export function schemeFromRow(sv, slabs = [], code = "") {
  if (!sv) throw new Error("no scheme version on this loan");
  if (Number(sv.round_step_paise) !== ROUND_STEP_PAISE)
    throw new Error(
      `scheme rounds to ${sv.round_step_paise} paise but the engine rounds to ₹10 — ` +
      `this scheme cannot be used until the engine is extended`);

  const scheme = {
    code,
    daysInYear: Number(sv.days_in_year),
    calcMethod: sv.calc_method,
    minInterestDays: Number(sv.min_interest_days),
    tenureDays: Number(sv.tenure_days),
    penalRatePct: Number(sv.penal_rate_pct || 0),
    penalGraceDays: Number(sv.penal_grace_days || 0),
  };

  if (sv.calc_method === "simple") {
    scheme.interestPctAnnual = Number(sv.interest_pct);
  } else {
    scheme.slabMode = sv.slab_mode || "retroactive";
    scheme.slabs = [...slabs]
      .sort((a, b) => Number(a.from_day) - Number(b.from_day))
      .map(s => ({ fromDay: Number(s.from_day), toDay: Number(s.to_day),
                   ratePct: Number(s.rate_pct) }));
    // The engine's slab ranges are contiguous from day 0; a scheme master that
    // writes its first slab as "day 1 to 62" means the same thing, since a loan
    // of zero days accrues nothing either way. Only the first boundary is moved,
    // and only when it is exactly 1 — a real gap still fails validation below.
    if (scheme.slabs.length && scheme.slabs[0].fromDay === 1) scheme.slabs[0].fromDay = 0;
  }
  validateScheme(scheme);
  return scheme;
}

/**
 * Build the timeline the engine folds over. Charges and receipts are merged by
 * date; a charge added on the same day as a payment is due on that payment,
 * so charges sort first within a day.
 */
export function buildEvents(charges = [], receipts = []) {
  const evs = [];
  for (const c of charges)
    evs.push({ at: String(c.added_on), seq: 0, type: "charge",
      id: String(c.id), amount: Number(c.total_paise) / 100 });
  for (const r of receipts)
    evs.push({ at: String(r.business_date), seq: 1, type: "payment",
      date: String(r.business_date), amount: Number(r.amount_paise) / 100,
      closing: !!r.closes_loan });
  evs.sort((a, b) => a.at === b.at ? a.seq - b.seq : (a.at < b.at ? -1 : 1));
  return evs;
}

/**
 * Replay a loan into its current engine state.
 *
 * `charges` are loan_charge rows still live (removed_at IS NULL), each carrying
 * `added_on` as a date string. `receipts` are receipt rows in any order.
 *
 * The engine's charge id is the loan_charge id, so an appropriation written
 * afterwards can point at the exact charge row it settled.
 */
export function replayLoan({ principalPaise, disbursedAt, scheme, charges = [], receipts = [] }) {
  const state = openLoan({ principal: Number(principalPaise) / 100, disbursedAt: String(disbursedAt) });
  for (const ev of buildEvents(charges, receipts)) {
    if (ev.type === "charge") addCharge(state, { id: ev.id, amount: ev.amount });
    else applyPayment(scheme, state, { date: ev.date, amount: ev.amount, closing: ev.closing });
  }
  return state;
}

/** Snapshot of what each charge has been paid, for diffing after a payment. */
export function chargeSnapshot(state) {
  const m = {};
  for (const c of state.charges) m[c.id] = c.paidExact;
  return m;
}

/**
 * The receipt_appropriation rows a payment produces.
 * Buckets match the approp_bucket enum: charge · charge_rounding · penal ·
 * interest · principal. Zero amounts are dropped — a receipt should not carry
 * rows that say nothing happened.
 */
export function appropriationRows(before, state, receipt) {
  const rows = [];
  for (const c of state.charges) {
    // paidExact carries the rounded-up money; only the part that settles the
    // charge's true amount belongs to the charge. The rest is rounding income,
    // booked once in its own bucket below.
    const wasPaid = before[c.id] ?? 0;
    const paid = Math.min(c.paidExact, c.amountExact) - Math.min(wasPaid, c.amountExact);
    if (paid > 0) rows.push({ bucket: "charge", loanChargeId: Number(c.id), amountPaise: paid });
  }
  const p = receipt.appropriation;
  const add = (bucket, rupees) => {
    const paise = Math.round(Number(rupees || 0) * 100);
    if (paise > 0) rows.push({ bucket, loanChargeId: null, amountPaise: paise });
  };
  add("charge_rounding", p.roundingIncome);
  add("penal", p.penal);
  add("interest", p.interest);
  add("principal", p.principal);
  return rows;
}

/** Cash from one customer, one day, is capped at ₹2,00,000 (Sec 269ST). */
export const CASH_DAY_CAP_PAISE = 20000000;

export function cashCapCheck({ alreadyTodayPaise = 0, amountPaise = 0 }) {
  const total = Number(alreadyTodayPaise) + Number(amountPaise);
  if (total > CASH_DAY_CAP_PAISE)
    return { ok: false,
      reason: "Cash from one customer is capped at ₹2,00,000 in a day (Sec 269ST) — " +
              "take the balance by UPI or bank transfer" };
  return { ok: true };
}

/** A non-cash receipt without a reference cannot be traced. The database refuses it too. */
export function utrCheck(mode, utr) {
  if (mode === "cash") return { ok: true };
  if (!String(utr || "").trim())
    return { ok: false, reason: "Enter the UTR or reference for this payment" };
  return { ok: true };
}
