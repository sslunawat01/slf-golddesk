/**
 * SLF GoldDesk — DAY BEGIN / DAY END RULES
 *
 * Owner decisions, 28 Jul 2026:
 *  · Day-begin is a RECORD, not a lock — the counter works regardless
 *  · A day-end variance signs off with a mandatory reason; it never blocks
 *    (the database agrees: day_cycle_check requires variance 0 OR reason ≥5)
 *  · No drawer cap — there is no excess-cash check (closes O12)
 *
 * Expected closing cash = opening + today's cash receipts − today's cash
 * disbursement legs. All three come from append-only tables; nothing here is
 * stored except the sign-off itself.
 */

export const NOTES = [500, 200, 100, 50, 20, 10];
export const MIN_REASON = 5;

/** Denomination counts → paise. Counts arrive as strings from inputs. */
export function denomTotalPaise(counts = {}) {
  let p = 0;
  for (const n of NOTES) p += (Number(counts[n]) || 0) * n * 100;
  return p;
}

/**
 * Expected closing cash for the day, in paise.
 * Opening comes from the signed day-begin count if there is one, else from
 * yesterday's signed closing count, else zero (a branch's very first day).
 */
export function expectedClosingPaise({ openingPaise = 0, cashReceiptsPaise = 0,
  cashDisbursedPaise = 0 }) {
  return Number(openingPaise) + Number(cashReceiptsPaise) - Number(cashDisbursedPaise);
}

/**
 * May day-begin be signed?
 * The four checks mirror the frozen UX: rate in force · seal stock ·
 * queues reviewed · yesterday's report seen.
 */
export function dayBeginReady({ checks = {}, countedPaise = null, carriedPaise = 0,
  reason = "", alreadySigned = false }) {
  const problems = [];
  if (alreadySigned) problems.push("Day-begin is already signed for today");
  for (const k of ["rate", "seal", "queues", "report"])
    if (!checks[k]) { problems.push("Tick all four opening checks"); break; }
  if (countedPaise == null || countedPaise < 0)
    problems.push("Count the opening cash");
  const diff = (countedPaise ?? 0) - Number(carriedPaise || 0);
  if (diff !== 0 && String(reason || "").trim().length < MIN_REASON)
    problems.push("The count differs from the carried-forward figure — a reason is mandatory");
  return { ok: problems.length === 0, problems, diffPaise: diff };
}

/**
 * May day-end be signed?
 * Variance never blocks; it demands a reason. (Owner decision + DB CHECK.)
 */
export function dayEndReady({ countedPaise = null, expectedPaise = 0, reason = "",
  alreadySigned = false, beginSigned = true }) {
  const problems = [];
  if (alreadySigned) problems.push("Day-end is already signed for today");
  if (!beginSigned) problems.push("Sign day-begin first — the day has no recorded opening");
  if (countedPaise == null || countedPaise < 0)
    problems.push("Count the drawer with the denomination table");
  const variance = (countedPaise ?? 0) - Number(expectedPaise || 0);
  if (variance !== 0 && String(reason || "").trim().length < MIN_REASON)
    problems.push("Counted cash differs from the system figure — a reason is mandatory");
  return { ok: problems.length === 0, problems, variancePaise: variance };
}
