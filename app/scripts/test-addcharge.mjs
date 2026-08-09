import { chargeDefault, splitTotal, validPickedCharge, validChargeBatch }
  from "../src/lib/addcharge.js";
let pass = 0, fail = 0;
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w); k ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };
const ok = (n, r) => eq(n, r.ok, true);
const no = (n, r, phrase) => { const hit = !r.ok && r.problems.some(p => p.toLowerCase().includes(phrase));
  hit ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, JSON.stringify(r.problems))); };

console.log("\n§1 Defaults come from the master, computed for the loan");
eq("a fixed ₹100 + 18% GST defaults to ₹118",
   chargeDefault({ calc: "fixed", amount_paise: 10000, gst_pct: 18 }, 4000000),
   { manual: false, basePaise: 10000, gstPaise: 1800, totalPaise: 11800 });
eq("0.25% of ₹40,000 floors at ₹100",
   chargeDefault({ calc: "percent", pct: 0.25, min_paise: 10000, max_paise: 150000, gst_pct: 18 },
     4000000).basePaise, 10000);
eq("0.25% of ₹10,00,000 caps at ₹1,500",
   chargeDefault({ calc: "percent", pct: 0.25, min_paise: 10000, max_paise: 150000, gst_pct: 18 },
     100000000).basePaise, 150000);
eq("a master row with neither amount nor pct is at actuals",
   chargeDefault({ calc: "fixed", amount_paise: null, gst_pct: 18 }, 4000000).manual, true);

console.log("\n§2 An increased total splits back into honest base + GST");
eq("₹236 at 18% is ₹200 + ₹36", splitTotal(23600, 18), { basePaise: 20000, gstPaise: 3600 });
eq("no GST means the base is the total", splitTotal(11800, 0), { basePaise: 11800, gstPaise: 0 });

console.log("\n§3 A default may be increased, never reduced");
ok("paying exactly the default passes",
   validPickedCharge({ enteredPaise: 11800, defaultTotalPaise: 11800, manual: false }));
ok("paying above the default passes",
   validPickedCharge({ enteredPaise: 15000, defaultTotalPaise: 11800, manual: false }));
no("below the default is refused",
   validPickedCharge({ enteredPaise: 11000, defaultTotalPaise: 11800, manual: false }), "never reduced");
no("a manual charge without an amount is refused",
   validPickedCharge({ enteredPaise: 0, manual: true }), "at actuals");

console.log("\n§4 The batch needs a running loan and a real narration");
const goodPick = { enteredPaise: 11800, defaultTotalPaise: 11800, manual: false };
ok("a picked charge with a narration on an active loan passes",
   validChargeBatch({ picks: [goodPick], narration: "Postage on reminder notice", loanStatus: "active" }));
no("a closed loan takes no more charges",
   validChargeBatch({ picks: [goodPick], narration: "Postage on notice", loanStatus: "closed" }), "running loan");
no("no charges ticked is refused",
   validChargeBatch({ picks: [], narration: "Postage on notice", loanStatus: "active" }), "at least one");
no("a four-character narration is refused",
   validChargeBatch({ picks: [goodPick], narration: "post", loanStatus: "active" }), "narration");

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
