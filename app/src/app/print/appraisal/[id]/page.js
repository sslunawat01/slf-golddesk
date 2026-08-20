import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { redirect, notFound } from "next/navigation";
import PrintBar from "../../PrintBar.js";
export const dynamic = "force-dynamic";

/**
 * №10 — Appraisal note, print-ready. Frozen layout: item grid (Item / Qty /
 * Gross / Net / Purity / Market value), the three totals, two valuer
 * signature blocks. Data straight from appraisal_item snapshots — the figures
 * the loan was actually sanctioned on, not today's recomputation.
 */
const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");
const g = (mg) => (Number(mg) / 1000).toLocaleString("en-IN",
  { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default async function AppraisalPrintPage({ params }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "appraise", { need: "view" }).ok
      && !can(actor, "collect", { need: "view" }).ok) redirect("/home");

  const { id } = await params;
  const loan = await one(
    `SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.application_id, la.customer_id,
            b.code AS branch_code, b.name AS branch_name,
            c.full_name AS cust, c.cust_no,
            la.valuer1_id, la.valuer2_id, la.app_no
       FROM loan l
       JOIN loan_application la ON la.id = l.application_id
       JOIN customer c ON c.id = la.customer_id
       JOIN branch b ON b.id = l.branch_id
      WHERE l.id = $1`, [id]);
  if (!loan) notFound();

  const items = await q(
    `SELECT ai.qty, ai.gross_mg, ai.stone_mg, ai.purity_pct_snapshot, ai.market_paise,
            ai.funding_paise, i.print_name, p.karat
       FROM appraisal_item ai
       JOIN item i ON i.id = ai.item_id
       JOIN purity p ON p.id = ai.purity_id
      WHERE ai.application_id = $1 ORDER BY ai.id`, [loan.application_id]);
  const v1 = loan.valuer1_id
    ? await one(`SELECT full_name FROM employee WHERE id=$1`, [loan.valuer1_id]) : null;
  const v2 = loan.valuer2_id
    ? await one(`SELECT full_name FROM employee WHERE id=$1`, [loan.valuer2_id]) : null;

  const netMg = items.reduce((s, r) => s + (Number(r.gross_mg) - Number(r.stone_mg)), 0);
  const market = items.reduce((s, r) => s + Number(r.market_paise), 0);
  const funding = items.reduce((s, r) => s + Number(r.funding_paise), 0);
  const today = new Date().toISOString().slice(0, 10);

  const cell = { padding: "8px 10px", borderTop: "1px solid #f0ede4", fontSize: 12 };

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <style>{`@media print { .noprint { display:none } }`}</style>
      <PrintBar backHref={`/customers/${loan.customer_id ?? ""}` || "/home"} />

      <div style={{ maxWidth: 820, margin: "14px auto", border: "1px solid #e2ddd1",
        borderRadius: 10, padding: 30, fontSize: 13, color: "#26291f",
        fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 17 }}>
          S Lunawat Finance — Appraisal Note</div>
        <div style={{ textAlign: "center", color: "#7d786c", fontSize: 12, marginBottom: 16 }}>
          Branch {loan.branch_code}, {loan.branch_name} · {today}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <span>Customer: <b>{loan.cust}</b> ({loan.cust_no})</span>
          <span>Ref: {loan.loan_no}{loan.app_no ? ` · ${loan.app_no}` : ""}</span></div>

        <div style={{ border: "1px solid #e2ddd1", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr",
            background: "#f4f2ec", fontWeight: 800, fontSize: 11, padding: "8px 10px" }}>
            <div>Item</div><div>Qty</div><div>Gross g</div><div>Net g</div>
            <div>Purity</div><div>Market value</div></div>
          {items.map((r, i) => (
            <div key={i} style={{ display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr" }}>
              <div style={cell}>{r.print_name}</div>
              <div style={cell}>{r.qty}</div>
              <div style={cell}>{g(r.gross_mg)}</div>
              <div style={cell}>{g(Number(r.gross_mg) - Number(r.stone_mg))}</div>
              <div style={cell}>{r.karat} · {Number(r.purity_pct_snapshot)}%</div>
              <div style={cell}>{inr(r.market_paise)}</div>
            </div>))}
        </div>

        <div style={{ display: "flex", gap: 24, margin: "16px 0", fontSize: 13 }}>
          <div>Net weight: <b>{g(netMg)} g</b></div>
          <div>Valuation: <b>{inr(market)}</b></div>
          <div>Funding value: <b>{inr(funding)}</b></div>
        </div>
        <div style={{ fontSize: 12.5 }}>Sanctioned principal: <b>{inr(loan.principal_paise)}</b>
          {" "}· disbursed {String(loan.disbursed_at).slice(0, 10)}</div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40,
          fontSize: 12 }}>
          <div>Valuer 1: {v1 ? v1.full_name : "—"}
            <div style={{ borderTop: "1px solid #999", marginTop: 30, paddingTop: 4 }}>
              Signature</div></div>
          <div>Valuer 2: {v2 ? v2.full_name : "—"}
            <div style={{ borderTop: "1px solid #999", marginTop: 30, paddingTop: 4 }}>
              Signature</div></div>
        </div>
      </div>
    </div>);
}
