import { validRoleName, normalizePermissions, validLoginWindow, validLimit,
  leavesAnAdmin, DAY_PRESETS, presetForDays, FUNCTION_LABELS }
  from "../src/lib/roles.js";
import { FUNCTIONS, withinLoginWindow } from "../src/lib/policy.js";

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

console.log("\n§1 A role's name is real and unique");
ok("a three-character name is accepted", validRoleName("Aud", []));
no("a two-character name is refused", validRoleName("Au", []), "3 characters");
no("a duplicate name is refused, whatever the case",
  validRoleName("counter OPERATOR", [{ id: 3, name: "Counter Operator" }]), "already has that name");
ok("renaming a role to its own name is allowed",
  validRoleName("Owner", [{ id: 1, name: "Owner" }], 1));

console.log("\n§2 Permissions are deny-by-default — absence IS 'none'");
eq("'none' rows are dropped, not stored (levels convert to bits)",
  normalizePermissions({ sanction: "none", vault: "full" }).rows,
  [{ fn: "vault", level: "full", view: true, add: true, edit: true, delete: true }]);
eq("granular bits pass through; any power implies view (D-B)",
  normalizePermissions({ collect: { add: true } }).rows,
  [{ fn: "collect", level: "view", view: true, add: true, edit: false, delete: false }]);
eq("an all-off bits object is treated as absent",
  normalizePermissions({ collect: { view: false } }).rows, []);
eq("unknown functions are silently dropped",
  normalizePermissions({ hack_the_vault: "full" }).rows, []);
no("an invented level is refused",
  normalizePermissions({ vault: "superuser" }), "unknown level");
eq("every engine function has an English label for the screen",
  FUNCTIONS.filter(f => !FUNCTION_LABELS[f]), []);

console.log("\n§3 The login window is sane, and its bitmask matches the engine");
ok("no window at all means any time", validLoginWindow({}));
no("a From without a To is refused", validLoginWindow({ from: "09:00" }), "both");
no("a From after the To is refused",
  validLoginWindow({ from: "18:00", to: "09:00" }), "earlier than");
no("zero allowed days is refused", validLoginWindow({ days: 0 }), "at least one");
no("241 grace minutes is refused",
  validLoginWindow({ graceMin: 241 }), "between 0 and 240");
// The convention in policy.js: Sun=64 Mon=1 Tue=2 Wed=4 Thu=8 Fri=16 Sat=32
eq("Mon–Sat preset is bitmask 63", DAY_PRESETS.find(([l]) => l === "Mon–Sat")[1], 63);
eq("Mon–Fri preset is bitmask 31", DAY_PRESETS.find(([l]) => l === "Mon–Fri")[1], 31);
eq("an unknown bitmask reads as Custom", presetForDays(5), "Custom");
{ // a role open Mon–Sat 09:30–18:00 refuses Sunday and accepts Tuesday noon
  const roles = [{ loginFrom: "09:30", loginTo: "18:00", loginDays: 63, graceMin: 0 }];
  const tueNoon = new Date("2026-08-11T12:00:00");   // a Tuesday
  const sunNoon = new Date("2026-08-09T12:00:00");   // a Sunday
  ok("Mon–Sat role signs in on Tuesday noon", withinLoginWindow(roles, tueNoon));
  no("Mon–Sat role is refused on Sunday", withinLoginWindow(roles, sunNoon), "not allowed today");
}

console.log("\n§4 A missing sanction limit means ZERO — unlimited is explicit and reasoned");
eq("a blank limit is stored as zero paise",
  { p: validLimit({ limitRs: "" }).limitPaise, u: validLimit({ limitRs: "" }).isUnlimited },
  { p: 0, u: false });
eq("₹3,00,000 becomes 30000000 paise", validLimit({ limitRs: 300000 }).limitPaise, 30000000);
no("a limit not in whole ₹100 is refused", validLimit({ limitRs: 250 }), "multiples of ₹100");
no("a negative limit is refused", validLimit({ limitRs: -5 }), "zero or a positive");
no("unlimited without a reason is refused",
  validLimit({ isUnlimited: true }), "written reason");
no("unlimited with a 3-character reason is refused",
  validLimit({ isUnlimited: true, reason: "ok!" }), "written reason");
ok("unlimited with a real reason is accepted",
  validLimit({ isUnlimited: true, reason: "Owner of the business" }));
no("unlimited AND a rupee figure together are refused",
  validLimit({ isUnlimited: true, limitRs: 500000, reason: "Owner of the business" }), "clear one");
eq("an unlimited grant stores limit_paise 0 (the DB CHECK demands it)",
  validLimit({ isUnlimited: true, reason: "Owner of the business" }).limitPaise, 0);

console.log("\n§5 The business can never lock itself out of Settings");
const holders = [
  { roleId: 1, hasRolesEdit: true, activeMembers: 1 },   // Owner
  { roleId: 3, hasRolesEdit: false, activeMembers: 2 },  // Counter Operator
];
ok("removing settings from a role nobody-admin holds is fine",
  leavesAnAdmin(holders, 3, false));
no("removing settings from the ONLY admin role is refused",
  leavesAnAdmin(holders, 1, false), "no active employee able to edit roles");
ok("removing settings from Owner is fine if another staffed role keeps it",
  leavesAnAdmin([...holders, { roleId: 5, hasRolesEdit: true, activeMembers: 1 }], 1, false));
no("a settings-full role with ZERO members does not count as an admin",
  leavesAnAdmin([
    { roleId: 1, hasRolesEdit: true, activeMembers: 1 },
    { roleId: 9, hasRolesEdit: true, activeMembers: 0 },
  ], 1, false), "no active employee");
ok("keeping settings on the edited role passes trivially", leavesAnAdmin(holders, 1, true));

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
