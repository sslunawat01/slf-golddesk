import { validContact, validAddress, validNominee, diffFields } from "../src/lib/editcust.js";

let pass = 0, fail = 0;
const ok = (n, r) => { r.ok ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "\n      problems:", JSON.stringify(r.problems))); };
const no = (n, r, phrase) => {
  const hit = !r.ok && r.problems.join(" ").toLowerCase().includes(phrase);
  hit ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "\n      got:", JSON.stringify(r))); };
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w);
  k ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };

console.log("\n§1 Contact — the phone must be reachable");
ok("a valid mobile alone passes", validContact({ mobile: "9822012345" }));
no("a 9-digit mobile is refused", validContact({ mobile: "982201234" }), "10-digit");
no("an alt mobile equal to the main is refused",
  validContact({ mobile: "9822012345", altMobile: "9822012345" }), "same as the main");
no("a malformed email is refused",
  validContact({ mobile: "9822012345", email: "not-an-email" }), "does not look like");
eq("an empty email stores NULL, not an empty string",
  validContact({ mobile: "9822012345", email: "  " }).email, null);

console.log("\n§2 Address — a real line and a real pincode");
ok("line1 + 6-digit pincode passes", validAddress({ line1: "12 Main Road", pincode: "422101" }));
no("a 5-digit pincode is refused", validAddress({ line1: "12 Main Road", pincode: "42210" }), "6 digits");
no("a two-character line1 is refused", validAddress({ line1: "12", pincode: "422101" }), "3 characters");
eq("blank optional fields store NULL",
  validAddress({ line1: "12 Main Road", pincode: "422101", area: " " }).area, null);

console.log("\n§3 Nominee — whole or absent, never partial");
ok("a full nominee passes",
  validNominee({ name: "Sunita Pawar", relation: "Wife", mobile: "9822012399" }));
ok("clearing all three fields is allowed — it removes the nominee", validNominee({}));
eq("…and reads as empty", validNominee({}).empty, true);
no("a name with no relation is refused", validNominee({ name: "Sunita Pawar" }), "relation must be one of");
no("an invented relation is refused",
  validNominee({ name: "Sunita Pawar", relation: "Neighbour" }), "relation must be one of");
no("a two-character nominee name is refused",
  validNominee({ name: "Su", relation: "Wife" }), "at least 3");
no("a bad nominee mobile is refused",
  validNominee({ name: "Sunita Pawar", relation: "Wife", mobile: "12345" }), "10-digit");

console.log("\n§4 A no-op save writes nothing");
eq("identical before/after yields no diff",
  diffFields({ mobile: "9822012345", email: null }, { mobile: "9822012345", email: null }), {});
eq("one changed field is caught with from/to",
  diffFields({ mobile: "9822012345" }, { mobile: "9822012399" }),
  { mobile: { from: "9822012345", to: "9822012399" } });
eq("null and missing are the same thing",
  diffFields({ email: null }, { email: undefined ?? null }), {});

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
