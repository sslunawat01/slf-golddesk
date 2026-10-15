/**
 * SLF GoldDesk — Interest Engine
 * ==============================
 * Pure calculation core. No dependencies, no I/O, no dates-from-the-clock:
 * everything the engine knows arrives as arguments; everything it decides
 * returns as plain data. This file is the single place interest, penal,
 * charges-rounding, minimum-interest and appropriation are computed.
 *
 * THE CONSTITUTION (locked with the owner, Jul 2026)
 *  R-A  Divisor = scheme.daysInYear (365 today). Never the calendar.
 *  R-B  Slab interest is RETROACTIVE within a cycle: the slab reached by the
 *       cycle's age prices ALL its days. (Prospective also supported as config.)
 *  R-C  Cycles are anchored by interest payments: a payment that clears ALL
 *       interest due seals the period and restarts the slab clock from day 1.
 *       Partial payments reduce dues but never move the anchor.
 *  R-D  Round-up to the next ₹10 is universal. Interest and penal round once
 *       on their own total. CHARGES ROUND INDIVIDUALLY — each charge rounds up
 *       to ₹10 on its own (amended 27 Jul 2026 by the owner; previously the
 *       charges total rounded once). Raw 2-dp is kept underneath, and the
 *       difference between what is billed and what is owed is Rounding income.
 *  R-E  Minimum interest (scheme.minInterestDays, 15 today) is a LIFETIME floor
 *       applied at EVERY payment, not only at closure (amended 27 Jul 2026 by
 *       the owner; the earlier closure-only reading was wrong). A loan's first
 *       interest payment is topped up to the minimum-days amount if it falls
 *       short. Because the floor is on LIFETIME interest, it can bind only once
 *       per loan — after it is satisfied it never binds again.
 *       Paying the floor buys DAYS, not a reset: when the top-up applies, the
 *       cycle anchor moves to disbursement + minInterestDays, so the customer
 *       is never charged twice for the same day.
 *  R-F  Settlement = principal + interest(rounded) + penal(rounded)
 *       + charges(rounded). No second rounding of the total.
 *  R-G  Appropriation order: charges → penal → interest → principal.
 *  R-H  Capitalization only at renewal, by human choice (outside this file —
 *       a renewal simply starts a new loan whose principal may include it).
 *  R-I  Penal = scheme.penalRatePct p.a. on OVERDUE PRINCIPAL. Grace forgives
 *       ENTIRELY if the loan is closed within tenure+grace; otherwise penal
 *       runs from tenure end itself. Rate and grace are scheme fields.
 *       AMENDED 15 Oct 2026 (owner): the penal clock is the INTEREST-UNPAID
 *       period, not the loan's age. It starts at disbursement and restarts
 *       the day after ANY payment that reaches interest (a part payment
 *       counts). Penal is charged only once that period exceeds
 *       tenure+grace, and then from day tenure+1 of the period (the grace
 *       days are charged, not skipped). Receipts taken under engine 1.1.x
 *       were priced on the loan's age; they replay under that older rule
 *       (penalRule "loan_age") so stored appropriations reproduce exactly.
 *  R-J  Principal is a multiple of ₹100. Payments: min ₹100 in ₹10 steps —
 *       the exact settlement figure is always accepted (safety net; with R-D
 *       on charges every settlement already lands on ₹10).
 *  R-L  BOTH END DAYS COUNT (owner, 28 Aug 2026): the disbursement day and
 *       the payment day are both interest days — day 1 IS the disbursement
 *       day. So that no day is ever charged twice, every anchor holds the
 *       FIRST CHARGEABLE day of its period: disbursement for the first
 *       cycle, the day AFTER the sealing payment for every later one. The
 *       same counting applies to loan age, tenure and penal days.
 *
 * Money is handled in PAISE (integers) internally; the public surface speaks
 * rupees. Grams and rates never enter this file — valuation is upstream.
 */

// ————————————————————————————— helpers —————————————————————————————

const P = 100; // paise per rupee

/** rupees → paise (integer). Accepts int or 2-dp float. */
const toPaise = (r) => Math.round(r * P);
/** paise → rupees float (safe for display math only). */
const toRupees = (p) => p / P;

/** Round paise UP to the next ₹10 (R-D). 0 stays 0. */
export function roundUp10(paise) {
  const step = 10 * P;
  return Math.ceil(paise / step) * step;
}

