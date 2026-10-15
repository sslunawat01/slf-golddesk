/**
 * SLF GoldDesk — Interest Engine GOLDEN TESTS
 * Every case below was locked with the owner. If any assertion here ever
 * fails, the engine has drifted from the constitution — fix the engine,
 * never the test.
 *
 * AMENDED for R-L (owner, 28 Aug 2026): BOTH end days count. D(T0,n) is a
 * CALENDAR offset, so the loan is n+1 days old on that date. Every figure
 * below was recomputed by hand for the inclusive count.
 */
import {
  validateScheme, openLoan, addCharge, dues, applyPayment,
  validatePaymentAmount, roundUp10, cycleInterestRaw, replay,
  interestCoverage, paymentCoverage,
} from "../src/lib/engine.js";

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}
const D = (base, n) => { // base date + n days → ISO
  const d = new Date(Date.UTC(+base.slice(0,4), +base.slice(5,7)-1, +base.slice(8,10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
};
const T0 = "2026-05-01"; // disbursement date used throughout
const dmyT = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

// ——— schemes from the seed canon ———
const SB_IND04 = {
  code: "SB-IND04", daysInYear: 365, calcMethod: "slab", slabMode: "retroactive",
  slabs: [ {fromDay:0,toDay:62,ratePct:15}, {fromDay:63,toDay:123,ratePct:18}, {fromDay:124,toDay:185,ratePct:24} ],
  minInterestDays: 15, tenureDays: 185, penalRatePct: 2, penalGraceDays: 7,
};
const GL2070 = { code:"GL2070", daysInYear:365, calcMethod:"simple", interestPctAnnual:20, minInterestDays:15, tenureDays:365 };
const GL2080 = { ...GL2070, code:"GL2080" };
validateScheme(SB_IND04); validateScheme(GL2070);

console.log("\n§1 Canonical single-cycle dues (Product Doc §5)");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });      // Prathmesh
  const d = dues(SB_IND04, L, D(T0, 80));
  eq("Prathmesh day-80 (81 days, R-L) raw", d.interest.raw, 3994.52);
  eq("Prathmesh day-80 due (R-B retro + R-D)", d.interest.due, 4000);
  eq("Prathmesh work line", d.interest.workLine, "Day 1–81 @ 18% (slab 63–123 reached)");
  eq("Prathmesh settlement (R-F)", dues(SB_IND04, L, D(T0,80), {closing:true}).settlement, 104000);
}
{
  const L = openLoan({ principal: 20000, disbursedAt: T0 });       // Komal
  eq("Komal day-33 due (34 days, R-L)", dues(GL2070, L, D(T0, 33)).interest.due, 380);
}

console.log("\n§2 Minimum-interest: a lifetime floor on EVERY payment (R-E, amended 27-Jul-2026)");
{
  const L = openLoan({ principal: 50000, disbursedAt: T0 });       // Archana
  const interim = dues(GL2080, L, D(T0, 5));                       // NOT closing
  eq("Archana day-5 raw interest is only 6 days (R-L)", interim.interest.raw, 164.38);
  eq("but she is charged the 15-day minimum even on an interim payment", interim.interest.due, 420);
  eq("and the screen says so", interim.interest.minApplied, true);
  const close = dues(GL2080, L, D(T0, 5), { closing: true });
  eq("closing on day 5 charges the same 15-day minimum", close.interest.due, 420);
  eq("Archana closure settlement", close.settlement, 50420);
}
{
  // A loan repaid the very day it was taken still owes the minimum.
  const L = openLoan({ principal: 40000, disbursedAt: T0 });
  const sameDay = dues(GL2070, L, T0);
  eq("a same-day repayment is not free", sameDay.interest.due, 330);
  eq("one day accrued (R-L: same day in and out = 1), fifteen charged",
     [sameDay.cycleDays, sameDay.interest.minApplied], [1, true]);
}
{
  // THE RULE THE OWNER SETTLED: paying the floor buys DAYS, not a reset.
  // ₹40,000 @ 20%. Pays interest on day 3; returns on day 20.
  const L = openLoan({ principal: 40000, disbursedAt: T0 });
  const first = dues(GL2070, L, D(T0, 3));
  eq("day-3 payment is topped up to 15 days", first.interest.due, 330);
  eq("the floor covers days 1–15; the first chargeable day after it", first.interest.minCoversUpto, D(T0, 15));
  applyPayment(GL2070, L, { date: D(T0, 3), amount: first.interest.due });
  eq("the clock restarts where the paid days run out, not on the payment date",
     L.cycleStart, D(T0, 15));

  const second = dues(GL2070, L, D(T0, 20));
  eq("he returns on D(T0,20) and owes only the 6 days 16–21 (R-L)", second.cycleDays, 6);
  eq("six days, never twice for a day", second.interest.due, 140);
  eq("the floor is spent and never binds again", second.interest.minApplied, false);
}
{
  // Komal pays day-95 (seals cycle), closes day-98 → only 3 actual days (Q5-B)
  const L = openLoan({ principal: 20000, disbursedAt: T0 });
  const p95 = dues(GL2070, L, D(T0, 95));
  applyPayment(GL2070, L, { date: D(T0, 95), amount: p95.interest.due });
  const close = dues(GL2070, L, D(T0, 98), { closing: true });
  eq("Komal final-cycle 3 days only", close.interest.due, 40);
  eq("Komal no floor (lifetime already ≥ floor)", close.interest.minApplied, false);
}
{
  // Close day-10 after paying day-8 → closing charge TOPS UP lifetime to ₹420
  const L = openLoan({ principal: 50000, disbursedAt: T0 });
  const p8 = dues(GL2080, L, D(T0, 8));
  eq("day-8 interim is floored to the 15-day minimum", p8.interest.due, 420);
  applyPayment(GL2080, L, { date: D(T0, 8), amount: 220 });
  const close = dues(GL2080, L, D(T0, 10), { closing: true });
  eq("day-10 closure tops lifetime to floor", close.interest.due, 200); // 220+200=420
  eq("floor flag on top-up", close.interest.minApplied, true);
}

