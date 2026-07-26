/**
 * SLF GoldDesk — auth & policy tests (run: node scripts/test-auth.mjs)
 * Pure logic only; no database, no network.
 */
import { hashPassword, verifyPassword, checkPasswordPolicy, newSessionToken, sha256 } from "../src/lib/password.js";
import { mergePermissions, can, sanctionCeiling, sanctionAuthority, needsHoApproval,
         withinLoginWindow, attemptsLeft, isLocked, visibleDesks } from "../src/lib/policy.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass++, console.log("  ✓", name))
     : (fail++, console.log("  ✗", name, "\n      got ", JSON.stringify(got), "\n      want", JSON.stringify(want)));
};

console.log("\n§1 Passwords");
{
  const h = hashPassword("Bhagur@2026");
  eq("correct password verifies", verifyPassword("Bhagur@2026", h), true);
  eq("wrong password rejected", verifyPassword("bhagur@2026", h), false);
  eq("two hashes of same password differ (salted)", hashPassword("x1234567890") === hashPassword("x1234567890"), false);
  eq("seed placeholder never verifies", verifyPassword("anything", "argon2id$SEED-RESET"), false);
  eq("garbage never verifies", verifyPassword("x", "not-a-hash"), false);
  eq("policy: too short", checkPasswordPolicy("Ab1", "sarita").ok, false);
  eq("policy: no digit", checkPasswordPolicy("abcdefghijk", "sarita").ok, false);
  eq("policy: same as username", checkPasswordPolicy("saritasarita1", "saritasarita1").ok, false);
  eq("policy: good", checkPasswordPolicy("Bhagur@2026", "sarita").ok, true);
  const t = newSessionToken();
  eq("session token hashed for storage", t.tokenHash === sha256(t.token) && t.tokenHash !== t.token, true);
}

console.log("\n§2 Permission merging (highest level wins across roles)");
{
  const merged = mergePermissions([
    { fn: "collect", level: "view" }, { fn: "collect", level: "full" },
    { fn: "reports", level: "view" }, { fn: "settings", level: "none" },
  ]);
  eq("collect merged to full", merged.collect, "full");
  eq("reports stays view", merged.reports, "view");
  eq("ungranted defaults to none", merged.appraise, "none");
}

console.log("\n§3 can() — deny by default, branch and scheme scoped");
{
  const operator = {
    employeeId: 4, username: "saritap", actingBranchId: 1,
    roles: [{ roleId: 3, name: "Counter Operator" }],
    permissions: mergePermissions([
      { fn: "appraise", level: "full" }, { fn: "collect", level: "full" },
      { fn: "reports", level: "view" },
    ]),
    branchIds: [1], schemeIds: [1, 2], personLimitPaise: null, roleLimitPaise: null,
  };
  eq("may collect", can(operator, "collect").ok, true);
  eq("may not change settings", can(operator, "settings").ok, false);
  eq("reports: view yes", can(operator, "reports", { need: "view" }).ok, true);
  eq("reports: full no", can(operator, "reports", { need: "full" }).ok, false);
  eq("other branch refused", can(operator, "collect", { branchId: 2 }).ok, false);
  eq("unallocated scheme refused", can(operator, "appraise", { schemeId: 4 }).ok, false);
  eq("allocated scheme ok", can(operator, "appraise", { schemeId: 1 }).ok, true);
  eq("unknown function refused", can(operator, "print_money").ok, false);
  eq("no actor refused", can(null, "collect").ok, false);
}

