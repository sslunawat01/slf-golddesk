import { NOTES, denomTotalPaise, expectedClosingPaise, dayBeginReady, dayEndReady }
  from "../src/lib/daycycle.js";
let pass = 0, fail = 0;
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w); k ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };
const ok = (n, r) => eq(n, r.ok, true);
const no = (n, r, phrase) => { const hit = !r.ok && r.problems.some(p => p.toLowerCase().includes(phrase));
  hit ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, JSON.stringify(r.problems))); };

console.log("\n§1 The denomination table adds up");
eq("standard notes are 500 to 10", NOTES, [500, 200, 100, 50, 20, 10]);
eq("3×₹500 + 4×₹100 + 2×₹10 = ₹1,920",
   denomTotalPaise({ 500: "3", 100: "4", 10: "2" }), 192000);
eq("an empty table counts zero", denomTotalPaise({}), 0);
eq("garbage counts count as zero", denomTotalPaise({ 500: "abc" }), 0);

console.log("\n§2 Expected cash is opening + cash in − cash out");
eq("₹1,84,500 opening, ₹12,000 receipts, ₹8,000 paid out → ₹1,88,500",
   expectedClosingPaise({ openingPaise: 18450000, cashReceiptsPaise: 1200000,
     cashDisbursedPaise: 800000 }), 18850000);
eq("a branch's first day starts from zero", expectedClosingPaise({}), 0);

console.log("\n§3 Day-begin: four ticks, a count, and a reason only if it differs");
const allChecks = { rate: true, seal: true, queues: true, report: true };
ok("all ticks and a matching count sign off",
   dayBeginReady({ checks: allChecks, countedPaise: 18450000, carriedPaise: 18450000 }));
no("a missing tick blocks", dayBeginReady({ checks: { ...allChecks, seal: false },
   countedPaise: 18450000, carriedPaise: 18450000 }), "four opening checks");
no("no count blocks", dayBeginReady({ checks: allChecks, carriedPaise: 18450000 }), "count the opening");
no("a difference without a reason blocks",
   dayBeginReady({ checks: allChecks, countedPaise: 18400000, carriedPaise: 18450000 }), "reason is mandatory");
ok("a difference WITH a reason signs off — it is a record, not a lock",
   dayBeginReady({ checks: allChecks, countedPaise: 18400000, carriedPaise: 18450000,
     reason: "₹500 short — recovering from R Patil tomorrow" }));
no("cannot sign twice", dayBeginReady({ checks: allChecks, countedPaise: 18450000,
   carriedPaise: 18450000, alreadySigned: true }), "already signed");

console.log("\n§4 Day-end: variance signs off with a reason, never blocks the day");
ok("counted equals expected — clean sign-off",
   dayEndReady({ countedPaise: 18850000, expectedPaise: 18850000 }));
no("a variance without a reason blocks the button",
   dayEndReady({ countedPaise: 18800000, expectedPaise: 18850000 }), "reason is mandatory");
ok("the same variance with a reason signs off",
   dayEndReady({ countedPaise: 18800000, expectedPaise: 18850000,
     reason: "₹500 excess change given at counter" }));
no("day-end needs day-begin first",
   dayEndReady({ countedPaise: 100, expectedPaise: 100, beginSigned: false }), "day-begin first");
no("cannot sign twice", dayEndReady({ countedPaise: 100, expectedPaise: 100,
   alreadySigned: true }), "already signed");
eq("the variance figure is counted minus expected",
   dayEndReady({ countedPaise: 18800000, expectedPaise: 18850000, reason: "short" }).variancePaise,
   -50000);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
