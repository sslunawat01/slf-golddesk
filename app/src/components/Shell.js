import { currentActor } from "@/lib/session.js";
import { visibleDesks } from "@/lib/policy.js";
import { redirect } from "next/navigation";
import HeaderCluster from "./HeaderCluster.js";
import { dueSummary } from "@/lib/followups-db.js";

/** Dark chrome + search-first navigation, shared by every signed-in page. */
export default async function Shell({ children, title }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (actor.forceChange) redirect("/setpw");
  const desks = visibleDesks(actor);
  const initials = (actor.fullName || "?").split(/\s+/).filter(Boolean)
    .slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";

  // E33: the Follow-ups tab, with a count of what is due or missed at this branch
  let fuBadge = 0;
  if (desks.overdue) {
    try { const s = await dueSummary(actor.actingBranchId, actor.employeeId); fuBadge = s.total; }
    catch { fuBadge = 0; }
  }
  const nav = [["/home", "⌂ Home"],
    ...(desks.reports ? [["/search", "Search"]] : []),
    ...(desks.overdue ? [["/followups", "Follow-ups", fuBadge]] : []),
    ...(desks.reports ? [["/reports", "Reports"]] : []),
    ...(desks.settings ? [["/settings", "Settings"]] : [])];

  return (
    <>
      <div style={{ background: "var(--vault)", color: "#fff", position: "sticky",
        top: 0, zIndex: 100 }}>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "12px 16px", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <a href="/home" style={{ textDecoration: "none" }}>
              <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.5px", color: "#fff" }}>
                SLF <span style={{ color: "var(--brass)" }}>GoldDesk</span></div>
            </a>
            <div style={{ display: "flex", gap: 16 }}>
              {nav.map(([href, label, badge]) => (
                <a key={href} href={href} style={{ color: "#cfe4da", fontSize: 13, fontWeight: 700,
                  textDecoration: "none", whiteSpace: "nowrap" }}>{label}
                  {badge > 0 && <span data-fu-badge style={{ background: "var(--bad)", color: "#fff", borderRadius: 99,
                    padding: "1px 7px", fontSize: 11, marginLeft: 4, fontWeight: 900 }}>{badge}</span>}</a>))}
            </div>
          </div>
          <HeaderCluster employeeId={actor.employeeId}
            branches={actor.branches.map(b => ({ id: b.id, code: b.code, name: b.name }))}
            actingBranchId={actor.actingBranchId} initials={initials}
            fullName={actor.fullName} username={actor.username} empCode={actor.empCode} />
        </div>
      </div>
      <div className="wrap" style={{ padding: "20px 16px 70px" }}>
        {title && <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 14 }}>{title}</h1>}
        {children}
      </div>
    </>
  );
}
