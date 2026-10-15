/**
 * Remove the Maraekat test-data import again (owner, 15 Oct 2026).
 *
 *   node scripts/purge-maraekat-import.mjs [--commit]
 *
 * Without --commit: counts what would go, deletes it inside a transaction,
 * checks, and ROLLS BACK. With --commit: the same, committed. Run it with the
 * service stopped (it briefly lifts the append-only guards on the fact tables
 * — inside the transaction only, so a failure leaves them exactly as they were).
 *
 * What goes: every customer the import created, and EVERYTHING hanging off
 * them — including receipts, charges or loans your staff added to those test
 * customers afterwards. The inferred MRK- schemes, Safe M, the MRK SLF
 * accounts and the placeholder photo rows go too. Audit rows stay (the audit
 * log is never edited); the two import employees are renamed, not deleted,
 * so those audit rows still name who did what. customer_no_seq is not wound
 * back (numbers are never re-issued).
 */
import fs from "node:fs";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
if (envPath) for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cx = await pool.connect();
await cx.query("SELECT set_config('app.entity_ids', 'ALL', false)");
const q = async (t, p) => (await cx.query(t, p)).rows;
const n = async (t, p) => Number((await q(t, p))[0].n);
const FROZEN = ["receipt", "receipt_appropriation", "disbursement_leg", "loan_state_history",
                "vault_movement", "vault_in_check", "renewal", "collection_call"];
