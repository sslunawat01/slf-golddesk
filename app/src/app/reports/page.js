import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/**
 * Reports home (E27, owner order 8 Sep 2026): grouped exactly as the owner
 * asked — MIS · Transaction · Cash/Bank/Financial. Every report inside is
 * branch-walled to the user's own postings.
 */
const GROUPS = [
  ["MIS Reports", [
    ["/reports/summary", "▦", "Branch Loan Summary",
     "Business written, live book, overdue and collections — one line per branch"],
    ["/reports/repay", "₹", "Loan Repay Register",
     "Every receipt with its charges / penal / interest / principal split"],
  ]],
  ["Transaction Reports", [
    ["/reports/apphistory", "▥", "Loan Application History",
     "Every state change on every file — who moved it, when, and why"],
    ["/reports/outstanding", "◉", "Outstanding Amount Report",
     "Every active loan priced today: principal + interest + charges = total due"],
    ["/reports/loandetails", "▤", "Loan Details",
     "The full dossier of one loan — ornaments to release, printable"],
    ["/reports/followups", "☎", "Follow-up Register",
     "Due, done and promised — every customer contact, with kept / broken promises and a per-staff tally"],
  ]],
  ["Cash / Bank / Financial", [
    ["/reports/daybook", "🗓", "DayBook",
     "One branch, one day — every rupee in and out, with the running cash balance"],
    ["/reports/ledger", "§", "Ledger Report",
     "Account heads with Dr/Cr entries derived from the day's money facts"],
  ]],
];

export default async function ReportsHome() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "reports", { need: "view" }).ok) redirect("/home");
  const branches = actor.branches || [];
  return (
    <Shell title="Reports">
      <p style={{ color: "var(--mut)", fontSize: 13.5, margin: "-6px 0 18px", maxWidth: 680 }}>
        Every report shows only the branches allotted to you
        {branches.length === 1
          ? <> — <b>{branches[0].code} {branches[0].name}</b>.</>
          : <> ({branches.length} branches).</>} Figures come from the same
        engine and stored receipts the counter screens use.
      </p>
      {GROUPS.map(([group, items]) => (
        <div key={group} style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: ".09em",
            textTransform: "uppercase", color: "var(--mut)", margin: "0 0 10px" }}>{group}</h2>
          <div style={{ display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
            {items.map(([href, icon, name, blurb]) => (
              <a key={href} href={href} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card" style={{ height: "100%", display: "flex", gap: 12,
                  alignItems: "flex-start", borderLeft: "5px solid var(--vault3)" }}>
                  <div style={{ fontSize: 22, lineHeight: 1, marginTop: 2 }}>{icon}</div>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 15 }}>{name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 4,
                      lineHeight: 1.45 }}>{blurb}</div>
                  </div>
                  <div style={{ marginLeft: "auto", color: "var(--brass)",
                    fontWeight: 900, fontSize: 16 }}>→</div>
                </div>
              </a>))}
          </div>
        </div>))}
    </Shell>
  );
}
