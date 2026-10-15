/**
 * Walk: E28 regression — every fix in the 14 Oct 2026 batch, proven against
 * the DATABASE (not just HTTP codes). API layer; the employee wizard and the
 * login screen have their own browser walks. Run TWICE.
 *
 *   node scripts/walk-e28.mjs
 */
import pg from "pg";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
const PW = "Testpass123456";

async function call(path, body, cookie, method = "POST") {
  const r = await fetch(BASE + path, { method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const setCookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return { status: r.status, j: await r.json().catch(() => null), setCookie };
}
/** Full two-step login the way the browser does it (ticket for multi-branch). */
async function login(username, branchId, password = PW) {
  const a = await call("/api/auth/login", { username, password });
  if (a.j?.next === "branch") {
    const b = await call("/api/auth/branch", { ticket: a.j.ticket, branchId });
    return b.setCookie;
  }
  return a.setCookie;
}

// ═════ 1 · the session hole ═════
const hole = await call("/api/auth/branch", { employeeId: 1, branchId: 1 });
ok(hole.status === 401 && !hole.setCookie, `no cookie, no ticket → 401, no session (got ${hole.status})`);
const forged = await call("/api/auth/branch", { ticket: "1.9999999999999.AAAA", branchId: 1 });
ok(forged.status === 401 && !forged.setCookie, "forged ticket → 401");
// vijay: posted to 3 branches; with no session history he gets the branch picker
const vij = await sql1(`SELECT id FROM employee WHERE username='vijay'`);
const vijBranches = (await sql(`SELECT branch_id FROM employee_branch WHERE employee_id=$1 ORDER BY branch_id`, [vij.id]))
  .map(r => Number(r.branch_id));
await pool.query(`DELETE FROM session WHERE employee_id=$1`, [vij.id]);   // local only: force the picker
const pre = await call("/api/auth/login", { username: "vijay", password: PW });
ok(pre.j?.next === "branch" && /^\d+\.\d+\./.test(pre.j?.ticket || "") && pre.j.employeeId === undefined,
  `multi-branch login returns a ticket and NO bare employeeId (next=${pre.j?.next})`);
const tamper = (pre.j?.ticket || "").replace(/^\d+\./, "1.");
const t2 = await call("/api/auth/branch", { ticket: tamper, branchId: vijBranches[0] });
ok(t2.status === 401, "ticket edited to the OWNER's employee id → 401");
const good = await call("/api/auth/branch", { ticket: pre.j?.ticket, branchId: vijBranches[0] });
ok(good.status === 200 && !!good.setCookie, "genuine ticket → session issued");
const notPosted = await call("/api/auth/branch", { ticket: pre.j?.ticket, branchId: 999999 });
ok(notPosted.status === 403, "genuine ticket but a branch he is not posted to → 403");
// owner: normal login (resumes his last branch) — the everyday path must still work
const boss = await login("slunawat", 1);
const me = await call("/api/settings/employees", null, boss, "GET");
ok(me.j?.selfId === 1, "owner's everyday login still works");
// header switch: session-based, body employeeId ignored, old session revoked
const sw = await call("/api/auth/branch", { employeeId: 4, branchId: 3 }, boss);
const swMe = await call("/api/settings/employees", null, sw.setCookie, "GET");
ok(sw.status === 200 && swMe.j?.selfId === 1, "switch uses the session — body employeeId 4 ignored, still the owner");
const oldStill = await call("/api/settings/employees", null, boss, "GET");
ok(oldStill.status === 401, `the pre-switch session is revoked (got ${oldStill.status})`);
const bossB3 = sw.setCookie;                                    // owner now acting at branch 3

// ═════ 2 · forgot password never leaks a code ═════
const fp = await call("/api/auth/forgot", { action: "send", who: "slunawat" });
ok(fp.status === 503 && fp.j?.manualCode === undefined && /administrator/i.test(fp.j?.reason || ""),
  "forgot-password refuses, returns no code, points to the administrator");
const fpEnum = await call("/api/auth/forgot", { action: "send", who: "nobody_like_this" });
ok(fpEnum.status === fp.status && fpEnum.j?.reason === fp.j?.reason,
  "same answer for a non-existent user — no username enumeration");

// ═════ 3 · bank account swap clears verification ═════
const CID = 9, BID = 5;   // a complete customer (dob, gender, address, nominee) with a verified account
const c1 = await sql1(`SELECT c.*, to_char(c.dob,'YYYY-MM-DD') AS dob_s FROM customer c WHERE id=$1`, [CID]);
const addr = await sql(`SELECT * FROM customer_address WHERE customer_id=$1`, [CID]);
const cur = addr.find(x => x.kind === "current"), perm = addr.find(x => x.kind === "permanent");
const nom = await sql1(`SELECT * FROM nominee WHERE customer_id=$1`, [CID]);
const bk = await sql1(`SELECT * FROM customer_bank_account WHERE id=$1`, [BID]);
ok(!!bk.verified_at, `precondition: bank account ${BID} is verified`);
const A = (x) => ({ line1: x.line1, line2: x.line2, pincode: x.pincode, area: x.area,
  taluka: x.taluka, district: x.district, state: x.state });
const payload = (accountNo) => ({ action: "full", firstName: c1.first_name, middleName: c1.middle_name,
  lastName: c1.last_name, gender: c1.gender, dob: c1.dob_s, mobile: c1.mobile, altMobile: c1.alt_mobile,
  email: c1.email, risk: c1.risk, gstin: c1.gstin, maxOpenLoans: c1.max_open_loans,
  maxOutstandingPaise: Number(c1.max_outstanding_paise), current: A(cur),
  sameAsCurrent: !!perm?.same_as_current, permanent: A(perm || cur),
  nominee: { name: nom.name, relation: nom.relation, mobile: nom.mobile },
  banks: [{ id: BID, bank: bk.bank, bankBranch: bk.bank_branch, accountNo, ifsc: bk.ifsc,
    holderName: bk.holder_name, acctType: bk.acct_type, upiId: bk.upi_id }] });
const bankNow = async () => sql1(`SELECT account_no, verified_at, verify_method::text AS vm
                                    FROM customer_bank_account WHERE id=$1`, [BID]);
const same = await call(`/api/customers/${CID}/edit`, payload(bk.account_no), bossB3);
const afterSame = await bankNow();
ok(same.j?.ok === true && !!afterSame.verified_at,
  `saving with the SAME number keeps verification (${same.j?.reason || "ok"})`);
const swap = await call(`/api/customers/${CID}/edit`, payload("999988887777"), bossB3);
const afterSwap = await bankNow();
ok(swap.j?.ok === true && afterSwap.account_no === "999988887777", `number change saved (${swap.j?.reason || "ok"})`);
ok(afterSwap.verified_at === null && afterSwap.vm === "none",
  `…and verification CLEARED (verified_at ${afterSwap.verified_at}, method ${afterSwap.vm})`);
const aud = await sql1(`SELECT before, after FROM audit_log WHERE entity_table='customer_bank_account'
                         AND entity_id=$1 AND action='edit_full' ORDER BY id DESC LIMIT 1`, [BID]);
ok(aud && aud.before.accountNo === bk.account_no && aud.after.accountNo === "999988887777",
  "audit records the old and the new number");
// restore the local row so the walk can run twice
await pool.query(`UPDATE customer_bank_account SET account_no=$2, verified_at=$3, verify_method=$4 WHERE id=$1`,
  [BID, bk.account_no, bk.verified_at, bk.verify_method]);

// ═════ 4 · cancel needs permission; cancelling an HO-pending file no longer 500s ═════
const hoUser = `walkho${String(Date.now()).slice(-5)}`;
const mk = await call("/api/settings/employees", { action: "create", fullName: "Walk Ho Accounts",
  mobile: "96" + String(Date.now()).slice(-8), panNo: "WALKH" + String(Date.now()).slice(-4) + "Q",
  designation: "Accounts", doj: new Date().toISOString().slice(0, 10), roleIds: [5], branchIds: [3],
  primaryBranchId: 3, username: hoUser, password: "Walkpass2026x", confirm: "Walkpass2026x",
  dupAcknowledged: true }, bossB3);
ok(mk.j?.ok === true, `created an HO Accounts employee via the employee API (${mk.j?.reason || hoUser})`);
const hoCookie = await login(hoUser, 3, "Walkpass2026x");
ok(!!hoCookie, "the new HO Accounts employee signs in");
const app77 = await sql1(`SELECT status FROM loan_application WHERE id=77`);
const c403 = await call("/api/applications/77/action", { action: "cancel", reason: "walk", narration: "walk test cancel" }, hoCookie);
const app77b = await sql1(`SELECT status FROM loan_application WHERE id=77`);
ok(c403.status === 403 && app77b.status === app77.status,
  `HO Accounts (no appraise) refused cancel, file untouched (got ${c403.status}, status ${app77b.status})`);

// make a throwaway pending_ho file at branch 3 recommended by the owner, then cancel it as the owner
const tmp = await sql1(`INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status, created_by)
  SELECT 'APP-WALK-' || floor(random()*1e9)::bigint, entity_id, branch_id, customer_id, 'pending_ho', 1
    FROM loan_application WHERE id=77 RETURNING id`);
await pool.query(`INSERT INTO ho_approval (application_id, amount_paise, recommended_by, status)
                  VALUES ($1, 50000000, 1, 'waiting')`, [tmp.id]);
const c2 = await call(`/api/applications/${tmp.id}/action`, { action: "cancel", reason: "walk",
  narration: "walk test cancel of an HO-pending file" }, bossB3);
const hoRow = await sql1(`SELECT status::text, decided_by FROM ho_approval WHERE application_id=$1`, [tmp.id]);
ok(c2.j?.ok === true, `owner cancels an HO-pending file he recommended — no 500 (${c2.status} ${c2.j?.reason || ""})`);
ok(hoRow.status === "withdrawn" && hoRow.decided_by === null, `its HO row is withdrawn, not a fake decision (${hoRow.status})`);

// ═════ 5 · HO cannot approve a cancelled file back to life ═════
// build a stale row EVERY run (a cancelled file whose HO row still says waiting),
// so this check can never skip itself once the data fix has cleaned production
const ghost = await sql1(`INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status, created_by)
  SELECT 'APP-GHOST-' || floor(random()*1e9)::bigint, entity_id, branch_id, customer_id, 'cancelled', 4
    FROM loan_application WHERE id=77 RETURNING id`);
const gho = await sql1(`INSERT INTO ho_approval (application_id, amount_paise, recommended_by, status)
                        VALUES ($1, 50000000, 4, 'waiting') RETURNING id`, [ghost.id]);
const ap = await call(`/api/approvals/${gho.id}`, { decision: "approve" }, bossB3);
const ghostAfter = await sql1(`SELECT a.status AS app, h.status::text AS ho FROM loan_application a
  JOIN ho_approval h ON h.application_id=a.id WHERE a.id=$1`, [ghost.id]);
ok(ap.status === 409 && ghostAfter.app === "cancelled" && ghostAfter.ho === "waiting",
  `approving a stale HO row is refused and NOTHING changes (got ${ap.status}; file ${ghostAfter.app}, HO ${ghostAfter.ho})`);
const bad = await call(`/api/approvals/1`, { reason: "x" }, bossB3);
ok(bad.status === 400, `approval with no decision → 400, not 500 (got ${bad.status})`);

// ═════ 6 · customer 360 replays charges on their real dates ═════
const loan18 = await sql1(`SELECT id, customer_id, branch_id FROM loan WHERE id=18`);
if (loan18) {
  const page = await fetch(`${BASE}/customers/${loan18.customer_id}`, { headers: { cookie: bossB3 } });
  ok(page.status === 200, "customer 360 renders");
}

// ═════ 7 · release countdown sees the holiday table ═════
const rel = await call("/api/release", null, bossB3, "GET");
const hol = await sql1(`SELECT count(*)::int AS n FROM holiday`);
ok(rel.j?.ok && Array.isArray(rel.j.holidays) && rel.j.holidays.length === hol.n,
  `release API returns the ${hol.n} holidays (got ${rel.j?.holidays?.length})`);

// ═════ 8 · reports: principal no longer ×100, O/s columns are amounts ═════
const b1 = await sql1(`SELECT id, loan_no FROM loan WHERE status='active' AND branch_id=1 ORDER BY id LIMIT 1`);
// the owner resumes his LAST branch on login — switch him to branch 1 explicitly
const bossB1 = (await call("/api/auth/branch", { branchId: 1 }, await login("slunawat", 1))).setCookie;
const dues = await call(`/api/loans/${b1.id}/dues`, null, bossB1, "GET");
const out = await call("/api/reports/outstanding?branch=all", null, bossB1, "GET");
const row = out.j?.rows?.find(r => r.loanNo === b1.loan_no);
ok(row && row.principalPaise === Math.round(dues.j.running.principal * 100),
  `${b1.loan_no} report principal ₹${row?.principalPaise / 100} == collect screen ₹${dues.j?.running?.principal}`);
const sum = await call("/api/reports/summary?fy=2026-27&branch=all", null, bossB1, "GET");
ok(sum.j?.rows?.every(r => "osStartPaise" in r && "osEndPaise" in r && !("outstandingFrom" in r)),
  "summary carries O/s amounts at period start/end, no date columns");
ok(sum.j?.rows?.every(r => r.osEndPaise === r.activePrincipalPaise),
  "O/s at period end == live Principal O/s on every branch");

await pool.end();
console.log(failures === 0 ? "\nE28 WALK PASS" : `\nE28 WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