let failed = false;
try {
  await cx.query("BEGIN");
  const emps = await q(`SELECT id, emp_code FROM employee WHERE emp_code IN ('MRK-IMP-M','MRK-IMP-C')`);
  if (!emps.length) throw new Error("no Maraekat import found (employees MRK-IMP-M / MRK-IMP-C are not there)");
  const MAKER = Number(emps.find(e => e.emp_code === "MRK-IMP-M").id);
  const ids = emps.map(e => Number(e.id));

  // —— the set ——
  await cx.query(`CREATE TEMP TABLE _c ON COMMIT DROP AS SELECT id FROM customer WHERE created_by = $1`, [MAKER]);
  await cx.query(`CREATE TEMP TABLE _a ON COMMIT DROP AS SELECT id FROM loan_application
                   WHERE customer_id IN (SELECT id FROM _c) OR created_by = ANY($1)`, [ids]);
  await cx.query(`CREATE TEMP TABLE _l ON COMMIT DROP AS SELECT id FROM loan
                   WHERE customer_id IN (SELECT id FROM _c) OR application_id IN (SELECT id FROM _a)`);
  await cx.query(`CREATE TEMP TABLE _p ON COMMIT DROP AS SELECT id FROM packet WHERE loan_id IN (SELECT id FROM _l)`);
  await cx.query(`CREATE TEMP TABLE _r ON COMMIT DROP AS SELECT id FROM receipt WHERE loan_id IN (SELECT id FROM _l)`);
  const size = {
    customers: await n(`SELECT count(*) n FROM _c`), applications: await n(`SELECT count(*) n FROM _a`),
    loans: await n(`SELECT count(*) n FROM _l`), receipts: await n(`SELECT count(*) n FROM _r`),
    receiptsByStaff: await n(`SELECT count(*) n FROM receipt WHERE id IN (SELECT id FROM _r) AND received_by <> ALL($1)`, [ids]),
    loansByStaff: await n(`SELECT count(*) n FROM loan WHERE id IN (SELECT id FROM _l) AND created_by <> ALL($1)`, [ids]),
  };
  console.log(`· found: ${size.customers} customers · ${size.applications} applications · ${size.loans} loans · ${size.receipts} receipts`);
  if (size.receiptsByStaff || size.loansByStaff)
    console.log(`· of these, added later by your staff on test customers: ${size.loansByStaff} loan(s), ${size.receiptsByStaff} receipt(s) — they go too`);

  // features not in use yet — refuse rather than guess what deleting them means
  for (const [t, w] of [["auction", "loan_id IN (SELECT id FROM _l)"], ["death_case_loan", "loan_id IN (SELECT id FROM _l)"],
                        ["topup", "loan_id IN (SELECT id FROM _l)"], ["death_case", "customer_id IN (SELECT id FROM _c)"],
                        ["grievance", "customer_id IN (SELECT id FROM _c)"]])
    if (await n(`SELECT count(*) n FROM ${t} WHERE ${w}`))
      throw new Error(`${t} rows exist for the test customers — purge stopped, nothing changed`);

  for (const t of FROZEN) await cx.query(`ALTER TABLE ${t} DISABLE TRIGGER trg_${t}_frozen`);
  const del = async (label, sql, p) => { const r = await cx.query(sql, p); if (r.rowCount) console.log(`  ${label}: ${r.rowCount}`); };
  // money & custody facts
  await del("receipt splits", `DELETE FROM receipt_appropriation WHERE receipt_id IN (SELECT id FROM _r)`);
  await del("receipts", `DELETE FROM receipt WHERE id IN (SELECT id FROM _r)`);
  await del("accrual cache", `DELETE FROM loan_accrual_cache WHERE loan_id IN (SELECT id FROM _l)`);
  await del("renewal links", `DELETE FROM renewal WHERE old_loan_id IN (SELECT id FROM _l) OR new_loan_id IN (SELECT id FROM _l)`);
  await del("releases", `DELETE FROM release WHERE loan_id IN (SELECT id FROM _l)`);
  await del("collection calls", `DELETE FROM collection_call WHERE loan_id IN (SELECT id FROM _l)`);
  await del("notices", `DELETE FROM notice WHERE loan_id IN (SELECT id FROM _l)`);
  await del("spot-check lines", `DELETE FROM vault_spot_check_line WHERE packet_id IN (SELECT id FROM _p)`);
  await del("vault-in checks", `DELETE FROM vault_in_check WHERE packet_id IN (SELECT id FROM _p)`);
  await del("vault movements", `DELETE FROM vault_movement WHERE packet_id IN (SELECT id FROM _p)`);
  await del("packets", `DELETE FROM packet WHERE id IN (SELECT id FROM _p)`);
  await del("payout legs", `DELETE FROM disbursement_leg WHERE disbursement_id IN (SELECT id FROM disbursement WHERE loan_id IN (SELECT id FROM _l))`);
  await del("payouts", `DELETE FROM disbursement WHERE loan_id IN (SELECT id FROM _l)`);
  await del("charges", `DELETE FROM loan_charge WHERE loan_id IN (SELECT id FROM _l)`);
  await del("state history", `DELETE FROM loan_state_history WHERE loan_id IN (SELECT id FROM _l) OR application_id IN (SELECT id FROM _a)`);
  await del("loans", `DELETE FROM loan WHERE id IN (SELECT id FROM _l)`);
  // applications
  for (const t of ["application_cancellation", "application_document", "application_photo", "application_rate", "appraisal_item", "ho_approval"])
    await del(t, `DELETE FROM ${t} WHERE application_id IN (SELECT id FROM _a)`);
  await del("applications", `DELETE FROM loan_application WHERE id IN (SELECT id FROM _a)`);
  // customers
  await del("bank proofs", `DELETE FROM customer_bank_proof WHERE account_id IN (SELECT id FROM customer_bank_account WHERE customer_id IN (SELECT id FROM _c))`);
  for (const t of ["customer_bank_account", "customer_document", "customer_photo", "customer_address", "nominee", "cibil_report"])
    await del(t, `DELETE FROM ${t} WHERE customer_id IN (SELECT id FROM _c)`);
  await del("customers", `DELETE FROM customer WHERE id IN (SELECT id FROM _c)`);
  for (const t of FROZEN) await cx.query(`ALTER TABLE ${t} ENABLE TRIGGER trg_${t}_frozen`);

  // import-only masters, if nothing else uses them now
  await del("inferred scheme slabs", `DELETE FROM scheme_slab WHERE scheme_version_id IN (SELECT sv.id FROM scheme_version sv JOIN scheme s ON s.id=sv.scheme_id WHERE s.code LIKE 'MRK-%')`);
  await del("inferred scheme versions", `DELETE FROM scheme_version sv USING scheme s WHERE s.id=sv.scheme_id AND s.code LIKE 'MRK-%'
                                          AND NOT EXISTS (SELECT 1 FROM loan WHERE scheme_version_id=sv.id)
                                          AND NOT EXISTS (SELECT 1 FROM loan_application WHERE scheme_version_id=sv.id)`);
  await del("inferred schemes", `DELETE FROM scheme s WHERE s.code LIKE 'MRK-%' AND NOT EXISTS (SELECT 1 FROM scheme_version WHERE scheme_id=s.id)`);
  await del("Safe M", `DELETE FROM safe s WHERE s.label='Safe M — Maraekat import' AND NOT EXISTS (SELECT 1 FROM vault_movement WHERE safe_id=s.id)`);
  await del("MRK SLF accounts", `DELETE FROM slf_bank_account a WHERE a.nickname LIKE 'MRK · %'
                                   AND NOT EXISTS (SELECT 1 FROM receipt WHERE slf_bank_account_id=a.id)
                                   AND NOT EXISTS (SELECT 1 FROM disbursement WHERE from_slf_account_id=a.id)
                                   AND NOT EXISTS (SELECT 1 FROM cash_transfer WHERE slf_bank_account_id=a.id)`);
  await del("placeholder photo rows", `DELETE FROM file_object f WHERE f.s3_key LIKE 'import/maraekat/%'
      AND NOT EXISTS (SELECT 1 FROM packet WHERE seal_photo_file_id=f.id) AND NOT EXISTS (SELECT 1 FROM release WHERE handover_photo_id=f.id)
      AND NOT EXISTS (SELECT 1 FROM loan_application WHERE presence_photo_id=f.id)`);
  const stamp = (await q(`SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYYMMDD-HH24MI') AS s`))[0].s;
  await cx.query(`UPDATE employee SET emp_code = emp_code || '-PURGED-' || $2, username = username || '.purged.' || $2
                   WHERE id = ANY($1)`, [ids, stamp]);
  await cx.query(`INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
                  VALUES (NULL, NULL, 'import', NULL, 'maraekat_purged', $1)`, [JSON.stringify(size)]);

  // —— checks ——
  const left = await n(`SELECT (SELECT count(*) FROM customer WHERE created_by = ANY($1))
                             + (SELECT count(*) FROM loan WHERE created_by = ANY($1))
                             + (SELECT count(*) FROM receipt WHERE received_by = ANY($1))
                             + (SELECT count(*) FROM scheme WHERE code LIKE 'MRK-%') AS n`, [ids]);
  const guards = await n(`SELECT count(*) n FROM pg_trigger WHERE tgname = ANY($1) AND tgenabled = 'O'`,
    [FROZEN.map(t => `trg_${t}_frozen`)]);
  if (left) throw new Error(`${left} import row(s) still present — rolled back`);
  if (guards !== FROZEN.length) throw new Error(`append-only guards not all back on (${guards}/${FROZEN.length}) — rolled back`);
  console.log(`· check: nothing of the import is left · append-only guards back on (${guards}/${FROZEN.length})`);
  if (COMMIT) { await cx.query("COMMIT"); console.log("\nPURGE COMMITTED"); }
  else { await cx.query("ROLLBACK"); console.log("\nPURGE REHEARSAL OK — rolled back, nothing removed (add --commit to remove)"); }
} catch (e) {
  failed = true;
  await cx.query("ROLLBACK").catch(() => {});
  console.error("\nPURGE FAILED, nothing changed:", e.message);
} finally {
  cx.release();
  await pool.end();
}
process.exit(failed ? 1 : 0);
