import { isWorkingDay, slaDay, slaBand, releaseReady, releaseWhatsapp, SLA_WORKING_DAYS }
  from "../src/lib/release.js";
let pass = 0, fail = 0;
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w); k ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };
const ok = (n, r) => eq(n, r.ok, true);
const no = (n, r, phrase) => { const hit = !r.ok && r.problems.some(p => p.toLowerCase().includes(phrase));
  hit ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, JSON.stringify(r.problems))); };

console.log("\n§1 Working days: Sundays and holidays do not count");
eq("a Monday is a working day", isWorkingDay("2026-07-27", []), true);
eq("a Sunday is not", isWorkingDay("2026-07-26", []), false);
eq("a declared holiday is not", isWorkingDay("2026-08-15", ["2026-08-15"]), false);

console.log("\n§2 The SLA clock counts only working days");
// 2026-07-27 is a Monday.
eq("closed Monday, collected Monday — day 1", slaDay("2026-07-27", "2026-07-27", []), 1);
eq("closed Monday, collected Saturday — day 6", slaDay("2026-07-27", "2026-08-01", []), 6);
eq("the Sunday in between does not count",
   slaDay("2026-07-27", "2026-08-03", []), 7);
eq("closed on a Sunday, collected Monday — day 1, not day 2",
   slaDay("2026-07-26", "2026-07-27", []), 1);
eq("a holiday inside the window buys a day",
   slaDay("2026-07-27", "2026-08-03", ["2026-07-29"]), 6);
eq("the SLA itself is 7 working days", SLA_WORKING_DAYS, 7);

console.log("\n§3 The list bands match the frozen UX");
eq("day 1 is within SLA", slaBand(1), "Within SLA");
eq("day 4 is within SLA", slaBand(4), "Within SLA");
eq("day 5 turns amber", slaBand(5), "Day 5–6");
eq("day 6 is still amber", slaBand(6), "Day 5–6");
eq("day 7 is red", slaBand(7), "Day 7+");
eq("day 12 stays red", slaBand(12), "Day 7+");

console.log("\n§4 Gold goes back only when every gate is passed");
const good = { loanStatus: "closed", packetStatus: "in_safe", identityOk: true,
  sealOk: true, handoverPhotoId: 7, collectedBy: "borrower" };
ok("a settled loan, verified borrower, intact seal and a photo release", releaseReady(good));
ok("a packet still at the counter (closed same day) may also release",
   releaseReady({ ...good, packetStatus: "at_counter" }));
no("a running loan never releases", releaseReady({ ...good, loanStatus: "active" }), "still running");
no("an auctioned loan's gold does not go over the counter",
   releaseReady({ ...good, loanStatus: "auctioned" }), "does not go back over the counter");
no("a frozen packet must be cleared by HO first",
   releaseReady({ ...good, packetStatus: "frozen" }), "frozen");
no("gold cannot be released twice", releaseReady({ ...good, packetStatus: "out" }), "already left");
no("unverified identity blocks it", releaseReady({ ...good, identityOk: false }), "identity");
no("an unconfirmed seal blocks it", releaseReady({ ...good, sealOk: false }), "seal");
no("no handover photo blocks it", releaseReady({ ...good, handoverPhotoId: null }), "photograph");

console.log("\n§5 Borrower only — the relative path is future, not today");
no("a relative may not collect yet",
   releaseReady({ ...good, collectedBy: "relative" }), "only the borrower");
no("an unknown collector may not collect",
   releaseReady({ ...good, collectedBy: "agent" }), "only the borrower");
ok("absent collectedBy means the borrower", releaseReady({ ...good, collectedBy: undefined }));

console.log("\n§6 The WhatsApp text is Marathi and names the right things");
{
  const t = releaseWhatsapp({ customerName: "Anil Deshmukh", grams: "12.480", loanNo: "01A6702300" });
  eq("greets by first name", t.includes("अनिल") || t.includes("Anil"), true);
  eq("carries the grams", t.includes("12.480"), true);
  eq("carries the loan number", t.includes("01A6702300"), true);
  eq("signed by the company", t.includes("S Lunawat Finance"), true);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
