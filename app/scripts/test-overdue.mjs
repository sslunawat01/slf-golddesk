import { loanDay, daysToNextSlab, bucketsFor, ageTone, validFollowUp }
  from "../src/lib/overdue.js";

let pass = 0, fail = 0;
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w);
  k ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };
const has = (n, arr, v) => eq(n, arr.includes(v), true);
const not = (n, arr, v) => eq(n, arr.includes(v), false);
const no = (n, r, phrase) => {
  const hit = !r.ok && r.problems.join(" ").toLowerCase().includes(phrase);
  hit ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "\n      got:", JSON.stringify(r))); };
const ok = (n, r) => eq(n, r.ok, true);

console.log("\n§1 The loan's day number — day 0 is the disbursement day");
eq("disbursed today is day 0", loanDay("2026-08-13", "2026-08-13"), 0);
eq("disbursed yesterday is day 1", loanDay("2026-08-12", "2026-08-13"), 1);
eq("the 372-day seed loan reads day 372", loanDay("2025-08-06", "2026-08-13"), 372);

console.log("\n§2 Slab boundaries — SB-IND04 slabs start at days 1, 63, 124");
const SB = [{ fromDay: 1 }, { fromDay: 63 }, { fromDay: 124 }];
eq("day 58 → next boundary in 5 days", daysToNextSlab(58, SB), 5);
eq("day 62 → boundary tomorrow", daysToNextSlab(62, SB), 1);
eq("day 63 → next boundary is 124, i.e. 61 days off", daysToNextSlab(63, SB), 61);
eq("past the last boundary there is none", daysToNextSlab(130, SB), null);
eq("a flat scheme has no boundaries", daysToNextSlab(50, [{ fromDay: 1 }]), null);

console.log("\n§3 Buckets — the worklist is proactive, not just past-due");
const T = "2026-08-13";
has("day 95 of 185 sits in NO urgency bucket",
  bucketsFor({ day: 95, tenureDays: 185, slabs: SB, today: T }).length === 0 ? ["none"] : ["some"], "none");
has("day 172 of 185 is 'tenure in ≤15d'",
  bucketsFor({ day: 172, tenureDays: 185, today: T }), "t15");
has("day 181 of 185 is ALSO 'tenure in ≤5d'",
  bucketsFor({ day: 181, tenureDays: 185, today: T }), "t5");
has("…and still counts in ≤15d", bucketsFor({ day: 181, tenureDays: 185, today: T }), "t15");
has("day 190 of 185 is 'past tenure'",
  bucketsFor({ day: 190, tenureDays: 185, today: T }), "past");
not("a past-tenure loan is NOT also 'tenure in ≤5d'",
  bucketsFor({ day: 190, tenureDays: 185, today: T }), "t5");
has("day 60 of SB-IND04 is 'slab change ≤5d' — the 63-day band is 3 days off",
  bucketsFor({ day: 60, tenureDays: 185, slabs: SB, today: T }), "slab");
not("a past-tenure loan never shows a slab warning",
  bucketsFor({ day: 190, tenureDays: 185, slabs: [{ fromDay: 195 }], today: T }), "slab");
has("a follow-up dated today is 're-follow-up due'",
  bucketsFor({ day: 40, tenureDays: 185, nextFollowUp: "2026-08-13", today: T }), "refu");
has("a follow-up dated LAST week is still due",
  bucketsFor({ day: 40, tenureDays: 185, nextFollowUp: "2026-08-06", today: T }), "refu");
not("a follow-up dated tomorrow is not yet due",
  bucketsFor({ day: 40, tenureDays: 185, nextFollowUp: "2026-08-14", today: T }), "refu");

console.log("\n§4 The age chip tells the truth at a glance");
eq("comfortably inside tenure is grey", ageTone(95, 185), "mut");
eq("inside the last 15 days is amber", ageTone(172, 185), "warn");
eq("past tenure is red", ageTone(190, 185), "bad");

console.log("\n§5 A follow-up is a fact — method, outcome, dates that make sense");
const OUT = ["reached", "no_answer", "promised", "disputed"];
ok("method + enum outcome saves",
  validFollowUp({ method: "Phone call", outcome: "promised" }, OUT, T));
no("a missing method is refused",
  validFollowUp({ outcome: "promised" }, OUT, T), "how the customer was reached");
no("an outcome the database enum does not know is refused",
  validFollowUp({ method: "Phone call", outcome: "will pay someday" }, OUT, T), "from the list");
no("a promise-to-pay in the past is refused",
  validFollowUp({ method: "Phone call", outcome: "promised", ptpDate: "2026-08-01" }, OUT, T),
  "cannot be in the past");
no("a next follow-up in the past is refused",
  validFollowUp({ method: "Phone call", outcome: "promised", nextFollowUp: "2026-08-01" }, OUT, T),
  "cannot be in the past");
ok("today is an acceptable promise date",
  validFollowUp({ method: "Home visit", outcome: "promised", ptpDate: T }, OUT, T));
eq("blank narration stores NULL",
  validFollowUp({ method: "Phone call", outcome: "reached", narration: " " }, OUT, T).narration,
  null);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
