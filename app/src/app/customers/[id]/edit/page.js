import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { viewUrl } from "@/lib/s3.js";
import { redirect } from "next/navigation";
import NewCustomerClient from "../../new/NewCustomerClient.js";
export const dynamic = "force-dynamic";

/**
 * D-F (owner, 29 Aug 2026): the edit screen IS the new-customer screen —
 * every field, prefilled. Edit rights make it editable; view rights get the
 * identical screen with nothing typeable (№1). The old narrow editcust
 * (contact/address/nominee only) is retired by owner order.
 */
export default async function EditCustomerPage({ params, searchParams }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  const mayEdit = can(actor, "settings", { need: "full" }).ok
    || can(actor, "edit_customer", { need: "full" }).ok;
  const mayView = mayEdit
    || can(actor, "appraise", { need: "view" }).ok
    || can(actor, "collect", { need: "view" }).ok
    || can(actor, "edit_customer", { need: "view" }).ok;
  if (!mayView) redirect("/home");

  const { id } = await params;
  const c = await one(`SELECT * FROM customer WHERE id = $1`, [id]);
  if (!c) redirect("/search");

  const [addrs, photoRow, docs, nominee, banks, docTypes] = await Promise.all([
    q(`SELECT kind, line1, line2, pincode, area, taluka, district, state, same_as_current
         FROM customer_address WHERE customer_id = $1`, [id]),
    one(`SELECT cp.file_id, f.thumb_s3_key, f.s3_key
           FROM customer_photo cp JOIN file_object f ON f.id = cp.file_id
          WHERE cp.customer_id = $1 AND cp.is_current ORDER BY cp.id DESC LIMIT 1`, [id]),
    q(`SELECT d.id, d.doc_type_id, d.number, d.expiry_d,
              coalesce(json_agg(json_build_object('thumb', f.thumb_s3_key, 'key', f.s3_key))
                FILTER (WHERE f.id IS NOT NULL), '[]') AS scan_files
         FROM customer_document d
         LEFT JOIN customer_document_scan sc ON sc.customer_document_id = d.id
         LEFT JOIN file_object f ON f.id = sc.file_id
        WHERE d.customer_id = $1
        GROUP BY d.id ORDER BY d.id`, [id]),
    one(`SELECT name, relation, mobile FROM nominee WHERE customer_id = $1
         ORDER BY id DESC LIMIT 1`, [id]),
    q(`SELECT ba.id, ba.bank, ba.bank_branch, ba.account_no, ba.ifsc, ba.holder_name,
              ba.acct_type, ba.upi_id, ba.verified_at, ba.verify_method, ba.cheque_file_id,
              cf.thumb_s3_key AS cheque_thumb, cf.s3_key AS cheque_key
         FROM customer_bank_account ba
         LEFT JOIN file_object cf ON cf.id = ba.cheque_file_id
        WHERE ba.customer_id = $1 ORDER BY ba.id`, [id]),
    q(`SELECT id, name, category FROM document_type WHERE active ORDER BY name`),
  ]);

  const A = (kind) => addrs.find(x => x.kind === kind) || {};
  const cur = A("current"), perm = A("permanent");
  const toAddr = (a) => ({ line1: a.line1 || "", line2: a.line2 || "", pincode: a.pincode || "",
    area: a.area || "", taluka: a.taluka || "", district: a.district || "", state: a.state || "" });

  const existing = {
    firstName: c.first_name || "", middleName: c.middle_name || "", lastName: c.last_name || "",
    dob: c.dob ? String(c.dob).slice(0, 10) : "", gender: c.gender || "",
    custType: c.cust_type || "individual",
    // E21 №2 (owner override): the full number is stored and SHOWN fully.
    // Legacy rows (created before today) hold only last-4 until retyped.
    aadhaar: c.aadhaar_no || "", aadhaarVerified: !!c.aadhaar_verified_at, aadhaarScans: [],
    aadhaarLast4: c.aadhaar_last4 || "",
    pan: c.pan_no || "", panVerified: !!c.pan_verified_at, panScans: [],
    gstin: c.gstin || "", gstVerified: !!c.gstin,
    risk: c.risk || "", cibil: null,
    photoFileId: photoRow ? Number(photoRow.file_id) : null, photo: null,
    photoUrl: photoRow ? await viewUrl(photoRow.thumb_s3_key || photoRow.s3_key).catch(() => null) : null,
    mobile: c.mobile || "", mobileVerified: true, mobileDuplicate: false,
    altMobile: c.alt_mobile || "", email: c.email || "", emailVerified: !!c.email,
    appAccess: !!c.app_access,
    current: toAddr(cur), sameAsCurrent: !!perm.same_as_current, permanent: toAddr(perm),
    docs: [
      ...(await Promise.all(docs.map(async d => ({ id: Number(d.id), docTypeId: Number(d.doc_type_id),
        number: d.number, expiry: d.expiry_d ? String(d.expiry_d).slice(0, 10) : "",
        scans: [], files: [],
        // №6 (owner, 29 Aug 2026): every previously uploaded scan, signed
        existingScans: await Promise.all(
          (typeof d.scan_files === "string" ? JSON.parse(d.scan_files) : d.scan_files || [])
            .map(async sf => ({
              thumb: await viewUrl(sf.thumb || sf.key).catch(() => null),
              full: await viewUrl(sf.key).catch(() => null) }))) })))),
      { docTypeId: "", number: "", scans: [], files: [] },
    ],
    banks: banks.length ? await Promise.all(banks.map(async b => ({
      id: Number(b.id), ifsc: b.ifsc, bank: b.bank,
      accountNo: String(b.account_no), holderName: b.holder_name, acctType: b.acct_type || "",
      // bankPayable reads verifyMethod + verifiedAt — E15 dropped them (№3 bug)
      status: "unverified", verifyMethod: b.verify_method || "none",
      verifiedAt: b.verified_at ? String(b.verified_at) : null, cheque: null,
      chequeFileId: b.cheque_file_id ? Number(b.cheque_file_id) : null,
      chequeUrl: (b.cheque_thumb || b.cheque_key)
        ? await viewUrl(b.cheque_thumb || b.cheque_key).catch(() => null) : null,
      upiId: b.upi_id || "", upiVerified: false })))
      : [{ ifsc: "", bank: "", accountNo: "", holderName: "", acctType: "", status: "unverified",
           verifyMethod: "none", verifiedAt: null, cheque: null, chequeFileId: null,
           chequeUrl: null, upiId: "", upiVerified: false }],
    nominee: { name: nominee?.name || "", relation: nominee?.relation || "",
      mobile: nominee?.mobile || "" },
    maxOpenLoans: Number(c.max_open_loans ?? 3),
    maxOutstandingPaise: Number(c.max_outstanding_paise ?? 30000000),
    narration: c.blacklist_narration || "",
  };

  const sp = await searchParams;
  const mode = (!mayEdit || sp?.view) ? "view" : "edit";   // №1: ?view=1 forces the read-only life
  return (
    <Shell title={(mode === "edit" ? "Edit customer — " : "Customer details — ") + c.full_name}>
      <a href={`/customers/${c.id}`} style={{ display: "inline-block", marginBottom: 8,
        color: "var(--vault)", fontWeight: 800, textDecoration: "none", fontSize: 13.5 }}>
        ← Back to customer</a>
      <p className="mono" style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 12px" }}>
        {c.cust_no} · customer number never changes
        {existing.aadhaar ? ` · Aadhaar ${existing.aadhaar}`
          : existing.aadhaarLast4 ? ` · Aadhaar on file ••••${existing.aadhaarLast4} (full number not yet captured — retype to store it)` : ""}
        {mode === "view" ? " · view only" : ""}
      </p>
      <NewCustomerClient docTypes={docTypes.map(d => ({ id: Number(d.id), name: d.name,
        category: d.category }))} prefill="" mode={mode} existing={existing}
        customerId={Number(c.id)} />
    </Shell>
  );
}
