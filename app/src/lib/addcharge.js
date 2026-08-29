/**
 * SLF GoldDesk — ADD-CHARGE RULES
 *
 * The charges master (charge_type) defines each charge; the counter applies
 * them to a loan. Frozen-UX rules, locked 28 Jul 2026:
 *  · a computed default may be INCREASED, never reduced
 *  · "manual" charges (no amount and no pct in the master) are at actuals —
 *    an amount must be typed
 *  · one narration of at least 5 characters covers the batch
 *    (loan_charge has the same CHECK, so the database agrees)
 * Pure functions — master rows in, verdicts out.
 */

export const MIN_NARRATION = 5;

/**
 * The default total for a charge type on a given loan, in paise.
 * Fixed: amount + GST. Percent: pct of principal, clamped to floor/cap, + GST.
 * Manual (neither amount nor pct): null — the operator must type the amount.
 */
export function chargeDefault(ct, principalPaise) {
  // charge_calc enum: flat | pct_of_sanction | at_actuals (E14 №1 — the code
  // previously said "fixed"/"percent", which the database has never known,
  // so every master charge fell through to manual entry)
  const gstPct = Number(ct.gst_pct || 0);
  let base = null;
  if (ct.calc === "flat" && ct.amount_paise != null) {
    base = Number(ct.amount_paise);
  } else if (ct.calc === "pct_of_sanction" && ct.pct != null) {
    base = Math.round(Number(principalPaise) * Number(ct.pct) / 100);
    if (ct.min_paise != null) base = Math.max(base, Number(ct.min_paise));
    if (ct.max_paise != null && Number(ct.max_paise) > 0) base = Math.min(base, Number(ct.max_paise));
  }
  if (base == null) return { manual: true, basePaise: null, gstPaise: null, totalPaise: null };
  const gst = Math.round(base * gstPct / 100);
  return { manual: false, basePaise: base, gstPaise: gst, totalPaise: base + gst };
}

/**
 * Split an entered TOTAL back into base + GST at the master's rate, so the
 * ledger's GST figure stays honest when the operator increases a default.
 */
export function splitTotal(totalPaise, gstPct) {
  const g = Number(gstPct || 0);
  const base = Math.round(Number(totalPaise) / (1 + g / 100));
  return { basePaise: base, gstPaise: Number(totalPaise) - base };
}

/**
 * Validate one picked charge.
 * @param {{enteredPaise:number, defaultTotalPaise:number|null, manual:boolean}} c
 */
export function validPickedCharge(c = {}) {
  const problems = [];
  const amt = Number(c.enteredPaise || 0);
  if (c.manual) {
    if (!(amt > 0)) problems.push("This charge is at actuals — enter the billed amount");
  } else {
    if (!(amt > 0)) problems.push("Enter the amount");
    else if (amt < Number(c.defaultTotalPaise))
      problems.push("Below the master default — a default may be increased, never reduced");
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Validate the whole batch before saving.
 * @param {{picks:{enteredPaise:number, defaultTotalPaise:number|null, manual:boolean}[],
 *          narration:string, loanStatus:string}} b
 */
export function validChargeBatch(b = {}) {
  const problems = [];
  if (b.loanStatus !== "active")
    problems.push(`This loan is ${b.loanStatus} — charges can only be added to a running loan`);
  if (!(b.picks || []).length) problems.push("Tick at least one charge");
  for (const p of b.picks || []) {
    const v = validPickedCharge(p);
    if (!v.ok) { problems.push(v.problems[0]); break; }
  }
  if (String(b.narration || "").trim().length < MIN_NARRATION)
    problems.push(`Write a narration of at least ${MIN_NARRATION} characters — it appears on the customer's repayment screen`);
  return { ok: problems.length === 0, problems };
}
