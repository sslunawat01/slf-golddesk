/**
 * SLF GoldDesk — MASTER SETTINGS RULES
 * Pure validation for the branch, charge and scheme masters. Rows in,
 * verdicts out — no database, same discipline as policy.js and vault.js.
 */

// ————————————————————————— charges —————————————————————————

/**
 * @param {{name:string, calc:'fixed'|'percent', amountRs?:number|null,
 *          pct?:number|null, minRs?:number|null, maxRs?:number|null,
 *          gstPct?:number}} c
 */
export function validCharge(c = {}) {
  const problems = [];
  if (!String(c.name || "").trim() || String(c.name).trim().length < 3)
    problems.push("Give the charge a name of at least 3 characters");
  if (!["fixed", "percent"].includes(c.calc))
    problems.push("Choose how the charge is calculated — fixed amount or percentage");
  if (c.calc === "fixed") {
    if (!(Number(c.amountRs) > 0)) problems.push("A fixed charge needs an amount above zero");
  }
  if (c.calc === "percent") {
    const p = Number(c.pct);
    if (!(p > 0)) problems.push("A percentage charge needs a rate above zero");
    else if (p > 100) problems.push("A charge cannot exceed 100%");
    const mn = c.minRs == null || c.minRs === "" ? null : Number(c.minRs);
    const mx = c.maxRs == null || c.maxRs === "" ? null : Number(c.maxRs);
    if (mn != null && mn < 0) problems.push("The minimum cannot be negative");
    if (mx != null && mx < 0) problems.push("The maximum cannot be negative");
    if (mn != null && mx != null && mx > 0 && mn > mx)
      problems.push("The minimum cannot exceed the maximum");
  }
  const g = Number(c.gstPct ?? 0);
  if (g < 0 || g > 100) problems.push("GST must be between 0 and 100%");
  return { ok: problems.length === 0, problems };
}

// ————————————————————————— branches —————————————————————————

/**
 * @param {{code:string, name:string, entityId:number,
 *          existingCodes:string[]}} b
 */
export function validBranch(b = {}) {
  const problems = [];
  const code = String(b.code || "").trim();
  if (!/^[0-9]{2,3}$/.test(code))
    problems.push("Branch code must be 2 or 3 digits — it is printed into every loan number");
  if ((b.existingCodes || []).includes(code))
    problems.push(`Branch code ${code} is already taken`);
  if (!String(b.name || "").trim() || String(b.name).trim().length < 3)
    problems.push("Give the branch a name of at least 3 characters");
  if (!Number(b.entityId)) problems.push("Choose which entity the branch belongs to");
  return { ok: problems.length === 0, problems };
}

// ————————————————————————— schemes —————————————————————————

/** The engine today prices these and nothing else. */
export const SUPPORTED_CALC = ["simple", "slab"];
/** The engine rounds to ₹10 (R-D); the scheme master must not promise otherwise. */
export const REQUIRED_ROUND_STEP_PAISE = 1000;

/**
 * Validate a draft scheme version before it can be saved or published.
 * Slab rows come as rupees/days from the form; conversion happens after.
 * @param {{code:string, name:string, calcMethod:string, interestPct?:number,
 *          slabMode?:string, slabs?:{fromDay:number,toDay:number,ratePct:number}[],
 *          daysInYear:number, minInterestDays:number, tenureDays:number,
 *          penalRatePct:number, penalGraceDays:number,
 *          fundingPct:number, minLoanRs:number, maxLoanRs:number,
 *          docChargePct:number, docMinRs:number, docMaxRs:number,
 *          effectiveFrom:string, isNewScheme:boolean, existingCodes:string[]}} s
 */
