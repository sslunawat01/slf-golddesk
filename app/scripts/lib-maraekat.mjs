/**
 * Maraekat → GoldDesk import: the PURE planning half (no database).
 *
 * Takes the anonymised export (see import-maraekat.mjs) plus the scheme each
 * loan will run on, and decides — loan by loan — exactly what GoldDesk will
 * store. Every receipt is replayed through the SAME engine the counter uses
 * (src/lib/engine.js via loanstate.js), so whatever is stored replays cleanly
 * on every screen afterwards. Anything that had to be adjusted is returned as
 * a note for the comparison report; nothing is silently changed.
 *
 * Rules (owner, 15 Oct 2026 — "Full replay", "ReEntry = renewal"):
 *  · Principal must be a multiple of ₹100 (R-J): rounded DOWN, the largest
 *    payout leg absorbs the difference.
 *  · The LAST receipt of a loan Maraekat shows as closed becomes GoldDesk's
 *    exact closing settlement on that date (its interest may differ from
 *    Maraekat's — the difference is reported).
 *  · A receipt under ₹100 (R-J minimum) is carried into the same loan's next
 *    receipt; a receipt not in ₹10 steps is rounded down to ₹10 and the
 *    remainder carried. Carry left at the end is reported as dropped.
 *  · A receipt that would pay GoldDesk's whole settlement before Maraekat
 *    closed the loan closes it here at the exact settlement; later receipts
 *    of that loan are skipped. All of this is reported.
 *  · "Conso. Charges" on a receipt become a Misc charge raised that day, so
 *    the engine settles it first (R-G), exactly as at the counter.
 *  · A loan whose closing receipt came through "ReEntry Bank" was closed by a
 *    re-pledge: status closed_by_renewal, linked 1:1 to a new loan of the same
 *    customer and day that was funded by ReEntry (closest amounts first).
 */
import { dues, applyPayment, openLoan, addCharge } from "../src/lib/engine.js";
import { chargeSnapshot, appropriationRows } from "./../src/lib/loanstate.js";
import { ornamentValue } from "../src/lib/valuation.js";

/** 24K rate per gram (paise), monthly — an approximation for TEST data only:
 *  Indian market levels Oct 2024 → Oct 2025, then held at GoldDesk's own
 *  published rate (₹12,300) so imported loans value consistently today. */
export const RATE_24K = {
  "2024-10": 785000, "2024-11": 775000, "2024-12": 778000, "2025-01": 800000,
  "2025-02": 860000, "2025-03": 885000, "2025-04": 950000, "2025-05": 955000,
  "2025-06": 990000, "2025-07": 995000, "2025-08": 1020000, "2025-09": 1100000,
};
export const RATE_HOLD = 1230000;
export const rateOn = (iso) => RATE_24K[iso.slice(0, 7)] ?? RATE_HOLD;

/**
 * Schemes inferred from the export, for any code the owner has NOT created.
 * Maraekat prices on a 360-day year: its 18% loans come out at 18.3% when
 * measured over 365 days (20% → 20.3%, 24% → 24.3%), constant across ages.
 * Slab boundaries from the median implied rate by loan age (single-receipt
 * closures ≥ ₹5,000). Penal 0 — Maraekat's export shows none.
 */
const S = (fromDay, toDay, ratePct) => ({ from_day: fromDay, to_day: toDay, rate_pct: ratePct });
const FAR = 3650;
export const INFERRED = {
  VIN12:      { simple: 18, fund: 75 },
  GL2070:     { simple: 20, fund: 70 }, GL2075: { simple: 20, fund: 75 },
  GL2080:     { simple: 20, fund: 80 }, GL2085: { simple: 20, fund: 85 },
  GL2090:     { simple: 20, fund: 90 }, GL2470: { simple: 24, fund: 70 },
  IND12:      { slabs: [S(0, 180, 18), S(181, FAR, 24)] },
  IND04:      { slabs: [S(0, 90, 18), S(91, 210, 24), S(211, 365, 31), S(366, FAR, 34)] },
  IND95:      { slabs: [S(0, 60, 18), S(61, 210, 24), S(211, FAR, 31)] },
  IND03:      { slabs: [S(0, 120, 18), S(121, 210, 24), S(211, FAR, 31)] },
  IND90:      { slabs: [S(0, 30, 18), S(31, 210, 24), S(211, FAR, 31)] },
  IND01:      { slabs: [S(0, 210, 18), S(211, FAR, 24)] },
  IND02:      { slabs: [S(0, 120, 18), S(121, 365, 24), S(366, FAR, 32)] },
  "SB-IND01": { slabs: [S(0, 210, 18), S(211, FAR, 24)] },
  "SB-IND02": { slabs: [S(0, 120, 18), S(121, 365, 24), S(366, FAR, 32)] },
  "SB-IND04": { slabs: [S(0, 62, 15), S(63, 123, 18), S(124, FAR, 24)] },
  "SB-IND06": { simple: 18 },
  "SB-IND95": { slabs: [S(0, 60, 18), S(61, 210, 24), S(211, FAR, 31)] },
};
export const INFERRED_COMMON = { days_in_year: 360, min_interest_days: 15, tenure_days: 365,
  penal_rate_pct: 0, penal_grace_days: 0, round_step_paise: 1000, slab_mode: "retroactive" };

