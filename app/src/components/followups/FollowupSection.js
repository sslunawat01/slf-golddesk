"use client";
import { useEffect, useState } from "react";
import FollowupTimeline from "./FollowupTimeline.js";
import FollowupLogForm from "./FollowupLogForm.js";

/**
 * E33 — the Follow-ups card on the loan page: next-due banner, suggestion,
 * timeline, and the logging form in place. Loads itself from
 * /api/followups/loan/[id], so the loan page's server code stays untouched.
 */
export default function FollowupSection({ loanId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => fetch(`/api/followups/loan/${loanId}`).then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason)).catch(() => setErr("Could not load follow-ups"));
  useEffect(() => { load(); }, [loanId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const H = ({ children }) => <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--mut)" }}>{children}</div>;
  if (err && !data) return <div className="card"><H>Follow-ups</H><div style={{ marginTop: 8 }}><span className="chip bad">{err}</span></div></div>;
  if (!data) return <div className="card"><H>Follow-ups</H><div style={{ color: "var(--mut)", fontSize: 13.5, marginTop: 8 }}>Loading…</div></div>;
  const doneN = data.items.length;
  return (
    <div className="card" data-fu-section style={{ borderTop: "5px solid var(--brass)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <H>Follow-ups · {doneN} done{data.due ? " · 1 due" : ""}</H>
          <div style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 2 }}>Every contact about this loan, newest first — the same log the <a href="/followups">Follow-ups tab</a> shows. Nothing is ever deleted.</div>
        </div>
        {data.canLog && !open && <button type="button" className="btn green" style={{ padding: "9px 14px", fontSize: 13.5 }}
          onClick={() => setOpen(true)} data-fu-open>+ Log a follow-up</button>}
      </div>
      {open && (
        <div style={{ marginTop: 12, background: "#faf9f4", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
          <FollowupLogForm loan={data.loan} due={data.due} defaultType={data.suggestion?.type} staff={data.staff} me={data.me} today={data.today}
            onCancel={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} />
        </div>)}
      <div style={{ marginTop: 12 }}><FollowupTimeline data={data} /></div>
    </div>
  );
}