/** Whole days from a to b (calendar), floor at 0. Dates are 'YYYY-MM-DD'. */
export function daysBetween(a, b) {
  const MS = 86400000;
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.max(0, Math.round((db - da) / MS));
}

/**
 * Chargeable days from `from` to `to`, BOTH days counted (R-L, owner
 * 28 Aug 2026). `from` is the first chargeable day of the period; a `to`
 * before `from` is zero days. Same day in and out = 1 day.
 */
export function countDays(from, to) {
  return to < from ? 0 : daysBetween(from, to) + 1;
}

// ————————————————————————— scheme validation ————————————————————————

/**
 * @typedef {Object} Scheme
 * @property {string} code
 * @property {number} daysInYear            // R-A, e.g. 365
 * @property {'simple'|'slab'} calcMethod
 * @property {number=} interestPctAnnual    // simple method
 * @property {{fromDay:number,toDay:number,ratePct:number}[]=} slabs // slab method
 * @property {'retroactive'|'prospective'=} slabMode  // default retroactive (R-B)
 * @property {number} minInterestDays       // R-E, e.g. 15
 * @property {number=} tenureDays           // for penal (R-I)
 * @property {number=} penalRatePct         // scheme-driven; 0/undefined = no penal
 * @property {number=} penalGraceDays       // scheme-driven
 */

export function validateScheme(s) {
  if (!s || s.daysInYear <= 0) throw new Error("scheme.daysInYear required");
  if (s.calcMethod === "simple") {
    if (!(s.interestPctAnnual > 0)) throw new Error("interestPctAnnual required for simple");
  } else if (s.calcMethod === "slab") {
    if (!s.slabs?.length) throw new Error("slabs required for slab method");
    let prev = -1;
    for (const sl of s.slabs) {
      if (sl.fromDay !== prev + 1 && !(prev === -1 && sl.fromDay === 0))
        throw new Error(`slab gap/overlap at fromDay ${sl.fromDay}`);
      if (sl.toDay < sl.fromDay) throw new Error("slab toDay < fromDay");
      prev = sl.toDay;
    }
  } else throw new Error("calcMethod must be simple|slab");
  if (!(s.minInterestDays >= 0)) throw new Error("minInterestDays required");
  return true;
}

/** Slab whose range contains `day` (days past the last slab use the last slab). */
export function slabFor(scheme, day) {
  const slabs = scheme.slabs;
  for (const sl of slabs) if (day >= sl.fromDay && day <= sl.toDay) return sl;
  return slabs[slabs.length - 1];
}

/**
 * Interest for a cycle of `days` on `principalPaise` — RAW paise, no rounding.
 * R-A divisor, R-B slab modes. `days` may be 0 → 0.
 */
export function cycleInterestRaw(scheme, principalPaise, days) {
  if (days <= 0 || principalPaise <= 0) return 0;
  const DIY = scheme.daysInYear;
  if (scheme.calcMethod === "simple") {
    return Math.round((principalPaise * scheme.interestPctAnnual * days) / (100 * DIY));
  }
  const mode = scheme.slabMode ?? "retroactive";
  if (mode === "retroactive") {
    const rate = slabFor(scheme, days).ratePct;           // slab REACHED prices all days
    return Math.round((principalPaise * rate * days) / (100 * DIY));
  }
  // prospective: each slab prices only its own days
  let raw = 0;
  for (const sl of scheme.slabs) {
    const from = Math.max(1, sl.fromDay);                  // day counting starts at 1
    if (days < from) break;
    const upto = Math.min(days, sl.toDay);
    const d = upto - from + 1;
    raw += Math.round((principalPaise * sl.ratePct * d) / (100 * DIY));
    if (upto === days) break;
  }
  return raw;
}

// ————————————————————————————— dues (R-A…R-I) —————————————————————————————

/**
 * The loan state the engine folds over. Create with openLoan(), evolve ONLY
 * via applyPayment(). All monetary fields in paise.
 * @typedef {Object} LoanState
 * @property {number} principal            // outstanding principal, paise
 * @property {number} principalOriginal
 * @property {string} disbursedAt          // YYYY-MM-DD
 * @property {string} cycleAnchor          // R-C: interest accrues from here
 * @property {number} interestPaidInCycle  // rounded paise paid inside current cycle
 * @property {number} lifetimeInterestPaid // rounded paise, all cycles (feeds R-E)
 * @property {number} penalPaid            // rounded paise paid in current penal period
 * @property {string|null} penalAnchor     // penal accrues from here (default: tenure end)
 * @property {{id:string,amountExact:number,paidExact:number}[]} charges // paise
 * @property {boolean} closed
 */

