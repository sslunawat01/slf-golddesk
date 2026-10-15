"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, StdFilters, F, Sel, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, dmyS } from "../shared.js";
import { TYPES, CHANNELS } from "@/lib/followups.js";

const dt = (v) => v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";
const dtCsv = (v) => v ? new Date(v).toISOString() : "";

/** E33 — Follow-up Register: Due · Done · Promises · By staff. */
export default function FollowupRegisterClient({ fyOptions, fyCurrent, branches, staff }) {
  const [f, setF] = useState({ fy: fyCurrent, from: "", to: "", branch: "all", type: "", channel: "", staff: "" });
  const [tab, setTab] = useState("due");
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/followups");

  const dueCols = [
    { key: "dueOn", label: "Due on", fmt: dmyS },
    { key: "status", label: "Status", fmt: v => v.state === "missed" ? <span className="chip bad">{v.days} day{v.days === 1 ? "" : "s"} late</span>
        : v.state === "today" ? <span className="chip warn">today</span> : <span className="chip mut">{v.label}</span>, csv: v => v.state === "missed" ? `missed ${v.days}d` : v.label },
    { key: "branchCode", label: "Branch" },
    { key: "loanNo", label: "Loan No" },
    { key: "custNo", label: "Cust No" },
    { key: "customer", label: "Customer" },
    { key: "mobile", label: "Mobile" },
    { key: "typeLabel", label: "Type" },
    { key: "dueTodayPaise", label: "Due today ₹", num: true, fmt: inrP, total: "sum" },
    { key: "unpaidDays", label: "Interest unpaid (days)", num: true },
    { key: "assignedName", label: "Assigned to", fmt: v => v || "anyone", csv: v => v || "anyone" },
    { key: "last", label: "Last contact", fmt: v => v ? `${dt(v.at)} · ${v.channelLabel} · ${v.outcomeLabel} · ${v.by}` : "—",
      csv: v => v ? `${dtCsv(v.at)} ${v.channelLabel} ${v.outcomeLabel} ${v.by}` : "" },
  ];
  const doneCols = [
    { key: "at", label: "Logged at", fmt: dt, csv: dtCsv },
    { key: "branchCode", label: "Branch" },
    { key: "loanNo", label: "Loan No" },
    { key: "custNo", label: "Cust No" },
    { key: "customer", label: "Customer" },
    { key: "typeLabel", label: "Type" },
    { key: "channelLabel", label: "Channel" },
    { key: "outcomeLabel", label: "Outcome" },
    { key: "ptpDate", label: "Promised by", fmt: dmyS },
    { key: "ptpAmountPaise", label: "Promised ₹", num: true, fmt: inrP },
    { key: "nextFollowUp", label: "Next follow-up", fmt: dmyS },
    { key: "nextTypeLabel", label: "Next type" },
    { key: "assignedName", label: "Assigned to" },
    { key: "remark", label: "Remark", fmt: v => <span style={{ whiteSpace: "normal", display: "inline-block", maxWidth: 320 }}>{v || "—"}</span> },
    { key: "by", label: "Logged by" },
  ];
  const ptpCols = [
    { key: "ptpDate", label: "Promised by", fmt: dmyS },
    { key: "ptp", label: "Status", fmt: v => <span className={"chip " + (v === "kept" ? "ok" : v === "broken" ? "bad" : "warn")}>{v}</span> },
    { key: "branchCode", label: "Branch" },
    { key: "loanNo", label: "Loan No" },
    { key: "customer", label: "Customer" },
    { key: "mobile", label: "Mobile" },
    { key: "ptpAmountPaise", label: "Promised ₹", num: true, fmt: inrP, total: "sum" },
    { key: "paidByPtpPaise", label: "Paid by then ₹", num: true, fmt: inrP, total: "sum" },
    { key: "at", label: "Promise taken", fmt: dt, csv: dtCsv },
    { key: "by", label: "Taken by" },
    { key: "channelLabel", label: "Channel" },
    { key: "remark", label: "Remark", fmt: v => <span style={{ whiteSpace: "normal", display: "inline-block", maxWidth: 320 }}>{v || "—"}</span> },
  ];
  const staffCols = [
    { key: "name", label: "Staff" },
    { key: "logged", label: "Follow-ups logged", num: true, total: "sum" },
    { key: "calls", label: "Calls", num: true, total: "sum" },
    { key: "visits", label: "Visits", num: true, total: "sum" },
    { key: "promises", label: "Promises taken", num: true, total: "sum" },
    { key: "kept", label: "Kept", num: true, total: "sum" },
    { key: "broken", label: "Broken", num: true, total: "sum" },
    { key: "dueAssigned", label: "Due assigned", num: true, total: "sum" },
    { key: "missed", label: "Missed", num: true, total: "sum" },
  ];
  const tabs = [["due", "Due", dueCols, "due", "No follow-ups fall due in this period."],
    ["done", "Done", doneCols, "done", "No follow-ups were logged in this period."],
    ["promises", "Promises", ptpCols, "promises", "No promises to pay fall in this period."],
    ["staff", "By staff", staffCols, "byStaff", "Nothing to tally in this period."]];
  const cur = tabs.find(t => t[0] === tab);
  const rows = data ? data[cur[3]] : [];
  const K = ({ n, l, tone }) => (
    <div className="card" style={{ padding: "12px 16px", minWidth: 120, flex: "1 1 120px" }}>
      <div className="mono" style={{ fontSize: 24, fontWeight: 900, color: tone || "var(--ink)" }}>{n}</div>
      <div style={{ fontSize: 11.5, color: "var(--mut)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 800 }}>{l}</div>
    </div>);

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Follow-up Register"
        subtitle="Who was contacted, what they promised, what fell due and who did the work — from the permanent follow-up log"
        csvDisabled={!data} onCsv={() => downloadCsv(`followups-${tab}.csv`, cur[2], rows)} />
      <Bar busy={busy} onRun={() => run(f)}>
        <StdFilters f={f} setF={setF} fyOptions={fyOptions} branches={branches} />
        <F label="Type" width={150}>
          <Sel value={f.type} onChange={type => setF({ ...f, type })} options={[["", "All types"], ...TYPES]} />
        </F>
        <F label="Channel" width={140}>
          <Sel value={f.channel} onChange={channel => setF({ ...f, channel })} options={[["", "All channels"], ...CHANNELS]} />
        </F>
        <F label="Staff" width={180}>
          <Sel value={f.staff} onChange={staff => setF({ ...f, staff })}
            options={[["", "Everyone"], ...staff.map(s => [String(s.id), s.name])]} />
        </F>
      </Bar>
      {data && (
        <div className="rpt-print" data-fu-register>
          <ScopeLine scope={data.scope} period={data} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <K n={data.kpis.due} l="Due in period" />
            <K n={data.kpis.missed} l="Missed" tone={data.kpis.missed ? "var(--bad)" : undefined} />
            <K n={data.kpis.unassigned} l="Unassigned" />
            <K n={data.kpis.done} l="Logged" tone="var(--ok)" />
            <K n={data.kpis.promises} l="Promises" />
            <K n={data.kpis.kept} l="Kept" tone="var(--ok)" />
            <K n={data.kpis.broken} l="Broken" tone={data.kpis.broken ? "var(--bad)" : undefined} />
          </div>
          <div className="rpt-noprint" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {tabs.map(([k, l, , key]) => <button key={k} type="button" className={"fu-pill" + (tab === k ? " on" : "")}
              onClick={() => setTab(k)} data-fu-rtab={k}>{l} · {data[key].length}</button>)}
          </div>
          <Tbl cols={cur[2]} rows={rows} empty={cur[4]} />
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the period and press <b>Run report</b>. The period applies to the due date, the logged date and the promised date respectively.</div>}
    </ReportFrame>
  );
}
