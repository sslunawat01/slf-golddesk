/**
 * SLF GoldDesk — Pune calculation test-bed seeder (owner request, 28 Aug 2026)
 * ============================================================================
 * Seeds 18 BACK-DATED test loans on branch 11 (Pune, code 25) so that TODAY
 * lands on every interesting calculation boundary: min-interest floor (R-E),
 * flat vs slab, retroactive slab jumps (R-B), 365 vs 360 divisor (R-A),
 * rate difference, cycle anchoring by payment (R-C), floor-buys-days,
 * charge rounding (R-D), and the penal grace cliff (R-I / owner question O13).
 *
 * TEST DATA ONLY. Back-dating is done in SQL precisely because R-K forbids it
 * through the API. Historical receipts are computed BY THE ENGINE ITSELF
 * (openLoan → addCharge → applyPayment), so every seeded receipt and its
 * appropriation rows are exactly what a real collection on that day would have
 * written. The browser's replay will therefore agree to the paisa.
 *
 * Also publishes ONE new scheme for Pune — "Pune Penal Test 24 · tenure 90"
 * (24% p.a., tenure 90 days, penal 3%, grace 7) — because all four existing
 * Pune scheme versions carry penal 0% and could never show a penal figure.
 * Maker = emp 10 (Snehal), checker = emp 11 (Nagin): maker ≠ checker holds
 * even in seed data. Everything is tagged SEED in state-history notes.
 *
 * Refuses to run twice (branch 11 must have zero loans).
 *   node scripts/seed-pune-tests.mjs
 */
import fs from "node:fs";
import pg from "pg";
import { openLoan, addCharge, applyPayment, dues } from "../src/lib/engine.js";
import { schemeFromRow, appropriationRows, chargeSnapshot, ENGINE_VERSION }
  from "../src/lib/loanstate.js";

const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
// dates must come back as plain strings, exactly as the app reads them
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const BRANCH = 11, ENTITY = 1, FY = "26-27";
const MAKER = 10;   // Snehal Kothari — appraises + approves
const CHECKER = 11; // Naginkumar Kothari — disburses (maker ≠ checker trigger)
const RATE_PAISE = 1230000; // ₹12,300/g snapshot, matches current rate table