/** Maraekat paymode → GoldDesk pay_mode. */
export function payMode(pm) {
  const m = String(pm || "").trim().toUpperCase();
  if (m === "CASH") return "cash";
  if (m.endsWith("UPI")) return "upi";
  return "bank";                                   // NET BANKING, PG card, PG netbanking
}
/** Maraekat bank name → the SLF account key the importer creates. */
export function accountKey(bank) {
  const b = String(bank || "").toLowerCase();
  if (b === "cash" || b === "") return null;
  if (b.includes("reentry")) return "ReEntry Bank";
  if (b.includes("bandhan")) return "Bandhan Bank";
  if (b.includes("payment gateway")) return "Payment Gateway";
  if (b.includes("b3 hdfc")) return "B3 HDFC";
  return bank;                                     // unknown → its own account, reported
}

/** Ornament weight back-computed from what Maraekat said could be lent. */
export function backComputeItem({ lendablePaise, base24kPaise, fundingPct, purityPct = 92 }) {
  if (!(lendablePaise > 0)) return null;
  const netMg = Math.ceil((lendablePaise * 100 * 1000 * 100) / (base24kPaise * purityPct * fundingPct));
  const v = ornamentValue({ grossMg: netMg, stoneMg: 0, purityPct, base24kPaise,
    funding24kPaise: base24kPaise, fundingPct });
  const itemKey = netMg < 8000 ? "ring" : netMg <= 20000 ? "chain" : "bangle";
  return { netMg, grossMg: netMg, marketPaise: v.marketPaise, fundingPaise: v.fundingPaise, itemKey };
}

/** R-J: principal to ₹100; the largest leg absorbs the difference. */
export function fixPrincipal(amountPaise, legs) {
  const principal = Math.floor(amountPaise / 10000) * 10000;
  const diff = amountPaise - principal;
  const out = legs.map(l => ({ ...l }));
  if (diff && out.length) {
    const big = out.reduce((a, b) => (b.paise > a.paise ? b : a));
    big.paise -= diff;
  }
  return { principal, diff, legs: out.filter(l => l.paise > 0) };
}

/**
 * Plan one loan. `scheme` is the engine scheme (schemeFromRow), `receipts`
 * this loan's Maraekat receipts. Returns the GoldDesk receipts to store, the
 * charges to raise, the final engine state and notes.
 */
