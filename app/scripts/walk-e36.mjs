/**
 * Walk: E36 — interest paid-up-to / due-for in DAYS (owner, 15 Oct 2026). API + DB. Run TWICE
 * (each run takes receipts on a fresh never-paid B3 loan; receipts are append-only).
 *  · dues API carries `coverage`; nothing paid → due for the loan's whole age
 *  · a PART payment: the receipt answers coverageAfter; dues agrees; paid + due = cycle days;
 *    the days bought equal what the engine's per-day figure says
 *  · paying the balance interest: paid up to today, nothing due, lifetime = age
 *  · the loan page shows the clock; a closed loan shows none
 *  · stored appropriations unchanged in meaning (replay audit run separately)
 */
import pg from "pg";
pg.types.setTypeParser(1082, v => v);
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
  return { status: r.status, j, text };
}
async function loginAt(username, branchId) {
  const a = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "Testpass123456" }) });
  const j = await a.json(); let c = (a.headers.get("set-cookie") || "").split(";")[0];
  if (j.next === "branch") c = ((await fetch(BASE + "/api/auth/branch", { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ ticket: j.ticket, branchId }) })).headers.get("set-cookie") || "").split(";")[0];
  const s = await fetch(BASE + "/api/auth/branch", { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ branchId }) });
  return (s.headers.get("set-cookie") || "").split(";")[0] || c;
}
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.split("-").reverse().join("-");
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const nag = await loginAt("nagin.kothari", 3);
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;

// a never-paid, charge-free B3 loan at least 40 days old, interest due comfortably above ₹100
const L = await sql1(`SELECT l.id, l.loan_no, l.disbursed_at::text AS disbursed_at, l.principal_paise FROM loan l
  WHERE l.status='active' AND l.branch_id=3 AND l.principal_paise >= 2000000 AND l.disbursed_at <= CURRENT_DATE - 40
    AND NOT EXISTS (SELECT 1 FROM receipt r WHERE r.loan_id=l.id)
    AND NOT EXISTS (SELECT 1 FROM loan_charge c WHERE c.loan_id=l.id AND c.removed_at IS NULL)
  ORDER BY l.id LIMIT 1`);
ok(!!L, `fixture: ${L?.loan_no} disbursed ${L?.disbursed_at} principal ₹${L?.principal_paise / 100}`);

// ═════ 1 · nothing paid ═════
const d0 = await call(`/api/loans/${L.id}/dues`, null, nag);
const c0 = d0.j?.coverage;
ok(d0.j?.ok && c0, "dues API carries coverage");
ok(c0.paidDaysTotal === 0 && c0.paidDays === 0 && c0.paidUpTo === addDays(L.disbursed_at, -1), `nothing paid: paid up to the day before disbursement (${c0.paidUpTo})`);
ok(c0.dueDays === d0.j.ageDays && c0.cycleDays === d0.j.ageDays && c0.dueFrom === L.disbursed_at && c0.dueTo === today, `due for all ${c0.dueDays} days (${dmy(c0.dueFrom)} → today)`);
ok(c0.interestDuePaise === Math.round(d0.j.running.interest.due * 100), `coverage's rupees = running interest due ₹${d0.j.running.interest.due}`);
ok(c0.perDayPaise > 0 && Math.abs(c0.perDayPaise - (L.principal_paise * c0.ratePct) / (100 * 360)) < 1 || Math.abs(c0.perDayPaise - (L.principal_paise * c0.ratePct) / (100 * 365)) < 1, `per-day = principal × ${c0.ratePct}% / year (${(c0.perDayPaise / 100).toFixed(2)}/day)`);
const lp0 = await call(`/loans/${L.id}`, null, nag);
ok(lp0.status === 200 && /data-interest-clock="(warn|bad)"/.test(lp0.text) && /No interest paid yet/.test(lp0.text) && lp0.text.includes(`Due for ${c0.dueDays} days`), "loan page: clock strip says no interest paid, due for N days");