console.log("\n§3 Cycle anchoring — Q4-B (payment seals period, slab clock restarts)");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });      // Prathmesh again
  const d60 = dues(SB_IND04, L, D(T0, 60));
  eq("cycle-1 day-60 (61 days, R-L) due @15%", d60.interest.due, 2510);
  const { receipt } = applyPayment(SB_IND04, L, { date: D(T0, 60), amount: 2510 });
  eq("payment seals cycle", receipt.sealsCycle, true);
  const close = dues(SB_IND04, L, D(T0, 80), { closing: true });
  eq("cycle-2 = 20 days, slab restarted @15%", close.interest.due, 830);
  eq("cycle-2 work line", close.interest.workLine, "Day 1–20 @ 15% (slab 0–62 reached)");
  eq("total to close after split", close.settlement, 100830);
  // and the counterfactual: never paying costs 3950 (proved in §1) — paying saved ₹650
}
{
  // R-C (owner, 15 Oct 2026): a PART payment buys DAYS at that day's rate, never seals, never re-prices
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  const { receipt } = applyPayment(SB_IND04, L, { date: D(T0, 60), amount: 1000 });   // day 61 @15% = ₹41.0959/day
  eq("partial does not seal", receipt.sealsCycle, false);
  eq("₹1,000 on day 61 buys 24.33 days", [receipt.daysBought.toFixed(2), L.paidDays.toFixed(2), L.cycleStart], ["24.33", "24.33", T0]);
  eq("paid up to day 24 (whole days), first unpaid day is day 25", [receipt.paidUpTo, L.reachedPct], [D(T0, 23), 15]);
  const d80 = dues(SB_IND04, L, D(T0, 80));                        // 81 cycle days − 24.33 = 56.67 unpaid
  eq("day 81: 56.67 unpaid days are still on the first slab → 15%, ₹2,330 (not ₹3,000 re-priced)",
     [d80.unpaidDays.toFixed(2), d80.ratePct, d80.interest.due], ["56.67", 15, 2330]);
  eq("work line names the unpaid period", d80.interest.workLine, `Unpaid 56.67 days (${dmyT(D(T0, 24))} to ${dmyT(D(T0, 80))}) @ 15% (slab 0–62 reached)`);
  // the slab is crossed when the UNPAID days reach 63 — 24.33 days later than the calendar would say
  eq("cycle day 86: 61.67 unpaid → still 15%", dues(SB_IND04, L, D(T0, 85)).ratePct, 15);
  eq("cycle day 87: 62.67 unpaid → day 63 begun → 18%", dues(SB_IND04, L, D(T0, 86)).ratePct, 18);
}
{
  // R-C ratchet: a part payment never LOWERS the rate; only a full payment resets it
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  const d100 = dues(SB_IND04, L, D(T0, 99));                      // day 100 @18%
  eq("day 100 is on the 18% slab", d100.ratePct, 18);
  applyPayment(SB_IND04, L, { date: D(T0, 99), amount: 3000 });    // ₹49.315/day → 60.83 days
  eq("₹3,000 at 18% buys 60.83 days; 39.17 unpaid", [L.paidDays.toFixed(2), dues(SB_IND04, L, D(T0, 99)).unpaidDays.toFixed(2)], ["60.83", "39.17"]);
  const d120 = dues(SB_IND04, L, D(T0, 119));                     // 120 − 60.83 = 59.17 unpaid: slab says 15%, ratchet keeps 18%
  eq("day 120: 59.17 unpaid days stay at 18% (rate kept) → ₹2,920", [d120.ratePct, d120.interest.due], [18, 2920]);
  eq("work line says the rate is kept", /18% kept until interest is paid in full/.test(d120.interest.workLine), true);
  const full = applyPayment(SB_IND04, L, { date: D(T0, 119), amount: 2920 });
  eq("paying every rupee of interest seals the cycle", full.receipt.sealsCycle, true);
  const d130 = dues(SB_IND04, L, D(T0, 129));
  eq("…and the next cycle starts at day 1, 15%: 10 days → ₹420", [L.cycleStart, d130.ratePct, d130.interest.due], [D(T0, 120), 15, 420]);
  // ₹10 short is NOT full (owner: "even ₹10 short does not reset")
  const M = openLoan({ principal: 100000, disbursedAt: T0 });
  const r = applyPayment(SB_IND04, M, { date: D(T0, 99), amount: dues(SB_IND04, M, D(T0, 99)).interest.due - 10 });
  eq("₹10 short: not sealed, days bought instead", [r.receipt.sealsCycle, M.reachedPct, M.paidDays > 99], [false, 18, true]);
}