const ist = (date, time) => `${date}T${time}:00+05:30`;
const addDays = (iso, n) => {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ——— the eight sample customers ———————————————————————————————————————
const CUSTOMERS = [
  { first: "Prakash", last: "Wagholikar", gender: "male",   mobile: "9823000001", dob: "1978-03-12", aad: "4451" },
  { first: "Sunanda", last: "Kale",       gender: "female", mobile: "9823000002", dob: "1985-07-25", aad: "8812" },
  { first: "Ramesh",  last: "Bhosale",    gender: "male",   mobile: "9823000003", dob: "1970-11-02", aad: "3390" },
  { first: "Meena",   last: "Deshpande",  gender: "female", mobile: "9823000004", dob: "1990-01-19", aad: "6278" },
  { first: "Vitthal", last: "Jagtap",     gender: "male",   mobile: "9823000005", dob: "1965-05-30", aad: "9034" },
  { first: "Shobha",  last: "Kulkarni",   gender: "female", mobile: "9823000006", dob: "1982-09-14", aad: "1147" },
  { first: "Anil",    last: "Pardeshi",   gender: "male",   mobile: "9823000007", dob: "1975-12-08", aad: "5563" },
  { first: "Kavita",  last: "Shirole",    gender: "female", mobile: "9823000008", dob: "1993-04-21", aad: "7726" },
];
const ADDR = { line1: "Test Lane, Budhwar Peth", area: "Budhwar Peth", pincode: "411002",
               taluka: "Pune City", district: "Pune", state: "Maharashtra" };

// ——— charge templates (from charge_type master) ————————————————————————
const PROCESSING = { typeId: 1, base: 15000, gst: 2700, total: 17700, narr: "Processing charge" };
const NOTICE     = { typeId: 2, base: 18000, gst: 0,    total: 18000, narr: "Overdue notice" };
const DOCPCT     = { typeId: 7, base: 10000, gst: 1800, total: 11800, narr: "Document charge 0.25% (min applied)" };

// ——— the 18 cases, oldest first (loan numbers must ascend) ————————————
// sv: 7|8|9|10 or "PENAL" (the scheme this script publishes).
// day: the loan's age TODAY under R-L (both end days count, day 1 = the
//      disbursement day) — dates are computed from CURRENT_DATE at seed time,
//      so today always lands exactly on the boundary each case describes.
// pay: historical payments at loan-day payDay; amount = whatever charges +
//      interest were due that day (engine-priced at runtime) + optional
//      principal part. extraCharges carry onDay the same way.
const CASES = [
  { tag: "D6", sv: 10, cust: 5, principal: 40000, day: 149, item: [9, 1],
    extraCharges: [{ ...DOCPCT, onDay: 1 }],
    desc: "day 149 today — deep in slab 3, 36% retroactive on all days; also a pct charge (₹118 → ₹120)" },
  { tag: "P4", sv: "PENAL", cust: 7, principal: 30000, day: 120, item: [2, 1],
    extraCharges: [{ ...NOTICE, onDay: 103 }],
    desc: "day 120 — 30 days past tenure 90, beyond grace: penal retroactive from day 90; notice charge added while overdue" },
  { tag: "A4", sv: 7, cust: 3, principal: 60000, day: 100, item: [1, 2],
    pay: [{ payDay: 41, principalPart: 10000 }],
    desc: "cycle anchoring R-C — full interest + ₹10,000 principal paid day 41; today prices 59 days on ₹50,000" },
  { tag: "P3", sv: "PENAL", cust: 7, principal: 30000, day: 98, item: [4, 1],
    desc: "day 98 — ONE day past grace (90+7): penal jumps ₹0 → 8 days retroactive. The O13 cliff, small scale" },
  { tag: "P2", sv: "PENAL", cust: 6, principal: 30000, day: 97, item: [8, 1],
    desc: "day 97 — LAST day of grace: penal still ₹0. Compare with P3" },
  { tag: "P1", sv: "PENAL", cust: 6, principal: 30000, day: 93, item: [10, 1],
    desc: "day 93 — past tenure, inside grace window: penal ₹0, closing today forgiven entirely" },
  { tag: "D7", sv: 10, cust: 3, principal: 40000, day: 75, item: [7, 1],
    pay: [{ payDay: 25 }],
    desc: "slab + anchoring — interest cleared on day 25 (slab 1, 24%); today's cycle is 50 days → slab 2, 30% retroactive on 50 only" },
  { tag: "D5", sv: 10, cust: 5, principal: 40000, day: 61, item: [2, 2],
    desc: "day 61 — first day of slab 3: 36% retroactive on all 61 days. Compare with D4" },
  { tag: "D4", sv: 10, cust: 4, principal: 40000, day: 60, item: [1, 1],
    desc: "day 60 — last day of slab 2: 30% on all 60 days" },
  { tag: "A3", sv: 7, cust: 2, principal: 50000, day: 45, item: [4, 2],
    desc: "day 45 flat 20% ÷365 — compare with B1 and C1 (same customer, same facts)" },
  { tag: "B1", sv: 8, cust: 2, principal: 50000, day: 45, item: [2, 1],
    desc: "day 45 flat 20% ÷360 — divisor difference against A3" },
  { tag: "C1", sv: 9, cust: 2, principal: 50000, day: 45, item: [9, 1],
    desc: "day 45 flat 24% ÷360 — rate difference against B1" },
  { tag: "D3", sv: 10, cust: 4, principal: 40000, day: 31, item: [7, 2],
    desc: "day 31 — first day of slab 2: 30% RETROACTIVE on all 31 days. Compare with D2 one day younger" },
  { tag: "D2", sv: 10, cust: 1, principal: 40000, day: 30, item: [10, 1],
    desc: "day 30 — last day of slab 1, 24%" },
  { tag: "D1", sv: 10, cust: 0, principal: 40000, day: 25, item: [1, 2],
    desc: "day 25 — plain slab-1 accrual, ₹10 round-up visible" },
  { tag: "A2", sv: 7, cust: 1, principal: 50000, day: 15, item: [8, 1],
    desc: "day 15 exactly — raw interest EQUALS the 15-day floor: floor not flagged" },
  { tag: "A5", sv: 7, cust: 6, principal: 60000, day: 12, item: [2, 2],
    pay: [{ payDay: 8 }],
    desc: "floor buys days (R-E) — floor paid on day 8 moved the anchor to day 15 (31 Aug): interest due TODAY is ₹0" },
  { tag: "A1", sv: 7, cust: 0, principal: 50000, day: 8, item: [4, 1],
    desc: "day 8 — under the 15-day floor: interest due equals the floor, flag shown" },
];

// appraisal weight so that LTV sits near 68% at 22K/92% and ₹12,300
function ornament(principalRupees, itemId, qty) {
  const netMg = Math.ceil((principalRupees * 100000) / (0.7 * 0.92 * 12300) / 50) * 50;
  // valuation figures must be multiples of ₹100 (DB check) — round to ₹100, keep in paise
  const funding = Math.round(((netMg / 1000) * 0.92 * 12300) / 100) * 100 * 100;
  return { itemId, qty, grossMg: netMg + 300, stoneMg: 300, netMg, purityId: 1,
           puritySnap: 92, marketPaise: funding, fundingPaise: funding };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = (text, params) => client.query(text, params);
const issue = async (doc) =>
  (await q("SELECT issue_number($1,$2,$3::series_doc,$4) AS no", [ENTITY, BRANCH, doc, FY])).rows[0].no;

try {
  await q("BEGIN");
  const { rows: [{ d: TODAY }] } = await q("SELECT CURRENT_DATE::text AS d");
  console.log(`seeding relative to today = ${TODAY} (R-L: day N ⇒ disbursed ${"today"} − (N−1))`);

  // —— guard: never run twice ——
  const { rows: [g] } = await q("SELECT count(*)::int AS n FROM loan WHERE branch_id=$1", [BRANCH]);
  if (g.n > 0) throw new Error(`branch ${BRANCH} already has ${g.n} loan(s) — seed refused. ` +
    "If you truly want a fresh seed, remove the previous test loans first.");
  const { rows: [gs] } = await q("SELECT count(*)::int AS n FROM scheme WHERE code='PPT2490'");
  if (gs.n > 0) throw new Error("scheme PPT2490 already exists — seed refused (already ran?)");

  // —— 1 · publish the penal test scheme for Pune ——
  const { rows: [sch] } = await q(
    `INSERT INTO scheme (code, name, metal_id, active, created_by)
     VALUES ('PPT2490','Pune Penal Test 24 · tenure 90',1,TRUE,$1) RETURNING id`, [MAKER]);
  const { rows: [psv] } = await q(
    `INSERT INTO scheme_version (scheme_id, version_no, effective_from, cust_types, funding_pct,
       calc_method, interest_pct, slab_mode, days_in_year, min_interest_days, round_step_paise,
       tenure_days, penal_rate_pct, penal_grace_days, capitalization_on,
       doc_charge_pct, doc_charge_min_paise, doc_charge_max_paise, admin_fee_paise,
       min_loan_paise, max_loan_paise, status, maker_id, checker_id, published_at, created_by)
     VALUES ($1,1,'2026-04-01','{individual}',70,'simple',24,'retroactive',365,15,1000,
       90,3,7,FALSE, 0,0,0,0, 200000,200000000,'published',$2,$3,now(),$2) RETURNING id`,
    [sch.id, MAKER, CHECKER]);
  await q(`INSERT INTO scheme_branch (scheme_version_id, branch_id) VALUES ($1,$2)`, [psv.id, BRANCH]);
  const PENAL_SV = psv.id;
  console.log(`published scheme PPT2490, version id ${PENAL_SV}, allocated to Pune`);

  // —— 2 · load engine schemes for every version we will use ——
  const schemeCache = {};
  async function engineScheme(svId) {
    if (schemeCache[svId]) return schemeCache[svId];
    const { rows: [sv] } = await q(`SELECT sv.*, s.code AS scode FROM scheme_version sv
                                     JOIN scheme s ON s.id=sv.scheme_id WHERE sv.id=$1`, [svId]);
    const { rows: slabs } = await q(`SELECT * FROM scheme_slab WHERE scheme_version_id=$1`, [svId]);
    return (schemeCache[svId] = schemeFromRow(sv, slabs, sv.scode));
  }

  // —— 3 · customers, addresses, one manually-verified bank account each ——
  const custIds = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const c = CUSTOMERS[i];
    const { rows: [{ no }] } = await q("SELECT next_customer_no() AS no");
    const { rows: [cu] } = await q(
      `INSERT INTO customer (cust_no, cust_type, first_name, last_name, gender, dob,
         mobile, app_access, aadhaar_last4, risk, kyc_done_at, max_open_loans,
         max_outstanding_paise, created_by)
       VALUES ($1,'individual',$2,$3,$4::gender_kind,$5,$6,FALSE,$7,'low',CURRENT_DATE,10,
         100000000,$8) RETURNING id, cust_no, full_name`,
      [no, c.first, c.last, c.gender, c.dob, c.mobile, c.aad, MAKER]);
    await q(`INSERT INTO customer_address (customer_id, kind, line1, pincode, area, taluka,
               district, state, same_as_current)
             VALUES ($1,'current',$2,$3,$4,$5,$6,$7,FALSE)`,
      [cu.id, `${101 + i} ${ADDR.line1}`, ADDR.pincode, ADDR.area, ADDR.taluka, ADDR.district, ADDR.state]);
    await q(`INSERT INTO customer_bank_account (customer_id, bank, bank_branch, account_no, ifsc,
               holder_name, acct_type, verify_method, verified_at)
             VALUES ($1,'State Bank of India','Pune Main',$2,'SBIN0000454',$3,'savings','manual',now())`,
      [cu.id, `9124500${String(10 + i)}${c.aad}`, cu.full_name]);
    custIds.push({ id: cu.id, custNo: cu.cust_no, name: cu.full_name });
    console.log(`customer ${cu.cust_no}  ${cu.full_name}`);
  }

  // —— 4 · the loans, oldest first so loan numbers ascend with time ——
  for (const cs of [...CASES].sort((a, b) => b.day - a.day)) {
    const svId = cs.sv === "PENAL" ? PENAL_SV : cs.sv;
    const scheme = await engineScheme(svId);
    const cust = custIds[cs.cust];
    const principalPaise = cs.principal * 100;
    // R-L: to be loan-day N today, disburse (N−1) calendar days ago;
    // loan-day K falls on disbursement + (K−1).
    cs.disb = addDays(TODAY, -(cs.day - 1));
    const onDate = (k) => addDays(cs.disb, k - 1);
    for (const x of cs.extraCharges || []) x.on = onDate(x.onDay);
    for (const p of cs.pay || []) p.date = onDate(p.payDay);

    // application
    const appNo = await issue("application");
    const orn = ornament(cs.principal, cs.item[0], cs.item[1]);
    const { rows: [app] } = await q(
      `INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status,
         scheme_version_id, requested_paise, purpose, borrower_present, valuer1_id, valuer2_id,
         rate_date, base_paise_snapshot, funding_paise_snapshot, created_at, created_by)
       VALUES ($1,$2,$3,$4,'activated',$5,$6,'personal',
         TRUE,$7,$8,$9,$10,$10,$11,$7) RETURNING id`,
      [appNo, ENTITY, BRANCH, cust.id, svId, principalPaise, MAKER, CHECKER,
       cs.disb, RATE_PAISE, ist(cs.disb, "10:00")]);
    await q(
      `INSERT INTO appraisal_item (application_id, item_id, qty, gross_mg, stone_mg,
         purity_id, purity_pct_snapshot, market_paise, funding_paise, narration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [app.id, orn.itemId, orn.qty, orn.grossMg, orn.stoneMg, orn.purityId,
       orn.puritySnap, orn.marketPaise, orn.fundingPaise, `SEED ${cs.tag}`]);

    // state history: pledge → appraised → approved (by MAKER) → active (by CHECKER)
    const hist = (from, to, by, time, note, loanId = null) => q(
      `INSERT INTO loan_state_history (application_id, loan_id, from_state, to_state, at, by_employee, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [app.id, loanId, from, to, ist(cs.disb, time), by, note]);
    await hist(null, "draft", MAKER, "10:00", "pledge started (SEED)");
    await hist("draft", "appraised", MAKER, "10:20", null);
    await hist("appraised", "approved", MAKER, "10:40", "within branch authority (SEED)");

    // loan + packet + charges + disbursement (created_by = CHECKER; trigger holds)
    const loanNo = await issue("loan");
    const { rows: [loan] } = await q(
      `INSERT INTO loan (loan_no, application_id, entity_id, branch_id, customer_id,
         scheme_version_id, principal_paise, disbursed_at, status, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10) RETURNING id`,
      [loanNo, app.id, ENTITY, BRANCH, cust.id, svId, principalPaise, cs.disb,
       ist(cs.disb, "11:00"), CHECKER]);
    await hist("approved", "active", CHECKER, "11:00",
      `disbursed ${loanNo} · SEED CASE ${cs.tag}: ${cs.desc}`, loan.id);

    const packetNo = await issue("packet");
    await q(`INSERT INTO packet (packet_no, loan_id, qr_payload, status)
             VALUES ($1,$2,$3,'at_counter')`,
      [packetNo, loan.id, JSON.stringify({ loan: loanNo, seed: cs.tag })]);

    // charges: processing on every loan at disbursement, plus any extras
    const chargeRows = [];
    const addChargeRow = async (tpl, on) => {
      const { rows: [lc] } = await q(
        `INSERT INTO loan_charge (loan_id, charge_type_id, base_paise, gst_paise, total_paise,
           floor_paise, narration, added_by, added_at)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8) RETURNING id`,
        [loan.id, tpl.typeId, tpl.base, tpl.gst, tpl.total, `${tpl.narr} (SEED)`, CHECKER, ist(on, "11:05")]);
      chargeRows.push({ id: lc.id, on, totalPaise: tpl.total });
    };
    await addChargeRow(PROCESSING, cs.disb);
    for (const x of cs.extraCharges || []) await addChargeRow(x, x.on);

    // disbursement, one bank leg to the customer's verified account
    const { rows: [ba] } = await q(
      `SELECT id FROM customer_bank_account WHERE customer_id=$1 LIMIT 1`, [cust.id]);
    const { rows: [disb] } = await q(
      `INSERT INTO disbursement (loan_id, created_at, created_by)
       VALUES ($1,$2,$3) RETURNING id`, [loan.id, ist(cs.disb, "11:10"), CHECKER]);
    await q(`INSERT INTO disbursement_leg (disbursement_id, kind, customer_bank_account_id,
               amount_paise, utr) VALUES ($1,'bank',$2,$3,$4)`,
      [disb.id, ba.id, principalPaise, `SEEDUTR${loanNo.slice(-5)}`]);

    // —— historical payments, priced by the engine itself ——
    if (cs.pay?.length) {
      const state = openLoan({ principal: cs.principal, disbursedAt: cs.disb });
      // charges enter the engine in date order before the first payment they precede
      const chargeEvents = [...chargeRows].sort((a, b) => a.on < b.on ? -1 : 1);
      let paidNote = [];
      for (const p of cs.pay) {
        while (chargeEvents.length && chargeEvents[0].on <= p.date) {
          const c = chargeEvents.shift();
          addCharge(state, { id: c.id, amount: c.totalPaise / 100 });
        }
        const d = dues(scheme, state, p.date);
        const amountPaise = d._paise.chargesDue + d._paise.interestDue +
                            d._paise.penalDue + (p.principalPart || 0) * 100;
        const before = chargeSnapshot(state);
        const { receipt } = applyPayment(scheme, state, { date: p.date, amount: amountPaise / 100 });
        const rows = appropriationRows(before, state, receipt);

        const rcptNo = await issue("receipt");
        const { rows: [r] } = await q(
          `INSERT INTO receipt (receipt_no, entity_id, branch_id, loan_id, business_date,
             amount_paise, mode, is_exact_settlement, closes_loan, seals_cycle,
             engine_version, received_by, received_at, paid_by)
           VALUES ($1,$2,$3,$4,$5,$6,'cash',FALSE,FALSE,$7,$8,$9,$10,$11) RETURNING id`,
          [rcptNo, ENTITY, BRANCH, loan.id, p.date, amountPaise,
           !!receipt.sealsCycle, ENGINE_VERSION, MAKER, ist(p.date, "12:00"), cust.name]);
        for (const a of rows)
          await q(`INSERT INTO receipt_appropriation (receipt_id, bucket, loan_charge_id, amount_paise)
                   VALUES ($1,$2::approp_bucket,$3,$4)`,
            [r.id, a.bucket, a.loanChargeId, a.amountPaise]);
        paidNote.push(`${rcptNo} ₹${(amountPaise / 100).toFixed(0)} on ${p.date}` +
                      (receipt.sealsCycle ? " (sealed cycle)" : ""));
      }
      console.log(`  ${cs.tag}  ${loanNo}  ${cust.name}  — receipts: ${paidNote.join(", ")}`);
    } else {
      console.log(`  ${cs.tag}  ${loanNo}  ${cust.name}`);
    }
  }

  await q(`INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
           VALUES ($1,$2,'loan',NULL,'seed_pune_tests',$3)`,
    [MAKER, BRANCH, JSON.stringify({ cases: CASES.map(c => c.tag), note:
      "18 back-dated calculation test loans, owner request 28 Aug 2026. TEST DATA — delete before go-live." })]);

  await q("COMMIT");
  console.log("\nSeed complete. Now run:  node scripts/verify-pune-tests.mjs");
} catch (e) {
  await q("ROLLBACK");
  console.error("SEED FAILED — nothing was written:", e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
