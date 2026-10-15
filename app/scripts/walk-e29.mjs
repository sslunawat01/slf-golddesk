/**
 * Walk: E29 — payout to an UNVERIFIED bank account behind a signed pop-up
 * (owner ruling, 14 Oct 2026). API + DATABASE layers; the pop-up itself is
 * walked in a browser by walk-e29-ui.mjs. Run TWICE.
 *
 * Every scenario disburses a FRESH clone of approved file 77 (payouts are
 * append-only and cannot be undone), disbursed by nagin.kothari — a Branch
 * Manager at branch 3 who is neither the file's creator nor its approver.
 */
import pg from "pg";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

async function call(path, body, cookie, method = "POST") {
  const r = await fetch(BASE + path, { method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null),
    setCookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
async function loginAt(username, branchId) {
  const a = await call("/api/auth/login", { username, password: "Testpass123456" });
  let c = a.setCookie;
  if (a.j?.next === "branch") c = (await call("/api/auth/branch", { ticket: a.j.ticket, branchId })).setCookie;
  const s = await call("/api/auth/branch", { branchId }, c);         // make sure we act at this branch
  return s.setCookie || c;
}
/** A fresh approved copy of file 77: application + items + photos + rates + its approval. */
async function cloneApproved() {
  const a = await sql1(`INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status,
      rate_date, base_paise_snapshot, funding_paise_snapshot, scheme_version_id, requested_paise,
      purpose, borrower_present, presence_photo_id, valuer1_id, valuer2_id, created_by)
    SELECT 'APP-E29-' || floor(random()*1e9)::bigint, entity_id, branch_id, customer_id, 'approved',
      rate_date, base_paise_snapshot, funding_paise_snapshot, scheme_version_id, requested_paise,
      purpose, borrower_present, presence_photo_id, valuer1_id, valuer2_id, created_by
      FROM loan_application WHERE id=77 RETURNING id`);
  await pool.query(`INSERT INTO appraisal_item (application_id, item_id, qty, gross_mg, stone_mg, purity_id,
      purity_pct_snapshot, market_paise, funding_paise, narration)
    SELECT $1, item_id, qty, gross_mg, stone_mg, purity_id, purity_pct_snapshot, market_paise, funding_paise, narration
      FROM appraisal_item WHERE application_id=77`, [a.id]);
  await pool.query(`INSERT INTO application_photo (application_id, file_id, ord)
    SELECT $1, file_id, ord FROM application_photo WHERE application_id=77`, [a.id]);
  await pool.query(`INSERT INTO application_rate (application_id, metal_id, base_paise, funding_paise)
    SELECT $1, metal_id, base_paise, funding_paise FROM application_rate WHERE application_id=77`, [a.id]);
  await pool.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
    VALUES ($1,'appraised','approved',1,'E29 walk clone')`, [a.id]);
  return Number(a.id);
}

const app77 = await sql1(`SELECT customer_id, requested_paise, created_by FROM loan_application WHERE id=77`);
const PAY = Number(app77.requested_paise);
const nagin = await sql1(`SELECT id FROM employee WHERE username='nagin.kothari'`);
const verifiedAcc = await sql1(`SELECT id FROM customer_bank_account WHERE customer_id=$1 AND verified_at IS NOT NULL ORDER BY id LIMIT 1`, [app77.customer_id]);
// an UNVERIFIED account on the same customer (local test row; one per run)
const unvNo = "5555" + String(Date.now()).slice(-8);
const unv = await sql1(`INSERT INTO customer_bank_account (customer_id, bank, account_no, ifsc, holder_name, verify_method)
  VALUES ($1, 'Walk Bank', $2, 'KKBK0001896', 'Walk Holder', 'none') RETURNING id`, [app77.customer_id, unvNo]);
// pretend its number was changed 3 days ago, so the "changed recently" warning must appear
await pool.query(`INSERT INTO audit_log (at, employee_id, entity_table, entity_id, action, before, after)
  VALUES (now() - interval '3 days', 1, 'customer_bank_account', $1, 'edit_full', $2, $3)`,
  [unv.id, JSON.stringify({ accountNo: "111122223333" }),
   JSON.stringify({ accountNo: unvNo, verificationCleared: true })]);

const slf = await sql1(`SELECT id FROM slf_bank_account WHERE active AND allow_disbursement ORDER BY id LIMIT 1`);
const nag = await loginAt("nagin.kothari", 3);
const leg = (id) => ({ cashPaise: 0, bankLegs: [{ accountId: id, amountPaise: PAY }], slfAccountId: slf.id });

// ═════ 1 · verified account → pays straight away, no pop-up ═════
const f1 = await cloneApproved();
const r1 = await call(`/api/applications/${f1}/action`, { action: "disburse", ...leg(verifiedAcc.id) }, nag);
const l1 = await sql1(`SELECT dl.unverified_ack_by FROM disbursement_leg dl JOIN disbursement d ON d.id=dl.disbursement_id
  JOIN loan l ON l.id=d.loan_id WHERE l.application_id=$1 AND dl.kind='bank'`, [f1]);
ok(r1.j?.ok === true && l1 && l1.unverified_ack_by === null,
  `verified account: disbursed with no confirmation, nobody recorded (${r1.j?.loanNo || r1.j?.reason})`);

// ═════ 2 · unverified, no confirmation → pop-up data, NOTHING written ═════
const f2 = await cloneApproved();
const r2 = await call(`/api/applications/${f2}/action`, { action: "disburse", ...leg(unv.id) }, nag);
const loan2 = await sql1(`SELECT count(*)::int AS n FROM loan WHERE application_id=$1`, [f2]);
ok(r2.status === 409 && r2.j?.needsUnverifiedConfirm === true && loan2.n === 0,
  `unverified without confirmation → 409 asking for it, no loan created (got ${r2.status}, loans ${loan2.n})`);
const a2 = r2.j?.accounts?.[0];
ok(a2 && a2.accountNo === unvNo && a2.ifsc === "KKBK0001896" && a2.holderName === "Walk Holder" && a2.amountPaise === PAY,
  "pop-up gets the account IN FULL: number, IFSC, holder, amount");
ok(a2?.changedRecently && a2.changedRecently.from === "111122223333",
  `pop-up is told the number changed recently (${JSON.stringify(a2?.changedRecently)})`);

// ═════ 3 · confirmed → paid, confirmer recorded in the leg AND the audit ═════
const r3 = await call(`/api/applications/${f2}/action`, { action: "disburse", ...leg(unv.id), unverifiedAck: true }, nag);
const l3 = await sql1(`SELECT dl.unverified_ack_by, l.id AS loan_id, l.loan_no FROM disbursement_leg dl
  JOIN disbursement d ON d.id=dl.disbursement_id JOIN loan l ON l.id=d.loan_id
  WHERE l.application_id=$1 AND dl.kind='bank'`, [f2]);
ok(r3.j?.ok === true && l3 && Number(l3.unverified_ack_by) === Number(nagin.id),
  `confirmed → loan ${l3?.loan_no} activated; leg signed by nagin (#${l3?.unverified_ack_by})`);
const au = await sql1(`SELECT after FROM audit_log WHERE entity_table='loan' AND entity_id=$1
                        AND action='loan_activated' ORDER BY id DESC LIMIT 1`, [l3?.loan_id]);
ok(au?.after?.unverifiedLegs?.[0]?.accountNo === unvNo && Number(au.after.unverifiedConfirmedBy) === Number(nagin.id),
  "audit names the unverified account and the confirmer");

// ═════ 4 · the dossier shows it ═════
const ownerB3 = await loginAt("slunawat", 3);
const dd = await call(`/api/reports/loandetails?loanNo=${l3?.loan_no}`, null, ownerB3, "GET");
ok(dd.j?.legs?.some(x => x.unverifiedAckBy && /nagin/i.test(x.unverifiedAckBy)),
  `Loan Details marks the payout unverified, confirmed by ${dd.j?.legs?.[0]?.unverifiedAckBy}`);

// ═════ 5 · the DATABASE refuses on its own (no app in between) ═════
const disb = await sql1(`SELECT d.id FROM disbursement d JOIN loan l ON l.id=d.loan_id WHERE l.application_id=$1`, [f2]);
const tryLeg = async (ack) => {
  const c = await pool.connect();
  try { await c.query("BEGIN");
    await c.query(`INSERT INTO disbursement_leg (disbursement_id, kind, customer_bank_account_id, amount_paise, unverified_ack_by)
                   VALUES ($1,'bank',$2,100000,$3)`, [disb.id, unv.id, ack]);
    return "accepted";
  } catch (e) { return e.message; } finally { await c.query("ROLLBACK"); c.release(); }
};
const noAck = await tryLeg(null);
ok(/needs a signed confirmation/.test(noAck), `DB: unverified leg with no confirmer refused ("${noAck.slice(0, 60)}")`);
const byCreator = await tryLeg(app77.created_by);
ok(/creator of the loan file cannot confirm/.test(byCreator), `DB: the file's creator as confirmer refused ("${byCreator.slice(0, 60)}")`);
const byOther = await tryLeg(nagin.id);
ok(byOther === "accepted", "DB: a different employee as confirmer is accepted (rolled back)");

// ═════ 6 · the creator still can never disburse at all ═════
const f6 = await cloneApproved();
const r6 = await call(`/api/applications/${f6}/action`, { action: "disburse", ...leg(unv.id), unverifiedAck: true }, ownerB3);
ok(r6.status === 403, `the file's creator (owner) cannot disburse even with a confirmation (got ${r6.status})`);

// ═════ 7 · a NEW customer may be saved with an unverified bank account ═════
const sfx = String(Date.now()).slice(-6);
const nc = await call("/api/customers", { custType: "individual", firstName: "Unverified", lastName: "Banktest",
  dob: "1988-03-03", gender: "female", aadhaar: "8123" + sfx + "45", aadhaarVerified: true, photoFileId: 1,
  mobile: "93" + sfx + "77", current: { line1: "1 Walk Road", pincode: "422101" }, sameAsCurrent: true,
  nominee: { name: "Nom Walk", relation: "son" }, maxOpenLoans: 2, maxOutstandingPaise: 20000000,
  banks: [{ bank: "Fresh Bank", accountNo: "4321" + sfx, ifsc: "HDFC0000123", holderName: "Unverified Banktest" }] },
  ownerB3);
const ncb = nc.j?.id ? await sql1(`SELECT verified_at, verify_method::text AS vm FROM customer_bank_account WHERE customer_id=$1`, [nc.j.id]) : null;
ok(nc.j?.ok === true && ncb && ncb.verified_at === null && ncb.vm === "none",
  `new customer saved WITH an unverified bank account (${nc.j?.custNo || nc.j?.reason}; method ${ncb?.vm})`);

await pool.end();
console.log(failures === 0 ? "\nE29 WALK PASS" : `\nE29 WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
