import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
import { validContact, validAddress, validNominee, diffFields } from "@/lib/editcust.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edit customer — the frozen editcust scope only: contact, current address,
 * nominee. Name / IDs / limits are NOT editable here.
 * Same guard as customer creation: appraise or collect, full.
 */
export async function POST(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  // №4 (owner): contact/address/nominee edits are a granted right, not a
  // side-effect of counter permissions. Settings-full always may.
  if (!can(actor, "settings", { need: "full" }).ok
      && !can(actor, "edit_customer", { need: "full" }).ok)
    return NextResponse.json({ ok: false,
      reason: "You may not edit customers — ask for the Edit customer permission" }, { status: 403 });

  const { id } = await params;
  const cust = await one(
    `SELECT id, cust_no, full_name, mobile, alt_mobile, email FROM customer WHERE id = $1`, [id]);
  if (!cust) return NextResponse.json({ ok: false, reason: "Customer not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const vc = validContact(b.contact || {});
  const va = validAddress(b.address || {});
  const vn = validNominee(b.nominee || {});
  const problems = [...vc.problems, ...va.problems, ...vn.problems];
  if (problems.length)
    return NextResponse.json({ ok: false, reason: problems[0], problems }, { status: 400 });

  try {
    const curAddr = await one(
      `SELECT id, line1, line2, pincode, area, taluka, district, state
         FROM customer_address WHERE customer_id = $1 AND kind = 'current' LIMIT 1`, [cust.id]);
    const curNom = await one(
      `SELECT id, name, relation, mobile FROM nominee
        WHERE customer_id = $1 AND is_current LIMIT 1`, [cust.id]);

    // what actually changed — a no-op save writes nothing
    const contactDiff = diffFields(
      { mobile: cust.mobile, altMobile: cust.alt_mobile, email: cust.email },
      { mobile: vc.mobile, altMobile: vc.altMobile, email: vc.email });
    const addressDiff = diffFields(
      curAddr ? { line1: curAddr.line1, line2: curAddr.line2, pincode: curAddr.pincode,
        area: curAddr.area, taluka: curAddr.taluka, district: curAddr.district,
        state: curAddr.state } : {},
      { line1: va.line1, line2: va.line2, pincode: va.pincode, area: va.area,
        taluka: va.taluka, district: va.district, state: va.state });
    const nomineeDiff = diffFields(
      curNom ? { name: curNom.name, relation: curNom.relation, mobile: curNom.mobile }
             : { name: null, relation: null, mobile: null },
      { name: vn.name, relation: vn.relation, mobile: vn.mobile });

    if (!Object.keys(contactDiff).length && !Object.keys(addressDiff).length
        && !Object.keys(nomineeDiff).length)
      return NextResponse.json({ ok: true, unchanged: true });

    await tx(async (cl) => {
      if (Object.keys(contactDiff).length) {
        await cl.query(
          `UPDATE customer SET mobile=$2, alt_mobile=$3, email=$4 WHERE id=$1`,
          [cust.id, vc.mobile, vc.altMobile, vc.email]);
      }

      if (Object.keys(addressDiff).length) {
        if (curAddr) {
          await cl.query(
            `UPDATE customer_address SET line1=$2, line2=$3, pincode=$4, area=$5,
                    taluka=$6, district=$7, state=$8 WHERE id=$1`,
            [curAddr.id, va.line1, va.line2, va.pincode, va.area, va.taluka,
             va.district, va.state]);
          // a permanent address marked "same as current" follows the current one
          await cl.query(
            `UPDATE customer_address SET line1=$2, line2=$3, pincode=$4, area=$5,
                    taluka=$6, district=$7, state=$8
              WHERE customer_id=$1 AND kind='permanent' AND same_as_current`,
            [cust.id, va.line1, va.line2, va.pincode, va.area, va.taluka,
             va.district, va.state]);
        } else {
          await cl.query(
            `INSERT INTO customer_address (customer_id, kind, line1, line2, pincode,
               area, taluka, district, state, same_as_current)
             VALUES ($1,'current',$2,$3,$4,$5,$6,$7,$8,FALSE)`,
            [cust.id, va.line1, va.line2, va.pincode, va.area, va.taluka,
             va.district, va.state]);
        }
      }

      if (Object.keys(nomineeDiff).length) {
        // versioned: retire the old nominee, never overwrite them
        await cl.query(
          `UPDATE nominee SET is_current = FALSE WHERE customer_id = $1 AND is_current`,
          [cust.id]);
        if (!vn.empty) {
          await cl.query(
            `INSERT INTO nominee (customer_id, name, relation, mobile)
             VALUES ($1,$2,$3,$4)`,
            [cust.id, vn.name, vn.relation, vn.mobile]);
        }
      }

      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "customer", entityId: cust.id, action: "edit",
        before: { custNo: cust.cust_no },
        after: { contact: contactDiff, address: addressDiff, nominee: nomineeDiff } });
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: "The change could not be saved" }, { status: 500 });
  }
}
