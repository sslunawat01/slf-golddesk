import Shell from "@/components/Shell.js";
import { one, q } from "@/lib/db.js";
import { kycStatus, mayLend } from "@/lib/customer.js";
import { viewUrl } from "@/lib/s3.js";
import { notFound } from "next/navigation";
import NewPledgeButton from "@/components/NewPledgeButton.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { schemeFromRow, replayLoan } from "@/lib/loanstate.js";
import { dues } from "@/lib/engine.js";
import BankAccountsClient from "./BankAccountsClient.js";
export const dynamic = "force-dynamic";

const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");
const g = (mg) => (Number(mg) / 1000).toFixed(3);

export default async function Customer360({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const c = await one(
    `SELECT c.*, c.full_name AS "fullName" FROM customer c WHERE c.id = $1`, [id]);
  if (!c) notFound();
  const actor = await currentActor();
  const mayEditCust = actor && (can(actor, "settings", { need: "full" }).ok
    || can(actor, "edit_customer", { need: "full" }).ok);
  const canCollect = actor && can(actor, "collect", { need: "full" }).ok;

  const [photo, addresses, docs, nominee, banks, loans, closed] = await Promise.all([
    one(`SELECT f.s3_key, f.thumb_s3_key FROM customer_photo p JOIN file_object f ON f.id = p.file_id
          WHERE p.customer_id = $1 AND p.is_current ORDER BY p.captured_at DESC LIMIT 1`, [id]),
    q(`SELECT kind, line1, line2, pincode, area, taluka, district, state FROM customer_address
        WHERE customer_id = $1 ORDER BY kind`, [id]),
    q(`SELECT cd.number, cd.expiry_d, dt.name, dt.category,
              (SELECT count(*) FROM customer_document_scan s WHERE s.customer_document_id = cd.id)::int AS scans
         FROM customer_document cd JOIN document_type dt ON dt.id = cd.doc_type_id
        WHERE cd.customer_id = $1 ORDER BY dt.category, dt.name`, [id]),
    one(`SELECT name, relation, mobile FROM nominee WHERE customer_id = $1 AND is_current LIMIT 1`, [id]),
    q(`SELECT id, bank, bank_branch, account_no, ifsc, holder_name, acct_type, verified_at,
              verify_method, cheque_file_id
         FROM customer_bank_account WHERE customer_id = $1 ORDER BY id`, [id]),
    q(`SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.scheme_version_id,
              s.code AS scheme,
              (CURRENT_DATE - l.disbursed_at)::int AS age_days,
              (SELECT COALESCE(sum(ai.net_mg),0) FROM appraisal_item ai
                WHERE ai.application_id = l.application_id)::int AS net_mg
         FROM loan l JOIN scheme_version sv ON sv.id = l.scheme_version_id
         JOIN scheme s ON s.id = sv.scheme_id
        WHERE l.customer_id = $1 AND l.status = 'active' ORDER BY l.disbursed_at`, [id]),
    q(`SELECT l.loan_no, l.principal_paise, l.closed_at, l.status, s.code AS scheme
         FROM loan l JOIN scheme_version sv ON sv.id = l.scheme_version_id
         JOIN scheme s ON s.id = sv.scheme_id
        WHERE l.customer_id = $1 AND l.status <> 'active' ORDER BY l.closed_at DESC NULLS LAST LIMIT 8`, [id]),
  ]);

  const kyc = kycStatus(c.kyc_done_at, today);
  const lend = mayLend({ isBlacklisted: c.is_blacklisted, kycDoneAt: c.kyc_done_at }, today);
  const photoUrl = await viewUrl(photo?.thumb_s3_key || photo?.s3_key).catch(() => null);
  const outstanding = loans.reduce((s, l) => s + Number(l.principal_paise), 0);

  // №16 — the three amounts, replayed live from immutable receipts, never stored.
  const loanIds = loans.map(l => Number(l.id));
  for (const l of loans) {
    const sv = await one(`SELECT * FROM scheme_version WHERE id = $1`, [l.scheme_version_id]);
    const slabs = await q(`SELECT from_day, to_day, rate_pct FROM scheme_slab
                            WHERE scheme_version_id = $1 ORDER BY from_day`, [l.scheme_version_id]);
    const lch = await q(
      `SELECT lc.id, lc.total_paise, ct.name AS charge_name
         FROM loan_charge lc JOIN charge_type ct ON ct.id = lc.charge_type_id
        WHERE lc.loan_id = $1 AND lc.removed_at IS NULL ORDER BY lc.added_at, lc.id`, [l.id]);
    const rcp = await q(`SELECT business_date, amount_paise, closes_loan FROM receipt
                          WHERE loan_id = $1 ORDER BY business_date, id`, [l.id]);
    const scheme = schemeFromRow(sv, slabs, l.scheme);
    const state = replayLoan({ principalPaise: l.principal_paise, disbursedAt: l.disbursed_at,
      scheme, charges: lch, receipts: rcp });
    const closing = dues(scheme, state, today, { closing: true });
    l.totalOutPaise = closing._paise.settlement;
    l.outPrincipalPaise = closing._paise.settlement - closing._paise.interestDue
      - closing._paise.penalDue - closing._paise.chargesDue;
  }

  // every follow-up, newest first, plus the outcome list for the inline form
  const followups = loanIds.length ? await q(
    `SELECT cc.loan_id, cc.method, cc.outcome::text, cc.ptp_date, cc.next_follow_up,
            cc.note, cc.at::date AS on_date, e.full_name AS by
       FROM collection_call cc JOIN employee e ON e.id = cc.by_employee
      WHERE cc.loan_id = ANY($1::bigint[]) ORDER BY cc.at DESC`, [loanIds]) : [];
  const outcomes = (await one(
    `SELECT enum_range(NULL::call_outcome)::text[] AS labels`)).labels;
  const cur = addresses.find(a => a.kind === "current");

  return (
    <Shell>
      {sp?.created && <div style={{ marginBottom: 14 }}>
        <span className="chip ok">customer created · KYC filed today</span></div>}
      {sp?.err && <div style={{ marginBottom: 14 }}>
        <span className="chip bad">{sp.err}</span></div>}

      {c.is_blacklisted && (
        <div style={{ background: "var(--bad-bg)", borderLeft: "6px solid var(--bad)",
          borderRadius: "4px 14px 14px 4px", padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 900, color: "var(--bad)" }}>BLACKLISTED / BAD DEBTOR — lending blocked</div>
          <div style={{ color: "var(--bad)", fontSize: 13.5, marginTop: 4 }}>{c.blacklist_narration}</div>
        </div>)}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,300px) 1fr", gap: 18,
                    alignItems: "start" }} className="c360">
        {/* left rail */}
        <div className="card">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {photoUrl
              ? <img src={photoUrl} alt="" style={{ width: 96, height: 96, borderRadius: 14,
                  objectFit: "cover", border: "1px solid var(--line)" }} />
              : <div style={{ width: 96, height: 96, borderRadius: 14, background: "#faf9f4",
                  border: "1px dashed #cfc9ba", display: "grid", placeItems: "center",
                  color: "var(--mut)", fontSize: 11 }}>no photo</div>}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.25 }}>{c.fullName}</div>
              <div className="mono" style={{ color: "var(--mut)", fontSize: 13, marginTop: 3 }}>
                {c.cust_no}<br />{c.mobile}</div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <span className={"chip " + (kyc.state === "valid" ? "ok" : kyc.state === "expiring" ? "warn" : "bad")}>
              {kyc.label}</span>
          </div>

          <div style={{ marginTop: 16 }}>
            {lend.ok
              ? <NewPledgeButton customerId={Number(c.id)} />
              : <div><span className="chip bad" style={{ display: "block", textAlign: "center",
                  padding: "10px" }}>{lend.reason}</span></div>}
          </div>

          <div style={{ marginTop: 16, background: "var(--vault)", borderRadius: 14, padding: 14, color: "#fff" }}>
            <Row k="Open loans" v={loans.length} />
            <Row k="Principal outstanding" v={inr(outstanding)} brass />
            <Row k="Gold held" v={g(loans.reduce((s, l) => s + Number(l.net_mg || 0), 0)) + " g"} brass />
          </div>

          <div style={{ marginTop: 16, fontSize: 13 }}>
            <K>Address</K>
            <div style={{ color: "var(--mut)", lineHeight: 1.5 }}>
              {cur ? <>{cur.line1}{cur.line2 ? ", " + cur.line2 : ""}<br />
                {[cur.area, cur.taluka, cur.district].filter(Boolean).join(", ")}<br />
                {cur.state} · <span className="mono">{cur.pincode}</span></> : "—"}
            </div>
            <K style={{ marginTop: 12 }}>Nominee</K>
            <div style={{ color: "var(--mut)" }}>
              {nominee ? `${nominee.name} · ${nominee.relation}${nominee.mobile ? " · " + nominee.mobile : ""}` : "—"}</div>
          </div>
        </div>

        {/* right column */}
        <div style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <K>Active loans</K>
            {loans.length === 0 && <div style={{ color: "var(--mut)", fontSize: 14 }}>No active loans.</div>}
            {loans.map(l => (
              <div key={l.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0",
                display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <a href={`/loans/${l.id}`} className="mono" style={{ fontWeight: 800,
                    color: "inherit", textDecoration: "none" }}
                    title="Open the loan profile">{l.loan_no} <span style={{ color: "var(--mut)",
                    fontWeight: 400 }}>›</span></a>
                  <div style={{ color: "var(--mut)", fontSize: 13 }}>
                    {l.scheme} · {g(l.net_mg)} g · day {l.age_days}</div>
                </div>
                <div style={{ display: "flex", gap: 16, textAlign: "right", flexWrap: "wrap" }}>
                  <div><div style={{ fontSize: 10.5, color: "var(--mut)", fontWeight: 800 }}>ORIGINAL</div>
                    <div className="mono" style={{ fontWeight: 700 }}>{inr(l.principal_paise)}</div></div>
                  <div><div style={{ fontSize: 10.5, color: "var(--mut)", fontWeight: 800 }}>PRINCIPAL O/S</div>
                    <div className="mono" style={{ fontWeight: 700 }}>{inr(l.outPrincipalPaise)}</div></div>
                  <div><div style={{ fontSize: 10.5, color: "var(--brass)", fontWeight: 800 }}>TOTAL O/S</div>
                    <div className="mono" style={{ fontWeight: 800, color: "var(--brass)" }}>
                      {inr(l.totalOutPaise)}</div></div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {(() => {
                    const fus = followups.filter(f => Number(f.loan_id) === Number(l.id));
                    const next = fus.find(f => f.next_follow_up);
                    return next?.next_follow_up
                      ? <span className={"chip " + (String(next.next_follow_up) <= today
                          ? "warn" : "mut")}>next f/up {String(next.next_follow_up).slice(0, 10)}</span>
                      : null;
                  })()}
                  <a href={`/loans/${l.id}`} className="btn ghost"
                    style={{ fontSize: 13, padding: "8px 14px", textDecoration: "none" }}>
                    View details →</a>
                  {canCollect && <a href={`/repay/${l.id}`} className="btn green"
                    style={{ fontSize: 13, padding: "8px 14px", textDecoration: "none" }}>Collect</a>}
                </div>
              </div>))}
            {loans.length > 0 && <div className="hint" style={{ marginTop: 8 }}>
              Dues are priced live by the interest engine from this loan&rsquo;s receipts.</div>}
          </div>

          <div className="card">
            <K>Bank accounts</K>
            <BankAccountsClient customerId={Number(c.id)} mayEdit={!!mayEditCust}
              accounts={banks.map(b => ({ id: Number(b.id), bank: b.bank,
                bankBranch: b.bank_branch, accountNo: String(b.account_no), ifsc: b.ifsc,
                holderName: b.holder_name, acctType: b.acct_type,
                verifiedAt: b.verified_at ? String(b.verified_at) : null }))} />
          </div>

          <div className="card">
            <K>Documents on file</K>
            {docs.length === 0 && <div style={{ color: "var(--mut)", fontSize: 14 }}>None.</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              {docs.map((d, i) => (
                <span key={i} className="chip mut">
                  {d.name} · <span className="mono">{d.number}</span> · {d.scans} photo{d.scans === 1 ? "" : "s"}
                </span>))}
            </div>
          </div>

          {closed.length > 0 && (
            <div className="card">
              <K>Closed loans</K>
              {closed.map((l, i) => (
                <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : 0, padding: "10px 0",
                  display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
                  <span className="mono" style={{ fontWeight: 700 }}>{l.loan_no}</span>
                  <span style={{ color: "var(--mut)" }}>{l.scheme}</span>
                  <span className="mono">{inr(l.principal_paise)}</span>
                  <span className="chip mut">{l.status.replace(/_/g, " ")}</span>
                </div>))}
            </div>)}
        </div>
      </div>
      <style>{`@media(max-width:820px){.c360{grid-template-columns:1fr !important}}`}</style>
    </Shell>
  );
}

const K = ({ children, style }) => (
  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase",
    color: "var(--mut)", marginBottom: 8, ...style }}>{children}</div>);

const Row = ({ k, v, brass }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0" }}>
    <span style={{ color: "#7fae99", fontSize: 12.5 }}>{k}</span>
    <span className="mono" style={{ fontWeight: 800, color: brass ? "var(--brass-soft)" : "#fff" }}>{v}</span>
  </div>);
