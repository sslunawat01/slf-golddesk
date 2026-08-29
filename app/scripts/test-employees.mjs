import { validIdentity, validKyc, validEmployment, validAccess, validSuspension,
  canSuspend, wouldRemoveLastAdmin } from "../src/lib/employees.js";

let pass = 0, fail = 0;
const ok = (n, r) => { r.ok ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "\n      problems:", JSON.stringify(r.problems || r.reason))); };
const no = (n, r, phrase) => {
  const text = (r.problems || [r.reason || ""]).join(" ").toLowerCase();
  const hit = !r.ok && text.includes(phrase);
  hit ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "\n      got:", JSON.stringify(r))); };

console.log("\n§1 Identity — a real person with a reachable phone");
ok("name + valid mobile is enough",
  validIdentity({ fullName: "Sarita Pawar", mobile: "9822012345" }));
no("a 9-digit mobile is refused",
  validIdentity({ fullName: "Sarita Pawar", mobile: "982201234" }), "10-digit");
no("a mobile starting 5 is refused",
  validIdentity({ fullName: "Sarita Pawar", mobile: "5822012345" }), "starting 6");
no("an alternate mobile equal to the main one is refused",
  validIdentity({ fullName: "S P", mobile: "9822012345", altMobile: "9822012345" }), "same as the main");
no("a 17-year-old is refused",
  validIdentity({ fullName: "Sarita Pawar", mobile: "9822012345",
    dob: new Date(Date.now() - 17 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10) }),
  "at least 18");
no("a two-character name is refused",
  validIdentity({ fullName: "Sa", mobile: "9822012345" }), "full name");

console.log("\n§1b Names arrive tidy — Proper Case, whatever was typed");
{ const v = validIdentity({ fullName: "sarita ramesh pawar", mobile: "9822012345" });
  (v.fullName === "Sarita Ramesh Pawar")
    ? (pass++, console.log("  ✓ 'sarita ramesh pawar' is stored as 'Sarita Ramesh Pawar'"))
    : (fail++, console.log("  ✗ title case failed:", v.fullName)); }
{ const v = validIdentity({ fullName: "D'SOUZA anthony", mobile: "9822012345" });
  (v.fullName === "D'Souza Anthony")
    ? (pass++, console.log("  ✓ apostrophes and caps both behave: D'Souza Anthony"))
    : (fail++, console.log("  ✗ got:", v.fullName)); }

console.log("\n§2 KYC — the FULL Aadhaar is accepted and STORED (owner decision 12 Aug)");
ok("the full Aadhaar with spaces is accepted", validKyc({ aadhaarLast4: "4444 4444 4444" }));
ok("all 12 digits are kept for storage",
  { ok: validKyc({ aadhaarLast4: "4444 4444 1234" }).aadhaarNo === "444444441234",
    problems: ["full number not kept"] });
ok("the last 4 are still derived alongside, for display",
  { ok: validKyc({ aadhaarLast4: "4444 4444 1234" }).aadhaarLast4 === "1234",
    problems: ["last4 not derived"] });
ok("typing only the last 4 stores no full number",
  { ok: validKyc({ aadhaarLast4: "4321" }).aadhaarNo === null,
    problems: ["invented a full number"] });
ok("the bare last 4 still works too", validKyc({ aadhaarLast4: "4321" }));
ok("PAN alone is enough, in the owner's own example", validKyc({ panNo: "BIWPK2312M" }));
no("an 11-digit Aadhaar is refused",
  validKyc({ aadhaarLast4: "44444444444" }), "full 12 digits");
no("a 13-digit Aadhaar is refused",
  validKyc({ aadhaarLast4: "4444444444444" }), "full 12 digits");
no("a malformed PAN is refused", validKyc({ panNo: "ABC1234567" }), "biwpk2312m");
no("no document at all is refused", validKyc({}), "at least one identity document");
ok("PAN is upper-cased and de-spaced for storage",
  { ok: validKyc({ panNo: " biwpk 2312 m " }).panNo === "BIWPK2312M",
    problems: ["not normalised"] });

console.log("\n§3 Employment — a role, a branch, and a real joining date");
const good = { designation: "Counter Operator", doj: "2026-08-01",
  roleIds: [3], branchIds: [1], primaryBranchId: 1 };
ok("a complete employment step passes", validEmployment(good, ["permanent", "contract"]));
no("zero roles is refused — sign in but do nothing",
  validEmployment({ ...good, roleIds: [] }), "pick a role");
ok("zero branches is welcome — an unposted employee exists but signs in nowhere (owner 28 Aug 2026)",
  validEmployment({ ...good, branchIds: [], primaryBranchId: 0 }));
ok("an unposted employee has no primary branch",
  validEmployment({ ...good, branchIds: [], primaryBranchId: 0 }).primaryBranchId === null
    ? { ok: true } : { ok: false, problems: ["primary should be null"] });
no("a primary branch outside the ticked branches is refused",
  validEmployment({ ...good, primaryBranchId: 7 }), "must be one of the ticked");
no("a joining date three months ahead is refused",
  validEmployment({ ...good, doj: "2026-12-01" }), "more than a month in the future");
no("an employment type the database does not know is refused",
  validEmployment({ ...good, employmentType: "freelance" }, ["permanent", "contract"]), "unknown employment type");
ok("the first ticked branch becomes primary when none is chosen",
  { ok: validEmployment({ ...good, primaryBranchId: 0 }).primaryBranchId === 1,
    problems: ["primary not defaulted"] });

console.log("\n§4 System access — the same password policy the login screen enforces");
ok("a policy-passing password with matching confirm is accepted",
  validAccess({ username: "sarita.p", password: "monsoon2026", confirm: "monsoon2026" }));
no("a username starting with a digit is refused",
  validAccess({ username: "9sarita", password: "monsoon2026", confirm: "monsoon2026" }), "starting with a letter");
no("a 9-character password is refused",
  validAccess({ username: "sarita.p", password: "monsoon26", confirm: "monsoon26" }), "10 characters");
no("a password equal to the username is refused",
  validAccess({ username: "monsoon2026x", password: "monsoon2026x", confirm: "monsoon2026x" }), "username");
no("mismatched confirmation is refused",
  validAccess({ username: "sarita.p", password: "monsoon2026", confirm: "monsoon2027" }), "do not match");

console.log("\n§5 Suspension — dated, reasoned, never yourself, never the last admin");
ok("a dated, reasoned suspension passes",
  validSuspension({ dol: "2026-08-31", reason: "Resigned, last day 31 Aug" }));
no("no date of leaving is refused — the DB CHECK demands it",
  validSuspension({ reason: "Resigned this week" }), "date of leaving");
no("a 3-character reason is refused",
  validSuspension({ dol: "2026-08-31", reason: "left" }), "at least 5");
no("suspending your own account is refused", canSuspend(4, 4), "your own account");
ok("suspending somebody else is allowed", canSuspend(1, 4));
no("suspending the only administrator is refused",
  wouldRemoveLastAdmin([1], 1), "only active administrator");
ok("suspending an admin is fine when another admin remains",
  wouldRemoveLastAdmin([1, 2], 1));

console.log("\n§ One role per employee (№7, owner 28 Aug 2026)");
{
  const good2 = { designation: "Counter Operator", doj: "2026-01-05",
    employmentType: "full_time", roleIds: [3], branchIds: [1], primaryBranchId: 1 };
  ok("exactly one role is fine", validEmployment(good2, ["full_time"]));
  no("two roles are refused — an employee holds a single role",
     validEmployment({ ...good2, roleIds: [2, 3] }, ["full_time"]), "one role only");
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
