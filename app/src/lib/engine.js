/**
 * SLF GoldDesk — Interest Engine  ·  version 1.3.0
 * ================================================
 * Pure calculation core. No dependencies, no I/O, no dates-from-the-clock:
 * everything the engine knows arrives as arguments; everything it decides
 * returns as plain data. This file is the single place interest, penal,
 * charges-rounding, minimum-interest and appropriation are computed.
 *
 * THE CONSTITUTION (locked with the owner Jul 2026; part payments rewritten
 * with the owner on 15 Oct 2026 — "a part payment buys days")
 *
 *  R-A  Divisor = scheme.daysInYear. Never the calendar.
 *  R-B  Slab interest is RETROACTIVE within the UNPAID period: the slab reached
 *       by the unpaid-day count prices every unpaid day. (Prospective exists
 *       as scheme config: each day at its own slab.)
 *  R-C  A CYCLE opens on disbursement (or the day after a FULL interest
 *       payment) and is measured in UNPAID DAYS:
 *           unpaid = days since the cycle opened − days already bought.
 *       · A PART payment BUYS DAYS: the rupees reaching interest, divided by
 *         that day's per-day interest, in exact fractions (10.18 days is
 *         10.18 days). Days bought are final — never re-priced later.
 *       · A part payment never LOWERS the rate: the highest slab the cycle has
 *         reached is kept (ratchet) until a full interest payment.
 *       · The cycle crosses into the next slab when the UNPAID days reach it,
 *         not the calendar days since the cycle opened.
 *       · A FULL payment of every rupee of interest due closes the cycle; the
 *         next day is day 1 at the first slab. ₹10 short is not full.
 *  R-D  Round-up to the next ₹10 is universal: interest and penal round once
 *       on their own total; EACH charge rounds up on its own, and the
 *       difference between billed and owed is Rounding income.
 *  R-E  Minimum interest (scheme.minInterestDays) is a LIFETIME floor applied
 *       at every payment: the first interest payment is topped up to the
 *       minimum-days amount, and the floor then never binds again. Paying the
 *       floor buys days: a cycle sealed under the floor reopens on
 *       disbursement + minInterestDays, never earlier.
 *  R-F  Settlement = principal + interest + penal + charges, each already
 *       rounded. No second rounding.
 *  R-G  Appropriation order: charges → penal → interest → principal.
 *  R-H  Capitalization only at renewal, by human choice (outside this file).
 *  R-I  Penal = scheme.penalRatePct p.a. on OVERDUE PRINCIPAL, measured on the
 *       same UNPAID days as interest (i.e. from the paid-up-to date):
 *       · nothing until the unpaid days exceed tenure + grace;
 *       · then it runs from unpaid day tenure+1 (grace days are charged, not
 *         skipped) — closing inside the window is forgiven entirely;
 *       · ONCE STARTED it does not stop for a part payment: the start day is
 *         frozen; only a full interest payment (which, by R-G, has paid the
 *         penal first) or closure ends it. A full penal settlement on its own
 *         moves the penal anchor to the next day.
 *  R-J  Principal is a multiple of ₹100. Payments: min ₹100 in ₹10 steps —
 *       the exact settlement figure is always accepted.
 *  R-L  BOTH END DAYS COUNT: the disbursement day and the payment day are both
 *       interest days — day 1 IS the day the cycle opens. Every anchor holds
 *       the FIRST chargeable day of its period.
 *
 * HISTORY IS FACT, NOT ARITHMETIC. A receipt already taken is folded into the
 * state from its STORED split (applySplit) — it is never re-priced, whatever
 * engine version took it. applyPayment prices only the payment being taken
 * now, and then calls the same applySplit, so a receipt taken today and the
 * same receipt folded tomorrow leave the loan in exactly the same state.
 *
 * Money is handled in PAISE (integers) internally; days are exact fractions;
 * the public surface speaks rupees.
 */

// ————————————————————————————— helpers —————————————————————————————

