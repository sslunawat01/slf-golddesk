import Shell from "@/components/Shell.js";
import { one, q } from "@/lib/db.js";
import { kycStatus, mayLend } from "@/lib/customer.js";
import { viewUrl } from "@/lib/s3.js";
import { notFound } from "next/navigation";
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
    q(`SELECT bank, bank_branch, account_no, ifsc, holder_name, verified_at, verify_method, cheque_file_id
         FROM customer_bank_account WHERE customer_id = $1 ORDER BY id`, [id]),
    q(`SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, s.code AS scheme,
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
              ? <form action="/api/pledge-start" method="post">
                  <input type="hidden" name="customerId" value={c.id} />
                  <button className="btn" style={{ width: "100%", background: "var(--brass)",
                    color: "var(--vault)" }}>+ New pledge</button>
                </form>
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
                  <div className="mono" style={{ fontWeight: 800 }}>{l.loan_no}</div>
                  <div style={{ color: "var(--mut)", fontSize: 13 }}>
                    {l.scheme} · {g(l.net_mg)} g · day {l.age_days}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--mut)", fontWeight: 800 }}>PRINCIPAL</div>
                  <div className="mono" style={{ fontWeight: 800 }}>{inr(l.principal_paise)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btn ghost" disabled style={{ fontSize: 13, padding: "8px 12px" }}>Renew</button>
                  <button className="btn green" disabled style={{ fontSize: 13, padding: "8px 12px" }}>Collect</button>
                </div>
              </div>))}
            {loans.length > 0 && <div className="hint" style={{ marginTop: 8 }}>
              Live dues and collection arrive with Sprint 1B — the engine is already proven.</div>}
          </div>

          <div className="card">
            <K>Bank accounts</K>
            {banks.length === 0 && <div style={{ color: "var(--mut)", fontSize: 14 }}>None on file.</div>}
            {banks.map((b, i) => (
              <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : 0, padding: "10px 0",
                display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.bank}{b.bank_branch ? " · " + b.bank_branch : ""}</div>
                  <div className="mono" style={{ color: "var(--mut)", fontSize: 12.5 }}>
                    ····{String(b.account_no).slice(-4)} · {b.ifsc} · {b.holder_name}</div>
                </div>
                <span className={"chip " + (b.verified_at || b.cheque_file_id ? "ok" : "warn")}>
                  {b.verified_at ? "verified ✓" : b.cheque_file_id ? "cheque on file ✓" : "unverified — cannot receive money"}
                </span>
              </div>))}
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