export function validSchemeVersion(s = {}) {
  const problems = [];
  const code = String(s.code || "").trim().toUpperCase();

  if (s.isNewScheme) {
    if (!/^[A-Z0-9-]{3,12}$/.test(code))
      problems.push("Scheme code must be 3–12 letters, digits or dashes");
    if ((s.existingCodes || []).includes(code))
      problems.push(`Scheme code ${code} already exists — open it and add a new version instead`);
    if (!String(s.name || "").trim()) problems.push("Give the scheme a one-line description");
  }

  if (!SUPPORTED_CALC.includes(s.calcMethod))
    problems.push("Only Simple and Slab-wise can be priced today — Compound and EMI need the engine extended first");

  if (s.calcMethod === "simple") {
    const p = Number(s.interestPct);
    if (!(p > 0)) problems.push("Simple interest needs a rate above zero");
    else if (p > 60) problems.push("An interest rate above 60% p.a. looks like a typing mistake");
  }

  if (s.calcMethod === "slab") {
    if (!["retroactive", "prospective"].includes(s.slabMode))
      problems.push("Choose the slab mode — retroactive or prospective");
    const slabs = [...(s.slabs || [])].sort((a, b) => a.fromDay - b.fromDay);
    if (slabs.length < 2) problems.push("A slab scheme needs at least two slabs");
    let prevTo = null;
    for (const sl of slabs) {
      if (!(Number(sl.ratePct) > 0)) { problems.push("Every slab needs a rate above zero"); break; }
      if (Number(sl.toDay) < Number(sl.fromDay)) { problems.push("A slab cannot end before it starts"); break; }
      if (prevTo != null && Number(sl.fromDay) !== prevTo + 1) {
        problems.push("Slabs must join up with no gaps or overlaps — each starts the day after the last ends");
        break;
      }
      prevTo = Number(sl.toDay);
    }
    if (slabs.length && ![0, 1].includes(Number(slabs[0].fromDay)))
      problems.push("The first slab must start at day 1");
    if (slabs.length && s.tenureDays && prevTo != null && prevTo < Number(s.tenureDays))
      problems.push(`The last slab ends at day ${prevTo} but the tenure is ${s.tenureDays} days — cover the whole tenure`);
  }

  // Owner amendment 13 Aug 2026: the day divisor is the owner's commercial
  // choice (360 / 365 / 366 ...), not the calendar's. Pinned per scheme version
  // as ever — running loans never move. Sane bounds only catch typos.
  const diy = Number(s.daysInYear);
  if (!Number.isInteger(diy) || diy < 300 || diy > 370)
    problems.push("Days in a year must be a whole number between 300 and 370 (e.g. 360, 365)");
  if (!(Number(s.minInterestDays) >= 0))
    problems.push("Minimum interest days is required — 0 means no minimum");
  if (!(Number(s.tenureDays) > 0)) problems.push("Tenure in days is required");
  if (Number(s.minInterestDays) > Number(s.tenureDays))
    problems.push("Minimum interest days cannot exceed the tenure");

  const pr = Number(s.penalRatePct ?? 0);
  if (pr < 0 || pr > 36) problems.push("Penal rate must be between 0 and 36% p.a.");
  if (Number(s.penalGraceDays ?? 0) < 0) problems.push("Grace days cannot be negative");

  const f = Number(s.fundingPct);
  if (!(f > 0 && f <= 100)) problems.push("Funding % must be above 0 and at most 100");
  else if (f > 90) problems.push("Funding above 90% leaves almost no cushion if gold falls — confirm this is intended");

  const mn = Number(s.minLoanRs ?? 0), mx = Number(s.maxLoanRs ?? 0);
  if (mn < 0 || mx < 0) problems.push("Loan limits cannot be negative");
  if (mn > 0 && mn % 100 !== 0) problems.push("Minimum loan must be a multiple of ₹100");
  if (mx > 0 && mx % 100 !== 0) problems.push("Maximum loan must be a multiple of ₹100");
  if (mn > 0 && mx > 0 && mn > mx) problems.push("Minimum loan cannot exceed the maximum");

  if (Number(s.docChargePct ?? 0) < 0 || Number(s.docChargePct ?? 0) > 5)
    problems.push("Documentation charge must be between 0 and 5%");
  if (Number(s.docMinRs ?? 0) < 0 || Number(s.docMaxRs ?? 0) < 0)
    problems.push("Documentation floor and cap cannot be negative");
  if (Number(s.docMinRs ?? 0) > 0 && Number(s.docMaxRs ?? 0) > 0 &&
      Number(s.docMinRs) > Number(s.docMaxRs))
    problems.push("The documentation floor cannot exceed its cap");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.effectiveFrom || "")))
    problems.push("Give the scheme start date");

  // A warning that must be surfaced but does not block — the caller separates
  // problems containing "confirm" if it wants soft warnings; kept simple here.
  return { ok: problems.length === 0, problems };
}

/** Sample interest on ₹1,00,000 for a slab band, for the review table. */
export function slabSample({ fromDay, toDay, ratePct }, daysInYear = 365) {
  const days = toDay - Math.max(1, fromDay) + 1;
  const raw = (100000 * ratePct * days) / (100 * daysInYear);
  return Math.round(raw);
}