export function planLoan({ loan, scheme, receipts }) {
  const notes = [];
  const fx = fixPrincipal(loan.amountPaise, loan.legs);
  if (fx.diff) notes.push({ kind: "principal_rounded", detail: `₹${fx.diff / 100} off the principal (R-J ₹100 steps)` });
  const state = openLoan({ principal: fx.principal / 100, disbursedAt: loan.date });

  const rs = [...receipts].sort((a, b) => a.date === b.date ? (a.no < b.no ? -1 : 1) : (a.date < b.date ? -1 : 1));
  const lastIdx = loan.status === "Close" ? rs.length - 1 : -1;
  const charges = [], stored = [], charged = new Set();
  let carry = 0, carryFrom = [];

  rs.forEach((rc, i) => {
    if (state.closed) {
      const closer = stored.find(r => r.closes);
      notes.push(closer && closer.date === rc.date
        ? { kind: "receipt_merged_into_closing", receipt: rc.no,
            detail: `₹${rc.paise / 100} paid the same day — part of closing receipt ${closer.no}` }
        : { kind: "receipt_skipped_after_close", receipt: rc.no,
            detail: `₹${rc.paise / 100} on ${rc.date} — the loan was already settled in GoldDesk` });
      return;
    }
    // Charges of a day are raised BEFORE that day's first receipt — exactly
    // how the screens replay them (loanstate.buildEvents: charges sort first
    // within a day), so the stored split and the replayed split agree.
    if (!charged.has(rc.date)) {
      charged.add(rc.date);
      for (const r of rs) if (r.date === rc.date && r.chargesPaise > 0) {
        const idx = charges.length;
        charges.push({ idx, date: r.date, paise: r.chargesPaise, receipt: r.no });
        addCharge(state, { id: String(idx), amount: r.chargesPaise / 100 });
      }
    }
    const closing = i === lastIdx;
    // Maraekat often closes with several receipts on the closing day; only the
    // last becomes the settlement remainder, the others stay as they were.
    const onClosingDay = lastIdx >= 0 && rs[lastIdx].date === rc.date;
    // Two settlement figures: what a running loan owes today, and what it
    // owes if closed today (closure rules — grace forgiveness, R-E/R-I).
    const settleOpen = dues(scheme, state, rc.date)._paise.settlement;
    const settleClose = dues(scheme, state, rc.date, { closing: true })._paise.settlement;
    let want = rc.paise + carry, amt, closes = false;

    if (closing || (want >= settleClose && onClosingDay)) {
      amt = settleClose; closes = true;
      const mkDay = rs.filter(r => r.date === rc.date).reduce((t, r) => t + r.paise, 0);
      const gdDay = stored.filter(r => r.date === rc.date).reduce((t, r) => t + r.paise, 0) + amt;
      if (mkDay !== gdDay) notes.push({ kind: "closing_amount_differs", receipt: rc.no,
        detail: `closing day ${rc.date}: Maraekat took ₹${mkDay / 100}, GoldDesk settlement ₹${gdDay / 100}`,
        maraekatPaise: mkDay, golddeskPaise: gdDay });
    } else if (want >= settleOpen || want >= settleClose) {
      amt = settleClose; closes = true;
      notes.push({ kind: "closed_early", receipt: rc.no,
        detail: `₹${want / 100} on ${rc.date} pays GoldDesk's whole settlement ₹${settleClose / 100}; Maraekat kept the loan open` });
    } else if (want < 10000) {
      carry = want; carryFrom.push(rc.no);
      notes.push({ kind: "receipt_carried", receipt: rc.no,
        detail: `₹${want / 100} is below the ₹100 minimum — added to this loan's next receipt` });
      return;
    } else {
      amt = Math.floor(want / 1000) * 1000;
      if (amt !== want) notes.push({ kind: "receipt_rounded", receipt: rc.no,
        detail: `₹${want / 100} → ₹${amt / 100} (₹10 steps); ₹${(want - amt) / 100} carried to the next receipt` });
    }
    carry = want - amt;
    if (carry < 0) carry = 0;                       // a settlement cap never creates a negative carry
    const before = chargeSnapshot(state);
    const { receipt } = applyPayment(scheme, state, { date: rc.date, amount: amt / 100, closing: closes });
    stored.push({ no: rc.no, date: rc.date, paise: amt, maraekatPaise: rc.paise,
      mode: payMode(rc.paymode), account: payMode(rc.paymode) === "cash" ? null : accountKey(rc.bank),
      reEntry: accountKey(rc.bank) === "ReEntry Bank",
      isExact: closes, closes: !!receipt.closing, sealsCycle: !!receipt.sealsCycle,
      merged: carryFrom.length ? carryFrom.slice() : null,
      rows: appropriationRows(before, state, receipt) });
    carryFrom = [];
    if (carry && !closing) carryFrom.push(rc.no);
  });
  if (carry > 0 && !state.closed)
    notes.push({ kind: "carry_dropped", detail: `₹${carry / 100} from ${carryFrom.join(", ")} had no later receipt to join` });
  if (loan.status === "Close" && !state.closed)
    notes.push({ kind: "not_closed", detail: "Maraekat shows this loan closed but GoldDesk could not close it" });

  const closingRc = stored.find(r => r.closes) || null;
  return { principal: fx.principal, legs: fx.legs, state, charges, receipts: stored, notes,
    closedOn: closingRc?.date ?? null, closedByReEntry: !!closingRc?.reEntry };
}

/**
 * ReEntry pairing: an old loan closed through ReEntry on day D is renewed into
 * a new loan of the same customer disbursed on D with a ReEntry payout leg.
 * renewal is 1:1 both ways (unique old & new), so pairs go closest-amount first.
 */
export function pairRenewals(olds, news) {
  // olds: [{loanNo, cust, date, paise}]  news: [{loanNo, cust, date, paise}]
  const key = (x) => `${x.cust}|${x.date}`;
  const pool = new Map();
  for (const n of news) (pool.get(key(n)) ?? pool.set(key(n), []).get(key(n))).push(n);
  const cands = [];
  for (const o of olds) for (const n of pool.get(key(o)) || [])
    cands.push({ o, n, gap: Math.abs(o.paise - n.paise) });
  cands.sort((a, b) => a.gap - b.gap || (a.o.loanNo < b.o.loanNo ? -1 : 1));
  const usedO = new Set(), usedN = new Set(), pairs = [];
  for (const c of cands) {
    if (usedO.has(c.o.loanNo) || usedN.has(c.n.loanNo)) continue;
    usedO.add(c.o.loanNo); usedN.add(c.n.loanNo);
    pairs.push({ oldLoanNo: c.o.loanNo, newLoanNo: c.n.loanNo });
  }
  return pairs;
}
