import { jumpPct, sanityCheck, plausible, rateLabel, validRatePair } from "../src/lib/rate.js";
let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log("  ✓",n)):
  (fail++,console.log("  ✗",n,"\n      got ",JSON.stringify(g),"\n      want",JSON.stringify(w)));};

console.log("\n§1 Jump measurement");
eq("no change", jumpPct(1210000, 1210000), 0);
eq("+2%", Math.round(jumpPct(1234200, 1210000) * 10) / 10, 2);
eq("the classic typo: ×10", Math.round(jumpPct(12100000, 1210000)), 900);
eq("no previous rate", jumpPct(1210000, 0), 0);

console.log("\n§2 Sanity guard at 5%");
eq("small rise passes", sanityCheck(1234200, 1210000, 5).needsConfirm, false);
eq("exactly 5% passes", sanityCheck(1270500, 1210000, 5).needsConfirm, false);
eq("6% asks", sanityCheck(1282600, 1210000, 5).needsConfirm, true);
eq("big fall asks", sanityCheck(1000000, 1210000, 5).needsConfirm, true);
eq("direction is named", sanityCheck(1000000, 1210000, 5).direction, "down");
eq("typo message names the old rate",
   sanityCheck(12100000, 1210000, 5).message,
   "That is 900.0% up from ₹12,100. Check the figure — every loan taken today is priced from it.");
eq("first ever rate never asks", sanityCheck(1210000, null, 5).needsConfirm, false);

console.log("\n§3 Plausibility");
eq("normal rate ok", plausible(12100).ok, true);
eq("zero rejected", plausible(0).ok, false);
eq("₹121 rejected as too low", plausible(121).ok, false);
eq("₹1,21,000 rejected as too high", plausible(121000).ok, false);
eq("text rejected", plausible("abc").ok, false);

console.log("\n§4 Carry-forward labelling");
eq("today's rate", rateLabel("2026-07-26", "2026-07-26").state, "today");
eq("yesterday's rate carries", rateLabel("2026-07-25", "2026-07-26").state, "carried");
eq("carry text names the day count",
   rateLabel("2026-07-20", "2026-07-26").text, "carried forward from 20-07-2026 · 6 days ago");
eq("one day is singular", rateLabel("2026-07-25", "2026-07-26").text,
   "carried forward from 25-07-2026 · 1 day ago");
eq("no rate at all", rateLabel(null, "2026-07-26").state, "none");

console.log("\n§5 Market and funding rate pair");
eq("funding below market is fine", validRatePair(12040, 11290).ok, true);
eq("haircut percentage", Number(validRatePair(12040, 11290).haircutPct.toFixed(1)), 6.2);
eq("haircut wording matches the screen", validRatePair(12040, 11290).note,
   "margin ₹750/g · 6.2% haircut before the scheme's funding % applies");
eq("funding above market refused", validRatePair(12040, 12500).ok, false);
eq("refusal explains the danger", validRatePair(12040, 12500).reason,
   "The funding rate cannot be above the market rate — we would lend more than the gold is worth");
eq("equal rates allowed", validRatePair(12040, 12040).ok, true);
eq("equal rates note", validRatePair(12040, 12040).note, "no haircut — we lend at full market value");
eq("nonsense market caught", validRatePair(12, 10).ok, false);
eq("field is named for the screen", validRatePair(12040, 0).field, "funding");

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
