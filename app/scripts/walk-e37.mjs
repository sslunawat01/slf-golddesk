/**
 * Walk: E37 — engine 1.3.0, "a part payment buys days" (owner rulings, 15 Oct 2026). API + DB. Run TWICE.
 *  · part payment on a 24%-cycle: days bought at that day's rate; unpaid days fall; the 24% rate is KEPT
 *  · a full interest payment seals: next cycle at the first slab
 *  · penal: once running it stays running through a part payment that pulls the unpaid days under tenure
 *  · stored receipts fold as facts; the audit reconciles the whole book
 */
import pg from "pg";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
async function call(path, body, cookie, method = body == null ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method, redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
async function loginAt(username, branchId) {
  const a = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Testpass123456" }) });
  const j = await a.json(); let c = (a.headers.get("set-cookie") || "").split(";")[0];
  if (j.next === "branch") c = ((await fetch(BASE + "/api/auth/branch", { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ ticket: j.ticket, branchId }) })).headers.get("set-cookie") || "").split(";")[0];
  const s = await fetch(BASE + "/api/auth/branch", { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ branchId }) });
  return (s.headers.get("set-cookie") || "").split(";")[0] || c;
}
const f2 = (x) => Number(x).toFixed(2);
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const nag = await loginAt("nagin.kothari", 3);
const pick = (extra) => sql1(`SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at::text AS disbursed_at, (CURRENT_DATE - l.disbursed_at + 1)::int AS age
  FROM loan l JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id
  WHERE l.status='active' AND l.branch_id=3 AND s.code='IND04' AND NOT EXISTS (SELECT 1 FROM receipt r WHERE r.loan_id=l.id)
    AND NOT EXISTS (SELECT 1 FROM loan_charge c WHERE c.loan_id=l.id AND c.removed_at IS NULL) ${extra} ORDER BY l.id LIMIT 1`);

// ═════ 1 · a cycle already on 24%: part payment buys days, rate kept ═════
const A = await pick(`AND l.disbursed_at BETWEEN CURRENT_DATE - 150 AND CURRENT_DATE - 90 AND l.principal_paise >= 2000000`);
ok(!!A, `fixture A: ${A?.loan_no}, day ${A?.age}, ₹${A?.principal_paise / 100} (never paid, on the 24% slab)`);
const d0 = (await call(`/api/loans/${A.id}/dues`, null, nag)).j;
ok(d0.running.interest.ratePct === 24 && d0.coverage.dueDays === A.age, `nothing paid: ${A.age} unpaid days at 24%, ₹${d0.running.interest.due}`);
const perDay = d0.coverage.perDayPaise;
// buy enough days to pull the unpaid count UNDER 63 (back into the 18% band) — the rate must stay 24%
const wantDays = A.age - 50;
const amt = Math.ceil((wantDays * perDay / 100 + d0.running.penal.due + d0.running.charges.due) / 10) * 10;
const r1 = (await call(`/api/loans/${A.id}/receipt`, { amountPaise: amt * 100, mode: "cash", utr: "", closing: false }, nag)).j;
ok(r1.ok && !r1.sealsCycle, `part payment ₹${amt} taken, not sealed (${r1.reason || r1.receiptNo})`);
const toInt = Math.round(r1.appropriation.interest * 100);
const ca = r1.coverageAfter;
ok(f2(ca.paidDays) === f2(toInt / perDay), `₹${toInt / 100} bought ${f2(ca.paidDays)} days at ₹${f2(perDay / 100)}/day (that day's 24% rate)`);
ok(ca.dueDays < 63 && ca.ratePct === 24 && ca.reachedPct === 24, `unpaid days now ${f2(ca.dueDays)} (< 63) — yet the rate stays 24% (ratchet)`);
const d1 = (await call(`/api/loans/${A.id}/dues`, null, nag)).j;
ok(/24% kept until interest is paid in full/.test(d1.running.interest.workLine), `work line: "${d1.running.interest.workLine}"`);
ok(Math.abs(d1.running.interest.due - Math.ceil((ca.dueDays * perDay / 100) / 10) * 10) <= 10, `interest due ₹${d1.running.interest.due} = ${f2(ca.dueDays)} unpaid days × ₹${f2(perDay / 100)}, rounded up to ₹10`);
const row = await sql1(`SELECT engine_version, seals_cycle FROM receipt WHERE loan_id=$1 ORDER BY id DESC LIMIT 1`, [A.id]);
ok(row.engine_version === "1.3.0" && row.seals_cycle === false, "receipt stamped engine 1.3.0, seals_cycle false");
// now pay the balance interest in full → the cycle seals, next cycle at 18%
const r2 = (await call(`/api/loans/${A.id}/receipt`, { amountPaise: Math.round(d1.running.interest.due * 100), mode: "cash", utr: "", closing: false }, nag)).j;
ok(r2.ok && r2.sealsCycle, `full interest ₹${d1.running.interest.due} seals the cycle`);
const d2 = (await call(`/api/loans/${A.id}/dues`, null, nag)).j;
ok(d2.coverage.dueDays === 0 && d2.coverage.paidDaysTotal === A.age && d2.running.interest.due === 0, `paid up to today (${A.age} days), nothing due`);
const cache = await sql1(`SELECT cycle_anchor::text AS c, engine_version FROM loan_accrual_cache WHERE loan_id=$1`, [A.id]);
ok(cache && cache.c > d2.today && cache.engine_version === "1.3.0", `cache: next cycle opens ${cache.c} under 1.3.0`);

// ═════ 2 · penal, once running, survives a part payment (owner Q13) ═════
const B = await pick(`AND l.disbursed_at <= CURRENT_DATE - 230 AND l.principal_paise >= 1000000`);
ok(!!B, `fixture B: ${B?.loan_no}, day ${B?.age} (past tenure + grace, never paid)`);
const b0 = (await call(`/api/loans/${B.id}/dues`, null, nag)).j;
ok(b0.running.penal.running && b0.running.penal.due > 0 && b0.running.penal.from, `penal running from ${b0.running.penal.from}: ₹${b0.running.penal.due}`);
const bPer = b0.coverage.perDayPaise;
const buy = B.age - 100;                                                          // pull unpaid days to ~100, well under tenure 185
const bAmt = Math.ceil((b0.running.penal.due + b0.running.charges.due + buy * bPer / 100) / 10) * 10;
const rb = (await call(`/api/loans/${B.id}/receipt`, { amountPaise: bAmt * 100, mode: "cash", utr: "", closing: false }, nag)).j;
ok(rb.ok && !rb.sealsCycle && rb.appropriation.penal === b0.running.penal.due, `₹${bAmt}: penal ₹${rb.appropriation.penal} first, ₹${rb.appropriation.interest} buys days`);
const b1 = (await call(`/api/loans/${B.id}/dues`, null, nag)).j;
ok(b1.coverage.dueDays < 185 && b1.running.penal.running === true && b1.running.penal.from === b0.running.penal.from, `unpaid days ${f2(b1.coverage.dueDays)} (< tenure) but penal still running from ${b1.running.penal.from}`);
ok(b1.running.penal.due === 0, "penal settled today, so ₹0 due at this moment — it resumes tomorrow");

// ═════ 3 · the whole book reconciles ═════
const { execSync } = await import("node:child_process");
const audit = execSync("node scripts/verify-replay.mjs", { encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" } });
ok(/REPLAY AUDIT PASS/.test(audit), audit.trim().split("\n").slice(-3).join(" | "));

await pool.end();
console.log(failures ? `\n${failures} FAILED` : "\nE37 WALK PASS");
process.exit(failures ? 1 : 0);
