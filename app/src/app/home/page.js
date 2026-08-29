import { redirect } from "next/navigation";
import { dmy } from "@/lib/format.js";
import { currentActor } from "@/lib/session.js";
import Shell from "@/components/Shell.js";
import { visibleDesks, sanctionAuthority, can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";

export const dynamic = "force-dynamic";
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

export default async function Home() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (actor.forceChange) redirect("/setpw");

  const desks = visibleDesks(actor);
  const authority = sanctionAuthority(actor);

  const rate = await one(`SELECT base_paise, rate_date FROM rate_in_force(1, CURRENT_DATE)`);
  const canDisburse = can(actor, "disburse", { need: "full" }).ok;
  // approved, not yet disbursed, at the acting branch — with who approved it
  // E15 №5 (owner, 29 Aug 2026): files the disburse desk returned — the maker
  // must SEE them, or a sent-back loan silently dies in a drawer.
  const sentBackQ = await q(
    `SELECT la.id, la.app_no, la.requested_paise, c.full_name AS cust,
            h.note, h.at AS sent_at, e.full_name AS sent_by
       FROM loan_application la
       JOIN customer c ON c.id = la.customer_id
       JOIN LATERAL (SELECT note, at, by_employee FROM loan_state_history
                      WHERE application_id = la.id
                      ORDER BY id DESC LIMIT 1) h ON h.note LIKE 'sent back for changes:%'
       JOIN employee e ON e.id = h.by_employee
      WHERE la.branch_id = $1 AND la.status = 'appraised'
      ORDER BY h.at DESC`, [actor.actingBranchId]);

  const readyQ = await q(
    `SELECT la.id, la.app_no, la.requested_paise, la.created_by AS creator_id,
            c.full_name AS cust, s.code AS scheme,
            h.by_employee AS approver_id, e.full_name AS approver, h.at AS approved_at
       FROM loan_application la
       JOIN customer c ON c.id = la.customer_id
       JOIN scheme_version sv ON sv.id = la.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
       LEFT JOIN loan l ON l.application_id = la.id
       JOIN LATERAL (SELECT by_employee, at FROM loan_state_history
                      WHERE application_id = la.id AND to_state = 'approved'
                      ORDER BY at DESC LIMIT 1) h ON TRUE
       JOIN employee e ON e.id = h.by_employee
      WHERE la.branch_id = $1 AND la.status = 'approved' AND l.id IS NULL
      ORDER BY h.at`, [actor.actingBranchId]);
  const counts = await one(
    `SELECT (SELECT count(*) FROM loan WHERE status='active' AND branch_id=$1)::int AS active_loans,
            (SELECT count(*) FROM release r JOIN loan l ON l.id=r.loan_id
              WHERE r.released_at IS NULL AND l.branch_id=$1)::int AS release_queue,
            (SELECT count(*) FROM ho_approval h JOIN loan_application a ON a.id=h.application_id
              WHERE h.status='waiting' AND a.branch_id=$1)::int AS awaiting_ho,
            (SELECT count(*) FROM customer)::int AS customers,
            (SELECT count(*) FROM packet pk JOIN loan l2 ON l2.id=pk.loan_id
              WHERE pk.status='at_counter' AND l2.branch_id=$1)::int AS vault_due,
            (SELECT count(*) FROM packet pk JOIN loan l2 ON l2.id=pk.loan_id
              WHERE pk.status='frozen' AND l2.branch_id=$1)::int AS vault_frozen,
            (SELECT count(*) FROM loan l3 JOIN packet p3 ON p3.loan_id=l3.id
              WHERE l3.branch_id=$1 AND l3.status='closed' AND p3.status <> 'out')::int AS release_due`,
    [actor.actingBranchId]);
  const day = await one(
    `SELECT begin_signed_at, end_signed_at FROM day_cycle
      WHERE branch_id=$1 AND business_date=CURRENT_DATE`, [actor.actingBranchId]);

  const deskLabels = {
    counterHome: "Counter", overdue: "Overdue", dayCycle: "Day begin/end",
    cashTransfer: "Cash transfer", vault: "Vault", reports: "Reports",
    hqDashboard: "HQ dashboard", approvals: "Approvals", dailyRate: "Daily rate", settings: "Settings",
  };

  return (
    <Shell>
      {!rate && (
        <div style={{ marginBottom: 14 }}>
          {desks.dailyRate
            ? <a href="/hq/rate" className="chip warn" style={{ textDecoration: "none" }}>
                Today&rsquo;s gold rate is not set — lending is locked until it is. Set it →</a>
            : <span className="chip warn">
                Today&rsquo;s gold rate is not set — lending is locked until HO sets it.</span>}
        </div>)}
      <div>
        <a href="/search" style={{ display: "block", textDecoration: "none" }}>
          <div style={{ border: "1px solid #cfc9ba", borderRadius: 12, padding: "16px 18px",
            background: "#fff", color: "var(--mut)", fontSize: 16, maxWidth: 760 }}>
            🔍 Customer at counter? Type mobile, name, or loan no…
          </div>
        </a>

        <p style={{ color: "var(--mut)", fontSize: 13.5, margin: "8px 0 20px" }}>
          Search is the front door — new pledge, payment, renewal, enquiry, everything.
        </p>

      {sentBackQ.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "5px solid #e8a020" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "#a06407" }}>
            ↩ Sent back — needs correction ({sentBackQ.length})</div>
          {sentBackQ.map((r, i) => (
            <a key={r.id} href={`/pledge/${r.id}`} style={{ textDecoration: "none",
              color: "inherit", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "11px 2px", borderTop: i ? "1px solid var(--line)" : "1px solid transparent",
              marginTop: i ? 0 : 6 }}>
              <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                <b>{r.cust}</b>
                <span className="mono" style={{ color: "var(--mut)", fontSize: 12,
                  marginLeft: 8 }}>{r.app_no}</span>
                <div style={{ color: "#a06407", fontSize: 12.5, marginTop: 2, fontWeight: 700 }}>
                  “{String(r.note).replace(/^sent back for changes:\s*/, "")}”
                  <span style={{ color: "var(--mut)", fontWeight: 400 }}>
                    {" "}— {r.sent_by}, {dmy(r.sent_at)}</span></div>
              </div>
              <b className="mono" style={{ fontSize: 15 }}>
                ₹{Math.round(Number(r.requested_paise) / 100).toLocaleString("en-IN")}</b>
              <span className="chip warn" style={{ fontSize: 11.5 }}>open & fix →</span>
            </a>))}
        </div>)}

      {readyQ.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "5px solid var(--brass)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
            gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
              textTransform: "uppercase", color: "var(--mut)" }}>
              Ready to disburse — {readyQ.length} loan{readyQ.length === 1 ? "" : "s"} approved</div>
            <div style={{ fontSize: 11.5, color: "var(--mut)" }}>
              maker ≠ checker: the approver never disburses</div>
          </div>
          {readyQ.map((r, i) => {
            const mine = Number(r.approver_id) === Number(actor.employeeId);
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12,
                flexWrap: "wrap", padding: "11px 2px",
                borderTop: i ? "1px solid var(--line)" : "1px solid transparent",
                marginTop: i ? 0 : 6 }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <b>{r.cust}</b>
                  <span className="mono" style={{ color: "var(--mut)", fontSize: 12,
                    marginLeft: 8 }}>{r.app_no}</span>
                  <div style={{ color: "var(--mut)", fontSize: 12.5, marginTop: 2 }}>
                    {r.scheme} · approved by {mine ? "you" : r.approver}
                    {" · "}{dmy(r.approved_at)}</div>
                </div>
                <b className="mono" style={{ fontSize: 15 }}>
                  ₹{Math.round(Number(r.requested_paise) / 100).toLocaleString("en-IN")}</b>
                {Number(r.creator_id) === Number(actor.employeeId) && (
                  <a href={`/pledge/${r.id}`} className="btn ghost"
                    title="You created this file — editing returns it to appraised for fresh approval (D-E amended)"
                    style={{ padding: "7px 13px", fontSize: 12.5, textDecoration: "none" }}>✎ Edit</a>)}
                {canDisburse && !mine ? (
                  <a href={`/pledge/${r.id}`} className="btn green"
                    style={{ fontSize: 13, padding: "9px 16px", textDecoration: "none" }}>
                    Disburse →</a>
                ) : (
                  <span className="chip mut" title={mine
                    ? "You approved this loan — a different person must pay it out"
                    : "You do not hold the disburse permission"}
                    style={{ whiteSpace: "nowrap" }}>
                    {mine ? "🔒 you approved — another person disburses" : "view only"}</span>
                )}
              </div>);
          })}
        </div>)}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}>
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>You</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginTop: 6 }}>{actor.fullName}</div>
            <div className="mono" style={{ fontSize: 13, color: "var(--mut)" }}>{actor.username} · {actor.empCode}</div>
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {actor.roleNames.map(r => <span key={r} className="chip mut">{r}</span>)}
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--mut)" }}>
              Sanction authority:{" "}
              <b className="mono">{authority.unlimited ? "unlimited" : inr(authority.ceilingPaise)}</b>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span className={"chip " + (authority.unlimited ? "ok"
                  : authority.ceilingPaise > 0 ? "mut" : "warn")}>{authority.reason}</span></div>
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>
              This branch today</div>
            <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.9 }}>
              Active loans <b className="mono">{counts.active_loans}</b><br />
              Gold release queue <b className="mono">{counts.release_queue}</b><br />
              Awaiting HO approval <b className="mono">{counts.awaiting_ho}</b><br />
              Customers on file <b className="mono">{counts.customers}</b>
            </div>
            <div style={{ marginTop: 10 }}>
              <span className={"chip " + (day?.begin_signed_at ? "ok" : "warn")}>
                {day?.begin_signed_at ? "day-begin signed" : "day-begin not signed"}</span>
            </div>
          </div>

          {desks.vault && counts.release_due > 0 && (
            <a href="/release" className="card" style={{ textDecoration: "none", color: "inherit",
              display: "block", borderColor: "var(--brass)" }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>
                Gold release due — {counts.release_due} loan{counts.release_due === 1 ? "" : "s"}</div>
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--mut)", lineHeight: 1.5 }}>
                Closed loans awaiting handover · gold goes back within 7 working days.</div>
              <div style={{ marginTop: 12, fontWeight: 800, fontSize: 14, color: "var(--vault)" }}>
                Open list →</div>
            </a>
          )}

          {desks.vault && (
            <a href="/vault" className="card" style={{ textDecoration: "none", color: "inherit",
              display: "block", borderColor: counts.vault_due > 0 ? "var(--brass)" : undefined }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>
                Vault-in due — {counts.vault_due} packet{counts.vault_due === 1 ? "" : "s"}</div>
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--mut)", lineHeight: 1.5 }}>
                Disbursed pledges still in counter custody · recheck, then safe.</div>
              {counts.vault_frozen > 0 && (
                <div style={{ marginTop: 10 }}>
                  <span className="chip bad">{counts.vault_frozen} frozen after a mismatch</span></div>)}
              <div style={{ marginTop: 12, fontWeight: 800, fontSize: 14, color: "var(--vault)" }}>
                Open list →</div>
            </a>
          )}

          {desks.dayCycle && (
            <a href="/daycycle" className="card" style={{ textDecoration: "none", color: "inherit",
              display: "block" }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>
                Day begin / end</div>
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--mut)", lineHeight: 1.5 }}>
                Opening checks and count in the morning · denomination count and variance at close.</div>
              <div style={{ marginTop: 12, fontWeight: 800, fontSize: 14, color: "var(--vault)" }}>
                Open →</div>
            </a>
          )}

          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>
              Your desks — from permissions, not job title</div>
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(desks).map(([k, v]) =>
                v && k === "overdue"
                  ? <a key={k} href="/overdue" className="chip ok" style={{ textDecoration: "none" }}>
                      ✓ {deskLabels[k]} →</a>
                  : v && k === "approvals"
                  ? <a key={k} href="/hq/approvals" className="chip ok" style={{ textDecoration: "none" }}>
                      ✓ {deskLabels[k]} →</a>
                  : v && k === "dailyRate"
                  ? <a key={k} href="/hq/rate" className="chip ok" style={{ textDecoration: "none" }}>
                      ✓ {deskLabels[k]} →</a>
                  : <span key={k} className={"chip " + (v ? "ok" : "mut")}>{v ? "✓" : "—"} {deskLabels[k]}</span>)}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