console.log("\n§4 Penal — Q7-B with grace-forgiveness cliff (R-I)");
{
  const mk = () => openLoan({ principal: 100000, disbursedAt: T0 });
  const c190 = dues(SB_IND04, mk(), D(T0, 190), { closing: true });
  eq("close day-190 (within window) penal ₹0", c190.penal.due, 0);
  eq("day-190 grace flag", c190.penal.inGraceWindow, true);
  const c193 = dues(SB_IND04, mk(), D(T0, 193), { closing: true });
  eq("close day-193 penal on 9 days from first overdue day (R-L)", c193.penal.due, 50);
  const c250 = dues(SB_IND04, mk(), D(T0, 250), { closing: true });
  eq("close day-250 penal 66 days (R-L)", c250.penal.due, 370);
  eq("day-250 interest rides top slab retroactively (251 days)", c250.interest.due, 16510);
  eq("day-250 settlement", c250.settlement, 100000 + 16510 + 370);
}

console.log("\n§4b Penal anchor — paying penal must not re-charge the same days");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  const d200 = dues(SB_IND04, L, D(T0, 200));                       // 16 penal days (R-L)
  eq("day-200 penal (16d, R-L)", d200.penal.due, 90);
  // pay penal + all interest due today (seals both anchors)
  applyPayment(SB_IND04, L, { date: D(T0, 200), amount: d200.penal.due + d200.interest.due });
  const d210 = dues(SB_IND04, L, D(T0, 210));
  // R-I amended 15 Oct 2026: the interest payment on day 200 restarted the
  // penal clock — penal returns only after tenure+grace more unpaid days.
  eq("day-210 penal is ZERO (the full interest payment on day 200 ended the penal period)", d210.penal.due, 0);
  eq("day-210 interest = fresh 10-day cycle", d210.interest.due, 420);
}

