import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
import { validContact, validAddress, validNominee, diffFields } from "@/lib/editcust.js";
import { underAge } from "@/lib/customer.js";
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

  // E32 №5 (owner, 15 Oct 2026): warning / blacklist remarks. A warning is an
  // edit-customer right; a blacklist is its own granted permission. Clearing
  // a remark is the same right as setting it. Everything is audited.
  if (b.action === "remarks") {
    const warn = String(b.warningRemark ?? "").trim().slice(0, 500) || null;
    const black = String(b.blacklistRemark ?? "").trim().slice(0, 500) || null;
    const full = await one(`SELECT warning_remark, blacklist_remark FROM customer WHERE id=$1`, [cust.id]);
    const warnChanged = warn !== (full.warning_remark || null);
    const blackChanged = black !== (full.blacklist_remark || null);
    if (blackChanged && !can(actor, "blacklist", { need: "full" }).ok)
      return NextResponse.json({ ok: false,
        reason: "You may not blacklist or un-blacklist a customer — ask for the Blacklist permission" }, { status: 403 });
    if (!warnChanged && !blackChanged) return NextResponse.json({ ok: true, unchanged: true });
    await tx(async (cl) => {
      if (warnChanged) await cl.query(
        `UPDATE customer SET warning_remark=$2, warning_set_by=$3, warning_set_at=now(), updated_by=$3 WHERE id=$1`,
        [cust.id, warn, actor.employeeId]);
      if (blackChanged) await cl.query(
        `UPDATE customer SET blacklist_remark=$2, blacklist_set_by=$3, blacklist_set_at=now(), updated_by=$3 WHERE id=$1`,
        [cust.id, black, actor.employeeId]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "customer", entityId: cust.id,
        action: blackChanged ? (black ? "customer_blacklisted" : "customer_unblacklisted") : "customer_warning_set",
        before: { warningRemark: full.warning_remark, blacklistRemark: full.blacklist_remark },
        after: { warningRemark: warn, blacklistRemark: black } });
    }, { entityIds: actor.entityIds });
    return NextResponse.json({ ok: true, warningRemark: warn, blacklistRemark: black });
  }

  if (b.action === "full") {
    // D-F (owner, 29 Aug 2026): the full-field edit — every creation field,
    // same screen, same duplicate ceremonies. Banks are NOT touched here
    // (the 360 manages them); documents are add-only; the customer number
    // never changes.
    const first = String(b.firstName || "").trim();
    const last = String(b.lastName || "").trim();
    const mobile = String(b.mobile || "").replace(/\D/g, "");
    const probs = [];
    if (first.length < 2) probs.push("First name is compulsory");
    if (last.length < 2) probs.push("Last name is compulsory");
    if (!/^[6-9]\d{9}$/.test(mobile)) probs.push("Mobile must be a 10-digit number starting 6-9");
    if (!b.dob) probs.push("Date of birth is compulsory");
    else if (b.custType !== "corporate" && underAge(String(b.dob).slice(0, 10), new Date().toISOString().slice(0, 10)))
      probs.push("The customer must be 18 or older (E32 №10)");
    if (!b.gender) probs.push("Gender is compulsory");
    const va2 = validAddress(b.current || {});
    if (!va2.ok) probs.push(...va2.problems.map(x => "Current address: " + x));
    const vperm = b.sameAsCurrent ? va2 : validAddress(b.permanent || {});
    if (!b.sameAsCurrent && !vperm.ok) probs.push(...vperm.problems.map(x => "Permanent address: " + x));
    const vn2 = validNominee(b.nominee || {});
    if (!vn2.ok) probs.push(...vn2.problems);
    if (probs.length)
      return NextResponse.json({ ok: false, reason: probs[0], problems: probs }, { status: 400 });

    const full = await one(`SELECT * FROM customer WHERE id=$1`, [cust.id]);
    const aadhaar = String(b.aadhaar || "").replace(/\D/g, "");
    // E21 №2: full number is the identity now — changed when it differs from
    // the stored full number (or when no full number was on file yet)
    const aadhaarChanged = aadhaar.length === 12 && aadhaar !== (full.aadhaar_no || "");
    const pan = String(b.pan || "").trim().toUpperCase();
    const panChanged = !!pan && pan !== (full.pan_no || "");

    // same duplicate ceremonies as creation, only when identity actually moves
    if (panChanged) {
      const dc = await one(`SELECT full_name, cust_no FROM customer
                             WHERE upper(pan_no)=$1 AND id<>$2 LIMIT 1`, [pan, cust.id]);
      if (dc) return NextResponse.json({ ok: false,
        reason: `Already a customer with this PAN — ${dc.full_name} (${dc.cust_no}).` }, { status: 409 });
    }
    // E21 №2: mobile and full Aadhaar never repeat across customers — hard
    const dm2 = await one(`SELECT full_name, cust_no FROM customer
                            WHERE mobile=$1 AND id<>$2 LIMIT 1`, [mobile, cust.id]);
    if (dm2) return NextResponse.json({ ok: false,
      reason: `This mobile already belongs to ${dm2.full_name} (${dm2.cust_no}) — mobile numbers never repeat (app login)` }, { status: 409 });
    if (aadhaarChanged) {
      const da2 = await one(`SELECT full_name, cust_no FROM customer
                              WHERE aadhaar_no=$1 AND id<>$2 LIMIT 1`, [aadhaar, cust.id]);
      if (da2) return NextResponse.json({ ok: false,
        reason: `This Aadhaar already belongs to ${da2.full_name} (${da2.cust_no}) — identity numbers never repeat` }, { status: 409 });
    }
    if ((aadhaarChanged || panChanged) && !b.dupAcknowledged) {
      const hits = [];
      if (aadhaarChanged) {
        const de = await one(`SELECT full_name, emp_code FROM employee WHERE aadhaar_no=$1 LIMIT 1`, [aadhaar]);
        if (de) hits.push(`employee ${de.full_name} (${de.emp_code}) has this Aadhaar`);
        // E21: same-table matching is hard on the full number above
      }
      if (panChanged) {
        const de2 = await one(`SELECT full_name, emp_code FROM employee WHERE upper(pan_no)=$1 LIMIT 1`, [pan]);
        if (de2) hits.push(`employee ${de2.full_name} (${de2.emp_code}) has this PAN`);
      }
      if (hits.length) return NextResponse.json({ ok: false, needsDupConfirm: true,
        reason: `Possible duplicate: ${hits.join("; ")}. Confirm to save anyway.` }, { status: 409 });
    }

    try {
      await tx(async (cl) => {
        await cl.query(
          `UPDATE customer SET first_name=$2, middle_name=$3, last_name=$4, gender=$5, dob=$6,
                  mobile=$7, alt_mobile=$8, email=$9, risk=COALESCE($10::risk_band, risk),
                  gstin=$11, max_open_loans=$12, max_outstanding_paise=$13,
                  aadhaar_last4=COALESCE($14, aadhaar_last4),
                  aadhaar_no=COALESCE($17, aadhaar_no),
                  pan_no=COALESCE($15, pan_no), updated_at=now(), updated_by=$16
            WHERE id=$1`,
          [cust.id, first, String(b.middleName || "").trim() || null, last, b.gender, b.dob,
           mobile, String(b.altMobile || "").replace(/\D/g, "") || null,
           String(b.email || "").trim() || null, b.risk || null,
           String(b.gstin || "").trim().toUpperCase() || null,
           Number(b.maxOpenLoans) || 0, Number(b.maxOutstandingPaise) || 0,
           aadhaarChanged ? aadhaar.slice(-4) : null, panChanged ? pan : null,
           actor.employeeId, aadhaarChanged ? aadhaar : null]);

        const upAddr = async (kind, a, same) => {
          const va3 = validAddress(a);
          const r = await cl.query(
            `UPDATE customer_address SET line1=$3, line2=$4, pincode=$5, area=$6, taluka=$7,
                    district=$8, state=$9, same_as_current=$10
              WHERE customer_id=$1 AND kind=$2`,
            [cust.id, kind, va3.line1, va3.line2, va3.pincode, va3.area, va3.taluka,
             va3.district, va3.state, !!same]);
          if (!r.rowCount)
            await cl.query(
              `INSERT INTO customer_address (customer_id, kind, line1, line2, pincode, area,
                 taluka, district, state, same_as_current)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [cust.id, kind, va3.line1, va3.line2, va3.pincode, va3.area, va3.taluka,
               va3.district, va3.state, !!same]);
        };
        await upAddr("current", b.current, false);
        await upAddr("permanent", b.sameAsCurrent ? b.current : b.permanent, !!b.sameAsCurrent);

        if (b.photoFileId) {
          const curP = await one(
            `SELECT file_id FROM customer_photo WHERE customer_id=$1 AND is_current LIMIT 1`, [cust.id]);
          if (!curP || Number(curP.file_id) !== Number(b.photoFileId)) {
            await cl.query(`UPDATE customer_photo SET is_current=FALSE WHERE customer_id=$1`, [cust.id]);
            await cl.query(`INSERT INTO customer_photo (customer_id, file_id, is_current)
                            VALUES ($1,$2,TRUE)`, [cust.id, Number(b.photoFileId)]);
          }
        }

        for (const d of (b.docs || [])) {
          // №6 (owner, 29 Aug 2026): new scans may join an EXISTING document
          if (d.id && (d.scans || []).length) {
            const owns = await one(`SELECT id FROM customer_document WHERE id=$1 AND customer_id=$2`,
              [Number(d.id), cust.id]);
            if (owns) for (const f of d.scans)
              await cl.query(`INSERT INTO customer_document_scan (customer_document_id, file_id)
                              VALUES ($1,$2)`, [Number(d.id), f.fileId ?? f]);
            continue;
          }
          if (d.id || !d.docTypeId || !String(d.number || "").trim()) continue;  // add-only
          const { rows: [doc] } = await cl.query(
            `INSERT INTO customer_document (customer_id, doc_type_id, number, expiry_d)
             VALUES ($1,$2,$3,$4) RETURNING id`,
            [cust.id, d.docTypeId, String(d.number).trim(), d.expiry || null]);
          for (const f of d.scans || [])
            await cl.query(`INSERT INTO customer_document_scan (customer_document_id, file_id)
                            VALUES ($1,$2)`, [doc.id, f.fileId ?? f]);
        }

        // №3/№7 (owner, 29 Aug 2026): the edit screen's bank rows now SAVE —
        // update by id, insert new rows, attach cheques. Deleting stays on
        // the 360's own manager; verification stays with its ceremonies.
        for (const bk of (b.banks || [])) {
          const accNo = String(bk.accountNo || "").replace(/\s/g, "");
          const ifsc2 = String(bk.ifsc || "").trim().toUpperCase();
          if (!/^\d{6,20}$/.test(accNo) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc2)) continue;
          const holder2 = String(bk.holderName || "").trim();
          const chq = Number(bk.chequeFileId) || null;
          if (bk.id) {
            // E28 (14 Oct 2026) — SECURITY: THE RULE WITH TEETH applies here too.
            // This path used to change account_no/ifsc while KEEPING verified_at,
            // and the payout trigger only checks verified_at — so a verified
            // account could be swapped for any other and the next disbursement
            // paid into it, with nothing in the audit. Changing the number or
            // IFSC now clears verification exactly as the bank-only route does,
            // and an old cheque photo no longer vouches for a new number.
            const { rows: [cur] } = await cl.query(
              `SELECT account_no, ifsc FROM customer_bank_account
                WHERE id=$1 AND customer_id=$2 FOR UPDATE`, [Number(bk.id), cust.id]);
            if (!cur) continue;
            const identityChanged = cur.account_no !== accNo || cur.ifsc !== ifsc2;
            await cl.query(
              `UPDATE customer_bank_account
                  SET bank=$3, bank_branch=$4, account_no=$5, ifsc=$6, holder_name=$7,
                      acct_type=$8, upi_id=$9,
                      cheque_file_id = CASE WHEN $11 THEN $10 ELSE COALESCE($10, cheque_file_id) END,
                      verified_at    = CASE WHEN $11 THEN NULL ELSE verified_at END,
                      verify_method  = CASE
                        WHEN $11 THEN 'none'::verify_method   -- same as the bank-only route
                        WHEN COALESCE($10, cheque_file_id) IS NOT NULL THEN 'cheque_photo'::verify_method
                        ELSE verify_method END
                WHERE id=$1 AND customer_id=$2`,
              [Number(bk.id), cust.id, bk.bank || "—", bk.bankBranch || null, accNo, ifsc2,
               holder2 || "—", bk.acctType || null, bk.upiId || null, chq, identityChanged]);
            if (identityChanged)
              await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
                table: "customer_bank_account", entityId: Number(bk.id), action: "edit_full",
                before: { accountNo: cur.account_no, ifsc: cur.ifsc },
                after: { accountNo: accNo, ifsc: ifsc2, verificationCleared: true } });
          } else {
            await cl.query(
              `INSERT INTO customer_bank_account (customer_id, bank, bank_branch, account_no,
                 ifsc, holder_name, acct_type, upi_id, cheque_file_id, verify_method)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                       CASE WHEN $9::bigint IS NOT NULL THEN 'cheque_photo'::verify_method
                            ELSE 'none'::verify_method END)`,
              [cust.id, bk.bank || "—", bk.bankBranch || null, accNo, ifsc2,
               holder2 || "—", bk.acctType || null, bk.upiId || null, chq]);
          }
        }

        const rn = await cl.query(
          `UPDATE nominee SET name=$2, relation=$3, mobile=$4 WHERE customer_id=$1`,
          [cust.id, vn2.name, vn2.relation, vn2.mobile]);
        if (!rn.rowCount)
          await cl.query(`INSERT INTO nominee (customer_id, name, relation, mobile)
                          VALUES ($1,$2,$3,$4)`, [cust.id, vn2.name, vn2.relation, vn2.mobile]);

        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "customer", entityId: Number(cust.id), action: "customer_edited_full",
          after: { aadhaarChanged, panChanged } });
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("[customer edit full] failed", e);
      return NextResponse.json({ ok: false,
        reason: "Could not save — nothing was written" }, { status: 500 });
    }
  }

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
