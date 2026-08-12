import { validPurity, rateAtPurity, validItem, validSafe, canDeactivateSafe,
  addableMetalKinds } from "../src/lib/metals.js";

let pass = 0, fail = 0;
const ok = (n, r) => { r.ok ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "\n      problems:", JSON.stringify(r.problems || r.reason))); };
const no = (n, r, phrase) => {
  const text = (r.problems || [r.reason || ""]).join(" ").toLowerCase();
  const hit = !r.ok && text.includes(phrase);
  hit ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "\n      got:", JSON.stringify(r))); };
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w);
  k ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };

console.log("\n§1 A purity grade multiplies the rate — so its % must be sane");
ok("22K at 92% of gold is accepted", validPurity({ karat: "22K", pct: 92, metalId: 1 }, {}));
no("120% of a directly-rated metal is refused",
  validPurity({ karat: "24K+", pct: 120, metalId: 1 }, {}), "cannot exceed 100");
ok("Silver99 at 1.75 is fine — silver prices as a % of the GOLD rate",
  validPurity({ karat: "Silver99", pct: 1.75, metalId: 2 }, { valuedAsPctOfGold: true }));
no("30 'percent of gold' on silver looks like a typo and is refused",
  validPurity({ karat: "SilverX", pct: 30, metalId: 2 }, { valuedAsPctOfGold: true }), "typo");
no("zero percent is refused", validPurity({ karat: "22K", pct: 0, metalId: 1 }, {}), "greater than zero");
no("a five-decimal percentage is refused — the column is numeric(7,4)",
  validPurity({ karat: "22K", pct: 92.12345, metalId: 1 }, {}), "4 decimal places");
no("a one-character grade name is refused",
  validPurity({ karat: "X", pct: 92, metalId: 1 }, {}), "at least 2");

console.log("\n§2 Rate at purity = base × pct — the number the appraiser sees");
eq("₹12,040 base at 92% is ₹11,076.80/g (in paise)", rateAtPurity(1204000, 92), 1107680);
eq("₹12,040 base at 1.75% (Silver99) is ₹210.70/g", rateAtPurity(1204000, 1.75), 21070);

console.log("\n§3 Items — a name, a PRINT name, and a metal");
ok("a full item passes", validItem({ name: "Necklace / Haar", printName: "necklace", metalId: 1 }));
eq("the print name is stored UPPERCASE for the pledge card",
  validItem({ name: "Necklace", printName: "necklace", metalId: 1 }).printName, "NECKLACE");
no("no print name is refused — it appears on printed documents",
  validItem({ name: "Necklace", metalId: 1 }), "print name");
no("no metal is refused", validItem({ name: "Necklace", printName: "NECKLACE" }), "metal");
no("a one-character name is refused",
  validItem({ name: "N", printName: "NECKLACE", metalId: 1 }), "at least 2");

console.log("\n§4 Safes — labelled, branch-bound, and never switched off with gold inside");
ok("a labelled safe on a branch passes", validSafe({ label: "Safe A — main vault", branchId: 2 }));
no("a one-character label is refused", validSafe({ label: "A", branchId: 2 }), "at least 2");
no("a safe without a branch is refused", validSafe({ label: "Safe A" }), "belong to a branch");
ok("an empty safe may be switched off", canDeactivateSafe(0));
no("a safe holding 3 packets is refused — the gold would be in a safe that 'does not exist'",
  canDeactivateSafe(3), "3 packets are inside");
no("even ONE packet blocks it", canDeactivateSafe(1), "1 packet is inside");

console.log("\n§5 Metals — only kinds the database enum already knows can be added");
eq("silver is addable when the enum knows it and the table lacks it",
  addableMetalKinds(["gold", "silver"], ["gold"]), ["silver"]);
eq("nothing is addable when every kind already exists",
  addableMetalKinds(["gold", "silver"], ["gold", "silver"]), []);
eq("case differences do not create phantom addables",
  addableMetalKinds(["gold", "silver"], ["Gold", "SILVER"]), []);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
