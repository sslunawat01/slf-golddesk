import { maskAccount, validSlfBank, deactivationNote } from "../src/lib/slfbanks.js";
let pass = 0, fail = 0;
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w);
  k ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, "got", JSON.stringify(g))); };
const ok = (n, r) => eq(n, r.ok, true);
const no = (n, r, ph) => { const hit = !r.ok && r.problems.join(" ").toLowerCase().includes(ph);
  hit ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, JSON.stringify(r))); };

console.log("\n§1 The full account number never enters the database");
eq("'00311234567890' is stored as ··········7890", maskAccount("00311234567890"), "··········7890");
eq("spaces and dashes are ignored before masking", maskAccount("0031 1234-5678 90"), "··········7890");
eq("a 3-digit fragment is refused — nothing to keep", maskAccount("123"), null);

console.log("\n§2 A company account is a named, purposeful thing");
const base = { nickname: "HDFC current — HO", bank: "HDFC Bank", ifsc: "HDFC0001234",
  accountNo: "00311234567890", allowDisbursement: true, allowCollection: true };
ok("a full account passes", validSlfBank(base));
no("a two-character nickname is refused — staff pick accounts by name",
  validSlfBank({ ...base, nickname: "HD" }), "at least 3");
no("a malformed IFSC is refused", validSlfBank({ ...base, ifsc: "HDFC001234" }), "hdfc0001234");
no("an account allowed for NOTHING is refused",
  validSlfBank({ ...base, allowDisbursement: false, allowCollection: false }), "at least one use");
eq("no branch means every branch may use it", validSlfBank(base).branchId, null);

console.log("\n§3 History never deletes");
eq("a used account explains itself",
  deactivationNote(7), "7 payments reference this account — it can be switched off but never deleted");
console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
