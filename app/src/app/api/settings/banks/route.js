import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validSlfBank, maskAccount } from "@/lib/slfbanks.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "set_banks", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const rows = await q(
    `SELECT a.id, a.entity_id, a.nickname, a.bank, a.ifsc, a.account_no, a.scope_all,
            a.ledger_id, a.allow_disbursement, a.allow_collection, a.active,
            COALESCE((SELECT array_agg(ab.branch_id ORDER BY ab.branch_id)
                        FROM slf_bank_account_branch ab WHERE ab.account_id = a.id),
                     '{}') AS branch_ids,
            (SELECT count(*) FROM disbursement d WHERE d.from_slf_account_id = a.id)::int
              + (SELECT count(*) FROM cash_transfer ct WHERE ct.slf_bank_account_id = a.id)::int
              AS used_on
       FROM slf_bank_account a
      ORDER BY a.active DESC, a.nickname`);
  const branches = await q(
    `SELECT id, code, name, is_ho FROM branch WHERE active ORDER BY is_ho, code`);
  const entities = await q(
    `SELECT id, code, legal_name FROM entity WHERE active ORDER BY id`);
  const ledgers = await q(
    `SELECT id, code, name FROM ledger WHERE active ORDER BY code`).catch(() => []);

  return NextResponse.json({ ok: true,
    rows: rows.map(r => ({ id: Number(r.id), entityId: Number(r.entity_id),
      branchIds: (r.branch_ids || []).map(Number),
      scopeAll: r.scope_all,
      branchLabel: r.scope_all
        ? "All branches"
        : ((r.branch_ids || []).length
            ? branches.filter(x => r.branch_ids.map(Number).includes(Number(x.id)))
                .map(x => x.code).join(", ")
            : "No branch — parked"),
      nickname: r.nickname, bank: r.bank, ifsc: r.ifsc, accountNo: r.account_no,
      ledgerId: r.ledger_id ? Number(r.ledger_id) : null,
      allowDisbursement: r.allow_disbursement, allowCollection: r.allow_collection,
      active: r.active, usedOn: r.used_on })),
    branches: branches.map(b => ({ id: Number(b.id),
      label: `${b.code} ${b.name}${b.is_ho ? " (HO)" : ""}` })),
    entities: entities.map(e => ({ id: Number(e.id), label: e.legal_name })),
    ledgers: ledgers.map(l => ({ id: Number(l.id), label: `${l.code} · ${l.name}` })),
    canEdit: can(actor, "set_banks", { need: "add" }).ok || can(actor, "set_banks", { need: "edit" }).ok,
    verbs: { add: can(actor, "set_banks", { need: "add" }).ok,
             edit: can(actor, "set_banks", { need: "edit" }).ok,
             del: can(actor, "set_banks", { need: "delete" }).ok } });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "view");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });
    const b = await req.json().catch(() => ({}));

    if (b.action === "create") {
      if (!can(actor, "set_banks", { need: "add" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not create here — ask for the Add permission on Settings · banks" }, { status: 403 });
      const v = validSlfBank(b);
      if (!v.ok) return bad(v.problems);
      const ent = b.entityId
        ? await one(`SELECT id FROM entity WHERE id=$1 AND active`, [b.entityId])
        : await one(`SELECT id FROM entity WHERE active ORDER BY id LIMIT 1`);
      if (!ent) return bad(["No active entity found"]);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO slf_bank_account (entity_id, nickname, bank, ifsc,
             account_no, account_no_masked, scope_all, ledger_id,
             allow_disbursement, allow_collection)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [ent.id, v.nickname, v.bank, v.ifsc, v.accountNo, v.masked, v.scopeAll,
           v.ledgerId, v.allowDisbursement, v.allowCollection]);
        for (const bid of v.branchIds)
          await cl.query(`INSERT INTO slf_bank_account_branch (account_id, branch_id)
                          VALUES ($1,$2)`, [r.rows[0].id, bid]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "slf_bank_account", entityId: r.rows[0].id, action: "create",
          after: { nickname: v.nickname, ifsc: v.ifsc, masked: v.masked,
                   branches: v.scopeAll ? "all" : (v.branchIds.length ? v.branchIds : "none"),
                   disb: v.allowDisbursement, coll: v.allowCollection } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    const acct = b.id ? await one(`SELECT * FROM slf_bank_account WHERE id=$1`, [b.id]) : null;
    if (!acct) return NextResponse.json({ ok: false, reason: "Account not found" }, { status: 404 });

    if (b.action === "edit") {
      if (!can(actor, "set_banks", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — ask for the Edit permission on Settings · banks" }, { status: 403 });
      // blank account number keeps the stored one; typing replaces it
      const v = validSlfBank({ ...b, accountNo: b.accountNo || acct.account_no });
      if (!v.ok) return bad(v.problems);
      await tx(async (cl) => {
        await cl.query(
          `UPDATE slf_bank_account SET nickname=$2, bank=$3, ifsc=$4, account_no=$5,
                  account_no_masked=$6, scope_all=$7, ledger_id=$8,
                  allow_disbursement=$9, allow_collection=$10
            WHERE id=$1`,
          [acct.id, v.nickname, v.bank, v.ifsc, v.accountNo, v.masked, v.scopeAll,
           v.ledgerId, v.allowDisbursement, v.allowCollection]);
        await cl.query(`DELETE FROM slf_bank_account_branch WHERE account_id=$1`, [acct.id]);
        for (const bid of v.branchIds)
          await cl.query(`INSERT INTO slf_bank_account_branch (account_id, branch_id)
                          VALUES ($1,$2)`, [acct.id, bid]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "slf_bank_account", entityId: acct.id, action: "edit",
          before: { nickname: acct.nickname, ifsc: acct.ifsc },
          after: { nickname: v.nickname, ifsc: v.ifsc,
                   numberChanged: v.accountNo !== acct.account_no,
                   branches: v.branchIds.length ? v.branchIds : "all" } });
      });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "toggle") {
      if (!can(actor, "set_banks", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — ask for the Edit permission on Settings · banks" }, { status: 403 });
      await tx(async (cl) => {
        await cl.query(`UPDATE slf_bank_account SET active = NOT active WHERE id=$1`, [acct.id]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "slf_bank_account", entityId: acct.id,
          action: acct.active ? "deactivate" : "reactivate",
          before: { nickname: acct.nickname } });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (String(e.message || "").includes("slf_bank_account_nickname_key"))
      return NextResponse.json({ ok: false,
        reason: "That nickname is already in use — nicknames are how staff tell accounts apart" },
        { status: 409 });
    return NextResponse.json({ ok: false, reason: "The account could not be saved" }, { status: 500 });
  }
}

function bad(problems, status = 400) {
  return NextResponse.json({ ok: false, reason: problems[0], problems }, { status });
}
