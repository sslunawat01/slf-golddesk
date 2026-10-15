/**
 * Walk: E32 — the owner's 15 Oct punch list, API + DATABASE layer. Run TWICE.
 *  №2/3/4 wizard: scheme-first + weights are UI (walk-e32-ui); remark saves via PATCH
 *  №5 warning / blacklist remarks: permission, lending block, search, audit
 *  №6 cash limits: setting, API, disbursement + receipt checks, DB trigger
 *  №7 loan amount on the loan page · №8/9 day book blocks · №10 age · №11 photos
 */
import pg from "pg";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
async function call(path, body, cookie, method = body == null ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, setCookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
async function loginAt(username, branchId) {
  const a = await call("/api/auth/login", { username, password: "Testpass123456" });
  let c = a.setCookie;
  if (a.j?.next === "branch") c = (await call("/api/auth/branch", { ticket: a.j.ticket, branchId })).setCookie;
  const s = await call("/api/auth/branch", { branchId }, c);
  return s.setCookie || c;
}
const RUN = String(Date.now()).slice(-6);
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const own = await loginAt("slunawat", 3);
const nag = await loginAt("nagin.kothari", 3);          // Branch Manager at B3: edit_customer + blacklist (seeded)

// ═════ №5 · remarks ═════
const cust = await sql1(`SELECT c.id, c.cust_no, c.full_name FROM customer c JOIN loan l ON l.customer_id=c.id AND l.status='active'
  WHERE c.cust_no LIKE 'IND%' AND c.blacklist_remark IS NULL AND c.warning_remark IS NULL ORDER BY c.id LIMIT 1`);
const w1 = await call(`/api/customers/${cust.id}/edit`, { action: "remarks", warningRemark: `Walk warning ${RUN}` }, nag);
ok(w1.j?.ok === true, `warning remark set by a Branch Manager (${w1.j?.reason || "ok"})`);
const s1 = await call(`/api/search?q=${cust.cust_no}`, null, nag);
ok(s1.j?.customers?.[0]?.warningRemark === `Walk warning ${RUN}`, "search carries the warning remark");
const b1 = await call(`/api/customers/${cust.id}/edit`, { action: "remarks", warningRemark: `Walk warning ${RUN}`, blacklistRemark: `Walk blacklist ${RUN}` }, nag);
ok(b1.j?.ok === true, "blacklist remark set by someone holding the Blacklist permission");
const row = await sql1(`SELECT is_blacklisted, blacklist_remark, warning_remark FROM customer WHERE id=$1`, [cust.id]);
ok(row.is_blacklisted === true, "the database marks the customer blacklisted from the remark alone");
const np = await call(`/api/applications`, { customerId: cust.id }, nag);
ok(np.status >= 400 && /blacklist/i.test(np.j?.reason || ""), `a new pledge is refused: ${np.j?.reason}`);
const s2 = await call(`/api/search?q=${cust.cust_no}`, null, nag);
ok(s2.j?.customers?.[0]?.isBlacklisted === true && s2.j.customers[0].blacklistRemark === `Walk blacklist ${RUN}`, "search shows blacklisted + remark");
const au = await sql1(`SELECT action, after FROM audit_log WHERE entity_table='customer' AND entity_id=$1 AND action='customer_blacklisted' ORDER BY id DESC LIMIT 1`, [cust.id]);
ok(au && au.after.blacklistRemark === `Walk blacklist ${RUN}`, "audit row customer_blacklisted carries the remark");
// a role WITHOUT the blacklist permission: strip it from Branch Manager temporarily
const bm = await sql1(`SELECT r.id FROM role r JOIN employee_role er ON er.role_id=r.id JOIN employee e ON e.id=er.employee_id WHERE e.username='nagin.kothari' AND er.effective_to IS NULL`);
await pool.query(`UPDATE role_permission SET can_add=false, can_edit=false WHERE role_id=$1 AND fn='blacklist'`, [bm.id]);
const nag2 = await loginAt("nagin.kothari", 3);
const b2 = await call(`/api/customers/${cust.id}/edit`, { action: "remarks", warningRemark: `Walk warning ${RUN}`, blacklistRemark: "" }, nag2);
ok(b2.status === 403, `without the permission, clearing the blacklist is refused (${b2.status})`);
const w2 = await call(`/api/customers/${cust.id}/edit`, { action: "remarks", warningRemark: `Walk warning ${RUN} edited`, blacklistRemark: `Walk blacklist ${RUN}` }, nag2);
ok(w2.j?.ok === true, "…but a warning remark still saves (edit-customer right)");
await pool.query(`UPDATE role_permission SET can_add=true, can_edit=true WHERE role_id=$1 AND fn='blacklist'`, [bm.id]);
const page = await call(`/customers/${cust.id}`, null, own);
ok(page.status === 200 && page.text.includes(`Walk blacklist ${RUN}`) && page.text.includes("Edit remarks"), "customer 360 shows the remarks card");
const rp = await sql1(`SELECT l.id FROM loan l WHERE l.customer_id=$1 AND l.status='active' LIMIT 1`, [cust.id]);
const rpg = await call(`/repay/${rp.id}`, null, own);
ok(rpg.status === 200 && rpg.text.includes(`Walk blacklist ${RUN}`), "collect screen carries the remark pop-up");
// clear both (owner has the permission) — leaves the data as it was
const clr = await call(`/api/customers/${cust.id}/edit`, { action: "remarks", warningRemark: "", blacklistRemark: "" }, own);
const row2 = await sql1(`SELECT is_blacklisted FROM customer WHERE id=$1`, [cust.id]);
ok(clr.j?.ok === true && row2.is_blacklisted === false, "owner clears both remarks → blacklist lifted");

// ═════ №6 · cash limits ═════
const lim0 = await call(`/api/settings/limits`, null, own);
ok(lim0.j?.ok && lim0.j.limits.cash_disburse_below_paise.paise === 2000000 && lim0.j.limits.cash_receipt_day_max_paise.paise === 20000000,
  "limits API returns the two legal defaults");
const nagLim = await call(`/api/settings/limits`, null, nag);
ok(nagLim.status === 403, `a Branch Manager may not see limits (${nagLim.status})`);
const bad = await call(`/api/settings/limits`, { cash_disburse_below_paise: 123456 }, own);
ok(bad.status === 400, "a non-₹100 figure is refused");
const up = await call(`/api/settings/limits`, { cash_disburse_below_paise: 5000000, cash_receipt_day_max_paise: 30000000 }, own);
ok(up.j?.ok === true && up.j.changed === 2, "owner raises both limits (override recorded)");
const auL = await sql1(`SELECT after FROM audit_log WHERE action='limit_changed' ORDER BY id DESC LIMIT 1`);
ok(auL?.after?.aboveLegal === true, "audit says the new figure is above the legal one");
// DB trigger honours the setting: a ₹25,000 cash leg is now accepted, ₹50,000 is not
const anyDisb = await sql1(`SELECT id FROM disbursement ORDER BY id LIMIT 1`);
const tryLeg = async (paise) => { const c = await pool.connect(); try { await c.query("BEGIN");
  await c.query(`INSERT INTO disbursement_leg (disbursement_id, kind, amount_paise) VALUES ($1,'cash',$2)`, [anyDisb.id, paise]);
  return "accepted"; } catch (e) { return e.message; } finally { await c.query("ROLLBACK"); c.release(); } };
ok(await tryLeg(2500000) === "accepted", "DB: ₹25,000 cash leg accepted under the raised limit (rolled back)");
ok(/below ₹50000/.test(await tryLeg(5000000)), `DB: ₹50,000 cash leg refused ("${(await tryLeg(5000000)).slice(0, 50)}")`);
// receipt route: ₹2,50,000 cash on an imported loan is accepted under the raised daily cap, refused after reset
const big = await sql1(`SELECT l.id FROM loan l JOIN customer c ON c.id=l.customer_id WHERE l.status='active' AND l.loan_no LIKE '03A%'
   AND l.principal_paise > 30000000 AND NOT EXISTS (SELECT 1 FROM receipt r WHERE r.loan_id=l.id AND r.business_date=CURRENT_DATE) ORDER BY l.principal_paise DESC LIMIT 1`);
const r250 = await call(`/api/loans/${big.id}/receipt`, { mode: "cash", amountPaise: 25000000 }, own);
ok(r250.j?.ok === true, `₹2,50,000 cash receipt accepted under the raised daily cap (${r250.j?.receiptNo || r250.j?.reason})`);
const back = await call(`/api/settings/limits`, { cash_disburse_below_paise: 2000000, cash_receipt_day_max_paise: 20000000 }, own);
ok(back.j?.ok === true, "limits restored to the legal figures");
const r2 = await call(`/api/loans/${big.id}/receipt`, { mode: "cash", amountPaise: 1000 }, own);
ok(r2.status === 400 && /2,00,000/.test(r2.j?.reason || ""), `…and another ₹10 cash today is refused: ${r2.j?.reason}`);
ok((await tryLeg(2500000)) !== "accepted", "DB: ₹25,000 cash leg refused again at the legal limit");

// ═════ №4 · remark on the file, №7 · loan amount, №11 · photos ═════
const appr = await sql1(`SELECT id FROM loan_application WHERE status IN ('draft','appraised') AND branch_id=3 ORDER BY id DESC LIMIT 1`)
  || await sql1(`SELECT id FROM loan_application WHERE status='approved' ORDER BY id DESC LIMIT 1`);
const pr = await call(`/api/applications/${appr.id}`, { remark: `Walk remark ${RUN}` }, own, "PATCH");
const saved = await sql1(`SELECT remark FROM loan_application WHERE id=$1`, [appr.id]);
ok(saved?.remark === `Walk remark ${RUN}`, `remark saved on the application (${pr.status})`);
const anyLoan = await sql1(`SELECT l.id, l.loan_no, l.principal_paise FROM loan l WHERE l.status='active' AND l.loan_no LIKE '03A%' ORDER BY id LIMIT 1`);
const lp = await call(`/loans/${anyLoan.id}`, null, own);
ok(lp.status === 200 && lp.text.includes("Loan amount") && lp.text.includes("Sealed packet"),
  "loan page shows the Loan amount tile and the sealed-packet photo");
const ld = await call(`/api/reports/loandetails?loanNo=${anyLoan.loan_no}`, null, own);
ok(ld.j?.ok && "remark" in ld.j.loan, "Loan Details carries the remark field");
const dobCust = await sql1(`SELECT id, dob FROM customer WHERE dob IS NOT NULL ORDER BY id LIMIT 1`);
const c360 = await call(`/customers/${dobCust.id}`, null, own);
ok(c360.status === 200 && /age \d+/.test(c360.text), `customer 360 shows the age (born ${dobCust.dob})`);

// ═════ №8/№9 · day book ═════
const db = await call(`/api/reports/daybook?branch=3&date=2025-10-29`, null, own);
ok(db.j?.ok && Array.isArray(db.j.disbursed) && Array.isArray(db.j.collected), "day book has the two blocks");
const anyColl = db.j?.collected?.find(x => x.interestPaise > 0 || x.principalPaise > 0);
ok(anyColl && anyColl.chargesPaise + anyColl.penalPaise + anyColl.interestPaise + anyColl.principalPaise === anyColl.amountPaise,
  `a collected row splits into charges+penal+interest+principal = total (${anyColl?.receiptNo})`);
const dbPage = await call(`/reports/daybook`, null, own);
ok(dbPage.status === 200, "day book page renders");

// ═════ №10 · age on create ═════
const sfx = String(Date.now()).slice(-6);
const minor = await call("/api/customers", { custType: "individual", firstName: "Minor", lastName: "Test", dob: "2012-05-05", gender: "male",
  aadhaar: "7123" + sfx + "45", aadhaarVerified: true, photoFileId: 1, mobile: "94" + sfx + "77",
  current: { line1: "1 Walk Road", pincode: "422101" }, sameAsCurrent: true, nominee: { name: "N", relation: "son" },
  maxOpenLoans: 2, maxOutstandingPaise: 20000000, banks: [] }, own);
ok(minor.status === 400 && /18 years/.test(minor.j?.reason || ""), `a 14-year-old is refused: ${minor.j?.reason}`);

// ═════ settings page lists Limits for the owner, roles list the two new rights ═════
const sp = await call(`/settings`, null, own);
ok(sp.status === 200 && sp.text.includes("Limits"), "Settings shows the Limits tab");
const roles = await call(`/api/settings/roles`, null, own);
ok(roles.status === 200 && /blacklist/.test(roles.text) && /set_limits/.test(roles.text), "roles API carries blacklist and set_limits");

await pool.end();
console.log(failures === 0 ? "\nE32 WALK PASS" : `\nE32 WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
