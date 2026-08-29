import { schemeFromRow, buildEvents, replayLoan, chargeSnapshot, appropriationRows,
         cashCapCheck, utrCheck, ENGINE_VERSION } from "../src/lib/loanstate.js";
import { dues, applyPayment } from "../src/lib/engine.js";

let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "\n      got ", JSON.stringify(g), "\n      want", JSON.stringify(w))); };
const throws = (n, fn, phrase) => { try { fn(); fail++; console.log("  ✗", n, "— it did not refuse"); }
  catch (e) { const hit = e.message.toLowerCase().includes(phrase);
    hit ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, "— wrong reason:", e.message)); } };

// The four schemes exactly as they sit in the database today.
const GL2070 = { days_in_year: 365, calc_method: "simple", interest_pct: "20.0000",
  min_interest_days: 15, tenure_days: 365, penal_rate_pct: "2.0000", penal_grace_days: 7,
  round_step_paise: 1000 };
const SBIND04 = { days_in_year: 365, calc_method: "slab", slab_mode: "retroactive",
  min_interest_days: 15, tenure_days: 185, penal_rate_pct: "2.0000", penal_grace_days: 7,
  round_step_paise: 1000 };
const SLABS = [ { from_day: 63, to_day: 123, rate_pct: "18.0000" },
                { from_day: 1,  to_day: 62,  rate_pct: "15.0000" },
                { from_day: 124, to_day: 185, rate_pct: "21.0000" } ];

console.log("\n§1 A scheme row becomes what the engine expects");
{
  const s = schemeFromRow(GL2070, [], "GL2070");
  eq("simple scheme carries its annual rate", s.interestPctAnnual, 20);
  eq("divisor comes from the scheme, never the calendar", s.daysInYear, 365);
  eq("minimum interest days carried across", s.minInterestDays, 15);
  eq("penal rate and grace carried across", [s.penalRatePct, s.penalGraceDays], [2, 7]);
}
{
  const s = schemeFromRow(SBIND04, SLABS, "SB-IND04");
  eq("slabs are sorted into day order however they arrive",
     s.slabs.map(x => x.fromDay), [0, 63, 124]);
  eq("a first slab written as day 1 means the same as day 0", s.slabs[0].fromDay, 0);
  eq("slab rates survive the numeric conversion", s.slabs.map(x => x.ratePct), [15, 18, 21]);
  eq("retroactive is the mode on file", s.slabMode, "retroactive");
}

console.log("\n§2 A scheme the engine cannot price is refused, never guessed at");
throws("a scheme rounding to ₹1 is refused outright",
  () => schemeFromRow({ ...GL2070, round_step_paise: 100 }, [], "X"), "rounds to");
throws("a simple scheme with no rate is refused",
  () => schemeFromRow({ ...GL2070, interest_pct: null }, [], "X"), "interestpctannual");
throws("a slab scheme with a real gap between slabs is refused",
  () => schemeFromRow(SBIND04, [{ from_day: 1, to_day: 62, rate_pct: "15" },
                                { from_day: 70, to_day: 123, rate_pct: "18" }], "X"), "slab");
throws("overlapping slabs are refused",
  () => schemeFromRow(SBIND04, [{ from_day: 1, to_day: 62, rate_pct: "15" },
                                { from_day: 50, to_day: 123, rate_pct: "18" }], "X"), "slab");

console.log("\n§3 A charge added on the day of a payment is due on that payment");
{
  const evs = buildEvents(
    [{ id: 7, added_on: "2026-08-01", total_paise: 11800 }],
    [{ business_date: "2026-08-01", amount_paise: 100000, closes_loan: false }]);
  eq("two events on one day", evs.length, 2);
  eq("the charge sorts first", evs[0].type, "charge");
  eq("the payment sorts second", evs[1].type, "payment");
}
{
  const evs = buildEvents(
    [{ id: 7, added_on: "2026-09-01", total_paise: 11800 }],
    [{ business_date: "2026-08-01", amount_paise: 100000, closes_loan: false }]);
  eq("a later charge stays after an earlier payment", evs.map(e => e.type), ["payment", "charge"]);
}

console.log("\n§4 Replaying receipts reproduces the loan's position");
{
  const scheme = schemeFromRow(GL2070, [], "GL2070");
  const opening = { principalPaise: 4000000, disbursedAt: "2026-07-27", scheme };

  const fresh = replayLoan({ ...opening, charges: [{ id: 1, added_on: "2026-07-27", total_paise: 11800 }] });
  const d0 = dues(scheme, fresh, "2026-08-26");
  eq("a fresh loan owes its principal", d0.principal, 40000);
  eq("the ₹118 charge rounds up to ₹120 for the customer", d0.charges.due, 120);
  eq("the rounding difference is income, not a discount", d0.charges.roundingIncome, 2);

  // pay exactly charges + interest on day 30 — this must seal the cycle
  const payment = d0.charges.due + d0.interest.due;
  const replayed = replayLoan({ ...opening,
    charges: [{ id: 1, added_on: "2026-07-27", total_paise: 11800 }],
    receipts: [{ business_date: "2026-08-26", amount_paise: Math.round(payment * 100), closes_loan: false }] });
  eq("principal is untouched by an interest-only payment", replayed.principal, 4000000);
  eq("the cycle clock restarts the day AFTER the payment (R-L, owner 28 Aug 2026)",
     replayed.cycleAnchor, "2026-08-27");
  eq("the ₹118 charge is settled by the ₹120 billed", replayed.charges[0].paidExact, 12000);
  eq("₹2 of that is rounding income, not charge recovery",
     replayed.charges[0].paidExact - replayed.charges[0].amountExact, 200);

  const d1 = dues(scheme, replayed, "2026-08-26");
  eq("nothing further is owed on the day it was paid", [d1.interest.due, d1.charges.due], [0, 0]);
}

