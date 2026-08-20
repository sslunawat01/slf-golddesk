import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { redirect, notFound } from "next/navigation";
import PrintBar from "../../PrintBar.js";
export const dynamic = "force-dynamic";

/**
 * №10 — Loan Agreement & Key Facts Statement, print-ready, bilingual exactly
 * as the frozen layout (English / Marathi line by line). Figures come from
 * the loan's own pinned scheme version and its actual charge rows — never
 * today's masters.
 */
const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");
const g = (mg) => (Number(mg) / 1000).toLocaleString("en-IN",
  { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default async function KfsPrintPage({ params }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "appraise", { need: "view" }).ok
      && !can(actor, "collect", { need: "view" }).ok) redirect("/home");

  const { id } = await params;
  const loan = await one(
    `SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.application_id,
            l.scheme_version_id, la.customer_id,
            b.code AS branch_code, b.name AS branch_name,
            c.full_name AS cust, c.cust_no,
            s.code AS scheme_code, s.name AS scheme_name,
            sv.tenure_days, sv.days_in_year, sv.penal_rate_pct, sv.penal_grace_days,
            sv.min_interest_days
       FROM loan l
       JOIN loan_application la ON la.id = l.application_id
       JOIN customer c ON c.id = la.customer_id
       JOIN branch b ON b.id = l.branch_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.id = $1`, [id]);
  if (!loan) notFound();

  const slabs = await q(
    `SELECT from_day, to_day, rate_pct FROM scheme_slab
      WHERE scheme_version_id = $1 ORDER BY from_day`, [loan.scheme_version_id]);
  const charges = await q(
    `SELECT ct.name, lc.total_paise FROM loan_charge lc
       JOIN charge_type ct ON ct.id = lc.charge_type_id
      WHERE lc.loan_id = $1 AND lc.removed_at IS NULL ORDER BY lc.id`, [loan.id]);
  const netMg = (await one(
    `SELECT COALESCE(SUM(gross_mg - stone_mg), 0) AS net FROM appraisal_item
      WHERE application_id = $1`, [loan.application_id])).net;

  const rateText = slabs.length
    ? slabs.map(sl => `${Number(sl.rate_pct)}% p.a.` +
        (slabs.length > 1 ? ` (day ${sl.from_day}${sl.to_day ? "–" + sl.to_day : "+"})` : ""))
        .join(" · ")
    : "—";
  const chargesText = charges.length
    ? charges.map(ch => `${ch.name}: ${inr(ch.total_paise)}`).join(" · ")
    : "None at disbursement";
  const today = new Date().toISOString().slice(0, 10);

  const row = (i) => ({ display: "flex", justifyContent: "space-between",
    padding: "9px 14px", borderTop: i ? "1px solid #f0ede4" : 0,
    background: i === 0 ? "#f4f2ec" : "#fff", gap: 14 });

  const R = [
    ["Borrower / कर्जदार", `${loan.cust} (${loan.cust_no})`],
    ["Loan No. / कर्ज क्र.", loan.loan_no],
    ["Scheme / योजना", `${loan.scheme_code} — ${loan.scheme_name}`],
    ["Loan amount / कर्ज रक्कम", inr(loan.principal_paise)],
    ["Gold pledged / गहाण सोने", `${g(netMg)} g net`],
    ["Rate of interest / व्याजदर", rateText],
    ["Tenor / मुदत", `${loan.tenure_days} days (${loan.days_in_year}-day year basis)`],
    ["Minimum interest / किमान व्याज", `${loan.min_interest_days} days`],
    ["Penal charge / दंड आकार", Number(loan.penal_rate_pct) > 0
      ? `${Number(loan.penal_rate_pct)}% p.a. past tenure`
        + (Number(loan.penal_grace_days) > 0 ? ` after ${loan.penal_grace_days} grace days` : "")
      : "None"],
    ["Processing charges / प्रक्रिया शुल्क", chargesText],
    ["Date of disbursement / वितरण दिनांक", String(loan.disbursed_at).slice(0, 10)],
  ];

  return (
    <div style={{ background: "#fff", minHeight: "100vh" }}>
      <style>{`@media print { .noprint { display:none } }`}</style>
      <PrintBar backHref={`/customers/${loan.customer_id}`} />

      <div style={{ maxWidth: 820, margin: "14px auto", border: "1px solid #e2ddd1",
        borderRadius: 10, padding: 30, fontSize: 13, color: "#26291f",
        fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 17 }}>
          Loan Agreement &amp; Key Facts Statement</div>
        <div style={{ textAlign: "center", color: "#7d786c", fontSize: 12, marginBottom: 16 }}>
          कर्ज करार व मुख्य तथ्य विवरण · Branch {loan.branch_code}, {loan.branch_name} · {today}</div>

        <div style={{ border: "1px solid #e2ddd1", borderRadius: 8, overflow: "hidden",
          fontSize: 13 }}>
          {R.map(([k, v], i) => (
            <div key={k} style={row(i)}>
              <span>{k}</span><b style={{ textAlign: "right" }}>{v}</b></div>))}
        </div>

        <p style={{ fontSize: 12, color: "#7d786c", marginTop: 14, lineHeight: 1.6 }}>
          The borrower acknowledges having read and understood the terms above and the full loan
          agreement overleaf. Interest accrues day-wise on the slab applicable to the loan's age;
          part-payments appropriate to charges, then interest, then principal. The pledged
          ornaments are released only on full settlement. /
          कर्जदाराने वरील अटी व मागील बाजूचा संपूर्ण करार वाचून समजून घेतला आहे.</p>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36,
          fontSize: 12 }}>
          <div>Borrower signature / कर्जदाराची स्वाक्षरी
            <div style={{ borderTop: "1px solid #999", marginTop: 30, width: 180 }}></div></div>
          <div>Branch authorised signatory
            <div style={{ borderTop: "1px solid #999", marginTop: 30, width: 180 }}></div></div>
        </div>
      </div>
    </div>);
}
