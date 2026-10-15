/**
 * Maraekat → GoldDesk TEST-DATA import (owner, 15 Oct 2026).
 *
 *   node scripts/import-maraekat.mjs <maraekat-b3.json> [--commit] [--report <dir>]
 *
 * Without --commit everything is written inside ONE transaction, checked, and
 * ROLLED BACK — a full rehearsal that leaves the database untouched. With
 * --commit the same transaction is committed, but only if every self-check
 * passed. Run it with the service stopped.
 *
 * What it builds (all tagged by two inactive, non-login import employees, so
 * scripts/purge-maraekat-import.mjs can remove every row again):
 *   customers (anonymised in the json) + address/nominee placeholders
 *   customer bank accounts (placeholders — Maraekat holds no account numbers)
 *   loan applications, appraisal items (weight back-computed), state history
 *   loans, packets, disbursements + legs, charges, receipts + appropriation
 *   vault custody in a new B3 safe, releases, renewals (ReEntry)
 * Interest is never imported: every receipt is replayed through the engine
 * (see lib-maraekat.mjs) and stored only as the engine appropriates it.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { schemeFromRow, replayLoan, buildEvents, chargeSnapshot, appropriationRows, ENGINE_VERSION }
  from "../src/lib/loanstate.js";
import { dues, openLoan, addCharge, applyPayment } from "../src/lib/engine.js";
import { qrPayload } from "../src/lib/vault.js";
import { planLoan, pairRenewals, backComputeItem, rateOn, accountKey,
         INFERRED, INFERRED_COMMON } from "./lib-maraekat.mjs";

// ———————————————————————————— arguments & env ————————————————————————————
const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith("--"));
const COMMIT = args.includes("--commit");
const reportDir = args.includes("--report") ? args[args.indexOf("--report") + 1]
  : path.resolve("import-report-maraekat");
if (!jsonPath) { console.error("usage: node scripts/import-maraekat.mjs <json> [--commit] [--report <dir>]"); process.exit(2); }

const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
if (envPath) for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const MAKER_CODE = "MRK-IMP-M", CHECKER_CODE = "MRK-IMP-C";
const at = (iso, hhmm) => `${iso}T${hhmm}:00+05:30`;            // IST wall clock
const rs = (p) => (Number(p) / 100).toLocaleString("en-IN");

pg.types.setTypeParser(1082, v => v);                           // DATE columns stay 'YYYY-MM-DD' (no timezone drift)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cx = await pool.connect();
await cx.query("SELECT set_config('app.entity_ids', 'ALL', false)");
const q = async (t, p) => (await cx.query(t, p)).rows;
const q1 = async (t, p) => (await q(t, p))[0];
async function ins(table, row, ret = "id") {
  const k = Object.keys(row);
  const r = await q1(`INSERT INTO ${table} (${k.join(",")}) VALUES (${k.map((_, i) => "$" + (i + 1)).join(",")})
                      ${ret ? "RETURNING " + ret : ""}`, k.map(x => row[x]));
  return ret ? Number(r[ret]) : null;
}
const step = (s) => console.log(`· ${s}`);
const notes = [];                                                // → notes.csv

let failed = false;
try {
  await cx.query("BEGIN");

  // ═════════════════════════ 1 · prechecks ═════════════════════════
  const br = await q1(`SELECT id, entity_id, code, name, address_json->>'pincode' AS pin FROM branch WHERE code=$1`,
    [data.meta.branchCode]);
  if (!br) throw new Error(`branch code ${data.meta.branchCode} not found`);
  const BR = Number(br.id), ENT = Number(br.entity_id);
  const today = (await q1(`SELECT CURRENT_DATE::text AS d`)).d;
  const lastDate = [...data.loans.map(l => l.date), ...data.receipts.map(r => r.date)].sort().at(-1);
  if (lastDate >= today)
    throw new Error(`the export has entries dated ${lastDate}; run the import on a later day than that ` +
      `(today is ${today}) so no imported cash lands in a day that is still open`);
  if (await q1(`SELECT 1 FROM employee WHERE emp_code IN ($1,$2)`, [MAKER_CODE, CHECKER_CODE]))
    throw new Error("this import has already been run — purge it first (scripts/purge-maraekat-import.mjs)");
  const mob = await q(`SELECT mobile FROM customer WHERE mobile = ANY($1)`, [data.customers.map(c => c.mobile)]);
  if (mob.length) throw new Error(`${mob.length} test mobile(s) already belong to customers, e.g. ${mob[0].mobile}`);
  const ln = await q(`SELECT loan_no FROM loan WHERE loan_no = ANY($1)`, [data.loans.map(l => l.loanNo)]);
  if (ln.length) throw new Error(`${ln.length} loan number(s) already exist, e.g. ${ln[0].loan_no}`);
  const rn = await q(`SELECT receipt_no FROM receipt WHERE receipt_no = ANY($1)`, [data.receipts.map(r => r.no)]);
  if (rn.length) throw new Error(`${rn.length} receipt number(s) already exist, e.g. ${rn[0].receipt_no}`);
  const own = await q1(`SELECT bool_and(tableowner = current_user) AS ok FROM pg_tables
                         WHERE schemaname='public' AND tablename IN ('receipt','disbursement_leg','vault_movement','loan_state_history','renewal','receipt_appropriation')`);
  step(`branch ${br.code} ${br.name} · data up to ${lastDate} · purge possible later: ${own.ok ? "yes" : "NO (tables owned by another role)"}`);

  // ═════════════════════════ 2 · masters ═════════════════════════
  const emp = async (code, user, name) => ins("employee", { emp_code: code, full_name: name, username: user,
    password_hash: "!no-login-import-account", force_change: true, status: "inactive", dol: today,
    designation: "Data import (no login)", primary_branch_id: BR });
  const MAKER = await emp(MAKER_CODE, "maraekat.import.maker", "Maraekat Import (maker)");
  const CHECKER = await emp(CHECKER_CODE, "maraekat.import.checker", "Maraekat Import (checker)");

  // placeholder photos — one image, one file_object per kind (s3_key is unique)
  const jpg = fs.readFileSync(new URL("./import-assets/maraekat-no-photo.jpg", import.meta.url));
  const FILE = {};
  for (const kind of ["presence", "seal", "handover"])
    FILE[kind] = await ins("file_object", { kind, s3_key: `import/maraekat/no-photo-${kind}.jpg`,
      mime: "image/jpeg", bytes: jpg.length, width_px: 480, height_px: 320, captured_by: MAKER });

  const SAFE = await ins("safe", { branch_id: BR, label: "Safe M — Maraekat import",
    location_note: "created by the Maraekat test-data import", created_by: MAKER });

  const SLF_DEF = {
    "B3 HDFC":         { nickname: "MRK · B3 HDFC", bank: "HDFC Bank", ifsc: "HDFC0000000" },
    "Bandhan Bank":    { nickname: "MRK · Bandhan Nasikroad", bank: "Bandhan Bank", ifsc: "BDBL0000000" },
    "Payment Gateway": { nickname: "MRK · Payment Gateway", bank: "Payment Gateway", ifsc: "PGWY0000000" },
    "ReEntry Bank":    { nickname: "MRK · ReEntry adjustment", bank: "Internal — renewal adjustment", ifsc: "NONE0000000" },
  };
  const SLF = {};
  const slfFor = async (key) => {
    if (SLF[key]) return SLF[key];
    const d = SLF_DEF[key] || { nickname: `MRK · ${key}`, bank: key, ifsc: "NONE0000000" };
    const n = Object.keys(SLF).length + 1;
    SLF[key] = await ins("slf_bank_account", { entity_id: ENT, branch_id: BR, nickname: d.nickname,
      bank: d.bank, ifsc: d.ifsc, account_no: `MRK-IMPORT-${n}`, account_no_masked: `MRK…${n}`,
      allow_disbursement: true, allow_collection: true, active: false, scope_all: false });
    return SLF[key];
  };

  const ITEM = {};
  for (const [k, like] of [["ring", "ring%"], ["chain", "chain%"], ["bangle", "bangle%"]]) {
    const r = await q1(`SELECT i.id FROM item i JOIN metal m ON m.id=i.metal_id
                         WHERE m.kind='gold' AND i.active AND i.name ILIKE $1 ORDER BY i.id LIMIT 1`, [like]);
    ITEM[k] = r ? Number(r.id) : null;
  }
  ITEM.fallback = Number((await q1(`SELECT i.id FROM item i JOIN metal m ON m.id=i.metal_id
                                     WHERE m.kind='gold' AND i.active ORDER BY i.id LIMIT 1`)).id);
  const PUR = await q1(`SELECT p.id, p.purity_pct AS pct FROM purity p JOIN metal m ON m.id=p.metal_id
                         WHERE m.kind='gold' AND p.karat='22K' AND p.active ORDER BY p.id DESC LIMIT 1`);
  const GOLD = Number((await q1(`SELECT id FROM metal WHERE kind='gold' ORDER BY id LIMIT 1`)).id);
  const MISC = Number((await q1(`SELECT id FROM charge_type WHERE name ILIKE 'misc%' ORDER BY id LIMIT 1`)).id);

  // ═════════════════════════ 3 · schemes ═════════════════════════
  // The owner's own scheme wins: a PUBLISHED version of the same code that is
  // offered at this branch and in force on the loan date (highest version if
  // several). A code he has not set up runs on an inferred MRK- scheme.
  const ownRows = await q(`SELECT s.code, sv.*, sv.id AS svid FROM scheme s JOIN scheme_version sv ON sv.scheme_id=s.id
      WHERE sv.status='published' AND EXISTS (SELECT 1 FROM scheme_branch sb WHERE sb.scheme_version_id=sv.id AND sb.branch_id=$1)
        AND (sv.effective_to IS NULL OR sv.effective_to >= sv.effective_from)`, [BR]);
  const slabRows = await q(`SELECT * FROM scheme_slab WHERE scheme_version_id = ANY($1)`, [ownRows.map(r => r.svid)]);
  const SV = new Map();                                            // svid → { row, scheme, code, inferred }
  for (const r of ownRows) {
    try {
      SV.set(Number(r.svid), { row: r, code: r.code, inferred: false,
        scheme: schemeFromRow(r, slabRows.filter(s => Number(s.scheme_version_id) === Number(r.svid)), r.code) });
    } catch (e) { notes.push({ loanNo: "", kind: "own_scheme_unusable", detail: `${r.code} v${r.version_no}: ${e.message}` }); }
  }
  const inferredSv = {};
  const pickScheme = async (code, date) => {
    const cands = [...SV.entries()].filter(([, v]) => !v.inferred && v.code.toUpperCase() === code.toUpperCase()
      && String(v.row.effective_from) <= date
      && (v.row.effective_to == null || String(v.row.effective_to) >= date))
      .sort((a, b) => b[1].row.version_no - a[1].row.version_no);
    if (cands.length) return cands[0][0];
    if (inferredSv[code]) return inferredSv[code];
    const t = INFERRED[code];
    if (!t) return null;
    const sid = await ins("scheme", { code: `MRK-${code}`, name: `${code} — inferred from Maraekat (test data)`,
      metal_id: GOLD, active: false, created_by: MAKER });
    const svRow = { scheme_id: sid, version_no: 1, effective_from: "2024-01-01",
      funding_pct: t.fund ?? 75, calc_method: t.simple ? "simple" : "slab", interest_pct: t.simple ?? null,
      slab_mode: INFERRED_COMMON.slab_mode, days_in_year: INFERRED_COMMON.days_in_year,
      min_interest_days: INFERRED_COMMON.min_interest_days, round_step_paise: INFERRED_COMMON.round_step_paise,
      tenure_days: INFERRED_COMMON.tenure_days, penal_rate_pct: 0, penal_grace_days: 0,
      status: "published", maker_id: MAKER, checker_id: CHECKER, published_at: at(today, "09:00"), created_by: MAKER };
    const svid = await ins("scheme_version", svRow);
    for (const s of t.slabs || []) await ins("scheme_slab", { scheme_version_id: svid, ...s }, null);
    SV.set(svid, { row: { ...svRow, id: svid }, code: `MRK-${code}`, inferred: true,
      scheme: schemeFromRow(svRow, t.slabs || [], `MRK-${code}`) });
    inferredSv[code] = svid;
    return svid;
  };

  // ═════════════════════════ 4 · customers ═════════════════════════
  const imported = data.customers;
  const maxNum = Math.max(...imported.filter(c => /^IND\d+$/.test(c.custNo)).map(c => Number(c.custNo.slice(3))));
  await q(`SELECT setval('customer_no_seq', GREATEST((SELECT last_value FROM customer_no_seq), $1))`, [maxNum]);
  const taken = new Set((await q(`SELECT cust_no FROM customer WHERE cust_no = ANY($1)`, [imported.map(c => c.custNo)])).map(r => r.cust_no));
  const loansByCust = {};
  for (const l of data.loans) (loansByCust[l.cust] ??= []).push(l);
  const CUST = {};                                                  // maraekat id → { id, custNo, full, bank, reentry }
  for (const c of imported) {
    let custNo = c.custNo;
    if (taken.has(custNo)) {
      custNo = (await q1(`SELECT next_customer_no() AS n`)).n;
      notes.push({ loanNo: "", kind: "customer_renumbered", detail: `${c.custNo} already belongs to another GoldDesk customer → imported as ${custNo}` });
    }
    const ls = loansByCust[c.custNo] || [];
    const open = ls.filter(l => l.status === "Approve");
    const openPaise = open.reduce((t, l) => t + l.amountPaise, 0);
    const id = await ins("customer", { cust_no: custNo, cust_type: c.type, first_name: c.first,
      middle_name: c.middle, last_name: c.last, gender: c.gender, mobile: c.mobile, kyc_done_at: c.kycDate,
      max_open_loans: Math.min(32000, Math.max(3, open.length + 2)),
      max_outstanding_paise: Math.max(100000000, Math.ceil((openPaise * 2) / 10000000) * 10000000),
      status: "active", created_at: at(c.kycDate, "10:00"), created_by: MAKER });
    const line1 = "Address not imported — Maraekat test data";
    await ins("customer_address", { customer_id: id, kind: "current", line1, pincode: br.pin || "422001",
      district: "Nashik", state: "Maharashtra" }, null);
    await ins("customer_address", { customer_id: id, kind: "permanent", line1, pincode: br.pin || "422001",
      district: "Nashik", state: "Maharashtra", same_as_current: true }, null);
    await ins("nominee", { customer_id: id, name: "Nominee not imported", relation: "other" }, null);
    const full = [c.first, c.middle, c.last].filter(Boolean).join(" ");
    CUST[c.custNo] = { id, custNo, full, kyc: c.kycDate };
    await cx.query(`INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
                    VALUES ($1,$2,'customer',$3,'customer_imported',$4)`,
      [MAKER, BR, id, JSON.stringify({ custNo, maraekatId: c.custNo, source: "maraekat" })]);
  }
  const custAccount = async (cu, kind) => {
    if (cu[kind]) return cu[kind];
    const re = kind === "reentry";
    cu[kind] = await ins("customer_bank_account", { customer_id: cu.id,
      bank: re ? "ReEntry — adjusted against earlier loans" : "Bank not imported (Maraekat)",
      account_no: `${re ? "REENTRY" : "MRK"}-${cu.custNo}`, ifsc: re ? "NONE0000000" : "MRKI0000000",
      holder_name: cu.full, verify_method: "manual", verified_at: at(cu.kyc, "10:00") });
    return cu[kind];
  };
  step(`${imported.length} customers (customer_no_seq now ≥ ${maxNum})`);

  // ═════════════════════════ 5 · loans ═════════════════════════
  const byLoan = {};
  for (const r of data.receipts) (byLoan[r.loanNo] ??= []).push(r);
  const LOAN = {};                                                  // loanNo → { id, plan, packetId, … }
  const tally = { active: 0, released: 0, renewed: 0, cancelled: 0, receipts: 0, skippedNoScheme: 0 };
  const sorted = [...data.loans].sort((a, b) => a.date === b.date ? (a.loanNo < b.loanNo ? -1 : 1) : (a.date < b.date ? -1 : 1));

  for (const l of sorted) {
    const cu = CUST[l.cust];
    const svid = await pickScheme(l.scheme, l.date);
    const sv = svid ? SV.get(svid) : null;
    const base = rateOn(l.date);
    const appNo = `MRK-${l.loanNo}`;

    // —— cancelled in Maraekat: an application that never became a loan ——
    if (l.status === "Cancel") {
      const req = Math.floor(l.amountPaise / 10000) * 10000;
      const appId = await ins("loan_application", { app_no: appNo, entity_id: ENT, branch_id: BR, customer_id: cu.id,
        status: "cancelled", scheme_version_id: svid, requested_paise: req > 0 ? req : null, purpose: "personal",
        borrower_present: true, valuer1_id: MAKER, rate_date: l.date, base_paise_snapshot: base,
        funding_paise_snapshot: base, created_at: at(l.date, "10:00"), created_by: MAKER });
      const it = backComputeItem({ lendablePaise: l.eligiblePaise, base24kPaise: base,
        fundingPct: Number(sv?.row.funding_pct ?? 75), purityPct: Number(PUR.pct) });
      if (it) await ins("appraisal_item", { application_id: appId, item_id: ITEM[it.itemKey] ?? ITEM.fallback, qty: 1,
        gross_mg: it.grossMg, stone_mg: 0, purity_id: PUR.id, purity_pct_snapshot: PUR.pct,
        market_paise: it.marketPaise, funding_paise: it.fundingPaise,
        narration: "Imported from Maraekat — weight back-computed from the eligible amount" }, null);
      await ins("application_cancellation", { application_id: appId, reason: "other",
        narration: "Cancelled in Maraekat — imported as test data", cancelled_by: MAKER, cancelled_at: at(l.date, "16:00") }, null);
      await ins("loan_state_history", { application_id: appId, from_state: "appraised", to_state: "cancelled",
        at: at(l.date, "16:00"), by_employee: MAKER, note: `cancelled in Maraekat (${l.loanNo})` }, null);
      if (l.legs.length) notes.push({ loanNo: l.loanNo, kind: "cancelled_with_payout",
        detail: `Maraekat shows a payout of ₹${rs(l.legs.reduce((t, g) => t + g.paise, 0))} on a cancelled loan — not imported` });
      tally.cancelled++;
      continue;
    }
    if (!sv) throw new Error(`loan ${l.loanNo}: no scheme for code ${l.scheme}`);

    // —— plan: the engine decides every stored figure ——
    const plan = planLoan({ loan: l, scheme: sv.scheme, receipts: byLoan[l.loanNo] || [] });
    for (const n of plan.notes) notes.push({ loanNo: l.loanNo, ...n });

    // —— application (maker appraises, checker approves) ——
    const appId = await ins("loan_application", { app_no: appNo, entity_id: ENT, branch_id: BR, customer_id: cu.id,
      status: "activated", scheme_version_id: svid, requested_paise: plan.principal, purpose: "personal",
      borrower_present: true, presence_photo_id: FILE.presence, valuer1_id: MAKER, valuer2_id: CHECKER,
      rate_date: l.date, base_paise_snapshot: base, funding_paise_snapshot: base,
      created_at: at(l.date, "10:00"), created_by: MAKER });
    const it = backComputeItem({ lendablePaise: Math.max(l.eligiblePaise, plan.principal), base24kPaise: base,
      fundingPct: Number(sv.row.funding_pct), purityPct: Number(PUR.pct) });
    await ins("appraisal_item", { application_id: appId, item_id: ITEM[it.itemKey] ?? ITEM.fallback, qty: 1,
      gross_mg: it.grossMg, stone_mg: 0, purity_id: PUR.id, purity_pct_snapshot: PUR.pct,
      market_paise: it.marketPaise, funding_paise: it.fundingPaise,
      narration: "Imported from Maraekat — weight back-computed from the eligible amount" }, null);
    await ins("application_rate", { application_id: appId, metal_id: GOLD, base_paise: base, funding_paise: base }, null);
    await ins("loan_state_history", { application_id: appId, from_state: "draft", to_state: "appraised",
      at: at(l.date, "10:20"), by_employee: MAKER, note: "imported from Maraekat" }, null);
    await ins("loan_state_history", { application_id: appId, from_state: "appraised", to_state: "approved",
      at: at(l.date, "10:40"), by_employee: CHECKER, note: "approved in Maraekat" }, null);

    // —— loan, packet, payout ——
    const loanId = await ins("loan", { loan_no: l.loanNo, application_id: appId, entity_id: ENT, branch_id: BR,
      customer_id: cu.id, scheme_version_id: svid, principal_paise: plan.principal, disbursed_at: l.date,
      status: "active", created_at: at(l.date, "11:00"), created_by: MAKER });
    const packetNo = `MRK-PKT-${l.loanNo}`;
    const packetId = await ins("packet", { packet_no: packetNo, loan_id: loanId, status: "in_safe",
      sealed_at: at(l.date, "11:30"), seal_photo_file_id: FILE.seal,
      qr_payload: qrPayload({ packetNo, loanNo: l.loanNo, branchCode: br.code }) });
    const bankLeg = plan.legs.find(g => g.acct !== "Cash" && g.acct !== "ReEntry Bank");
    const fromKey = bankLeg ? bankLeg.acct : plan.legs.find(g => g.acct === "ReEntry Bank") ? "ReEntry Bank" : null;
    const disbId = await ins("disbursement", { loan_id: loanId,
      from_slf_account_id: fromKey ? await slfFor(fromKey) : null, created_at: at(l.date, "11:00"), created_by: MAKER });
    let legNo = 0;
    for (const g of plan.legs) {
      legNo++;
      if (g.acct === "Cash") { await ins("disbursement_leg", { disbursement_id: disbId, kind: "cash", amount_paise: g.paise }, null); continue; }
      const re = g.acct === "ReEntry Bank";
      if (!re && g.acct !== fromKey) notes.push({ loanNo: l.loanNo, kind: "second_payout_bank",
        detail: `₹${rs(g.paise)} paid from ${g.acct}; GoldDesk records one SLF account per payout (${fromKey})` });
      await ins("disbursement_leg", { disbursement_id: disbId, kind: "bank",
        customer_bank_account_id: await custAccount(cu, re ? "reentry" : "bank"), amount_paise: g.paise,
        utr: `MRK-${l.loanNo}-${legNo}` }, null);
    }
    await ins("loan_state_history", { application_id: appId, loan_id: loanId, from_state: "approved", to_state: "active",
      at: at(l.date, "11:00"), by_employee: MAKER, note: `disbursed ${l.loanNo} (imported from Maraekat)` }, null);
    await ins("vault_movement", { packet_id: packetId, direction: "in", safe_id: SAFE, reason: "vault_in",
      at: at(l.date, "11:30"), by_employee: MAKER }, null);

    // —— charges, then receipts with the engine's appropriation ——
    const chargeId = {};
    for (const c of plan.charges)
      chargeId[c.idx] = await ins("loan_charge", { loan_id: loanId, charge_type_id: MISC, base_paise: c.paise,
        gst_paise: 0, total_paise: c.paise, floor_paise: c.paise,
        narration: `Maraekat consolidated charges (receipt ${c.receipt})`, added_by: MAKER, added_at: at(c.date, "09:00") });
    let k = 0;
    for (const r of plan.receipts) {
      k++;
      const rid = await ins("receipt", { receipt_no: r.no, entity_id: ENT, branch_id: BR, loan_id: loanId,
        business_date: r.date, amount_paise: r.paise, mode: r.mode,
        utr: r.mode === "cash" ? null : `MRK-${r.no}`, is_exact_settlement: r.isExact, closes_loan: r.closes,
        seals_cycle: r.sealsCycle, engine_version: ENGINE_VERSION, received_by: MAKER,
        received_at: at(r.date, `12:${String(Math.min(59, k)).padStart(2, "0")}`),
        slf_bank_account_id: r.mode === "cash" ? null : await slfFor(r.account || "B3 HDFC") });
      for (const a of r.rows)
        await ins("receipt_appropriation", { receipt_id: rid, bucket: a.bucket,
          loan_charge_id: a.loanChargeId == null ? null : chargeId[a.loanChargeId], amount_paise: a.amountPaise }, null);
      tally.receipts++;
    }

    // —— how the loan ended ——
    if (plan.state.closed) {
      const renewed = plan.closedByReEntry;
      const closer = plan.receipts.find(r => r.closes);
      await cx.query(`UPDATE loan SET status=$2, closed_at=$3, updated_by=$4 WHERE id=$1`,
        [loanId, renewed ? "closed_by_renewal" : "released", plan.closedOn, MAKER]);
      await ins("loan_state_history", { loan_id: loanId, from_state: "active",
        to_state: renewed ? "closed_by_renewal" : "closed", at: at(plan.closedOn, "15:00"), by_employee: MAKER,
        note: renewed ? `closed by re-pledge (ReEntry receipt ${closer.no})` : `settled in full by receipt ${closer.no}` }, null);
      await ins("vault_movement", { packet_id: packetId, direction: "out", safe_id: SAFE, reason: "release",
        at: at(plan.closedOn, "16:00"), by_employee: MAKER }, null);
      await cx.query(`UPDATE packet SET status='out' WHERE id=$1`, [packetId]);
      if (!renewed) {
        await ins("release", { loan_id: loanId, due_from: plan.closedOn, identity_ok: true, seal_ok: true,
          handover_photo_id: FILE.handover, released_at: at(plan.closedOn, "16:00"), released_by: MAKER }, null);
        await ins("loan_state_history", { loan_id: loanId, from_state: "closed", to_state: "released",
          at: at(plan.closedOn, "16:00"), by_employee: MAKER, note: "gold handed over (closed in Maraekat)" }, null);
        tally.released++;
      } else tally.renewed++;
    } else tally.active++;

    await cx.query(`INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
                    VALUES ($1,$2,'loan',$3,'loan_imported',$4)`,
      [MAKER, BR, loanId, JSON.stringify({ loanNo: l.loanNo, source: "maraekat", scheme: sv.code,
        principal: plan.principal, receipts: plan.receipts.length, notes: plan.notes.length })]);
    LOAN[l.loanNo] = { id: loanId, loan: l, plan, sv, cust: cu };
  }
  step(`${tally.active} running · ${tally.released} closed & released · ${tally.renewed} renewed · ${tally.cancelled} cancelled · ${tally.receipts} receipts`);

  // ═════════════════════════ 6 · renewals (ReEntry) ═════════════════════════
  const olds = [], news = [];
  for (const [no, x] of Object.entries(LOAN)) {
    if (x.plan.closedByReEntry) {
      const c = x.plan.receipts.find(r => r.closes);
      olds.push({ loanNo: no, cust: x.loan.cust, date: x.plan.closedOn, paise: c.paise });
    }
    const re = x.plan.legs.find(g => g.acct === "ReEntry Bank");
    if (re) news.push({ loanNo: no, cust: x.loan.cust, date: x.loan.date, paise: re.paise });
  }
  const pairs = pairRenewals(olds, news);
  for (const p of pairs) {
    await ins("renewal", { old_loan_id: LOAN[p.oldLoanNo].id, new_loan_id: LOAN[p.newLoanNo].id,
      interest_settlement: "paid", capitalized_paise: 0, at: at(LOAN[p.newLoanNo].loan.date, "11:00"), by_employee: MAKER }, null);
  }
  const paired = new Set(pairs.map(p => p.oldLoanNo));
  for (const o of olds) if (!paired.has(o.loanNo))
    notes.push({ loanNo: o.loanNo, kind: "renewal_unpaired",
      detail: "closed through ReEntry but no single new loan of that customer and day to link it to (several old loans went into one new loan)" });
  step(`${pairs.length} renewal links (${olds.length - pairs.length} ReEntry closures without a 1:1 partner)`);

  // ═════════════════════════ 7 · self-checks (read back from the DB) ═════════════════════════
  const problems = [];
  const rb = await q(`SELECT sv.*, l.id, l.loan_no, l.principal_paise, l.disbursed_at::text AS d, l.status::text AS status,
      s.code AS scheme_code, l.scheme_version_id AS svid
      FROM loan l JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id
      WHERE l.created_by=$1 ORDER BY l.loan_no`, [MAKER]);
  const rbSlabs = await q(`SELECT * FROM scheme_slab WHERE scheme_version_id = ANY($1)`, [[...new Set(rb.map(r => r.svid))]]);
  const rbRec = await q(`SELECT r.id, r.loan_id, r.business_date::text AS business_date, r.amount_paise, r.closes_loan, r.engine_version
      FROM receipt r JOIN loan l ON l.id=r.loan_id WHERE l.created_by=$1 ORDER BY r.business_date, r.id`, [MAKER]);
  const rbChg = await q(`SELECT lc.loan_id, lc.id, lc.total_paise, lc.added_at::date::text AS added_on
      FROM loan_charge lc JOIN loan l ON l.id=lc.loan_id WHERE l.created_by=$1 AND lc.removed_at IS NULL`, [MAKER]);
  const rbAp = await q(`SELECT ra.receipt_id, ra.bucket::text AS bucket, ra.loan_charge_id, ra.amount_paise
      FROM receipt_appropriation ra JOIN receipt r ON r.id=ra.receipt_id JOIN loan l ON l.id=r.loan_id WHERE l.created_by=$1`, [MAKER]);
  const group = (rows) => rows.reduce((m, r) => ((m[r.loan_id] ??= []).push(r), m), {});
  const recBy = group(rbRec), chgBy = group(rbChg);
  const apBy = rbAp.reduce((m, a) => ((m[a.receipt_id] ??= []).push(a), m), {});
  const running = [];
  for (const r of rb) {
    try {
      const scheme = schemeFromRow(r, rbSlabs.filter(s => Number(s.scheme_version_id) === Number(r.svid)), r.scheme_code);
      const st = replayLoan({ principalPaise: r.principal_paise, disbursedAt: r.d, scheme,
        charges: chgBy[r.id] || [], receipts: recBy[r.id] || [] });
      const x = LOAN[r.loan_no];
      // every stored receipt split must be what the screens' replay produces
      {
        const s2 = openLoan({ principal: Number(r.principal_paise) / 100, disbursedAt: r.d });
        const queue = {};
        for (const z of recBy[r.id] || []) (queue[`${z.business_date}|${z.amount_paise}|${z.closes_loan}`] ??= []).push(z);
        for (const ev of buildEvents(chgBy[r.id] || [], recBy[r.id] || [])) {
          if (ev.type === "charge") { addCharge(s2, { id: ev.id, amount: ev.amount }); continue; }
          const before = chargeSnapshot(s2);
          const { receipt } = applyPayment(scheme, s2, ev);
          const row = (queue[`${ev.date}|${Math.round(ev.amount * 100)}|${ev.closing}`] || []).shift();
          const want = (apBy[row?.id] || []).map(a => `${a.bucket}:${a.loan_charge_id ?? ""}:${a.amount_paise}`).sort().join(" ");
          const got = appropriationRows(before, s2, receipt).map(a => `${a.bucket}:${a.loanChargeId ?? ""}:${a.amountPaise}`).sort().join(" ");
          if (want !== got) { problems.push(`${r.loan_no} receipt on ${ev.date}: stored split [${want}] ≠ replayed [${got}]`); break; }
        }
      }
      if (st.principal !== x.plan.state.principal || st.closed !== x.plan.state.closed)
        problems.push(`${r.loan_no}: replay from the database differs from the import plan`);
      if ((r.status === "active") === st.closed) problems.push(`${r.loan_no}: status ${r.status} but engine closed=${st.closed}`);
      if (r.status === "active") {
        const d = dues(scheme, st, today);
        const mkOut = x.loan.amountPaise - (byLoan[r.loan_no] || []).reduce((t, z) => t + z.principalPaise, 0);
        running.push({ loanNo: r.loan_no, custNo: x.cust.custNo, scheme: `${r.scheme_code} v${r.version_no}`,
          disbursed: r.d, principal: Number(r.principal_paise), mkOutstanding: mkOut, gdOutstanding: st.principal,
          interestToday: d._paise.interestDue, penalToday: d._paise.penalDue, chargesToday: d._paise.chargesDue,
          settlementToday: d._paise.settlement,
          mkCollected: (byLoan[r.loan_no] || []).reduce((t, z) => t + z.paise, 0),
          gdCollected: (recBy[r.id] || []).reduce((t, z) => t + Number(z.amount_paise), 0) });
      }
    } catch (e) { problems.push(`${r.loan_no}: replay threw — ${e.message}`); }
  }
  const expectLoans = data.loans.filter(l => l.status !== "Cancel").length;
  if (rb.length !== expectLoans) problems.push(`loans in DB ${rb.length} ≠ expected ${expectLoans}`);
  const badPk = await q1(`SELECT count(*)::int AS n FROM loan l JOIN packet p ON p.loan_id=l.id
      WHERE l.created_by=$1 AND ((l.status='active') <> (p.status='in_safe'))`, [MAKER]);
  if (badPk.n) problems.push(`${badPk.n} packet(s) whose custody does not match the loan status`);
  step(`self-check: ${rb.length} loans replayed from the database — ${problems.length ? problems.length + " PROBLEM(S)" : "all identical to the plan"}`);

  // ═════════════════════════ 8 · report ═════════════════════════
  fs.mkdirSync(reportDir, { recursive: true });
  const csv = (rows, cols) => [cols.join(","), ...rows.map(r => cols.map(c => {
    const v = r[c] ?? ""; const s = typeof v === "number" && /Paise$|^(principal|mk|gd|interest|penal|charges|settlement)/.test(c) ? (v / 100).toFixed(2) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n") + "\n";
  fs.writeFileSync(path.join(reportDir, "notes.csv"), csv(notes, ["loanNo", "kind", "receipt", "detail"]));
  fs.writeFileSync(path.join(reportDir, "running-loans.csv"), csv(running,
    ["loanNo", "custNo", "scheme", "disbursed", "principal", "mkOutstanding", "gdOutstanding",
     "interestToday", "penalToday", "chargesToday", "settlementToday", "mkCollected", "gdCollected"]));
  const kinds = notes.reduce((m, n) => (m[n.kind] = (m[n.kind] || 0) + 1, m), {});
  const sum = (f) => running.reduce((t, r) => t + f(r), 0);
  const schemeUse = {};
  for (const x of Object.values(LOAN)) schemeUse[`${x.loan.scheme} → ${x.sv.code} v${x.sv.row.version_no}${x.sv.inferred ? " (inferred)" : ""}`] =
    (schemeUse[`${x.loan.scheme} → ${x.sv.code} v${x.sv.row.version_no}${x.sv.inferred ? " (inferred)" : ""}`] || 0) + 1;
  const summary = [
    `Maraekat import — ${COMMIT ? "COMMITTED" : "REHEARSAL (rolled back)"} on ${today}`,
    `customers ${imported.length} · loans ${expectLoans} (running ${tally.active}, released ${tally.released}, renewed ${tally.renewed}) · cancelled applications ${tally.cancelled} · receipts ${tally.receipts}`,
    `running loans principal: Maraekat ₹${rs(sum(r => r.mkOutstanding))} · GoldDesk ₹${rs(sum(r => r.gdOutstanding))} · differ on ${running.filter(r => r.mkOutstanding !== r.gdOutstanding).length} loan(s)`,
    `running loans due today (GoldDesk): interest ₹${rs(sum(r => r.interestToday))} · penal ₹${rs(sum(r => r.penalToday))} · charges ₹${rs(sum(r => r.chargesToday))}`,
    `money: Maraekat receipts ₹${rs(data.receipts.reduce((t, r) => t + r.paise, 0))} · GoldDesk stored ₹${rs(rbRec.reduce((t, r) => t + Number(r.amount_paise), 0))}`,
    "schemes: " + Object.entries(schemeUse).sort().map(([k, v]) => `${k}: ${v}`).join(" · "),
    "notes: " + Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(" · "),
    ...problems.slice(0, 20).map(p => "PROBLEM " + p),
  ].join("\n");
  fs.writeFileSync(path.join(reportDir, "summary.txt"), summary + "\n");
  console.log("\n" + summary + `\nreport files: ${reportDir}/summary.txt, notes.csv, running-loans.csv`);

  await cx.query(`INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
                  VALUES ($1,$2,'import',NULL,'maraekat_import',$3)`,
    [MAKER, BR, JSON.stringify({ customers: imported.length, ...tally, renewals: pairs.length, notes: kinds })]);

  if (problems.length) throw new Error(`${problems.length} self-check problem(s) — nothing was saved`);
  if (COMMIT) { await cx.query("COMMIT"); console.log("\nIMPORT COMMITTED"); }
  else { await cx.query("ROLLBACK"); console.log("\nREHEARSAL OK — rolled back, nothing saved (add --commit to keep it)"); }
} catch (e) {
  failed = true;
  await cx.query("ROLLBACK").catch(() => {});
  console.error("\nIMPORT FAILED, nothing changed:", e.message);
} finally {
  cx.release();
  await pool.end();
}
// Placeholder photo upload is best-effort and only after a commit.
if (!failed && COMMIT && process.env.S3_BUCKET !== "none") {
  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" });
    const body = fs.readFileSync(new URL("./import-assets/maraekat-no-photo.jpg", import.meta.url));
    for (const kind of ["presence", "seal", "handover"])
      await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET || "slf-golddesk-media-4471",
        Key: `import/maraekat/no-photo-${kind}.jpg`, Body: body, ContentType: "image/jpeg",
        ServerSideEncryption: "AES256" }), { abortSignal: AbortSignal.timeout(15000) });
    console.log("placeholder photos uploaded");
  } catch (e) { console.log("placeholder photos NOT uploaded (pictures will show as missing):", e.name); }
}
process.exit(failed ? 1 : 0);