console.log("\n§4c Penal on UNPAID days, frozen once started (owner, 15 Oct 2026)");
{
  // SB_IND04: tenure 185, grace 7, penal 2%. ₹1,00,000.
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  applyPayment(SB_IND04, L, { date: D(T0, 100), amount: 500 });     // day 101 @18% (₹49.315/day): 10.14 days
  eq("₹500 on day 101 buys 10.14 days", L.paidDays.toFixed(2), "10.14");
  eq("paid up to day 10; interest unpaid from day 11", dues(SB_IND04, L, D(T0, 100)).penal.clockFrom, D(T0, 10));
  // unpaid days = cycle days − 10.14: the grace window is unpaid 186…192 → cycle days 196…202
  eq("cycle day 196 (185.86 unpaid) → in grace, ₹0", [dues(SB_IND04, L, D(T0, 195)).penal.inGraceWindow, dues(SB_IND04, L, D(T0, 195)).penal.due], [true, 0]);
  eq("cycle day 202 (191.86 unpaid) → still ₹0", dues(SB_IND04, L, D(T0, 201)).penal.due, 0);
  const d203 = dues(SB_IND04, L, D(T0, 202));                       // 192.86 unpaid → penal runs from unpaid day 186
  eq("cycle day 203 (192.86 unpaid) → penal from unpaid day 186 = cycle day 196: 8 days → ₹50", [d203.penal.running, d203.penal.from, d203.penal.days, d203.penal.due], [true, D(T0, 195), 8, 50]);
  // ₹300 on that day: penal ₹50 first (R-G), ₹250 buys days at 24% (₹65.75/day = 3.80 days) — penal does NOT stop
  const r = applyPayment(SB_IND04, L, { date: D(T0, 202), amount: 300 });
  eq("₹300: penal cleared first, remainder buys interest days", [r.receipt.appropriation.penal, r.receipt.appropriation.interest, L.paidDays.toFixed(2)], [50, 250, "13.94"]);
  eq("the penal start is frozen on the state", L.penalFrom, D(T0, 195));
  const d211 = dues(SB_IND04, L, D(T0, 210));
  eq("cycle day 211: penal keeps running — 8 fresh days since the settlement → ₹50", [d211.penal.days, d211.penal.due], [8, 50]);
  // a big part payment pulls the unpaid days BELOW the tenure — penal still runs (owner Q13)
  applyPayment(SB_IND04, L, { date: D(T0, 210), amount: 7050 });    // ₹50 penal + ₹7,000 interest = 106.46 days
  const d221 = dues(SB_IND04, L, D(T0, 220));
  eq("after buying 106 days the unpaid period is 100.6 days (< tenure)…", d221.unpaidDays.toFixed(1), "100.6");
  eq("…yet penal still runs: 10 days → ₹60, and the 24% rate is kept", [d221.penal.due, d221.ratePct, d221.interest.due], [60, 24, 6620]);
  // only a FULL interest payment (which pays the penal first) ends it
  const full = applyPayment(SB_IND04, L, { date: D(T0, 220), amount: 6620 + 60 });
  eq("full interest + penal seals the cycle and ends the penal period", [full.receipt.sealsCycle, L.penalFrom, L.penalAnchor], [true, null, null]);
  const d231 = dues(SB_IND04, L, D(T0, 230));
  eq("fresh cycle: 10 days @15% → ₹420, no penal", [d231.interest.due, d231.penal.due, d231.penal.running], [420, 0, false]);
  // a payment too small to reach interest buys no days and leaves penal running
  const M = openLoan({ principal: 100000, disbursedAt: T0 });
  const m300 = dues(SB_IND04, M, D(T0, 300));                      // penal 116 days → ₹640
  eq("never paid, day 301: penal from day 186, 116 days → ₹640", [m300.penal.days, m300.penal.due], [116, 640]);
  applyPayment(SB_IND04, M, { date: D(T0, 300), amount: 300 });
  eq("₹300 swallowed by penal → no days bought, ₹300 toward penal", [M.paidDays, M.penalPaid], [0, 30000]);
  eq("penal still due after the part payment", dues(SB_IND04, M, D(T0, 300)).penal.due, 340);
}

console.log("\n§5 Charges rounding → Rounding income (owner's ₹180 rule)");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  addCharge(L, { id: "PROC", amount: 177 });                        // 150 + 18% GST
  const d = dues(SB_IND04, L, D(T0, 80), { closing: true });
  eq("charges exact", d.charges.exact, 177);
  eq("charges due rounded", d.charges.due, 180);
  eq("rounding income", d.charges.roundingIncome, 3);
  eq("settlement with charge = ₹1,04,180", d.settlement, 104180);
  const { receipt } = applyPayment(SB_IND04, L, { date: D(T0, 80), amount: 104180, closing: true });
  eq("appropriation splits (R-G)", receipt.appropriation,
     { charges: 180, roundingIncome: 3, penal: 0, interest: 4000, principal: 100000, unallocated: 0 });
  eq("loan closes", receipt.closing, true);
}

