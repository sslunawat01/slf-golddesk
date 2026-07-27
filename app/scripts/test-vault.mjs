import { vaultInReady, mismatchReady, vaultInBucket, bucketCounts, mgToGrams, qrPayload }
  from "../src/lib/vault.js";
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "\n      got ", JSON.stringify(g), "\n      want", JSON.stringify(w))); };
const ok = (n, r) => eq(n, r.ok, true);
const no = (n, r, phrase) => { const bad = !r.ok && r.problems.some(p => p.toLowerCase().includes(phrase));
  bad ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, "\n      problems:", JSON.stringify(r.problems))); };

const good = { sealIntact: true, itemsMatch: true, weightMatch: true,
  sealPhotoFileId: 91, safeId: 1, packetStatus: "at_counter" };

console.log("\n§1 A packet enters a safe only when everything has been checked");
ok("all three ticks, a photo and a safe let it through", vaultInReady(good));
no("an unconfirmed seal blocks it", vaultInReady({ ...good, sealIntact: false }), "seal");
no("an unconfirmed item count blocks it", vaultInReady({ ...good, itemsMatch: false }), "item count");
no("an unconfirmed weight blocks it", vaultInReady({ ...good, weightMatch: false }), "net weight");
no("no sealed-packet photograph blocks it", vaultInReady({ ...good, sealPhotoFileId: null }), "photograph");
no("no safe chosen blocks it", vaultInReady({ ...good, safeId: null }), "safe");

console.log("\n§2 Printing the QR tag does not gate the button");
ok("a packet with no tag printed may still be vaulted", vaultInReady(good));

console.log("\n§3 A packet cannot be vaulted twice, and a frozen packet cannot be vaulted at all");
no("already in a safe", vaultInReady({ ...good, packetStatus: "in_safe" }), "already in a safe");
no("frozen after a mismatch", vaultInReady({ ...good, packetStatus: "frozen" }), "frozen");
no("already gone out of the vault", vaultInReady({ ...good, packetStatus: "out" }), "left the vault");

console.log("\n§4 A mismatch must be evidenced, never a bare click (O10)");
const m = { reason: "seal_broken", note: "Seal was cut clean across the top edge; Mr Pawar was present.",
  photoFileId: 44, packetStatus: "at_counter" };
ok("a reason, a real narration and a photograph are enough", mismatchReady(m));
no("no reason chosen", mismatchReady({ ...m, reason: "" }), "did not match");
no("an invented reason is refused", mismatchReady({ ...m, reason: "felt wrong" }), "did not match");
no("a one-word narration is refused", mismatchReady({ ...m, note: "broken" }), "describe");
no("whitespace is not a narration", mismatchReady({ ...m, note: "            " }), "describe");
no("no photograph of what was found", mismatchReady({ ...m, photoFileId: null }), "photograph");
no("a packet already in a safe is a spot-check, not a vault-in mismatch",
   mismatchReady({ ...m, packetStatus: "in_safe" }), "spot-check");
no("a packet already frozen cannot be frozen again",
   mismatchReady({ ...m, packetStatus: "frozen" }), "already frozen");

console.log("\n§5 Gold disbursed today is not yet due — vault-in is the next working day");
eq("disbursed today sits in the today bucket", vaultInBucket("2026-07-27", "2026-07-27"), "today");
eq("disbursed yesterday is due now", vaultInBucket("2026-07-26", "2026-07-27"), "since_yesterday");
eq("disbursed last week is still due", vaultInBucket("2026-07-20", "2026-07-27"), "since_yesterday");

console.log("\n§6 The three filter counts always add up to the whole list");
{
  const rows = [{ disbursedAt: "2026-07-27" }, { disbursedAt: "2026-07-27" },
                { disbursedAt: "2026-07-26" }, { disbursedAt: "2026-07-24" }];
  const c = bucketCounts(rows, "2026-07-27");
  eq("all", c.all, 4);
  eq("disbursed today", c.disbursedToday, 2);
  eq("since yesterday", c.sinceYesterday, 2);
  eq("the two buckets equal the whole", c.disbursedToday + c.sinceYesterday, c.all);
  eq("an empty list counts zero", bucketCounts([], "2026-07-27"), { all: 0, sinceYesterday: 0, disbursedToday: 0 });
}

console.log("\n§7 Weight is shown to the milligram the scale reads");
eq("12480 mg reads as 12.480 g", mgToGrams(12480), "12.480");
eq("a whole gram keeps its zeros", mgToGrams(5000), "5.000");
eq("nothing weighs 0.000 g", mgToGrams(0), "0.000");
eq("a missing weight does not crash", mgToGrams(null), "0.000");

console.log("\n§8 A lost tag must not hand a finder a way in");
{
  const payload = qrPayload({ packetNo: "PKT-01-26-4468", loanNo: "01A6702300", branchCode: "01" });
  eq("the payload is branch, packet and loan", payload, "SLF|01|PKT-01-26-4468|01A6702300");
  eq("it is not a web address", /^https?:/i.test(payload), false);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
