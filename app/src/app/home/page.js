import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session.js";
import { visibleDesks, sanctionAuthority } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";

export const dynamic = "force-dynamic";
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

export default async function Home() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (actor.forceChange) redirect("/setpw");

  const desks = visibleDesks(actor);
  const authority = sanctionAuthority(actor);

  const rate = await one(
    `SELECT base_paise, rate_date FROM daily_rate
      WHERE rate_date = CURRENT_DATE AND metal_id = 1 ORDER BY published_at DESC LIMIT 1`);
  const counts = await one(
    `SELECT (SELECT count(*) FROM loan WHERE status='active' AND branch_id=$1)::int AS active_loans,
            (SELECT count(*) FROM release r JOIN loan l ON l.id=r.loan_id
              WHERE r.released_at IS NULL AND l.branch_id=$1)::int AS release_queue,
            (SELECT count(*) FROM ho_approval h JOIN loan_application a ON a.id=h.application_id
              WHERE h.status='waiting' AND a.branch_id=$1)::int AS awaiting_ho,
            (SELECT count(*) FROM customer)::int AS customers`, [actor.actingBranchId]);
  const day = await one(
    `SELECT begin_signed_at, end_signed_at FROM day_cycle
      WHERE branch_id=$1 AND business_date=CURRENT_DATE`, [actor.actingBranchId]);

  const deskLabels = {
    counterHome: "Counter", overdue: "Overdue", dayCycle: "Day begin/end",
    cashTransfer: "Cash transfer", vault: "Vault", reports: "Reports",
    hqDashboard: "HQ dashboard", approvals: "Approvals", dailyRate: "Daily rate", settings: "Settings",
  };

  return (
    <>
      <div style={{ background: "var(--vault)", color: "#fff" }}>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "14px 16px", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.5px" }}>
              SLF <span style={{ color: "var(--brass)" }}>GoldDesk</span></div>
            <div style={{ color: "#5f8f7b", fontSize: 12, fontWeight: 600 }}>
              {actor.actingBranch ? `${actor.actingBranch.code} · ${actor.actingBranch.name}` : "no branch"}
              {" · "}{actor.fullName}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {desks.dailyRate
              ? <a href="/hq/rate" className="mono" style={{ background: rate ? "#123227" : "#fdf1d8",
                  color: rate ? "var(--brass-soft)" : "#a06407", padding: "6px 12px", borderRadius: 99,
                  fontWeight: 800, fontSize: 13, textDecoration: "none" }}>
                  {rate ? inr(rate.base_paise) + "/g" : "rate not published →"}</a>
              : <span className="mono" style={{ background: rate ? "#123227" : "#fdf1d8",
                  color: rate ? "var(--brass-soft)" : "#a06407", padding: "6px 12px", borderRadius: 99,
                  fontWeight: 800, fontSize: 13 }}>
                  {rate ? inr(rate.base_paise) + "/g" : "rate not published"}</span>}
            <form action="/api/auth/logout" method="post">
              <button className="btn ghost" style={{ padding: "8px 14px", fontSize: 13 }}>Sign out</button>
            </form>
          </div>
        </div>
      </div>

      <div className="wrap" style={{ padding: "22px 16px 60px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>Signed in ✓</h1>
        <p style={{ color: "var(--mut)", fontSize: 14, margin: "6px 0 18px" }}>
          Step 4 foundation: real authentication, database-backed sessions, and permissions
          resolved on the server. The designed screens plug into this.
        </p>

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

          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--mut)" }}>
              Your desks — from permissions, not job title</div>
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(desks).map(([k, v]) =>
                v && k === "dailyRate"
                  ? <a key={k} href="/hq/rate" className="chip ok" style={{ textDecoration: "none" }}>
                      ✓ {deskLabels[k]} →</a>
                  : <span key={k} className={"chip " + (v ? "ok" : "mut")}>{v ? "✓" : "—"} {deskLabels[k]}</span>)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