console.log("\n§5 Every rupee of a receipt is accounted to a bucket");
{
  const scheme = schemeFromRow(GL2070, [], "GL2070");
  const state = replayLoan({ principalPaise: 4000000, disbursedAt: "2026-07-27", scheme,
    charges: [{ id: 55, added_on: "2026-07-27", total_paise: 11800 }] });
  const before = chargeSnapshot(state);
  const d = dues(scheme, state, "2026-08-26");
  const { receipt } = applyPayment(scheme, state, { date: "2026-08-26", amount: d.settlement, closing: true });
  const rows = appropriationRows(before, state, receipt);

  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  eq("the buckets add back to the amount received", total, Math.round(d.settlement * 100));
  eq("the charge row points at the charge it settled",
     rows.find(r => r.bucket === "charge").loanChargeId, 55);
  eq("rounding income is booked separately",
     rows.find(r => r.bucket === "charge_rounding").amountPaise, 200);
  eq("no bucket is written for nothing", rows.every(r => r.amountPaise > 0), true);
  eq("a full settlement closes the loan", state.closed, true);
}

console.log("\n§5b Each charge rounds up to ₹10 on its own (R-D, amended 27-Jul-2026)");
{
  const scheme = schemeFromRow(GL2070, [], "GL2070");
  const state = replayLoan({ principalPaise: 4000000, disbursedAt: "2026-07-27", scheme,
    charges: [{ id: 11, added_on: "2026-07-27", total_paise: 11800 },
              { id: 12, added_on: "2026-07-27", total_paise: 11200 }] });
  const d = dues(scheme, state, "2026-08-26");
  eq("₹118 and ₹112 bill as ₹120 + ₹120, not ₹230", d.charges.due, 240);
  eq("the true amount owed is still ₹230", d.charges.exact, 230);
  eq("₹10 of rounding income, not nil", d.charges.roundingIncome, 10);

  const before = chargeSnapshot(state);
  const { receipt } = applyPayment(scheme, state, { date: "2026-08-26", amount: d.settlement, closing: true });
  const rows = appropriationRows(before, state, receipt);
  eq("the buckets still add back to the amount received",
     rows.reduce((s, r) => s + r.amountPaise, 0), Math.round(d.settlement * 100));
  eq("each charge is settled at its own true amount",
     rows.filter(r => r.bucket === "charge").map(r => r.amountPaise), [11800, 11200]);
  eq("the two roundings are booked together",
     rows.find(r => r.bucket === "charge_rounding").amountPaise, 1000);
}

{
  // A part payment must not make a charge round a second time.
  const scheme = schemeFromRow(GL2070, [], "GL2070");
  const state = replayLoan({ principalPaise: 4000000, disbursedAt: "2026-07-27", scheme,
    charges: [{ id: 21, added_on: "2026-07-27", total_paise: 11800 }] });
  applyPayment(scheme, state, { date: "2026-07-27", amount: 100 });
  const d = dues(scheme, state, "2026-07-27");
  eq("₹120 payable less ₹100 paid leaves ₹20", d.charges.due, 20);
  eq("the balance does not round up again", d.charges.due + 100, 120);
}

console.log("\n§6 Cash from one customer is capped at ₹2,00,000 a day (Sec 269ST)");
eq("well under the cap passes", cashCapCheck({ alreadyTodayPaise: 0, amountPaise: 5000000 }).ok, true);
eq("exactly at the cap passes", cashCapCheck({ alreadyTodayPaise: 0, amountPaise: 20000000 }).ok, true);
eq("one rupee over is refused", cashCapCheck({ alreadyTodayPaise: 0, amountPaise: 20000100 }).ok, false);
eq("earlier cash the same day counts towards the cap",
   cashCapCheck({ alreadyTodayPaise: 19900000, amountPaise: 200000 }).ok, false);

console.log("\n§7 A non-cash payment must carry a reference");
eq("cash needs no UTR", utrCheck("cash", null).ok, true);
eq("UPI without a reference is refused", utrCheck("upi", "").ok, false);
eq("blank spaces are not a reference", utrCheck("bank", "    ").ok, false);
eq("a real reference passes", utrCheck("bank", "N0272026072700123").ok, true);

console.log("\n§8 Every receipt records which engine priced it");
eq("the engine version is stamped and not empty", ENGINE_VERSION.length > 0, true);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
