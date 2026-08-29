import Shell from "@/components/Shell.js";
import { one, q } from "@/lib/db.js";
import { viewUrl } from "@/lib/s3.js";
import { notFound } from "next/navigation";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { schemeFromRow, replayLoan } from "@/lib/loanstate.js";
import { dues } from "@/lib/engine.js";
import LoanExtrasClient from "../../customers/[id]/LoanExtrasClient.js";
export const dynamic = "force-dynamic";

const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");
const g = (mg) => (Number(mg) / 1000).toFixed(3);
const dmy = (d) => { const s = String(d).slice(0, 10).split("-"); return `${s[2]}-${s[1]}-${s[0]}`; };

/** Loan profile — frozen UX screen C4b. Read-only: every figure is replayed
 *  live from immutable receipts by the same engine the repay screen uses. */
export default async function LoanProfile({ params }) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const actor = await currentActor();
  const canCollect = actor && can(actor, "collect", { need: "full" }).ok;

  const l = await one(
    `SELECT l.*, s.code AS scheme_code, s.name AS scheme_name,
            c.full_name AS cust_name, c.cust_no, c.mobile AS cust_mobile,
            (CURRENT_DATE - l.disbursed_at)::int AS age_days
       FROM loan l JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
       JOIN customer c ON c.id = l.customer_id
      WHERE l.id = $1`, [id]);
  if (!l) notFound();

  const [sv, slabs, lch, rcp, approps, items, photos, cob, custody, followups, outcomes,
         borrowerPhotoRow] =
    await Promise.all([
      one(`SELECT * FROM scheme_version WHERE id = $1`, [l.scheme_version_id]),
      q(`SELECT from_day, to_day, rate_pct FROM scheme_slab
          WHERE scheme_version_id = $1 ORDER BY from_day`, [l.scheme_version_id]),
      q(`SELECT lc.id, lc.total_paise, lc.added_at::date AS added_on, ct.name AS charge_name
           FROM loan_charge lc JOIN charge_type ct ON ct.id = lc.charge_type_id
          WHERE lc.loan_id = $1 AND lc.removed_at IS NULL ORDER BY lc.added_at, lc.id`, [id]),
      q(`SELECT r.id, r.receipt_no, r.business_date, r.amount_paise, r.mode::text, r.utr,
                r.paid_by, r.closes_loan, e.full_name AS received_by_name, sa.nickname AS slf_account
           FROM receipt r JOIN employee e ON e.id = r.received_by
           LEFT JOIN slf_bank_account sa ON sa.id = r.slf_bank_account_id
          WHERE r.loan_id = $1 ORDER BY r.business_date, r.id`, [id]),
      q(`SELECT ra.receipt_id, ra.bucket::text, sum(ra.amount_paise)::bigint AS amt
           FROM receipt_appropriation ra JOIN receipt r ON r.id = ra.receipt_id
          WHERE r.loan_id = $1 GROUP BY ra.receipt_id, ra.bucket`, [id]),
      q(`SELECT ai.qty, ai.gross_mg, ai.stone_mg, ai.net_mg, ai.purity_pct_snapshot,
                ai.funding_paise, ai.narration, it.name AS item_name, pu.karat
           FROM appraisal_item ai JOIN item it ON it.id = ai.item_id
           JOIN purity pu ON pu.id = ai.purity_id
          WHERE ai.application_id = $1 ORDER BY ai.id`, [l.application_id]),
      q(`SELECT f.thumb_s3_key, f.s3_key FROM application_photo ap
           JOIN file_object f ON f.id = ap.file_id
          WHERE ap.application_id = $1 ORDER BY ap.ord LIMIT 4`, [l.application_id]),
      one(`SELECT c.full_name, c.cust_no,
                  COALESCE(la.coborrower_photo_id,
                    (SELECT cp.file_id FROM customer_photo cp
                      WHERE cp.customer_id = c.id ORDER BY cp.id DESC LIMIT 1)) AS photo_id
             FROM loan_application la
             JOIN customer c ON c.id = la.coborrower_customer_id
            WHERE la.id = $1 AND la.coborrower_customer_id IS NOT NULL`, [l.application_id]),
      one(`SELECT p.packet_no, p.status::text AS packet_status, sf.label AS safe_label,
                  vm.direction::text, vm.at AS moved_at
             FROM packet p
             LEFT JOIN LATERAL (SELECT * FROM vault_movement WHERE packet_id = p.id
                                 ORDER BY at DESC LIMIT 1) vm ON TRUE
             LEFT JOIN safe sf ON sf.id = vm.safe_id
            WHERE p.loan_id = $1 ORDER BY p.id DESC LIMIT 1`, [id]),
      q(`SELECT cc.method, cc.outcome::text, cc.ptp_date, cc.next_follow_up, cc.note,
                cc.at::date AS on_date, e.full_name AS by
           FROM collection_call cc JOIN employee e ON e.id = cc.by_employee
          WHERE cc.loan_id = $1 ORDER BY cc.at DESC`, [id]),
      one(`SELECT enum_range(NULL::call_outcome)::text[] AS labels`),
      // №10 (owner 28 Aug 2026): the borrower's live photo — current customer photo
      one(`SELECT f.s3_key, f.thumb_s3_key FROM customer_photo cp
             JOIN file_object f ON f.id = cp.file_id
            WHERE cp.customer_id = $1 AND cp.is_current
            ORDER BY cp.id DESC LIMIT 1`, [l.customer_id]),
    ]);

  // live figures — same replay the repay screen prices from
  const scheme = schemeFromRow(sv, slabs, l.scheme_code);
  const state = replayLoan({ principalPaise: l.principal_paise, disbursedAt: l.disbursed_at,
    scheme, charges: lch, receipts: rcp });
  const closing = dues(scheme, state, today, { closing: true });
  const P = closing._paise;
  const principalOut = P.settlement - P.interestDue - P.penalDue - P.chargesDue;
  const totalNetMg = items.reduce((s, it) => s + Number(it.net_mg), 0);

  // borrower's live photo (№10) — same signing as the co-borrower below
  let borrowerPhoto = null;
  if (borrowerPhotoRow) {
    borrowerPhoto = {
      thumb: await viewUrl(borrowerPhotoRow.thumb_s3_key || borrowerPhotoRow.s3_key).catch(() => null),
      full: await viewUrl(borrowerPhotoRow.s3_key).catch(() => null),
    };
    if (!borrowerPhoto.thumb) borrowerPhoto = null;
  }

  // co-borrower photo — the pledge-day snapshot, else their customer photo
  let cobPhoto = null;
  if (cob?.photo_id) {
    const f = await one(`SELECT s3_key, thumb_s3_key FROM file_object WHERE id=$1`, [cob.photo_id]);
    if (f) cobPhoto = {
      thumb: await viewUrl(f.thumb_s3_key || f.s3_key).catch(() => null),
      full: await viewUrl(f.s3_key).catch(() => null),
    };
    if (cobPhoto && !cobPhoto.thumb) cobPhoto = null;
  }

  // signed photo URLs — thumb for display, full for click-to-zoom
  const pics = (await Promise.all(photos.map(async (p) => ({
    thumb: await viewUrl(p.thumb_s3_key || p.s3_key).catch(() => null),
    full: await viewUrl(p.s3_key).catch(() => null),
  })))).filter(p => p.thumb);

  // one ledger: receipts + charges + disbursement, newest first
  const splitOf = (rid) => {
    const m = {}; approps.filter(a => Number(a.receipt_id) === Number(rid))
      .forEach(a => { m[a.bucket] = Number(a.amt); });
    return m;
  };
  const ledger = [
    ...rcp.map(r => ({ kind: "receipt", date: r.business_date,
      label: `Receipt ${r.receipt_no}${r.closes_loan ? " — LOAN CLOSED" : ""}`,
      amt: Number(r.amount_paise), split: splitOf(r.id),
      ref: [r.mode.toUpperCase() + (r.slf_account ? ` → ${r.slf_account}` : ""), r.utr,
            r.paid_by ? `paid by ${r.paid_by}` : null,
            `by ${r.received_by_name}`].filter(Boolean).join(" · ") })),
    ...lch.map(c => ({ kind: "charge", date: c.added_on,
      label: c.charge_name, amt: Number(c.total_paise), ref: "levied on the loan" })),
    { kind: "disb", date: l.disbursed_at,
      label: `Loan disbursed — ${l.scheme_code}`, amt: Number(l.principal_paise),
      ref: "principal at disbursement" },
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // due schedule — frozen UX estimation: due now, next 3 months at current pace, maturity
  const monthlyEst = Math.ceil(((P.interestDue / Math.max(l.age_days, 1)) * 30) / 1000) * 1000;
  const addM = (iso, m) => { const d = new Date(iso + "T00:00:00");
    d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
  const sched = [{ label: "Due now — interest + penal + charges", date: today,
    amt: P.interestDue + P.penalDue + P.chargesDue, hot: true }];
  let shown = 0;
  for (let m = 1; m <= 14 && shown < 3; m++) {
    const d = addM(l.disbursed_at, m);
    if (d > today) { sched.push({ label: "Monthly interest (estimated)", date: d, amt: monthlyEst }); shown++; }
  }
  const maturity = addM(l.disbursed_at, Math.round((sv.tenure_days ?? 365) / 30));
  sched.push({ label: "Maturity — principal + running interest", date: maturity,
    amt: Number(l.principal_paise), plus: true });

  const chipTone = { receipt: { t: "RECEIPT", bg: "#e2f2e9", fg: "#1e7a4f" },
    charge: { t: "CHARGE", bg: "#fbe6e2", fg: "#b03426" },
    disb: { t: "DISBURSED", bg: "#e3eef8", fg: "#22608f" } };

  const Tile = ({ k, v, tone }) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--mut)", marginBottom: 4 }}>{k}</div>
      <b className="mono" style={{ fontSize: 16, color: tone || "inherit" }}>{v}</b>
    </div>);
  const H = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
      textTransform: "uppercase", color: "var(--mut)", marginBottom: 8 }}>{children}</div>);
  const Ghost = ({ children }) => (
    <button className="btn ghost" disabled title="Coming soon"
      style={{ fontSize: 14, padding: "11px 16px", opacity: .5 }}>{children}</button>);

  return (
    <Shell>
      <a href={`/customers/${l.customer_id}`} style={{ color: "var(--mut)", fontSize: 13,
        fontWeight: 700, textDecoration: "none" }}>← {l.cust_name}</a>
      <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-.3px", margin: "8px 0 6px" }}>
        Loan profile — <span className="mono">{l.loan_no}</span>
        {l.status !== "active" && <span className="chip mut" style={{ marginLeft: 10,
          verticalAlign: "middle" }}>{l.status.replace(/_/g, " ")}</span>}
      </h1>
      <p className="mono" style={{ color: "var(--mut)", fontSize: 14, margin: "0 0 12px" }}>
        {l.scheme_code} · {g(totalNetMg)} g net · disbursed {dmy(l.disbursed_at)} · day {l.age_days} · as on {dmy(today)}
      </p>

      {/* №10+№5 (owner 28 Aug 2026): the people on this loan, live photos, straight links */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
        margin: "0 0 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {borrowerPhoto
            ? <a href={borrowerPhoto.full || borrowerPhoto.thumb} target="_blank" rel="noreferrer"
                title="Open full size"><img src={borrowerPhoto.thumb} alt="borrower"
                style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover",
                  border: "1px solid var(--line)", display: "block" }} /></a>
            : <div style={{ width: 52, height: 52, borderRadius: 10, background: "#faf9f4",
                border: "1px dashed #cfc9ba", display: "grid", placeItems: "center",
                color: "var(--mut)", fontSize: 10 }}>no photo</div>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{l.cust_name}</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--mut)" }}>{l.cust_no} · borrower</div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>
              <a href={`/customers/${l.customer_id}`} style={{ color: "var(--vault)",
                fontWeight: 800, textDecoration: "none" }}>View customer</a>
              <span style={{ color: "var(--mut)" }}> · </span>
              <a href={`/customers/${l.customer_id}/edit`} style={{ color: "var(--vault)",
                fontWeight: 800, textDecoration: "none" }}>Edit</a>
            </div>
          </div>
        </div>
        {cob && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {cobPhoto
              ? <a href={cobPhoto.full || cobPhoto.thumb} target="_blank" rel="noreferrer"
                  title="Open full size"><img src={cobPhoto.thumb} alt="co-borrower"
                  style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover",
                    border: "1px solid var(--line)", display: "block" }} /></a>
              : <div style={{ width: 52, height: 52, borderRadius: 10, background: "#faf9f4",
                  border: "1px dashed #cfc9ba", display: "grid", placeItems: "center",
                  color: "var(--mut)", fontSize: 10 }}>no photo</div>}
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{cob.full_name}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--mut)" }}>{cob.cust_no} · co-borrower</div>
            </div>
          </div>
        )}
      </div>

      {/* figure strip — penal gets its own tile (owner request; deviation from frozen) */}
      <div style={{ background: "#faf9f4", border: "1px solid var(--line)", borderRadius: 16,
        padding: "16px 18px", display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 14 }}>
        <Tile k="Principal outstanding" v={inr(principalOut)} />
        <Tile k="Interest accrued" v={inr(P.interestDue)} tone="#9a6d13" />
        <Tile k="Penal due" v={inr(P.penalDue)} tone={P.penalDue > 0 ? "#b03426" : "inherit"} />
        <Tile k="Charges due" v={inr(P.chargesDue)} tone={P.chargesDue > 0 ? "#b03426" : "inherit"} />
        <Tile k="Full settlement today" v={inr(P.settlement)} />
      </div>

      {/* actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0 18px" }}>
        {canCollect && l.status === "active" &&
          <a href={`/repay/${l.id}`} className="btn green"
            style={{ fontSize: 14, padding: "11px 18px", textDecoration: "none" }}>Collect →</a>}
        <a href={`/addcharge/${l.id}`} className="btn ghost"
          style={{ fontSize: 14, padding: "11px 16px", textDecoration: "none" }}>Add charge</a>
        <Ghost>Renew</Ghost>
        <Ghost>Top-up</Ghost>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* left: ornaments, then ledger */}
        <div style={{ flex: "1 1 380px", minWidth: 320, display: "grid", gap: 14 }}>
          <div className="card">
            <H>Ornaments pledged</H>
            {pics.length > 0 ? (
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                {pics.map((p, i) => (
                  <a key={i} href={p.full || p.thumb} target="_blank" rel="noreferrer"
                    title="Open full size">
                    <img src={p.thumb} alt="ornaments" style={{ width: 120, height: 120,
                      objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)",
                      display: "block" }} /></a>))}
              </div>
            ) : (
              <div style={{ border: "1px dashed #cfc9ba", borderRadius: 12, padding: "10px 14px",
                color: "var(--mut)", fontSize: 13, marginBottom: 10 }}>
                No ornament photo on file for this loan.</div>
            )}
            {items.map((it, i) => (
              <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : 0, padding: "9px 0",
                display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
                fontSize: 13.5 }}>
                <div style={{ minWidth: 0 }}>
                  <b>{it.item_name}</b>{Number(it.qty) > 1 ? ` × ${it.qty}` : ""}
                  <span style={{ color: "var(--mut)" }}> · {it.karat} ({Number(it.purity_pct_snapshot)}%)</span>
                  {it.narration && <div style={{ color: "var(--mut)", fontSize: 12 }}>{it.narration}</div>}
                </div>
                <div className="mono" style={{ textAlign: "right" }}>
                  <div>{g(it.gross_mg)} g gross{Number(it.stone_mg) > 0
                    ? ` − ${g(it.stone_mg)} stone` : ""} = <b>{g(it.net_mg)} g</b></div>
                  <div style={{ color: "var(--mut)", fontSize: 12 }}>valued {inr(it.funding_paise)}</div>
                </div>
              </div>))}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 2,
              display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
              <b>Total net weight</b><b className="mono">{g(totalNetMg)} g</b>
            </div>
          </div>

          <div className="card">
            <H>Payment &amp; charge history</H>
            {rcp.length === 0 && (
              <div style={{ border: "1px dashed #cfc9ba", borderRadius: 12, padding: "12px 14px",
                color: "var(--mut)", fontSize: 13, margin: "4px 0 8px" }}>
                No payment received on this loan yet — every receipt will appear here.</div>)}
            {ledger.map((e, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: 12, padding: "11px 2px", flexWrap: "wrap",
                borderTop: i ? "1px solid var(--line)" : 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ padding: "2px 9px", borderRadius: 99, fontSize: 10,
                      fontWeight: 800, letterSpacing: ".05em",
                      background: chipTone[e.kind].bg, color: chipTone[e.kind].fg }}>
                      {chipTone[e.kind].t}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{e.label}</span>
                  </div>
                  {e.ref && <div className="mono" style={{ fontSize: 12, color: "var(--mut)",
                    marginTop: 3 }}>{e.ref}</div>}
                  {e.split && Object.keys(e.split).length > 0 && (
                    <div className="mono" style={{ fontSize: 12, color: "#4a4d42", marginTop: 3 }}>
                      {["charge", "charge_rounding", "penal", "interest", "principal"]
                        .filter(b => e.split[b])
                        .map(b => `${({ charge: "charges", charge_rounding: "rounding" })[b] || b} ${inr(e.split[b])}`)
                        .join(" · ")}</div>)}
                  <div className="mono" style={{ fontSize: 12, color: "var(--mut)", marginTop: 3 }}>
                    {dmy(e.date)}</div>
                </div>
                <b className="mono" style={{ marginLeft: "auto" }}>{inr(e.amt)}</b>
              </div>))}
          </div>
        </div>

        {/* right: schedule, facts, follow-ups, extras */}
        <div style={{ flex: "1 1 300px", minWidth: 280, display: "grid", gap: 14 }}>
          <div className="card">
            <H>Due schedule</H>
            {sched.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10,
                padding: "9px 2px", fontSize: 13, borderTop: i ? "1px solid var(--line)" : 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: d.hot ? "#b03426" : "inherit" }}>{d.label}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>
                    {dmy(d.date)}</div>
                </div>
                <b className="mono" style={{ color: d.hot ? "#b03426" : "inherit",
                  marginLeft: "auto", whiteSpace: "nowrap" }}>{inr(d.amt)}{d.plus ? " + int." : ""}</b>
              </div>))}
            <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 8 }}>
              Monthly figures are estimated at the current pace — the schedule refreshes after
              every receipt.</div>
          </div>

          <div className="card">
            <H>Loan facts</H>
            {[
              ["Borrower", `${l.cust_name} · ${l.cust_no}`],
              cob ? ["Co-borrower", <span key="cob" style={{ display: "inline-flex",
                  alignItems: "center", gap: 8 }}>
                  {cobPhoto && <a href={cobPhoto.full || cobPhoto.thumb} target="_blank"
                    rel="noreferrer" title="Open full size">
                    <img src={cobPhoto.thumb} alt="" style={{ width: 34, height: 34,
                      objectFit: "cover", borderRadius: 8,
                      border: "1px solid var(--line)", display: "block" }} /></a>}
                  {cob.full_name} · {cob.cust_no}</span>] : null,
              custody ? ["Packet", `${custody.packet_no} · ${custody.packet_status.replace(/_/g, " ")}` +
                (custody.safe_label && custody.direction === "in" ? ` · ${custody.safe_label}` : "")] : null,
              ["Scheme", `${l.scheme_name} (${l.scheme_code}) v${sv.version_no ?? ""}`],
              ["Interest slabs", slabs.map(s => `${s.from_day}–${s.to_day ?? "…"}d @ ${s.rate_pct}%`).join(" · ")],
              ["Minimum interest", `${sv.min_interest_days ?? 0} days`],
              ["Penal", `${sv.penal_rate_pct ?? 0}% p.a. after tenure` +
                (sv.penal_grace_days ? ` · ${sv.penal_grace_days}d grace` : "")],
              ["Days in year", String(sv.days_in_year ?? 365)],
              ["Tenure", `${sv.tenure_days ?? "—"} days`],
            ].filter(Boolean).map(([k, v], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12,
                padding: "5px 0", fontSize: 13, borderTop: i ? "1px dashed #eee9dd" : 0 }}>
                <span style={{ color: "var(--mut)", flex: "0 0 auto" }}>{k}</span>
                <span style={{ textAlign: "right" }}>{v}</span>
              </div>))}
          </div>

          <div className="card">
            <H>Reprints — documents for this loan</H>
            <div style={{ display: "grid", gap: 8 }}>
              <a href={`/print/appraisal/${l.id}`} className="btn ghost"
                style={{ fontSize: 13, padding: "10px 14px", textDecoration: "none",
                  textAlign: "left" }}>🖨 Appraisal note</a>
              <a href={`/print/kfs/${l.id}`} className="btn ghost"
                style={{ fontSize: 13, padding: "10px 14px", textDecoration: "none",
                  textAlign: "left" }}>🖨 Loan agreement + KFS</a>
              <Ghost>🖨 Customer statement</Ghost>
              <Ghost>🖨 Bank-details NOC</Ghost>
              <Ghost>🖨 Packet QR tag</Ghost>
            </div>
          </div>

          <div className="card">
            <H>Follow-ups · {followups.length}</H>
            <LoanExtrasClient loanId={Number(l.id)} outcomes={outcomes.labels} today={today}
              canCollect={!!canCollect} />
            {followups.map((f, i) => (
              <div key={i} style={{ fontSize: 12.5, color: "#4a4d42", padding: "5px 0",
                borderTop: "1px dashed #e8e4d8", marginTop: i === 0 ? 8 : 0 }}>
                <span className="mono" style={{ color: "var(--mut)" }}>{dmy(f.on_date)}</span>
                {" · "}{f.method || "call"} · <b>{f.outcome}</b>
                {f.ptp_date ? ` · PTP ${dmy(f.ptp_date)}` : ""}
                {f.next_follow_up ? ` · next ${dmy(f.next_follow_up)}` : ""}
                {" · "}{f.by}{f.note ? ` — ${f.note}` : ""}</div>))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
