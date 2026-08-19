import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * №3 + №4 — bank accounts on the Customer 360.
 * Gate: settings(full) OR the new edit_customer(full) permission.
 * THE RULE WITH TEETH: changing the account number or IFSC clears the
 * verification — otherwise "verified" means nothing. Payouts to the account
 * then refuse until it is verified again (the existing DB rule, unchanged).
 */
function mayEdit(actor) {
  return can(actor, "settings", { need: "full" }).ok
    || can(actor, "edit_customer", { need: "full" }).ok;
}

export async function POST(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!mayEdit(actor))
    return NextResponse.json({ ok: false,
      reason: "You may not edit customer bank details — ask for the Edit customer permission" },
      { status: 403 });

  const { id } = await params;
  const cust = await one(`SELECT id, cust_no FROM customer WHERE id = $1`, [id]);
  if (!cust) return NextResponse.json({ ok: false, reason: "Customer not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const problems = [];
  const accountNo = String(b.accountNo || "").replace(/\s/g, "");
  const ifsc = String(b.ifsc || "").trim().toUpperCase();
  const holder = String(b.holderName || "").trim();
  if (!/^\d{6,20}$/.test(accountNo)) problems.push("Account number must be 6–20 digits");
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) problems.push("IFSC must look like SBIN0001234");
  if (holder.length < 3) problems.push("Account holder name must be at least 3 characters");
  if (problems.length)
    return NextResponse.json({ ok: false, reason: problems[0], problems }, { status: 400 });

  try {
    if (b.action === "edit") {
      const cur = await one(
        `SELECT * FROM customer_bank_account WHERE id = $1 AND customer_id = $2`, [b.id, cust.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Account not found" }, { status: 404 });
      const identityChanged = cur.account_no !== accountNo || cur.ifsc !== ifsc;
      await tx(async (cl) => {
        await cl.query(
          `UPDATE customer_bank_account
              SET bank=$3, bank_branch=$4, account_no=$5, ifsc=$6, holder_name=$7, acct_type=$8,
                  verify_method = CASE WHEN $9 THEN 'none' ELSE verify_method END,
                  verified_at   = CASE WHEN $9 THEN NULL   ELSE verified_at   END
            WHERE id=$1 AND customer_id=$2`,
          [cur.id, cust.id, b.bank || "—", b.bankBranch || null, accountNo, ifsc, holder,
           b.acctType || null, identityChanged]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "customer_bank_account", entityId: cur.id, action: "edit",
          before: { accountNo: cur.account_no, ifsc: cur.ifsc },
          after: { accountNo, ifsc, verificationCleared: identityChanged } });
      });
      return NextResponse.json({ ok: true, verificationCleared:
        cur.account_no !== accountNo || cur.ifsc !== ifsc });
    }

    // default: add
    const row = await tx(async (cl) => {
      const r = await cl.query(
        `INSERT INTO customer_bank_account
           (customer_id, bank, bank_branch, account_no, ifsc, holder_name, acct_type, verify_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'none') RETURNING id`,
        [cust.id, b.bank || "—", b.bankBranch || null, accountNo, ifsc, holder, b.acctType || null]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "customer_bank_account", entityId: r.rows[0].id, action: "add",
        after: { custNo: cust.cust_no, accountNo, ifsc } });
      return r.rows[0];
    });
    return NextResponse.json({ ok: true, id: Number(row.id) });
  } catch {
    return NextResponse.json({ ok: false, reason: "The account could not be saved" }, { status: 500 });
  }
}