export function openLoan({ principal, disbursedAt }) {
  const pp = toPaise(principal);
  if (pp % (100 * P) !== 0) throw new Error("principal must be a multiple of ₹100 (R-J)");
  return {
    principal: pp, principalOriginal: pp, disbursedAt,
    cycleAnchor: disbursedAt, interestPaidInCycle: 0,
    interestClock: disbursedAt,              // R-I (15 Oct 2026): first day interest has been unpaid
    lifetimeInterestPaid: 0, penalPaid: 0, penalAnchor: null, charges: [], closed: false,
  };
}

export function addCharge(state, { id, amount }) {
  state.charges.push({ id, amountExact: toPaise(amount), paidExact: 0 });
  return state;
}

/**
 * Everything owed as of `asOf`. Pure — never mutates state.
 * `closing:true` applies the closure-only rules: min-interest floor (R-E) and
 * the grace-window forgiveness test (R-I).
 */
export function dues(scheme, state, asOf, { closing = false, penalRule = "unpaid_interest" } = {}) {
  // —— interest for the current cycle ——
  // R-L: the anchor is the first chargeable day and today counts too.
  const cycleDays = countDays(state.cycleAnchor, asOf);
  const rawCycle = cycleInterestRaw(scheme, state.principal, cycleDays);
  let interestDue = Math.max(0, roundUp10(rawCycle) - state.interestPaidInCycle);

  // —— minimum-interest lifetime floor, every payment (R-E) ——
  let minApplied = false;
  {
    const floorRaw = cycleInterestRaw(scheme, state.principalOriginal, scheme.minInterestDays);
    const floorRounded = roundUp10(floorRaw);
    const lifetimeWithThis = state.lifetimeInterestPaid + interestDue;
    if (lifetimeWithThis < floorRounded) {
      interestDue = floorRounded - state.lifetimeInterestPaid;
      minApplied = true;
    }
  }
  // R-L: the floor pays for days 1…minInterestDays, i.e. through
  // disbursement+(min−1); this is the FIRST CHARGEABLE day after that.
  const minCoversUpto = addDays(state.disbursedAt, scheme.minInterestDays);

  // —— penal (R-I, amended 15 Oct 2026) ——
  // The penal clock: "unpaid_interest" (today's rule) counts from the day
  // interest was last paid; "loan_age" (engine 1.1.x, kept for replaying old
  // receipts) counts from disbursement. R-L: both ends count, so day 1 is the
  // clock's first day; day `tenure` is the last in-time day and the first
  // overdue day is clock+tenure.
  const clock = penalRule === "loan_age" ? state.disbursedAt : (state.interestClock ?? state.disbursedAt);
  const unpaidDays = countDays(clock, asOf);
  const tenure = scheme.tenureDays ?? Infinity;
  const grace = scheme.penalGraceDays ?? 0;
  const rate = scheme.penalRatePct ?? 0;
  let penalRaw = 0, penalDays = 0, inGrace = false;
  if (rate > 0 && Number.isFinite(tenure) && unpaidDays > tenure) {
    const withinWindow = unpaidDays <= tenure + grace;
    if (withinWindow) {
      inGrace = true;   // closing here ⇒ forgiven entirely; running ⇒ would-be zero
    } else {
      // Penal accrues from the first overdue day of this clock, or from the
      // day after the last full penal settlement if that is later (R-L).
      const first = addDays(clock, tenure);
      const start = state.penalAnchor && state.penalAnchor > first ? state.penalAnchor : first;
      penalDays = countDays(start, asOf);
      penalRaw = Math.round((state.principal * rate * penalDays) / (100 * scheme.daysInYear));
    }
  }
  const penalDue = Math.max(0, roundUp10(penalRaw) - state.penalPaid);

  // —— charges (R-D amended: EACH charge rounds up to ₹10 on its own) ——
  // A charge's payable figure is fixed at its own rounded amount, so a part
  // payment can never cause it to round a second time.
  let chargesExact = 0, chargesDue = 0;
  for (const c of state.charges) {
    const payable = roundUp10(c.amountExact);
    const open = payable - c.paidExact;
    if (open <= 0) continue;
    chargesDue += open;
    chargesExact += Math.max(0, c.amountExact - Math.min(c.paidExact, c.amountExact));
  }
  const chargesRounding = chargesDue - chargesExact;      // → Rounding income ledger

  const settlement = state.principal + interestDue + penalDue + chargesDue; // R-F

  return {
    asOf, cycleDays,
    interest: { raw: toRupees(rawCycle), due: toRupees(interestDue), minApplied,
      minDays: scheme.minInterestDays, minCoversUpto: minApplied ? minCoversUpto : null,
      slab: scheme.calcMethod === "slab" ? slabFor(scheme, cycleDays) : null,
      workLine: workLine(scheme, cycleDays) },
    penal: { days: penalDays, raw: toRupees(penalRaw), due: toRupees(penalDue),
      inGraceWindow: inGrace, rule: penalRule, clockFrom: clock, unpaidDays,
      // R-L: day tenure+grace is the last forgiven day = clock + (tenure+grace−1)
      graceTill: Number.isFinite(tenure) ? addDays(clock, tenure + grace - 1) : null },
    charges: { exact: toRupees(chargesExact), due: toRupees(chargesDue),
      roundingIncome: toRupees(chargesRounding) },
    principal: toRupees(state.principal),
    settlement: toRupees(settlement),
    _paise: { interestDue, penalDue, chargesDue, chargesExact, settlement },
  };
}

