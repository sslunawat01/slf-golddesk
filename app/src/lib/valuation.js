/**
 * SLF GoldDesk — VALUATION
 * Pure arithmetic for what a pledge is worth and what may be lent on it.
 * Money = integer paise · weight = integer milligrams. No floats survive here.
 *
 * Rules (owner-locked):
 *  R1  rate/gram = published 24K rate × purity%           (× funding% = lendable/gram)
 *  R16 market value and funding value are shown SEPARATELY and each rounds UP
 *      to the next ₹100; the loan principal must be a multiple of ₹100
 *  R17 a second, different valuer is compulsory above the configured threshold
 *  R9  above MIN(person, role) sanction ceiling ⇒ routes to Head Office
 */

/** Round paise UP to the next ₹100 (R16). */
export const roundUp100 = (paise) => Math.ceil(paise / 10000) * 10000;

/** Exact rate per gram in paise for a purity (may carry fractional paise). */
export function ratePerGram(base24kPaise, purityPct) {
  return (base24kPaise * purityPct) / 100;
}

/** Lendable rate per gram under a scheme's funding percentage. */
export function fundingRatePerGram(base24kPaise, purityPct, fundingPct) {
  return (ratePerGram(base24kPaise, purityPct) * fundingPct) / 100;
}

/**
 * One ornament row.
 * Market and funding are each computed from the exact figure and rounded up
 * independently, so both numbers shown to the customer are honest on their own.
 */
export function ornamentValue({ grossMg, stoneMg = 0, purityPct, base24kPaise, fundingPct }) {
  const netMg = Math.max(0, Math.round(grossMg) - Math.round(stoneMg));
  const rawMarket = (netMg * base24kPaise * purityPct) / (100 * 1000);
  const rawFunding = (rawMarket * fundingPct) / 100;
  return {
    netMg,
    rawMarketPaise: rawMarket,
    marketPaise: roundUp100(rawMarket),
    rawFundingPaise: rawFunding,
    fundingPaise: roundUp100(rawFunding),
  };
}

/** Grid totals — the in-grid totals row on the appraisal step. */
export function appraisalTotals(rows) {
  const t = { items: rows.length, qty: 0, grossMg: 0, stoneMg: 0, netMg: 0, marketPaise: 0, fundingPaise: 0 };
  for (const r of rows) {
    t.qty += Number(r.qty || 0);
    t.grossMg += Number(r.grossMg || 0);
    t.stoneMg += Number(r.stoneMg || 0);
    t.netMg += Number(r.netMg || 0);
    t.marketPaise += Number(r.marketPaise || 0);
    t.fundingPaise += Number(r.fundingPaise || 0);
  }
  return t;
}

/** R16 — the principal a branch may actually key in. */
/** Indian digit grouping — every rupee figure the customer reads uses this. */
export const inr = (paise) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");

export function validPrincipal(paise, { maxFundingPaise, minLoanPaise = 0, maxLoanPaise = Infinity }) {
  if (!(paise > 0)) return { ok: false, reason: "enter the loan amount" };
  if (paise % 10000 !== 0)
    return { ok: false, reason: `must be a multiple of ₹100 — nearest ${inr(Math.ceil(paise / 10000) * 10000)}` };
  if (paise > maxFundingPaise)
    return { ok: false, reason: `above the funding value of ${inr(maxFundingPaise)}` };
  if (minLoanPaise && paise < minLoanPaise)
    return { ok: false, reason: `below this scheme's minimum of ${inr(minLoanPaise)}` };
  if (maxLoanPaise && paise > maxLoanPaise)
    return { ok: false, reason: `above this scheme's maximum of ${inr(maxLoanPaise)}` };
  return { ok: true };
}

/** R17 — second valuer compulsory above the threshold, and never the same person. */
export function valuerRule(amountPaise, thresholdPaise, valuer1Id, valuer2Id) {
  if (!valuer1Id) return { ok: false, reason: "valuer 1 is required" };
  if (amountPaise > thresholdPaise) {
    if (!valuer2Id)
      return { ok: false, required: true,
        reason: `a second valuer is compulsory above ${inr(thresholdPaise)}` };
    if (Number(valuer2Id) === Number(valuer1Id))
      return { ok: false, required: true, reason: "valuer 2 must be a different person" };
  } else if (valuer2Id && Number(valuer2Id) === Number(valuer1Id)) {
    return { ok: false, reason: "valuer 2 must be a different person" };
  }
  return { ok: true, required: amountPaise > thresholdPaise };
}

/** R11 — cash below ₹20,000 (269SS); the remainder must go to a bank account. */
export const CASH_CAP_PAISE = 2000000;
export function disbursementPlan({ principalPaise, chargesPaise = 0, cashPaise = 0, bankLegs = [] }) {
  const payable = principalPaise - chargesPaise;
  const bankTotal = bankLegs.reduce((s, l) => s + Number(l.amountPaise || 0), 0);
  const allocated = cashPaise + bankTotal;
  const problems = [];
  if (cashPaise >= CASH_CAP_PAISE)
    problems.push("cash must be under ₹20,000 (Sec 269SS) — send the balance to a bank account");
  if (cashPaise < 0 || bankLegs.some(l => Number(l.amountPaise) <= 0))
    problems.push("every leg needs a positive amount");
  if (bankLegs.some(l => !l.verified))
    problems.push("an unverified bank account cannot receive money");
  if (allocated !== payable)
    problems.push(allocated < payable
      ? `${inr(payable - allocated)} still unallocated`
      : `${inr(allocated - payable)} over-allocated`);
  return { payablePaise: payable, allocatedPaise: allocated, ok: problems.length === 0, problems };
}

/** Scheme document charge: percentage of sanction, floored and capped. */
export function docCharge({ principalPaise, pct = 0, minPaise = 0, maxPaise = 0, gstPct = 0 }) {
  let base = Math.round((principalPaise * pct) / 100);
  if (minPaise && base < minPaise) base = minPaise;
  if (maxPaise && base > maxPaise) base = maxPaise;
  const gst = Math.round((base * gstPct) / 100);
  return { basePaise: base, gstPaise: gst, totalPaise: base + gst };
}
