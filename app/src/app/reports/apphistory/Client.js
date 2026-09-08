"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, StdFilters, F, Sel, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, dmyS } from "../shared.js";

const STATES = ["draft", "appraised", "pending_ho", "approved", "disbursed", "cancelled", "withdrawn"];

export default function AppHistoryClient({ fyOptions, fyCurrent, branches }) {
  const [f, setF] = useState({ fy: fyCurrent, from: "", to: "", branch: "all", state: "", q: "" });
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/apphistory");

  const cols = [
    { key: "at", label: "When", fmt: v => new Date(v).toLocaleString("en-IN",
        { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) },
    { key: "branch", label: "Branch" },
    { key: "appNo", label: "Application No", total: "count" },
    { key: "startedOn", label: "Started", fmt: dmyS },
    { key: "custNo", label: "Cust No" },
    { key: "customer", label: "Customer" },
    { key: "mobile", label: "Mobile" },
    { key: "scheme", label: "Scheme" },
    { key: "requestedPaise", label: "Requested ₹", num: true, fmt: inrP },
    { key: "fromState", label: "From", fmt: v => v || "—" },
    { key: "toState", label: "To", fmt: v => <span className={"chip " +
        (v === "cancelled" || v === "withdrawn" ? "bad" : v === "disbursed" || v === "approved" ? "ok" : "mut")}>{v}</span>,
      csv: v => v },
    { key: "currentStatus", label: "Status Now" },
    { key: "by", label: "By" },
    { key: "note", label: "Note", fmt: v => <span style={{ whiteSpace: "normal", maxWidth: 340,
        display: "inline-block" }}>{v || "—"}</span>, csv: v => v },
  ];

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Loan Application History"
        subtitle="A true register — one row per state change, from the append-only history"
        csvDisabled={!data} onCsv={() => downloadCsv("application-history.csv", cols, data.rows)} />
      <Bar busy={busy} onRun={() => run(f)}>
        <StdFilters f={f} setF={setF} fyOptions={fyOptions} branches={branches} />
        <F label="Moved to" width={140}>
          <Sel value={f.state} onChange={state => setF({ ...f, state })}
            options={[["", "Any state"], ...STATES.map(s => [s, s])]} />
        </F>
        <F label="Search (app no / customer / mobile)" width={220}>
          <input className="i" style={{ height: 40 }} value={f.q}
            onChange={e => setF({ ...f, q: e.target.value })} placeholder="APP-… or a name" />
        </F>
      </Bar>
      {data && (
        <div className="rpt-print">
          <ScopeLine scope={data.scope} period={data} />
          <Tbl cols={cols} rows={data.rows} empty="No state changes in this period." />
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the period and press <b>Run report</b>.</div>}
    </ReportFrame>
  );
}
