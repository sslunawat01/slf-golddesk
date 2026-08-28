import { titleCaseName } from "@/lib/format.js";
import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { tx, audit, one } from "@/lib/db.js";
import { validateNewCustomer, blacklistState } from "@/lib/customer.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a customer. Everything lands in ONE transaction: the customer, their
 * addresses, photo, documents with scans, nominee, banks — or nothing at all.
 */
/** The screen shows "Low"; the database stores "low". Never let a label become a value. */
function normEnum(value, allowed) {
  const v = String(value ?? "").trim().toLowerCase();
  return allowed.includes(v) ? v : null;
}

export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "appraise", { need: "full" }).ok && !can(actor, "collect", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not create customers" }, { status: 403 });

  const c = await req.json().catch(() => ({}));
  const v = validateNewCustomer(c);
  if (!v.ok) return NextResponse.json({ ok: false, reason: `Missing: ${v.first}`, missing: v.missing }, { status: 400 });

  // duplicate identity checks — same table refuses; customer↔employee asks to confirm
  const pan = (c.pan || "").trim().toUpperCase();
  const aadhaar = String(c.aadhaar || "").replace(/\D/g, "");
  if (pan) {
    const dc = await one(
      `SELECT full_name, cust_no FROM customer WHERE upper(pan_no) = $1 LIMIT 1`, [pan]);
    if (dc) return NextResponse.json({ ok: false,
      reason: `Already a customer with this PAN — ${dc.full_name} (${dc.cust_no}). Open their profile instead of creating a duplicate.` },
      { status: 409 });
  }
  if (!c.dupAcknowledged) {
    const hits = [];
    if (aadhaar.length === 12) {
      const de = await one(
        `SELECT full_name, emp_code FROM employee WHERE aadhaar_no = $1 LIMIT 1`, [aadhaar]);
      if (de) hits.push(`an employee has the same Aadhaar — ${de.full_name} (${de.emp_code})`);
      const dc4 = await one(
        `SELECT full_name, cust_no FROM customer WHERE aadhaar_last4 = $1 LIMIT 1`,
        [aadhaar.slice(-4)]);
      if (dc4) hits.push(`a customer's Aadhaar ends in the same 4 digits — ${dc4.full_name} (${dc4.cust_no})`);
    }
    if (pan) {
      const de = await one(
        `SELECT full_name, emp_code FROM employee WHERE upper(pan_no) = $1 LIMIT 1`, [pan]);
      if (de) hits.push(`an employee has the same PAN — ${de.full_name} (${de.emp_code})`);
    }
    if (hits.length) return NextResponse.json({ ok: false, needsDupConfirm: true,
      reason: `Possible duplicate: ${hits.join("; ")}. If this is genuinely a different person (or an employee who is also a customer), confirm to save anyway.` },
      { status: 409 });
  }

  const bl = blacklistState(c.maxOpenLoans, c.maxOutstandingPaise, c.narration);
  if (bl.isBlacklisted && !c.blacklistAcknowledged)
    return NextResponse.json({ ok: false, needsBlacklistConfirm: true,
      reason: "A zero limit marks this customer as blacklisted" }, { status: 409 });

  try {
    const out = await tx(async (cl) => {
      const { rows: [{ no }] } = await cl.query(`SELECT next_customer_no() AS no`);

      const { rows: [cust] } = await cl.query(
        `INSERT INTO customer (cust_no, cust_type, first_name, middle_name, last_name, gender, dob,
           relative_name, mobile, alt_mobile, email, app_access, aadhaar_last4, aadhaar_verified_at,
           pan_no, pan_verified_at, gstin, risk, kyc_done_at, max_open_loans, max_outstanding_paise,
           blacklist_narration, created_by, mobile_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CURRENT_DATE,$19,$20,$21,$22,$23)
         RETURNING id, cust_no, full_name, is_blacklisted`,
        [no, c.custType || "individual", titleCaseName(c.firstName), titleCaseName(c.middleName) || null, titleCaseName(c.lastName),
         normEnum(c.gender, ["male","female","other"]), c.dob, c.relativeName?.trim() || null, c.mobile, c.altMobile || null,
         c.email || null, !!c.appAccess, String(c.aadhaar).slice(-4), c.aadhaarVerified ? new Date() : null,
         c.pan.toUpperCase(), c.panVerified ? new Date() : null, c.gstin?.toUpperCase() || null,
         normEnum(c.risk, ["low","medium","high"]), Number(c.maxOpenLoans), Number(c.maxOutstandingPaise),
         c.narration?.trim() || null, actor.employeeId, c.mobileVerified ? new Date() : null]);

      const cid = cust.id;
      const addr = (kind, a, same) => cl.query(
        `INSERT INTO customer_address (customer_id, kind, line1, line2, pincode, area, taluka, district, state, same_as_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cid, kind, a.line1.trim(), a.line2?.trim() || null, a.pincode, a.area || null,
         a.taluka || null, a.district || null, a.state || null, !!same]);
      await addr("current", c.current, false);
      await addr("permanent", c.sameAsCurrent ? c.current : c.permanent, !!c.sameAsCurrent);

      await cl.query(`INSERT INTO customer_photo (customer_id, file_id, is_current) VALUES ($1,$2,TRUE)`,
        [cid, c.photoFileId]);

      for (const d of (c.docs || [])) {
        if (!d.docTypeId || !d.number?.trim()) continue;
        const { rows: [doc] } = await cl.query(
          `INSERT INTO customer_document (customer_id, doc_type_id, number, expiry_d) VALUES ($1,$2,$3,$4) RETURNING id`,
          [cid, d.docTypeId, d.number.trim(), d.expiry || null]);
        for (const fid of d.scans || [])
          await cl.query(`INSERT INTO customer_document_scan (customer_document_id, file_id) VALUES ($1,$2)`,
            [doc.id, fid]);
      }

      for (const [label, list] of [["Aadhaar Card", c.aadhaarScans], ["PAN Card", c.panScans]]) {
        if (!list?.length) continue;
        const dt = await one(`SELECT id FROM document_type WHERE name=$1 AND category='id_proof' LIMIT 1`, [label]);
        if (!dt) continue;
        const { rows: [doc] } = await cl.query(
          `INSERT INTO customer_document (customer_id, doc_type_id, number) VALUES ($1,$2,$3) RETURNING id`,
          [cid, dt.id, label === "Aadhaar Card" ? String(c.aadhaar).slice(-4) : (c.pan || "").toUpperCase()]);
        for (const f of list)
          await cl.query(`INSERT INTO customer_document_scan (customer_document_id, file_id) VALUES ($1,$2)`,
            [doc.id, f.fileId ?? f]);
      }

      await cl.query(`INSERT INTO nominee (customer_id, name, relation, mobile) VALUES ($1,$2,$3,$4)`,
        [cid, c.nominee.name.trim(), c.nominee.relation, c.nominee.mobile || null]);

      for (const b of c.banks || []) {
        if (!b.accountNo?.trim()) continue;
        await cl.query(
          `INSERT INTO customer_bank_account (customer_id, bank, bank_branch, account_no, ifsc, holder_name,
             acct_type, upi_id, upi_verified_at, verify_method, verified_at, cheque_file_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [cid, b.bank || "—", b.bankBranch || null, b.accountNo.trim(), b.ifsc.toUpperCase(),
           b.holderName.trim(), b.acctType || null, b.upiId || null, b.upiVerified ? new Date() : null,
           b.verifyMethod || "none", b.verifiedAt ? new Date() : null, b.chequeFileId || null]);
      }

      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "customer", entityId: cid, action: "customer_created",
        after: { cust_no: cust.cust_no, name: cust.full_name, blacklisted: cust.is_blacklisted } });

      return { id: Number(cid), custNo: cust.cust_no, name: cust.full_name, blacklisted: cust.is_blacklisted };
    }, { entityIds: actor.entityIds });

    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[customers] create failed", e);
    const dup = /duplicate key/.test(e.message);
    return NextResponse.json({ ok: false,
      reason: dup ? "A customer with that detail already exists" : "Could not save — nothing was written" },
      { status: dup ? 409 : 500 });
  }
}
