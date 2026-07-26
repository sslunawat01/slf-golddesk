/**
 * SLF GoldDesk — Interest Engine GOLDEN TESTS
 * Every case below was locked with the owner. If any assertion here ever
 * fails, the engine has drifted from the constitution — fix the engine,
 * never the test.
 */
import {
  validateScheme, openLoan, addCharge, dues, applyPayment,
  validatePaymentAmount, roundUp10, cycleInterestRaw, replay,
} from "./engine.js";

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
  eq("Prathmesh day-80 raw", d.interest.raw, 3945.21);
  eq("Prathmesh day-80 due (R-B retro + R-D)", d.interest.due, 3950);
  eq("Prathmesh work line", d.interest.workLine, "Day 1–80 @ 18% (slab 63–123 reached)");
  eq("Prathmesh settlement (R-F)", dues(SB_IND04, L, D(T0,80), {closing:true}).settlement, 103950);
}
{
  const L = openLoan({ principal: 20000, disbursedAt: T0 });       // Komal
  eq("Komal day-33 due", dues(GL2070, L, D(T0, 33)).interest.due, 370);
}

console.log("\n§2 Minimum-interest: lifetime, closure-only (Q3-A + Q5-B)");
{
  const L = openLoan({ principal: 50000, disbursedAt: T0 });       // Archana
  const interim = dues(GL2080, L, D(T0, 5));                       // NOT closing
  eq("Archana day-5 interim raw", interim.interest.raw, 136.99);
  eq("Archana day-5 interim due — no floor, but R-D rounds", interim.interest.due, 140);
  const close = dues(GL2080, L, D(T0, 5), { closing: true });
  eq("Archana day-5 closure — floor bites", close.interest.due, 420);
  eq("Archana floor flag", close.interest.minApplied, true);
  eq("Archana closure settlement", close.settlement, 50420);
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
  eq("day-8 interim due", p8.interest.due, 220);
  applyPayment(GL2080, L, { date: D(T0, 8), amount: 220 });
  const close = dues(GL2080, L, D(T0, 10), { closing: true });
  eq("day-10 closure tops lifetime to floor", close.interest.due, 200); // 220+200=420
  eq("floor flag on top-up", close.interest.minApplied, true);
}

console.log("\n§3 Cycle anchoring — Q4-B (payment seals period, slab clock restarts)");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });      // Prathmesh again
  const d60 = dues(SB_IND04, L, D(T0, 60));
  eq("cycle-1 day-60 due @15%", d60.interest.due, 2470);
  const { receipt } = applyPayment(SB_IND04, L, { date: D(T0, 60), amount: 2470 });
  eq("payment seals cycle", receipt.sealsCycle, true);
  const close = dues(SB_IND04, L, D(T0, 80), { closing: true });
  eq("cycle-2 = 20 days, slab restarted @15%", close.interest.due, 830);
  eq("cycle-2 work line", close.interest.workLine, "Day 1–20 @ 15% (slab 0–62 reached)");
  eq("total to close after split", close.settlement, 100830);
  // and the counterfactual: never paying costs 3950 (proved in §1) — paying saved ₹650
}
{
  // Partial interest payment must NOT seal the cycle (Q4 corollary)
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  const { receipt } = applyPayment(SB_IND04, L, { date: D(T0, 60), amount: 1000 });
  eq("partial does not seal", receipt.sealsCycle, false);
  const d80 = dues(SB_IND04, L, D(T0, 80));
  eq("day-80 still one 80-day cycle, credit applied", d80.interest.due, 3950 - 1000);
}

console.log("\n§4 Penal — Q7-B with grace-forgiveness cliff (R-I)");
{
  const mk = () => openLoan({ principal: 100000, disbursedAt: T0 });
  const c190 = dues(SB_IND04, mk(), D(T0, 190), { closing: true });
  eq("close day-190 (within window) penal ₹0", c190.penal.due, 0);
  eq("day-190 grace flag", c190.penal.inGraceWindow, true);
  const c193 = dues(SB_IND04, mk(), D(T0, 193), { closing: true });
  eq("close day-193 penal on 8 days (from tenure end)", c193.penal.due, 50);
  const c250 = dues(SB_IND04, mk(), D(T0, 250), { closing: true });
  eq("close day-250 penal 65 days", c250.penal.due, 360);
  eq("day-250 interest rides top slab retroactively", c250.interest.due, 16440);
  eq("day-250 settlement", c250.settlement, 100000 + 16440 + 360);
}

console.log("\n§4b Penal anchor — paying penal must not re-charge the same days");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  const d200 = dues(SB_IND04, L, D(T0, 200));                       // 15 penal days
  eq("day-200 penal (15d)", d200.penal.due, 90);
  // pay penal + all interest due today (seals both anchors)
  applyPayment(SB_IND04, L, { date: D(T0, 200), amount: d200.penal.due + d200.interest.due });
  const d210 = dues(SB_IND04, L, D(T0, 210));
  eq("day-210 penal only 10 fresh days", d210.penal.due, 60);
  eq("day-210 interest = fresh 10-day cycle", d210.interest.due, 420);
}

console.log("\n§5 Charges rounding → Rounding income (owner's ₹180 rule)");
{
  const L = openLoan({ principal: 100000, disbursedAt: T0 });
  addCharge(L, { id: "PROC", amount: 177 });                        // 150 + 18% GST
  const d = dues(SB_IND04, L, D(T0, 80), { closing: true });
  eq("charges exact", d.charges.exact, 177);
  eq("charges due rounded", d.charges.due, 180);
  eq("rounding income", d.charges.roundingIncome, 3);
  eq("settlement with charge = ₹1,04,130", d.settlement, 104130);
  const { receipt } = applyPayment(SB_IND04, L, { date: D(T0, 80), amount: 104130, closing: true });
  eq("appropriation splits (R-G)", receipt.appropriation,
     { charges: 180, roundingIncome: 3, penal: 0, interest: 3950, principal: 100000, unallocated: 0 });
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
  eq("prospective day-80 raw", d.interest.raw, 3435.62);
  eq("prospective day-80 due", d.interest.due, 3440);
}

console.log("\n§8 replay() — the .bak validation harness");
{
  const { state, receipts } = replay(SB_IND04,
    { principal: 100000, disbursedAt: T0 },
    [
      { type: "charge", id: "PROC", amount: 177 },
      { type: "payment", date: D(T0, 60), amount: 2650 },           // 180 chg + 2470 int
      { type: "payment", date: D(T0, 80), amount: 100830, closing: true },
    ]);
  eq("replay receipt-1 seals", receipts[0].sealsCycle, true);
  eq("replay receipt-1 split", receipts[0].appropriation.interest, 2470);
  eq("replay closes clean", state.closed, true);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