const P = 100; // paise per rupee
const toPaise = (r) => Math.round(r * P);
const toRupees = (p) => p / P;
const EPS = 1e-9;

/** Round paise UP to the next ₹10 (R-D). 0 stays 0. */
export function roundUp10(paise) {
  const step = 10 * P;
  return Math.ceil(paise / step) * step;
}

/** Whole calendar days from a to b, floor at 0. Dates are 'YYYY-MM-DD'. */
export function daysBetween(a, b) {
  const MS = 86400000;
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.max(0, Math.round((db - da) / MS));
}

/** Chargeable days from `from` to `to`, BOTH days counted (R-L). `to` before `from` = 0. */
export function countDays(from, to) {
  return to < from ? 0 : daysBetween(from, to) + 1;
}

export function addDays(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 10.18 → "10.18", 12 → "12" — days as the screen shows them. */
export const fmtDays = (d) => Math.abs(d - Math.round(d)) < 0.005 ? String(Math.round(d)) : d.toFixed(2);

// ————————————————————————— scheme validation ————————————————————————

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

/** The slab day a (possibly fractional) unpaid count has reached: 62.82 unpaid days are on day 63. */
const slabDay = (u) => Math.max(1, Math.ceil(u - EPS));

/**
 * The annual rate that prices `unpaidDays` of a cycle (retroactive / simple),
 * never below `reachedPct` (R-C ratchet).
 */
export function rateFor(scheme, unpaidDaysCount, reachedPct = 0) {
  if (scheme.calcMethod === "simple") return scheme.interestPctAnnual;
  return Math.max(reachedPct, slabFor(scheme, slabDay(unpaidDaysCount)).ratePct);
}

/**
 * Interest for `days` (may be fractional) on `principalPaise` — RAW paise, no
 * rounding. Retroactive/simple: one rate for all days (R-B). Prospective:
 * each day at its own slab's rate.
 */
export function cycleInterestRaw(scheme, principalPaise, days, reachedPct = 0) {
  if (days <= 0 || principalPaise <= 0) return 0;
  const DIY = scheme.daysInYear;
  if (scheme.calcMethod === "simple" || (scheme.slabMode ?? "retroactive") === "retroactive")
    return (principalPaise * rateFor(scheme, days, reachedPct) * days) / (100 * DIY);
  let raw = 0;
  for (const sl of scheme.slabs) {
    const from = Math.max(1, sl.fromDay);
    const span = Math.min(days, sl.toDay) - (from - 1);           // unpaid days falling in this slab
    if (span <= 0) break;
    raw += (principalPaise * sl.ratePct * span) / (100 * DIY);
  }
  return raw;
}

/** Interest for ONE day at the rate in force — what a rupee of part payment buys against. */
export function perDayPaise(scheme, principalPaise, unpaidDaysCount, reachedPct = 0) {
  if (principalPaise <= 0) return 0;
  return (principalPaise * rateFor(scheme, unpaidDaysCount, reachedPct)) / (100 * scheme.daysInYear);
}

// ————————————————————————————— state —————————————————————————————

/**
 * @typedef {Object} LoanState
 * @property {number} principal            outstanding, paise
 * @property {number} principalOriginal
 * @property {string} disbursedAt
 * @property {string} cycleStart           R-C: day 1 of the open cycle
 * @property {number} paidDays             exact days of the open cycle bought by part payments
 * @property {number} reachedPct           highest slab rate the open cycle has reached (ratchet)
 * @property {number} lifetimeInterestPaid paise, all cycles (feeds R-E)
 * @property {string|null} penalFrom       R-I: frozen first penal day once penal has started
 * @property {string|null} penalAnchor     day after the last FULL penal settlement
 * @property {number} penalPaid            paise paid toward the current penal period
 * @property {{id:string,amountExact:number,paidExact:number}[]} charges
 * @property {boolean} closed
 */
export function openLoan({ principal, disbursedAt }) {
  const pp = toPaise(principal);
  if (pp % (100 * P) !== 0) throw new Error("principal must be a multiple of ₹100 (R-J)");
  return {
    principal: pp, principalOriginal: pp, disbursedAt,
    cycleStart: disbursedAt, paidDays: 0, reachedPct: 0,
    lifetimeInterestPaid: 0,
    penalFrom: null, penalAnchor: null, penalPaid: 0,
    charges: [], closed: false,
  };
}

export function addCharge(state, { id, amount }) {
  state.charges.push({ id, amountExact: toPaise(amount), paidExact: 0 });
  return state;
}

/** Unpaid days of the open cycle as of a date (never negative). */
export function unpaidDays(state, asOf) {
  return Math.max(0, countDays(state.cycleStart, asOf) - state.paidDays);
}

/** First unpaid day of the open cycle (the day after "paid up to"). */
const dueFromOf = (state) => addDays(state.cycleStart, Math.floor(state.paidDays + EPS));

// ————————————————————————————— dues —————————————————————————————

/**
 * Everything owed as of `asOf`. Pure — never mutates state. `closing` is the
 * customer's intent to settle in full; the figures are the same (the floor
 * applies at every payment, R-E) — the flag is echoed for the screen.
 */
export function dues(scheme, state, asOf, { closing = false } = {}) {
  const u = unpaidDays(state, asOf);
  const cycleDays = countDays(state.cycleStart, asOf);
  const ratePct = rateFor(scheme, u, state.reachedPct);
  const rawCycle = Math.round(cycleInterestRaw(scheme, state.principal, u, state.reachedPct));   // paise
  let interestDue = roundUp10(rawCycle);

  // —— minimum-interest lifetime floor (R-E) ——
  let minApplied = false;
  const floorRounded = roundUp10(Math.round(cycleInterestRaw(scheme, state.principalOriginal, scheme.minInterestDays)));
  if (state.lifetimeInterestPaid + interestDue < floorRounded) {
    interestDue = floorRounded - state.lifetimeInterestPaid;
    minApplied = true;
  }
  const minCoversUpto = addDays(state.disbursedAt, scheme.minInterestDays);   // first chargeable day after the floor's days

  // —— penal (R-I) on the same unpaid days ——
  const tenure = scheme.tenureDays ?? Infinity;
  const grace = scheme.penalGraceDays ?? 0;
  const penalRate = scheme.penalRatePct ?? 0;
  const penalPossible = penalRate > 0 && Number.isFinite(tenure);
  let penalFrom = state.penalFrom;                       // frozen once started (R-I)
  let running = !!penalFrom;
  if (!running && penalPossible && u > tenure + grace + EPS) {
    running = true;
    // the first day on which the unpaid count exceeded the tenure = unpaid day tenure+1
    penalFrom = addDays(state.cycleStart, Math.floor(tenure + state.paidDays + EPS));
  }
  const inGrace = !running && penalPossible && u > tenure + EPS && u <= tenure + grace + EPS;
  let penalDays = 0, penalRaw = 0;
  if (running) {
    const start = state.penalAnchor && state.penalAnchor > penalFrom ? state.penalAnchor : penalFrom;
    penalDays = countDays(start, asOf);
    penalRaw = (state.principal * penalRate * penalDays) / (100 * scheme.daysInYear);
  }
  const penalDue = Math.max(0, roundUp10(Math.round(penalRaw)) - state.penalPaid);

  // —— charges (R-D: each rounds up on its own) ——
  let chargesExact = 0, chargesDue = 0;
  for (const c of state.charges) {
    const payable = roundUp10(c.amountExact);
    const open = payable - c.paidExact;
    if (open <= 0) continue;
    chargesDue += open;
    chargesExact += Math.max(0, c.amountExact - Math.min(c.paidExact, c.amountExact));
  }
  const chargesRounding = chargesDue - chargesExact;

  const settlement = state.principal + interestDue + penalDue + chargesDue;   // R-F
  const dueFrom = dueFromOf(state);
  const paidUpTo = addDays(dueFrom, -1);

  return {
    asOf, closing, cycleDays, unpaidDays: u, ratePct,
    interest: { raw: toRupees(rawCycle), due: toRupees(interestDue), minApplied,
      minDays: scheme.minInterestDays, minCoversUpto: minApplied ? minCoversUpto : null,
      ratePct, perDayPaise: perDayPaise(scheme, state.principal, u, state.reachedPct),
      paidDays: state.paidDays, paidUpTo, dueFrom: u > 0 ? dueFrom : null,
      slab: scheme.calcMethod === "slab" ? slabFor(scheme, slabDay(u)) : null,
      workLine: workLine(scheme, state, u, ratePct, asOf) },
    penal: { days: penalDays, raw: toRupees(penalRaw), due: toRupees(penalDue),
      running, from: running ? penalFrom : null, inGraceWindow: inGrace,
      clockFrom: dueFrom, unpaidDays: u,
      graceTill: penalPossible ? addDays(dueFrom, Math.ceil(tenure + grace) - 1) : null },
    charges: { exact: toRupees(chargesExact), due: toRupees(chargesDue), roundingIncome: toRupees(chargesRounding) },
    principal: toRupees(state.principal),
    settlement: toRupees(settlement),
    _paise: { interestDue, penalDue, chargesDue, chargesExact, settlement },
  };
}

const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** Customer-facing working line. */
export function workLine(scheme, state, u, ratePct, asOf) {
  if (u <= 0) return "—";
  let slabNote = "";
  if (scheme.calcMethod === "slab" && (scheme.slabMode ?? "retroactive") === "retroactive") {
    const sl = slabFor(scheme, slabDay(u));
    slabNote = state.reachedPct > sl.ratePct
      ? ` (${ratePct}% kept until interest is paid in full)`
      : ` (slab ${sl.fromDay}–${sl.toDay} reached)`;
  }
  if (state.paidDays <= 0) return `Day 1–${fmtDays(u)} @ ${ratePct}%${slabNote}`;
  return `Unpaid ${fmtDays(u)} days (${dmy(dueFromOf(state))} to ${dmy(asOf)}) @ ${ratePct}%${slabNote}`;
}

// ——————————————————————— payments & appropriation ———————————————————————

/** R-J payment validation. `settlementPaise` enables the exact-figure safety net. */
export function validatePaymentAmount(amountRupees, settlementPaise) {
  const a = toPaise(amountRupees);
  if (a <= 0) return { ok: false, reason: "amount must be positive" };
  if (a === settlementPaise) return { ok: true };
  if (a > settlementPaise) return { ok: false, reason: "more than the total due" };
  if (a < 100 * P) return { ok: false, reason: "minimum payment is ₹100" };
  if (a % (10 * P) !== 0) return { ok: false, reason: "multiples of ₹10 only" };
  return { ok: true };
}

/**
 * Fold ONE receipt's split into the state — the single mutation path, used
 * both for a payment priced now and for a stored receipt replayed later.
 *   split (paise): { charges:[{id, paid}], penal, interest, principal }
 *                  `paid` is the money received against that charge — its exact
 *                  part plus the rounding that completed it (the caller folding a
 *                  stored receipt reconstructs that from the charge_rounding row)
 *   seals:  this receipt paid every rupee of interest due (closes the cycle)
 *   closes: the loan is settled in full
 * `d` is dues(scheme, state, date) computed BEFORE the fold: it carries the
 * rate that prices the days bought, the penal position and the floor's date.
 */
export function applySplit(scheme, state, { date, d, split, seals, closes }) {
  // 1 · charges
  for (const cp of split.charges || []) {
    const c = state.charges.find(x => String(x.id) === String(cp.id));
    if (c) c.paidExact += cp.paid;                       // money received against the charge, rounding included
  }
  // 2 · penal — once started it is frozen (R-I); a full settlement moves the anchor
  if (d.penal.running) state.penalFrom = d.penal.from;
  if (split.penal > 0) {
    state.penalPaid += split.penal;
    if (split.penal >= d._paise.penalDue) { state.penalAnchor = addDays(date, 1); state.penalPaid = 0; }
  }
  // 3 · interest — full: the cycle closes; part: days are bought at today's rate
  if (split.interest > 0) state.lifetimeInterestPaid += split.interest;
  if (seals) {
    const nextDay = addDays(date, 1);
    const upto = d.interest.minCoversUpto;
    state.cycleStart = upto && upto > nextDay ? upto : nextDay;
    state.paidDays = 0; state.reachedPct = 0;
    state.penalFrom = null; state.penalAnchor = null; state.penalPaid = 0;
  } else if (split.interest > 0) {
    state.reachedPct = Math.max(state.reachedPct, d.interest.ratePct);
    if (d.interest.perDayPaise > 0) state.paidDays += split.interest / d.interest.perDayPaise;
  }
  // 4 · principal
  state.principal = Math.max(0, state.principal - (split.principal || 0));
  if (closes) state.closed = true;
  return state;
}

/** Price and apply one NEW payment (R-G order). Mutates and returns { state, receipt }. */
export function applyPayment(scheme, state, { date, amount, closing = false }) {
  if (state.closed) throw new Error("loan already closed");
  const d = dues(scheme, state, date, { closing });
  const v = validatePaymentAmount(amount, d._paise.settlement);
  if (!v.ok) throw new Error(v.reason);
  let rest = toPaise(amount);

  // 1 · charges FIFO: the customer pays each charge's ROUNDED payable; the part
  //     above its true amount is Rounding income (R-D)
  const toCharges = Math.min(rest, d._paise.chargesDue);
  const chargeParts = []; let roundingIncome = 0;
  if (toCharges > 0) {
    let left = toCharges;
    for (const c of state.charges) {
      if (left <= 0) break;
      const payable = roundUp10(c.amountExact);
      const open = payable - c.paidExact;
      if (open <= 0) continue;
      const pay = Math.min(open, left);
      const exactBefore = Math.min(c.paidExact, c.amountExact);
      const exactAfter = Math.min(c.paidExact + pay, c.amountExact);
      const exact = exactAfter - exactBefore;
      roundingIncome += pay - exact;
      chargeParts.push({ id: c.id, paid: pay, exact });
      left -= pay;
    }
    rest -= toCharges;
  }
  // 2 · penal
  const toPenal = Math.min(rest, d._paise.penalDue); rest -= toPenal;
  // 3 · interest
  const toInterest = Math.min(rest, d._paise.interestDue); rest -= toInterest;
  const seals = toInterest > 0 && toInterest === d._paise.interestDue;
  // 4 · principal
  const toPrincipal = Math.min(rest, state.principal); rest -= toPrincipal;
  const closes = state.principal - toPrincipal === 0 &&
    d._paise.interestDue === toInterest && d._paise.penalDue === toPenal && d._paise.chargesDue === toCharges;

  const daysBought = seals || d.interest.perDayPaise <= 0 ? 0 : toInterest / d.interest.perDayPaise;
  applySplit(scheme, state, { date, d,
    split: { charges: chargeParts, penal: toPenal, interest: toInterest, principal: toPrincipal }, seals, closes });

  return {
    state,
    receipt: {
      date, amount, closing: closes,
      appropriation: {
        charges: toRupees(toCharges), roundingIncome: toRupees(roundingIncome),
        penal: toRupees(toPenal), interest: toRupees(toInterest),
        principal: toRupees(toPrincipal), unallocated: toRupees(rest),
      },
      chargeParts,
      sealsCycle: seals, daysBought, principalAfter: toRupees(state.principal),
      paidUpTo: addDays(dueFromOf(state), -1),
    },
  };
}

/**
 * Replay a whole event history.
 *   {type:"charge", id, amount}                                   a charge raised
 *   {type:"payment", date, amount, closing}                       priced now
 *   {type:"split", date, split, seals, closes}                    a stored receipt (fact)
 */
export function replay(scheme, opening, events) {
  validateScheme(scheme);
  const state = openLoan(opening);
  const receipts = [];
  for (const ev of events) {
    if (ev.type === "charge") addCharge(state, ev);
    else if (ev.type === "payment") receipts.push(applyPayment(scheme, state, ev).receipt);
    else if (ev.type === "split") applySplit(scheme, state, { date: ev.date, d: dues(scheme, state, ev.date), split: ev.split, seals: ev.seals, closes: ev.closes });
    else throw new Error("unknown event " + ev.type);
  }
  return { state, receipts };
}

// ————————————————————— interest in DAYS, for the screens —————————————————————

/** The counter's "paid up to / due for" line — the engine's own state. Days may be fractional. */
export function interestCoverage(scheme, state, asOf) {
  const d = dues(scheme, state, asOf);
  const u = d.unpaidDays, cycleDays = d.cycleDays;
  const dueFrom = dueFromOf(state);
  const paidUpTo = addDays(dueFrom, -1);
  const sealedDays = countDays(state.disbursedAt, addDays(state.cycleStart, -1));
  return {
    asOf, cycleFrom: state.cycleStart, cycleDays, ratePct: d.ratePct, reachedPct: state.reachedPct,
    perDayPaise: d.interest.perDayPaise,
    paidUpTo, paidDays: state.paidDays, paidDaysTotal: sealedDays + Math.min(state.paidDays, cycleDays),
    // paid ahead of today: the floor moved the cycle start past today, or days were bought beyond today
    advanceDays: state.cycleStart > asOf ? countDays(addDays(asOf, 1), addDays(state.cycleStart, -1))
      : Math.max(0, state.paidDays - cycleDays),
    dueDays: u, dueFrom: u > 0 ? dueFrom : null, dueTo: u > 0 ? asOf : null,
    interestDuePaise: d._paise.interestDue, ageDays: countDays(state.disbursedAt, asOf),
  };
}

/**
 * What a payment's interest portion buys, for the live preview while the
 * amount is typed. Pure arithmetic on the coverage figures — runs in the browser.
 */
export function paymentCoverage(cov, toInterestPaise, { minCoversUpto = null } = {}) {
  const toInt = Math.max(0, Math.round(toInterestPaise));
  if (cov.dueDays <= 0 || toInt === 0)
    return { clearsAll: false, coversDays: 0, coversFrom: null, coversTo: null,
      remainingDays: cov.dueDays, remainingPaise: cov.interestDuePaise, paidUpToAfter: cov.paidUpTo, advanceDays: 0 };
  if (toInt >= cov.interestDuePaise) {
    const upto = minCoversUpto && minCoversUpto > cov.asOf ? addDays(minCoversUpto, -1) : cov.asOf;
    return { clearsAll: true, coversDays: cov.dueDays, coversFrom: cov.dueFrom, coversTo: cov.asOf,
      remainingDays: 0, remainingPaise: 0, paidUpToAfter: upto,
      advanceDays: upto > cov.asOf ? countDays(addDays(cov.asOf, 1), upto) : 0 };
  }
  const coversDays = cov.perDayPaise > 0 ? Math.min(cov.dueDays, toInt / cov.perDayPaise) : 0;
  const whole = Math.floor(cov.paidDays + coversDays + EPS) - Math.floor(cov.paidDays + EPS);   // whole days the paid-up-to date moves
  const coversTo = whole > 0 ? addDays(cov.dueFrom, whole - 1) : cov.paidUpTo;
  return { clearsAll: false, coversDays, coversFrom: coversDays > 0 ? cov.dueFrom : null, coversTo: coversDays > 0 ? coversTo : null,
    remainingDays: cov.dueDays - coversDays, remainingPaise: cov.interestDuePaise - toInt, paidUpToAfter: coversTo, advanceDays: 0 };
}
