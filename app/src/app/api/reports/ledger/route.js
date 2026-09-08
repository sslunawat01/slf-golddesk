import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q } from "@/lib/db.js";
import { resolveBranchScope, resolvePeriod } from "@/lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ledger Report — DERIVED, CASH-BASIS v1 (owner accepted Claude's ruling,
 * 8 Sep 2026). Nothing posts journal entries yet, so every entry here is
 * computed from the stored money facts:
 *   receipt          → Dr Cash-in-hand / the SLF account · Cr per its stored
 *                      appropriation (interest / penal / charges+GST split
 *                      pro-rata from the loan_charge / rounding / principal)
 *   disbursement leg → Dr Gold loan principal · Cr Cash / the SLF account
 *   cash transfer    → Cr Cash-in-hand · Dr the SLF account (or HO transit)
 * Opening balances are ZERO in v1; a true double-entry posting engine is on
 * the roadmap before the accountant relies on this.
 */
const HEADS = ["Cash in hand", "Gold loan principal", "Interest income",
  "Penal income", "Charges income", "Rounding income", "GST payable", "Cash in transit"];

export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, sp.branch);
  if (!scope) return NextResponse.json({ ok: false, reason: "That branch is not allotted to you" }, { status: 403 });
  const { from, to } = await resolvePeriod(sp);

  try {
    const P = [scope.ids, from, to];
    const recs = await q(
      `SELECT r.id, r.receipt_no, r.business_date::text AS d, r.amount_paise, r.mode,
              l.loan_no, sa.nickname AS account
         FROM receipt r JOIN loan l ON l.id=r.loan_id
         LEFT JOIN slf_bank_account sa ON sa.id=r.slf_bank_account_id
        WHERE r.branch_id = ANY($1::bigint[]) AND r.business_date BETWEEN $2 AND $3
        ORDER BY r.business_date, r.id`, P);
    const apps = await q(
      `SELECT ra.receipt_id, ra.bucket, ra.amount_paise, ra.loan_charge_id,
              lc.base_paise, lc.gst_paise, lc.total_paise
         FROM receipt_appropriation ra
         JOIN receipt r ON r.id = ra.receipt_id
         LEFT JOIN loan_charge lc ON lc.id = ra.loan_charge_id
        WHERE r.branch_id = ANY($1::bigint[]) AND r.business_date BETWEEN $2 AND $3`, P);
    const legs = await q(
      `SELECT dl.id, dl.kind, dl.amount_paise, d.created_at::date::text AS d,
              l.loan_no, sa.nickname AS account
         FROM disbursement_leg dl JOIN disbursement d ON d.id=dl.disbursement_id
         JOIN loan l ON l.id=d.loan_id
         LEFT JOIN slf_bank_account sa ON sa.id=d.from_slf_account_id
        WHERE l.branch_id = ANY($1::bigint[]) AND d.created_at::date BETWEEN $2 AND $3
        ORDER BY d.created_at, dl.id`, P);
    const xfers = await q(
      `SELECT ct.id, ct.destination, ct.amount_paise, ct.created_at::date::text AS d,
              sa.nickname AS account, ct.status
         FROM cash_transfer ct LEFT JOIN slf_bank_account sa ON sa.id=ct.slf_bank_account_id
        WHERE ct.branch_id = ANY($1::bigint[]) AND ct.created_at::date BETWEEN $2 AND $3
        ORDER BY ct.created_at, ct.id`, P);

    const appsBy = {};
    for (const a of apps) (appsBy[a.receipt_id] = appsBy[a.receipt_id] || []).push(a);

    const entries = [];   // { head, date, ref, particulars, drPaise, crPaise }
    const post = (head, date, ref, particulars, dr, cr) =>
      entries.push({ head, date, ref, particulars, drPaise: Math.round(dr), crPaise: Math.round(cr) });

    for (const r of recs) {
      const inHead = r.mode === "cash" ? "Cash in hand" : (r.account || "Bank (account not named)");
      post(inHead, r.d, r.receipt_no, `receipt · ${r.loan_no}`, Number(r.amount_paise), 0);
      for (const a of appsBy[r.id] || []) {
        const amt = Number(a.amount_paise);
        if (a.bucket === "interest") post("Interest income", r.d, r.receipt_no, `interest · ${r.loan_no}`, 0, amt);
        else if (a.bucket === "penal") post("Penal income", r.d, r.receipt_no, `penal · ${r.loan_no}`, 0, amt);
        else if (a.bucket === "principal") post("Gold loan principal", r.d, r.receipt_no, `principal repaid · ${r.loan_no}`, 0, amt);
        else if (a.bucket === "charge_rounding") post("Rounding income", r.d, r.receipt_no, `rounding · ${r.loan_no}`, 0, amt);
        else if (a.bucket === "charge") {
          // split pro-rata base:gst from the charge it settled (exact GST kept underneath — R-D)
          const total = Number(a.total_paise || 0), gst = Number(a.gst_paise || 0);
          const gstPart = total > 0 ? Math.round(amt * gst / total) : 0;
          if (amt - gstPart) post("Charges income", r.d, r.receipt_no, `charge · ${r.loan_no}`, 0, amt - gstPart);
          if (gstPart) post("GST payable", r.d, r.receipt_no, `GST on charge · ${r.loan_no}`, 0, gstPart);
        }
      }
    }
    for (const x of legs) {
      post("Gold loan principal", x.d, x.loan_no, `disbursed (${x.kind})`, Number(x.amount_paise), 0);
      post(x.kind === "cash" ? "Cash in hand" : (x.account || "Bank (account not named)"),
        x.d, x.loan_no, `disbursement paid out (${x.kind})`, 0, Number(x.amount_paise));
    }
    for (const x of xfers) {
      post("Cash in hand", x.d, `CT#${x.id}`, `cash transfer to ${x.destination} (${x.status})`, 0, Number(x.amount_paise));
      post(x.account || "Cash in transit", x.d, `CT#${x.id}`, `cash received from counter (${x.status})`, Number(x.amount_paise), 0);
    }

    // summary per head + running balances inside a head
    const headNames = [...new Set([...HEADS, ...entries.map(e => e.head)])];
    const summary = headNames.map(h => {
      const es = entries.filter(e => e.head === h);
      const dr = es.reduce((a, e) => a + e.drPaise, 0), cr = es.reduce((a, e) => a + e.crPaise, 0);
      return { head: h, entries: es.length, drPaise: dr, crPaise: cr, netPaise: dr - cr };
    }).filter(s => s.entries > 0 || HEADS.includes(s.head));

    let detail = null;
    if (sp.head) {
      let run = 0;
      detail = entries.filter(e => e.head === sp.head)
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
        .map(e => ({ ...e, balancePaise: (run += e.drPaise - e.crPaise) }));
    }

    return NextResponse.json({ ok: true, from, to, scope: scope.label,
      basis: "Derived from stored money facts, cash basis, opening balances zero (v1)",
      summary, detail, head: sp.head || null });
  } catch (e) {
    console.error("[reports/ledger] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
