/**
 * SLF GoldDesk — automatic day cycle (E15 №8/№9, owner 29 Aug 2026)
 * =================================================================
 *   node scripts/auto-daycycle.mjs begin   ← systemd timer, 11:00 IST daily
 *   node scripts/auto-daycycle.mjs end     ← systemd timer, 23:59 IST daily
 *
 * begin: every active non-HO branch that has NOT signed day-begin today gets
 *        one — opening and counted both equal the carry from the last signed
 *        close (variance zero), all four checklist boxes recorded true, and
 *        the reason marks it automatic.
 * end:   every branch whose day began but was not closed gets an automatic
 *        day-end — counted equals expected (variance zero), no denomination
 *        breakdown — and then №7 fires: every application of that branch not
 *        disbursed today is cancelled with a state-history note, INCLUDING
 *        files waiting at Head Office (owner's explicit call, 29 Aug 2026).
 *
 * Every write is stamped by the owner account (employee 1) with an
 * "automatic" reason — the audit trail always says what happened and why.
 * The SQL here mirrors src/app/api/daycycle/route.js line for line; if that
 * route changes, change this too.
 */
import fs from "node:fs";
import pg from "pg";

const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const SYSTEM_EMPLOYEE = 1;   // S. Lunawat — every automatic signature is his, marked automatic
const mode = process.argv[2];
if (!["begin", "end"].includes(mode)) {
  console.error("usage: node scripts/auto-daycycle.mjs begin|end");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const one = async (t, p) => (await pool.query(t, p)).rows[0] || null;

async function carriedForward(branchId) {
  const r = await one(
    `SELECT end_counted_paise FROM day_cycle
      WHERE branch_id=$1 AND business_date < CURRENT_DATE AND end_signed_at IS NOT NULL
      ORDER BY business_date DESC LIMIT 1`, [branchId]);
  return r ? Number(r.end_counted_paise) : 0;
}
async function cashToday(branchId) {
  const rec = await one(
    `SELECT coalesce(sum(amount_paise),0)::bigint AS p FROM receipt
      WHERE branch_id=$1 AND business_date=CURRENT_DATE AND mode='cash'`, [branchId]);
  const dis = await one(
    `SELECT coalesce(sum(dl.amount_paise),0)::bigint AS p
       FROM disbursement_leg dl
       JOIN disbursement d ON d.id=dl.disbursement_id
       JOIN loan l ON l.id=d.loan_id
      WHERE l.branch_id=$1 AND d.created_at::date=CURRENT_DATE AND dl.kind='cash'`, [branchId]);
  return { cashReceiptsPaise: Number(rec.p), cashDisbursedPaise: Number(dis.p) };
}

const branches = (await pool.query(
  `SELECT id, code, name FROM branch WHERE active AND NOT is_ho ORDER BY id`)).rows;
let touched = 0;

for (const br of branches) {
  const cyc = await one(
    `SELECT * FROM day_cycle WHERE branch_id=$1 AND business_date=CURRENT_DATE`, [br.id]);

  if (mode === "begin") {
    if (cyc?.begin_signed_at) continue;               // a human already did it
    const carry = await carriedForward(br.id);
    const checks = { rate: true, seal: true, queues: true, report: true };
    const cl = await pool.connect();
    try {
      await cl.query("BEGIN");
      await cl.query(
        `INSERT INTO day_cycle (branch_id, business_date, begin_opening_paise, begin_checks,
           begin_counted_paise, begin_diff_reason, begin_signed_by, begin_signed_at)
         VALUES ($1, CURRENT_DATE, $2, $3, $2, $4, $5, now())
         ON CONFLICT (branch_id, business_date) DO UPDATE SET
           begin_opening_paise=EXCLUDED.begin_opening_paise, begin_checks=EXCLUDED.begin_checks,
           begin_counted_paise=EXCLUDED.begin_counted_paise,
           begin_diff_reason=EXCLUDED.begin_diff_reason,
           begin_signed_by=EXCLUDED.begin_signed_by, begin_signed_at=now()`,
        [br.id, carry, JSON.stringify(checks),
         "automatic day-begin 11:00 IST — carry copied from previous close (№9)",
         SYSTEM_EMPLOYEE]);
      await cl.query(
        `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
         VALUES ($1,$2,'day_cycle',$2,'day_begin_automatic',$3)`,
        [SYSTEM_EMPLOYEE, br.id, JSON.stringify({ carriedPaise: carry, mode: "automatic_1100" })]);
      await cl.query("COMMIT");
      console.log(`begin  ${br.code} ${br.name} — opening ₹${(carry / 100).toLocaleString("en-IN")}`);
      touched++;
    } catch (e) { await cl.query("ROLLBACK"); console.error(`begin ${br.code} FAILED:`, e.message); }
    finally { cl.release(); }
  }

  if (mode === "end") {
    if (!cyc?.begin_signed_at || cyc?.end_signed_at) continue;   // never began, or closed already
    const opening = Number(cyc.begin_counted_paise);
    const flows = await cashToday(br.id);
    const expected = opening + flows.cashReceiptsPaise - flows.cashDisbursedPaise;
    const cl = await pool.connect();
    try {
      await cl.query("BEGIN");
      await cl.query(
        `UPDATE day_cycle SET end_expected_paise=$2, end_counted_paise=$2,
           end_variance_paise=0,
           end_reason='automatic day-end 23:59 IST — counted taken as expected, no denominations (№8)',
           end_signed_by=$3, end_signed_at=now()
         WHERE id=$1 AND end_signed_at IS NULL`, [cyc.id, expected, SYSTEM_EMPLOYEE]);
      // №7 — the day is over: every undisbursed application dies with it
      const { rows: doomed } = await cl.query(
        `SELECT id, app_no, status FROM loan_application
          WHERE branch_id=$1 AND status IN ('draft','appraised','pending_ho','approved')
          FOR UPDATE`, [br.id]);
      for (const d of doomed) {
        await cl.query(
          `UPDATE loan_application SET status='cancelled', updated_at=now(), updated_by=$2
            WHERE id=$1`, [d.id, SYSTEM_EMPLOYEE]);
        await cl.query(
          `INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
           VALUES ($1,$2,'cancelled',$3,'not disbursed by day-end — cancelled automatically (№7)')`,
          [d.id, d.status, SYSTEM_EMPLOYEE]);
      }
      await cl.query(
        `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
         VALUES ($1,$2,'day_cycle',$3,'day_end_automatic',$4)`,
        [SYSTEM_EMPLOYEE, br.id, Number(cyc.id), JSON.stringify({
          expectedPaise: expected, cancelledApplications: doomed.map(x => x.app_no),
          mode: "automatic_2359" })]);
      await cl.query("COMMIT");
      console.log(`end    ${br.code} ${br.name} — closed at ₹${(expected / 100).toLocaleString("en-IN")}` +
        (doomed.length ? ` · cancelled ${doomed.length} undisbursed` : ""));
      touched++;
    } catch (e) { await cl.query("ROLLBACK"); console.error(`end ${br.code} FAILED:`, e.message); }
    finally { cl.release(); }
  }
}
console.log(`${mode}: ${touched} branch(es) touched, ${branches.length} checked`);
await pool.end();
