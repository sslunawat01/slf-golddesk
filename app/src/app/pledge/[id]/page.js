import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can, sanctionAuthority } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { redirect, notFound } from "next/navigation";
import WizardClient from "./WizardClient.js";
export const dynamic = "force-dynamic";

export default async function PledgePage({ params }) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "appraise", { need: "full" }).ok) redirect("/home");

  const app = await one(
    `SELECT a.*, c.full_name AS customer_name, c.cust_no, c.id AS customer_id
       FROM loan_application a JOIN customer c ON c.id = a.customer_id
      WHERE a.id = $1 AND a.branch_id = $2`, [id, actor.actingBranchId]);
  if (!app) notFound();

  const [items, photos, purities, itemMaster, schemes, valuers, banks, slfAccounts, thr, metals] = await Promise.all([
    q(`SELECT item_id, qty, gross_mg, stone_mg, purity_id, narration FROM appraisal_item WHERE application_id=$1`, [id]),
    q(`SELECT file_id FROM application_photo WHERE application_id=$1 ORDER BY ord`, [id]),
    q(`SELECT id, karat, purity_pct AS "purityPct", metal_id AS "metalId"
         FROM purity WHERE active ORDER BY metal_id, purity_pct DESC`),
    q(`SELECT id, name, metal_id AS "metalId" FROM item WHERE active ORDER BY metal_id, name`),
    q(`SELECT sv.id, s.code, sv.funding_pct AS "fundingPct", sv.min_loan_paise AS "minLoanPaise",
              sv.max_loan_paise AS "maxLoanPaise", sv.doc_charge_pct AS "docChargePct",
              sv.doc_charge_min_paise AS "docChargeMinPaise", sv.doc_charge_max_paise AS "docChargeMaxPaise"
         FROM scheme_version sv JOIN scheme s ON s.id=sv.scheme_id
         JOIN scheme_branch sb ON sb.scheme_version_id=sv.id AND sb.branch_id=$1
        WHERE sv.status='published' AND s.active AND sv.effective_from <= CURRENT_DATE
        ORDER BY s.code`, [actor.actingBranchId]),
    q(`SELECT DISTINCT e.id, e.full_name AS "fullName" FROM employee e
         JOIN employee_role er ON er.employee_id=e.id
         JOIN role_permission rp ON rp.role_id=er.role_id AND rp.fn='appraise' AND rp.level='full'
         JOIN employee_branch eb ON eb.employee_id=e.id AND eb.branch_id=$1
        WHERE e.status='active' ORDER BY e.full_name`, [actor.actingBranchId]),
    q(`SELECT id, bank, account_no AS "accountNo", ifsc, holder_name AS "holderName",
              (verified_at IS NOT NULL OR cheque_file_id IS NOT NULL) AS payable
         FROM customer_bank_account WHERE customer_id=$1 ORDER BY id`, [app.customer_id]),
    q(`SELECT a.id, a.nickname FROM slf_bank_account a
        WHERE a.active AND a.allow_disbursement
          AND (NOT EXISTS (SELECT 1 FROM slf_bank_account_branch ab WHERE ab.account_id = a.id)
               OR EXISTS (SELECT 1 FROM slf_bank_account_branch ab
                           WHERE ab.account_id = a.id AND ab.branch_id = $1))
        ORDER BY a.nickname`, [actor.actingBranchId]),
    one(`SELECT value FROM app_setting WHERE key='valuer2_threshold_paise'`),
    q(`SELECT id, kind FROM metal WHERE enabled ORDER BY id`),
  ]);

  const authority = sanctionAuthority(actor);

  return (
    <Shell title={`New pledge · ${app.customer_name}`}>
      <WizardClient
        app={{ id: Number(app.id), appNo: app.app_no, status: app.status,
          schemeVersionId: app.scheme_version_id ? Number(app.scheme_version_id) : null,
          requestedPaise: app.requested_paise ? Number(app.requested_paise) : null,
          purpose: app.purpose, borrowerPresent: app.borrower_present,
          valuer1Id: app.valuer1_id ? Number(app.valuer1_id) : null,
          valuer2Id: app.valuer2_id ? Number(app.valuer2_id) : null,
          ornamentPhotos: photos.map(p => ({ fileId: Number(p.file_id), preview: null, kb: 0 })) }}
        customer={{ id: Number(app.customer_id), fullName: app.customer_name, custNo: app.cust_no }}
        items={items.map(i => ({ itemId: String(i.item_id), qty: i.qty,
          gross: (i.gross_mg / 1000).toFixed(3), stone: (i.stone_mg / 1000).toFixed(3),
          purityId: String(i.purity_id), narration: i.narration || "" }))}
        purities={purities.map(p => ({ ...p, id: Number(p.id), metalId: Number(p.metalId) }))}
        metals={metals.map(m => ({ id: Number(m.id), kind: m.kind }))}
        ratedMetalId={1}
        schemes={schemes.map(s => ({ ...s, id: Number(s.id) }))}
        itemMaster={itemMaster.map(i => ({ ...i, id: Number(i.id), metalId: Number(i.metalId) }))}
        valuers={valuers.map(v => ({ ...v, id: Number(v.id) }))}
        banks={banks.map(b => ({ ...b, id: Number(b.id) }))}
        slfAccounts={slfAccounts.map(a => ({ ...a, id: Number(a.id) }))}
        ceilingPaise={authority.unlimited ? null : authority.ceilingPaise}
        base24k={Number(app.base_paise_snapshot)}
        funding24k={Number(app.funding_paise_snapshot ?? app.base_paise_snapshot)}
        valuer2Threshold={Number(thr?.value ?? 2000000)}
        canDisburse={can(actor, "disburse", { need: "full" }).ok} />
    </Shell>);
}