console.log("\n§6 Payment validation (R-J)");
{
  const L = openLoan({ principal: 20000, disbursedAt: T0 });
  const s = dues(GL2070, L, D(T0, 33), { closing: true })._paise.settlement;
  eq("₹50 rejected", validatePaymentAmount(50, s).ok, false);
  eq("₹105 rejected (step)", validatePaymentAmount(105, s).ok, false);
  eq("₹110 accepted", validatePaymentAmount(110, s).ok, true);
  eq("exact settlement accepted", validatePaymentAmount(s / 100, s).ok, true);
  let threw = false;
  try { openLoan({ principal: 20050, disbursedAt: T0 }); } catch { threw = true; }
  eq("principal %100 enforced", threw, true);
}

console.log("\n§7 Prospective mode stays available as scheme config");
{
  const prosp = { ...SB_IND04, slabMode: "prospective" };
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  const d = dues(prosp, L, D(T0, 80));
  eq("prospective day-80 raw (81 days: 62@15 + 19@18; summed exactly, then rounded to paise)", d.interest.raw, 3484.93);
  eq("prospective day-80 due", d.interest.due, 3490);
}

console.log("\n§8 replay() — the .bak validation harness");
{
  const { state, receipts } = replay(SB_IND04,
    { principal: 100000, disbursedAt: T0 },
    [
      { type: "charge", id: "PROC", amount: 177 },
      { type: "payment", date: D(T0, 60), amount: 2690 },           // 180 chg + 2510 int (R-L)
      { type: "payment", date: D(T0, 80), amount: 100830, closing: true },
    ]);
  eq("replay receipt-1 seals", receipts[0].sealsCycle, true);
  eq("replay receipt-1 split", receipts[0].appropriation.interest, 2510);
  eq("replay closes clean", state.closed, true);
}

