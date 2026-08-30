"use client";
import { useEffect, useState } from "react";
import { slaBand } from "@/lib/release.js";
import TopNotice from "@/app/ui/TopNotice.js";

const dmy = (d) => { const [y, m, dd] = String(d).split("-"); return `${dd}-${m}-${y}`; };
const BANDS = ["All", "Within SLA", "Day 5–6", "Day 7+"];

export default function ReleaseListClient() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    fetch("/api/release").then(r => r.json())
      .then(r => r.ok ? setData(r) : setErr(r.reason))
      .catch(() => setErr("Could not load the release list"));
  }, []);

  if (err) return <div className="card"><TopNotice notice={err} onClose={() => setErr(null)} /><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const shown = data.rows.filter(r => filter === "All" || slaBand(r.slaDay) === filter);
  const count = (band) => band === "All" ? data.rows.length
    : data.rows.filter(r => slaBand(r.slaDay) === band).length;

  const chipFor = (day, frozen) => frozen
    ? <span className="chip bad">frozen — HO must clear</span>
    : day >= 7 ? <span className="chip bad">day {day} of 7 — overdue</span>
    : day >= 5 ? <span className="chip warn">day {day} of 7</span>
    : <span className="chip ok">day {day} of 7</span>;

  return (
    <>
      <p style={{ color: "var(--mut)", fontSize: 13.5, margin: "0 0 14px", maxWidth: 640 }}>
        Closed loans awaiting handover. Gold must go back within 7 working days of closure.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {BANDS.map(b => (
          <button key={b} onClick={() => setFilter(b)}
            style={{ border: "1px solid " + (filter === b ? "var(--vault)" : "#cfc9ba"),
              background: filter === b ? "var(--vault)" : "#fff",
              color: filter === b ? "#fff" : "var(--mut)",
              borderRadius: 99, padding: "6px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            {b} · {count(b)}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "var(--mut)", padding: "28px 16px" }}>
          No gold waiting to go back.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {shown.map(r => (
          <div key={r.loanId} className="card" style={{ display: "flex",
            justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{r.customerName}</div>
              <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 3 }}>
                {r.loanNo} · packet {r.packetNo} · {(r.netMg / 1000).toFixed(3)} g ·
                closed {dmy(r.closedAt)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {chipFor(r.slaDay, r.packetStatus === "frozen")}
              {data.canAct && r.packetStatus !== "frozen" && (
                <a href={`/release/${r.loanId}`} className="btn" style={{ textDecoration: "none" }}>
                  Release →</a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
