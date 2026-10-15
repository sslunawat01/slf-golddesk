/**
 * Walk: E35 — change my password (owner, 15 Oct 2026). Run TWICE (creates its own throwaway employee).
 *  · voluntary change needs the CURRENT password; wrong / missing / same-as-new refused; policy enforced
 *  · a successful change ends every open session; the new password signs in; audit password_changed
 *  · forced change (temporary password) needs no current password; audit password_set
 *  · admin reset (Settings · Employees) still works: manual password, sessions end, works as-is
 *  · the pages: /setpw voluntary vs forced markers; the profile menu is in every Shell page
 */
import pg from "pg";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
async function call(path, body, cookie, method = body == null ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method, redirect: "manual",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, loc: r.headers.get("location"), setCookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
async function login(username, password, branchId) {
  const a = await call("/api/auth/login", { username, password });
  if (!a.j?.ok) return { cookie: null, j: a.j };
  let c = a.setCookie;
  if (a.j.next === "branch") c = (await call("/api/auth/branch", { ticket: a.j.ticket, branchId })).setCookie;
  return { cookie: c, j: a.j };
}
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;
const own = (await login("slunawat", "Testpass123456", 3)).cookie;
const PW1 = "Walkpass2026x", PW2 = "Newpass2026yz", PW3 = "Resetpass2026q";

// a throwaway Counter Operator at B3
const u = `walkpw${String(Date.now()).slice(-5)}`;
const mk = await call("/api/settings/employees", { action: "create", fullName: "Walk Pw Change", mobile: "95" + String(Date.now()).slice(-8),
  panNo: "WALKP" + String(Date.now()).slice(-4) + "Q", designation: "Walk", doj: today, roleIds: [3], branchIds: [3], primaryBranchId: 3,
  username: u, password: PW1, confirm: PW1, dupAcknowledged: true }, own);
ok(mk.j?.ok === true, `created ${u} (${mk.j?.reason || "ok"})`);
const emp = await sql1(`SELECT id, force_change FROM employee WHERE username=$1`, [u]);
ok(emp && emp.force_change === false, "a created employee's password works as-is (no forced change)");

// ═════ 1 · voluntary change ═════
const s1 = await login(u, PW1, 3);
ok(!!s1.cookie && s1.j.next !== "password", "signs in normally with the given password");
const page = await call("/setpw", null, s1.cookie);
ok(page.status === 200 && /data-setpw="voluntary"/.test(page.text) && /Current password/.test(page.text) && page.text.includes(u), "/setpw for a normal user is the VOLUNTARY form with a current-password field and the username");
const home = await call("/home", null, s1.cookie);
ok(home.status === 200 && /data-me-menu/.test(home.text) && home.text.includes("Walk Pw Change"), "the Shell renders the profile menu button with the user's name");
const v1 = await call("/api/auth/password", { password: PW2 }, s1.cookie);
ok(v1.status === 400 && /current password/i.test(v1.j?.reason || ""), `no current password → 400: ${v1.j?.reason}`);
const v2 = await call("/api/auth/password", { password: PW2, current: "wrongwrong1" }, s1.cookie);
ok(v2.status === 400 && /not correct/i.test(v2.j?.reason || ""), `wrong current password → 400: ${v2.j?.reason}`);
const v3 = await call("/api/auth/password", { password: PW1, current: PW1 }, s1.cookie);
ok(v3.status === 400 && /differ/i.test(v3.j?.reason || ""), `same as current → 400: ${v3.j?.reason}`);
const v4 = await call("/api/auth/password", { password: "short1", current: PW1 }, s1.cookie);
ok(v4.status === 400 && /at least 10/i.test(v4.j?.reason || ""), `policy breach → 400: ${v4.j?.reason}`);
const v5 = await call("/api/auth/password", { password: u, current: PW1 }, s1.cookie);
ok(v5.status === 400 && /username/i.test(v5.j?.reason || ""), `password equal to the username → 400: ${v5.j?.reason}`);
const stillOld = await login(u, PW1, 3);
ok(!!stillOld.cookie, "none of the refusals changed the password");
const s1b = stillOld.cookie;
const v6 = await call("/api/auth/password", { password: PW2, current: PW1 }, s1b);
ok(v6.j?.ok === true, "correct current password → changed");
const dead = await call("/home", null, s1b);
ok([302, 307].includes(dead.status) && /login/.test(dead.loc || ""), `the old session is dead (${dead.status} → ${dead.loc})`);
ok(!(await login(u, PW1, 3)).cookie, "the old password no longer signs in");
const s2 = await login(u, PW2, 3);
ok(!!s2.cookie, "the new password signs in");
const au = await sql1(`SELECT action FROM audit_log WHERE entity_table='employee' AND entity_id=$1 AND action IN ('password_changed','password_set') ORDER BY id DESC LIMIT 1`, [emp.id]);
ok(au?.action === "password_changed", `audit: ${au?.action}`);

// ═════ 2 · admin reset, then the forced path ═════
const rs = await call("/api/settings/employees", { action: "reset_password", id: emp.id, password: PW3, confirm: PW3 }, own);
ok(rs.j?.ok === true, `admin reset to a manual password (${rs.j?.reason || "ok"})`);
ok([302, 307].includes((await call("/home", null, s2.cookie)).status), "the user's open session ended on reset");
const rsBad = await call("/api/settings/employees", { action: "reset_password", id: emp.id, password: "abc", confirm: "abc" }, own);
ok(rsBad.status === 400 && /Password needs/.test(rsBad.j?.reason || ""), `admin reset enforces the policy: ${rsBad.j?.reason}`);
const s3 = await login(u, PW3, 3);
ok(!!s3.cookie && s3.j.next !== "password", "the reset password works as-is (no forced change, as designed)");
// now a FORCED change: mark the account as holding a temporary password
await pool.query(`UPDATE employee SET force_change = TRUE WHERE id=$1`, [emp.id]);
const s4 = await login(u, PW3, 3);
ok(s4.j?.next === "password", `sign-in with a temporary password says next=${s4.j?.next}`);
const fpage = await call("/setpw", null, s4.cookie);
ok(fpage.status === 200 && /data-setpw="forced"/.test(fpage.text) && !/Current password/.test(fpage.text), "/setpw is the FORCED form — no current-password field");
const fhome = await call("/home", null, s4.cookie);
ok([302, 307].includes(fhome.status) && /setpw/.test(fhome.loc || ""), "Home bounces a forced user to /setpw");
const f1 = await call("/api/auth/password", { password: PW2 }, s4.cookie);
ok(f1.j?.ok === true, "forced change needs no current password");
const s5 = await login(u, PW2, 3);
ok(!!s5.cookie && s5.j.next !== "password", "…and the account is normal again");
const au2 = await sql1(`SELECT action FROM audit_log WHERE entity_table='employee' AND entity_id=$1 AND action IN ('password_changed','password_set') ORDER BY id DESC LIMIT 1`, [emp.id]);
ok(au2?.action === "password_set", `audit: ${au2?.action}`);

// ═════ 3 · signed-out callers ═════
const anon = await call("/api/auth/password", { password: PW2, current: PW2 }, null);
ok(anon.status === 401, "signed-out POST is refused");
const anonPage = await call("/setpw", null, null);
ok([302, 307].includes(anonPage.status) && /login/.test(anonPage.loc || ""), "signed-out /setpw goes to login");
const chg = await call("/login?changed=1", null, null);
ok(chg.status === 200, "login page accepts ?changed=1");

// tidy: suspend the throwaway so it never appears in staff lists
await call("/api/settings/employees", { action: "suspend", id: emp.id, dol: today, reason: "walk fixture done" }, own).catch(() => {});
await pool.end();
console.log(failures ? `\n${failures} FAILED` : "\nE35 WALK PASS");
process.exit(failures ? 1 : 0);