console.log("\n§4 Sanction authority — DENY BY DEFAULT (regression: operator was 'unlimited')");
{
  const sanctioner = (extra) => ({
    permissions: mergePermissions([{ fn: "sanction", level: "full" }]),
    branchIds: [1], schemeIds: [1], actingBranchId: 1, ...extra });

  // the bug this test exists for: a counter operator with no limit rows
  const operator = { permissions: mergePermissions([{ fn: "collect", level: "full" }]),
    branchIds: [1], schemeIds: [1], actingBranchId: 1,
    personLimitPaise: null, roleLimitPaise: null };
  eq("operator cannot sanction at all", sanctionAuthority(operator).ceilingPaise, 0);
  eq("operator is NOT unlimited", sanctionAuthority(operator).unlimited, false);
  eq("operator reason names the cause", sanctionAuthority(operator).reason, "not a sanctioning role");
  eq("operator: any amount routes to HO", needsHoApproval(operator, 100), true);

  // has the permission but nobody configured a limit ⇒ still zero, with a warning
  const unconfigured = sanctioner({ personLimitPaise: null, roleLimitPaise: null });
  eq("missing config is zero, not unlimited", sanctionAuthority(unconfigured), 
     { ceilingPaise: 0, unlimited: false, reason: "no limit configured — contact HO" });

  const bm = sanctioner({ roleLimitPaise: 30000000, personLimitPaise: null });
  eq("BM ceiling ₹3,00,000", sanctionCeiling(bm), 30000000);
  eq("₹2,90,000 no HO", needsHoApproval(bm, 29000000), false);
  eq("₹3,00,001 needs HO", needsHoApproval(bm, 30000100), true);
  eq("BM reason", sanctionAuthority(bm).reason, "role limit");

  const restricted = sanctioner({ roleLimitPaise: 30000000, personLimitPaise: 10000000 });
  eq("person override lowers ceiling", sanctionCeiling(restricted), 10000000);
  eq("override reason", sanctionAuthority(restricted).reason, "person override");
  eq("₹1,50,000 now needs HO", needsHoApproval(restricted, 15000000), true);

  // unlimited only when explicitly granted
  const owner = sanctioner({ roleUnlimited: true });
  eq("explicit grant is unlimited", sanctionAuthority(owner).unlimited, true);
  eq("owner ceiling reads null", sanctionCeiling(owner), null);
  eq("owner never routes", needsHoApproval(owner, 999999999999), false);

  // permission removed ⇒ authority evaporates even with an unlimited row
  const demoted = { ...owner, permissions: mergePermissions([{ fn: "collect", level: "full" }]) };
  eq("no sanction permission beats an unlimited row", sanctionAuthority(demoted).unlimited, false);
  eq("demoted ceiling is zero", sanctionAuthority(demoted).ceilingPaise, 0);
}

console.log("\n§5 Login windows");
{
  const open = [{ loginFrom: null, loginTo: null, loginDays: 127 }];
  const office = [{ loginFrom: "08:30", loginTo: "21:00", loginDays: 127, graceMin: 0 }];
  const weekdays = [{ loginFrom: "09:00", loginTo: "18:00", loginDays: 31 }]; // Mon-Fri
  const at = (iso) => new Date(iso);
  eq("no window = always allowed", withinLoginWindow(open, at("2026-07-26T03:00:00")).ok, true);
  eq("inside window", withinLoginWindow(office, at("2026-07-27T10:00:00")).ok, true);
  eq("before window", withinLoginWindow(office, at("2026-07-27T07:00:00")).ok, false);
  eq("after window", withinLoginWindow(office, at("2026-07-27T22:30:00")).ok, false);
  eq("window message names the hours",
     withinLoginWindow(office, at("2026-07-27T22:30:00")).reason, "your role may sign in 08:30–21:00");
  eq("Sunday refused for weekday role", withinLoginWindow(weekdays, at("2026-07-26T10:00:00")).ok, false);
  eq("Monday allowed", withinLoginWindow(weekdays, at("2026-07-27T10:00:00")).ok, true);
  eq("no roles refused", withinLoginWindow([], at("2026-07-27T10:00:00")).ok, false);
  const grace = [{ loginFrom: "09:00", loginTo: "18:00", loginDays: 127, graceMin: 30 }];
  eq("grace extends closing", withinLoginWindow(grace, at("2026-07-27T18:20:00")).ok, true);
}

console.log("\n§6 Lockout");
{
  eq("3 attempts left after 2 failures", attemptsLeft(2), 3);
  eq("not locked at 4", isLocked(4), false);
  eq("locked at 5", isLocked(5), true);
  eq("no negative attempts", attemptsLeft(9), 0);
}

console.log("\n§7 Desk visibility derives from permissions, not role names");
{
  const owner = { permissions: mergePermissions(
      ["appraise","sanction","vault","disburse","collect","renew","release","dayend",
       "cash_transfer","rate_maker","rate_checker","reports","settings"].map(fn => ({ fn, level: "full" }))),
    branchIds: [1,7], schemeIds: [1,2,3,4], actingBranchId: 7 };
  const valuer = { permissions: mergePermissions([{ fn: "appraise", level: "full" }, { fn: "reports", level: "view" }]),
    branchIds: [1], schemeIds: [1], actingBranchId: 1 };
  const o = visibleDesks(owner), v = visibleDesks(valuer);
  eq("owner sees settings", o.settings, true);
  eq("owner sees approvals", o.approvals, true);
  eq("valuer sees counter", v.counterHome, true);
  eq("valuer does NOT see settings", v.settings, false);
  eq("valuer does NOT see day cycle", v.dayCycle, false);
  eq("valuer does NOT see cash transfer", v.cashTransfer, false);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