// ═════ 2 · a PART payment: penal + charges + roughly half the interest ═════
const run = d0.j.running;
const halfInt = Math.max(100, Math.floor(run.interest.due / 2 / 10) * 10);
const amt = Math.round(run.charges.due + run.penal.due + halfInt);
const r1 = await call(`/api/loans/${L.id}/receipt`, { amountPaise: amt * 100, mode: "cash", utr: "", closing: false }, nag);
ok(r1.j?.ok === true && r1.j.coverageAfter, `receipt ₹${amt} taken (${r1.j?.reason || r1.j?.receiptNo}) — answers coverageAfter`);
const ca = r1.j.coverageAfter;
const toInt = Math.round(r1.j.appropriation.interest * 100);
const expectDays = Math.min(c0.dueDays - 1, Math.floor(toInt / c0.perDayPaise));
ok(ca.paidDays === expectDays && ca.paidUpTo === addDays(L.disbursed_at, expectDays - 1), `₹${toInt / 100} to interest bought ${ca.paidDays} days (expected ${expectDays}) → paid up to ${dmy(ca.paidUpTo)}`);
ok(ca.paidDays + ca.dueDays === ca.cycleDays && ca.dueFrom === addDays(ca.paidUpTo, 1) && ca.dueTo === today, `paid ${ca.paidDays} + due ${ca.dueDays} = cycle ${ca.cycleDays}; due runs ${dmy(ca.dueFrom)} → today`);
ok(ca.interestDuePaise === Math.round(run.interest.due * 100) - toInt, `rupees still due ₹${ca.interestDuePaise / 100} = ₹${run.interest.due} − ₹${toInt / 100}`);
ok(ca.cycleFrom === L.disbursed_at, "a part payment did NOT move the cycle anchor (R-C)");
const d1 = await call(`/api/loans/${L.id}/dues`, null, nag);
ok(JSON.stringify(d1.j.coverage) === JSON.stringify(ca), "dues API after the receipt agrees exactly with coverageAfter");
const lp1 = await call(`/loans/${L.id}`, null, nag);
ok(lp1.text.includes(`Interest paid up to ${dmy(ca.paidUpTo)} (${ca.paidDaysTotal} days)`) && lp1.text.includes(`Due for ${ca.dueDays} days`), "loan page: paid up to / due for after the part payment");
const pen = await sql1(`SELECT coalesce(sum(ra.amount_paise),0)::bigint AS i FROM receipt_appropriation ra JOIN receipt r ON r.id=ra.receipt_id WHERE r.loan_id=$1 AND ra.bucket='interest'`, [L.id]);
ok(Number(pen.i) === toInt, "stored appropriation to interest matches what the preview was told");

// ═════ 3 · the balance interest: paid up to today ═════
const r2 = await call(`/api/loans/${L.id}/receipt`, { amountPaise: Math.round((d1.j.running.charges.due + d1.j.running.penal.due + d1.j.running.interest.due) * 100), mode: "cash", utr: "", closing: false }, nag);
const cb = r2.j?.coverageAfter;
ok(r2.j?.ok === true && r2.j.sealsCycle === true, `balance interest taken — seals the cycle (${r2.j?.reason || "ok"})`);
ok(cb.paidUpTo === today && cb.dueDays === 0 && cb.advanceDays === 0 && cb.paidDaysTotal === d0.j.ageDays, `paid up to today (${cb.paidDaysTotal} days), nothing due`);
const d2 = await call(`/api/loans/${L.id}/dues`, null, nag);
ok(d2.j.coverage.dueDays === 0 && d2.j.running.interest.due === 0, "dues: no interest due today");
const lp2 = await call(`/loans/${L.id}`, null, nag);
ok(/data-interest-clock="ok"/.test(lp2.text) && /Nothing due today/.test(lp2.text), "loan page: green clock, nothing due today");

// ═════ 4 · a closed loan shows no clock ═════
const R = await sql1(`SELECT id FROM loan WHERE status='released' AND branch_id=3 LIMIT 1`);
const lpR = await call(`/loans/${R.id}`, null, nag);
ok(lpR.status === 200 && !/data-interest-clock/.test(lpR.text), "released loan: no interest clock");

await pool.end();
console.log(failures ? `\n${failures} FAILED` : "\nE36 WALK PASS");
process.exit(failures ? 1 : 0);
