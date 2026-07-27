import { currentActor } from "@/lib/session.js";
import { visibleDesks } from "@/lib/policy.js";
import { one } from "@/lib/db.js";
import { redirect } from "next/navigation";

const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

/** Dark chrome + search-first navigation, shared by every signed-in page. */
export default async function Shell({ children, title }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (actor.forceChange) redirect("/setpw");
  const desks = visibleDesks(actor);
  const rate = await one(`SELECT base_paise, rate_date FROM rate_in_force(1, CURRENT_DATE)`);

  const nav = [["/home", "⌂ Home"], ...(desks.reports ? [["/search", "Search"]] : [])];

  return (
    <>
      <div style={{ background: "var(--vault)", color: "#fff" }}>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "12px 16px", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <a href="/home" style={{ textDecoration: "none" }}>
              <div style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.5px", color: "#fff" }}>
                SLF <span style={{ color: "var(--brass)" }}>GoldDesk</span></div>
              <div style={{ color: "#5f8f7b", fontSize: 11.5, fontWeight: 600 }}>
                {actor.actingBranch ? `${actor.actingBranch.code} · ${actor.actingBranch.name}` : "no branch"}
                {" · "}{actor.fullName}</div>
            </a>
            <div style={{ display: "flex", gap: 14 }}>
              {nav.map(([href, label]) => (
                <a key={href} href={href} style={{ color: "#cfe4da", fontSize: 13, fontWeight: 700,
                  textDecoration: "none" }}>{label}</a>))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mono" style={{
              background: rate ? "#123227" : "#fdf1d8", color: rate ? "var(--brass-soft)" : "#a06407",
              padding: "6px 12px", borderRadius: 99, fontWeight: 800, fontSize: 13 }}>
              {rate ? inr(rate.base_paise) + "/g" : "rate not set"}</span>
            <form action="/api/auth/logout" method="post">
              <button className="btn ghost" style={{ padding: "8px 14px", fontSize: 13 }}>Sign out</button>
            </form>
          </div>
        </div>
      </div>
      <div className="wrap" style={{ padding: "20px 16px 70px" }}>
        {title && <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 14 }}>{title}</h1>}
        {children}
      </div>
    </>
  );
}