function addDays(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Customer-facing working line, e.g. "Day 1–80 @ 18% (slab 63–123 reached)". */
export function workLine(scheme, days) {
  if (days <= 0) return "—";
  if (scheme.calcMethod === "simple")
    return `Day 1–${days} @ ${scheme.interestPctAnnual}%`;
  if ((scheme.slabMode ?? "retroactive") === "retroactive") {
    const sl = slabFor(scheme, days);
    return `Day 1–${days} @ ${sl.ratePct}% (slab ${sl.fromDay}–${sl.toDay} reached)`;
  }
  return scheme.slabs.filter(sl => days >= Math.max(1, sl.fromDay))
    .map(sl => `Day ${Math.max(1, sl.fromDay)}–${Math.min(days, sl.toDay)} @ ${sl.ratePct}%`)
    .join(" + ");
}

// ——————————————————————— payments & appropriation ———————————————————————

/** R-J payment validation. `settlementPaise` enables the exact-figure safety net. */
export function validatePaymentAmount(amountRupees, settlementPaise) {
  const a = toPaise(amountRupees);
  if (a <= 0) return { ok: false, reason: "amount must be positive" };
  if (a === settlementPaise) return { ok: true };            // exact settlement always ok
  if (a > settlementPaise) return { ok: false, reason: "more than the total due" };
  if (a < 100 * P) return { ok: false, reason: "minimum payment is ₹100" };
  if (a % (10 * P) !== 0) return { ok: false, reason: "multiples of ₹10 only" };
  return { ok: true };
}

/**
 * Apply one payment (R-G order). Mutates and returns { state, receipt }.
 * `closing` marks the customer's intent to settle in full (activates R-E/R-I
 * closure rules through dues()).
 */
export function applyPayment(scheme, state, { date, amount, closing = false, penalRule = "unpaid_interest" }) {
  if (state.closed) throw new Error("loan already closed");
  const d = dues(scheme, state, date, { closing, penalRule });
  const v = validatePaymentAmount(amount, d._paise.settlement);
  if (!v.ok) throw new Error(v.reason);
  let rest = toPaise(amount);

  // 1 · charges — customer pays the ROUNDED total; exact rows consume FIFO,
  //     the surplus is Rounding income (R-D).
  const toCharges = Math.min(rest, d._paise.chargesDue);
  let roundingIncome = 0;
  if (toCharges > 0) {
    let left = toCharges;
    for (const c of state.charges) {
      if (left <= 0) break;
      const payable = roundUp10(c.amountExact);
      const open = payable - c.paidExact;
      if (open <= 0) continue;
      const pay = Math.min(open, left);
      // whatever lands above the charge's true amount is Rounding income
      const exactBefore = Math.min(c.paidExact, c.amountExact);
      c.paidExact += pay;
      const exactAfter = Math.min(c.paidExact, c.amountExact);
      roundingIncome += pay - (exactAfter - exactBefore);
      left -= pay;
    }
    rest -= toCharges;
  }

  // 2 · penal — full settlement of penal moves the penal anchor (like R-C).
  //     R-L: the payment day itself was priced, so the new anchor is the
  //     day after it.
  const toPenal = Math.min(rest, d._paise.penalDue);
  state.penalPaid += toPenal; rest -= toPenal;
  if (toPenal > 0 && toPenal === d._paise.penalDue) {
    state.penalAnchor = addDays(date, 1); state.penalPaid = 0;
  }

  // 3 · interest
  const toInterest = Math.min(rest, d._paise.interestDue);
  state.interestPaidInCycle += toInterest;
  state.lifetimeInterestPaid += toInterest;
  rest -= toInterest;
  // R-I (15 Oct 2026): any money reaching interest restarts the penal clock
  // from the next day — a part payment counts (owner). Kept under every
  // penalRule so a loan replayed across engine versions carries the right clock.
  if (toInterest > 0) state.interestClock = addDays(date, 1);

  // R-C: full interest settled up to `date` ⇒ seal the cycle, restart the clock.
  // R-L: the payment day was priced inside THIS cycle, so the next cycle's
  // first chargeable day is the day after it.
  // R-E: when the minimum-days floor was applied, the customer has bought days
  // beyond today — the clock restarts from the first day the floor does NOT
  // cover, never earlier, or he would pay twice for the same days.
  const sealsCycle = toInterest > 0 && toInterest === d._paise.interestDue;
  if (sealsCycle) {
    const nextDay = addDays(date, 1);
    const upto = d.interest.minCoversUpto;
    state.cycleAnchor = (upto && upto > nextDay) ? upto : nextDay;
    state.interestPaidInCycle = 0;
  }

  // 4 · principal
  const toPrincipal = Math.min(rest, state.principal);
  state.principal -= toPrincipal; rest -= toPrincipal;

  const closes = state.principal === 0 &&
    d._paise.interestDue === toInterest && d._paise.penalDue === toPenal &&
    d._paise.chargesDue === toCharges;
  if (closes) state.closed = true;

  return {
    state,
    receipt: {
      date, amount, closing: closes,
      appropriation: {
        charges: toRupees(toCharges), roundingIncome: toRupees(roundingIncome),
        penal: toRupees(toPenal), interest: toRupees(toInterest),
        principal: toRupees(toPrincipal), unallocated: toRupees(rest),
      },
      sealsCycle, principalAfter: toRupees(state.principal),
    },
  };
}

// ————————————————————— interest coverage in DAYS (E36) —————————————————————

/** Per-day interest in paise (exact, fractional) for a cycle that is `cycleDays` old. */
function perDayPaise(scheme, principalPaise, cycleDays) {
  if (principalPaise <= 0) return 0;
  const rate = scheme.calcMethod === "simple" ? scheme.interestPctAnnual
    : slabFor(scheme, Math.max(1, cycleDays)).ratePct;
  return (principalPaise * rate) / (100 * scheme.daysInYear);
}

/** How many whole days of the current cycle `paidPaise` buys. */
function daysBought(scheme, principalPaise, cycleDays, paidPaise) {
  if (paidPaise <= 0 || cycleDays <= 0) return 0;
  if (scheme.calcMethod === "slab" && (scheme.slabMode ?? "retroactive") === "prospective") {
    let n = 0;                                   // each day at its own slab's rate
    while (n < cycleDays && cycleInterestRaw(scheme, principalPaise, n + 1) <= paidPaise) n++;
    return n;
  }
  const pd = perDayPaise(scheme, principalPaise, cycleDays);   // retroactive: today's slab prices every day
  return pd > 0 ? Math.min(cycleDays, Math.floor(paidPaise / pd)) : 0;
}

/**
 * The counter's "interest paid up to / due for" line (owner, 15 Oct 2026).
 * Pure, DERIVED from the state the engine already keeps — it changes no figure.
 *
 * Sealed cycles are paid in full, so every day before the cycle anchor is paid.
 * Inside the open cycle a part payment buys whole days at the rate the cycle
 * is priced at TODAY (R-B retroactive: crossing a slab re-prices the cycle, so
 * the same rupees buy fewer days — the honest consequence of the owner's rule).
 * Whatever the rounded due does not divide into whole days counts as one due
 * day, so paid + due always equals the cycle's length.
 *
 * Returns dates as 'YYYY-MM-DD' and days as integers:
 *   paidUpTo       last day interest is paid for (day before disbursement when nothing is)
 *   paidDays       days paid for in the OPEN cycle · paidDaysTotal over the loan's life
 *   dueDays        days unpaid, dueFrom … asOf · interestDuePaise the rupees for them
 *   advanceDays    > 0 when the min-interest floor carried the customer past today
 *   cycleDays, cycleFrom, ratePct, perDayPaise (for a client-side preview)
 */
export function interestCoverage(scheme, state, asOf, { penalRule = "unpaid_interest" } = {}) {
  const d = dues(scheme, state, asOf, { penalRule });
  const cycleDays = d.cycleDays;
  const prevDay = addDays(state.cycleAnchor, -1);
  const interestDue = d._paise.interestDue;
  let paidDays = daysBought(scheme, state.principal, cycleDays, state.interestPaidInCycle);
  let dueDays = Math.max(0, cycleDays - paidDays);
  if (interestDue > 0 && dueDays === 0) { dueDays = 1; paidDays = Math.max(0, cycleDays - 1); }
  if (interestDue === 0) { dueDays = 0; paidDays = cycleDays; }
  const paidUpTo = paidDays > 0 ? addDays(state.cycleAnchor, paidDays - 1) : prevDay;
  const advanceDays = state.cycleAnchor > asOf ? countDays(addDays(asOf, 1), prevDay) : 0;
  const paidDaysTotal = paidUpTo >= state.disbursedAt ? countDays(state.disbursedAt, paidUpTo) : 0;
  return {
    asOf, cycleFrom: state.cycleAnchor, cycleDays,
    ratePct: scheme.calcMethod === "simple" ? scheme.interestPctAnnual : slabFor(scheme, Math.max(1, cycleDays)).ratePct,
    perDayPaise: perDayPaise(scheme, state.principal, cycleDays),
    paidUpTo, paidDays, paidDaysTotal, advanceDays,
    dueDays, dueFrom: dueDays > 0 ? addDays(paidUpTo, 1) : null, dueTo: dueDays > 0 ? asOf : null,
    interestDuePaise: interestDue, ageDays: countDays(state.disbursedAt, asOf),
  };
}

/**
 * What a payment's interest portion buys, for the live preview while the
 * amount is typed. `cov` is interestCoverage(); `toInterestPaise` is the part
 * of the payment that reaches interest after charges and penal (R-G).
 * Pure arithmetic on the coverage figures — safe to run in the browser.
 */
export function paymentCoverage(cov, toInterestPaise, { minCoversUpto = null } = {}) {
  const toInt = Math.max(0, Math.round(toInterestPaise));
  if (cov.dueDays === 0 || toInt === 0)
    return { clearsAll: false, coversDays: 0, coversFrom: null, coversTo: null,
      remainingDays: cov.dueDays, remainingPaise: cov.interestDuePaise, paidUpToAfter: cov.paidUpTo };
  if (toInt >= cov.interestDuePaise) {
    const upto = minCoversUpto && minCoversUpto > cov.asOf ? addDays(minCoversUpto, -1) : cov.asOf;
    return { clearsAll: true, coversDays: cov.dueDays, coversFrom: cov.dueFrom, coversTo: cov.asOf,
      remainingDays: 0, remainingPaise: 0, paidUpToAfter: upto,
      advanceDays: upto > cov.asOf ? countDays(addDays(cov.asOf, 1), upto) : 0 };
  }
  const coversDays = cov.perDayPaise > 0 ? Math.min(cov.dueDays - 1, Math.floor(toInt / cov.perDayPaise)) : 0;
  const coversTo = coversDays > 0 ? addDays(cov.dueFrom, coversDays - 1) : cov.paidUpTo;
  return { clearsAll: false, coversDays, coversFrom: coversDays > 0 ? cov.dueFrom : null, coversTo: coversDays > 0 ? coversTo : null,
    remainingDays: cov.dueDays - coversDays, remainingPaise: cov.interestDuePaise - toInt, paidUpToAfter: coversTo, advanceDays: 0 };
}

/** Replay a whole event history — the .bak validation harness will live on this. */
export function replay(scheme, opening, events) {
  validateScheme(scheme);
  const state = openLoan(opening);
  const receipts = [];
  for (const ev of events) {
    if (ev.type === "charge") addCharge(state, ev);
    else if (ev.type === "payment") receipts.push(applyPayment(scheme, state, ev).receipt);
    else throw new Error("unknown event " + ev.type);
  }
  return { state, receipts };
}