console.log("\n§10 Interest coverage in DAYS — paid up to / due for (owner, 15 Oct 2026; loan 03A5602283)");
{
  // IND04 as published on prod: 18% to day 62, 24% from day 63, 360-day year, 185+7, penal 6%
  const IND04 = { code:"IND04", daysInYear:360, calcMethod:"slab", slabMode:"retroactive",
    slabs:[{fromDay:0,toDay:62,ratePct:18},{fromDay:63,toDay:185,ratePct:24}],
    minInterestDays:15, tenureDays:185, penalRatePct:6, penalGraceDays:7 };
  validateScheme(IND04);
  const f2 = (x) => Number(x).toFixed(2);
  const A = "2026-02-25", TODAY = "2026-10-15";
  // 1 · nothing ever paid, day 233
  let st = openLoan({ principal: 15800, disbursedAt: A });
  let c = interestCoverage(IND04, st, TODAY);
  eq("day 233: cycle from disbursement, 233 days, priced at 24%", [c.cycleFrom, c.cycleDays, c.ratePct, c.ageDays], [A, 233, 24, 233]);
  eq("nothing paid: paid up to the day BEFORE disbursement, 0 days", [c.paidUpTo, c.paidDays, c.paidDaysTotal], ["2026-02-24", 0, 0]);
  eq("due for all 233 days, 25 Feb → 15 Oct, ₹2,460", [c.dueDays, c.dueFrom, c.dueTo, c.interestDuePaise], [233, A, TODAY, 246000]);
  eq("per-day figure 15,800 × 24% / 360 = ₹10.5333", Math.round(c.perDayPaise), 1053);
  // 2 · a ₹1,000 part payment today: penal ₹130 first, ₹870 reaches interest → 82.59 days
  let pv = paymentCoverage(c, 87000);
  eq("₹870 buys 82.59 days: 25 Feb → 17 May (82 whole days)", [pv.clearsAll, f2(pv.coversDays), pv.coversFrom, pv.coversTo], [false, "82.59", A, "2026-05-17"]);
  eq("150.41 days (₹1,590) stay unpaid", [f2(pv.remainingDays), pv.remainingPaise, pv.paidUpToAfter], ["150.41", 159000, "2026-05-17"]);
  applyPayment(IND04, st, { date: TODAY, amount: 1000 });
  c = interestCoverage(IND04, st, "2026-10-16");
  eq("next day: paid up to 17 May (82.59 days), due 151.41 days from 18 May", [c.paidUpTo, f2(c.paidDays), f2(c.paidDaysTotal), f2(c.dueDays), c.dueFrom, c.dueTo], ["2026-05-17", "82.59", "82.59", "151.41", "2026-05-18", "2026-10-16"]);
  eq("paid + due = the cycle's length", f2(c.paidDays + c.dueDays), f2(c.cycleDays));
  eq("151.41 unpaid days at 24% = ₹1,594.85 → ₹1,600", c.interestDuePaise, 160000);
  // 3 · full interest + penal today (₹2,590) clears everything up to today
  st = openLoan({ principal: 15800, disbursedAt: A });
  c = interestCoverage(IND04, st, TODAY);
  pv = paymentCoverage(c, 246000);
  eq("full interest: clears all 233 days, paid up to today", [pv.clearsAll, pv.coversDays, pv.remainingDays, pv.paidUpToAfter, pv.advanceDays], [true, 233, 0, TODAY, 0]);
  applyPayment(IND04, st, { date: TODAY, amount: 2590 });
  c = interestCoverage(IND04, st, TODAY);
  eq("same day after paying: paid up to today, nothing due, no advance", [c.paidUpTo, c.dueDays, c.paidDaysTotal, c.advanceDays, c.cycleDays], [TODAY, 0, 233, 0, 0]);
  c = interestCoverage(IND04, st, "2026-10-16");
  eq("next day: a fresh cycle from 16 Oct, 1 day due, lifetime 233 paid", [c.cycleFrom, c.cycleDays, c.dueDays, c.dueFrom, c.paidUpTo, c.paidDaysTotal], ["2026-10-16", 1, 1, "2026-10-16", TODAY, 233]);
  // 4 · the minimum-interest floor buys days AHEAD: pay in full on day 5
  st = openLoan({ principal: 15800, disbursedAt: "2026-10-01" });
  c = interestCoverage(IND04, st, "2026-10-05");
  const d5 = dues(IND04, st, "2026-10-05");
  pv = paymentCoverage(c, d5._paise.interestDue, { minCoversUpto: d5.interest.minCoversUpto });
  eq("day 5 full payment carries 15 days: paid up to 15 Oct, 10 days ahead", [pv.clearsAll, pv.paidUpToAfter, pv.advanceDays], [true, "2026-10-15", 10]);
  applyPayment(IND04, st, { date: "2026-10-05", amount: d5.interest.due });
  c = interestCoverage(IND04, st, "2026-10-06");
  eq("6 Oct: paid up to 15 Oct, 9 days in advance, nothing due", [c.paidUpTo, c.advanceDays, c.dueDays, c.paidDaysTotal], ["2026-10-15", 9, 0, 15]);
  c = interestCoverage(IND04, st, "2026-10-16");
  eq("16 Oct: the advance is used up, 1 day due", [c.advanceDays, c.dueDays, c.dueFrom], [0, 1, "2026-10-16"]);
  // 5 · days bought are FINAL (owner Q3): ₹400 on day 60 at 18% = 50.63 days, still 50.63 days on day 63
  st = openLoan({ principal: 15800, disbursedAt: A });
  applyPayment(IND04, st, { date: D(A, 59), amount: 400 });           // ₹7.90/day
  eq("day 61: ₹400 bought 50.63 days at 18%", f2(interestCoverage(IND04, st, D(A, 60)).paidDays), "50.63");
  eq("day 63 and after: still 50.63 days — never re-priced", f2(interestCoverage(IND04, st, D(A, 90)).paidDays), "50.63");
  eq("…and the unpaid period is still on the 18% slab (40.37 days)", [f2(interestCoverage(IND04, st, D(A, 90)).dueDays), interestCoverage(IND04, st, D(A, 90)).ratePct], ["40.37", 18]);
  // 6 · prospective slabs: each unpaid day at its own rate
  const PRO = { ...IND04, code:"PRO", slabMode:"prospective", slabs:[{fromDay:0,toDay:10,ratePct:18},{fromDay:11,toDay:185,ratePct:24}] };
  st = openLoan({ principal: 36000, disbursedAt: A });              // ₹18/day then ₹24/day
  const d20 = dues(PRO, st, D(A, 19));                              // 20 unpaid days: 10 × 18 + 10 × 24
  eq("prospective: 20 unpaid days = 10 @ ₹18 + 10 @ ₹24 = ₹420", d20.interest.due, 420);
  // 7 · nothing typed yet / less than a day
  st = openLoan({ principal: 15800, disbursedAt: A });
  c = interestCoverage(IND04, st, TODAY);
  eq("₹0 to interest: nothing covered, all 233 days remain", [paymentCoverage(c, 0).coversDays, paymentCoverage(c, 0).remainingDays], [0, 233]);
  const tiny = paymentCoverage(c, 500);
  eq("₹5 buys 0.47 of a day; the paid-up-to date does not move", [f2(tiny.coversDays), tiny.coversTo, f2(tiny.remainingDays)], ["0.47", "2026-02-24", "232.53"]);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
