"use client";
import { useState } from "react";
import DateInput from "@/components/DateInput.js";
import { ReportFrame, ReportHeader, Bar, F, Sel, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, dmyS } from "../shared.js";

export default function DayBookClient({ branches }) {
  const [f, setF] = useState({ branch: String(branches[0]?.id ?? ""), date: "" });
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/daybook");

  const cols = [
    { key: "t", label: "Time", fmt: v => new Date(v).toLocaleTimeString("en-IN",
        { hour: "2-digit", minute: "2-digit", hour12: true }) },
    { key: "kind", label: "Entry" },
    { key: "ref", label: "Ref" },
    { key: "particulars", label: "Particulars", fmt: v => <span style={{ whiteSpace: "normal",
        maxWidth: 300, display: "inline-block" }}>{v}</span>, csv: v => v },
    { key: "mode", label: "Mode" },
    { key: "account", label: "Account", fmt: v => v || "—" },
    { key: "utr", label: "UTR" },
    { key: "by", label: "By" },
    { key: "inPaise", label: "In ₹", num: true, fmt: v => v ? inrP(v) : "—", total: "sum" },
    { key: "outPaise", label: "Out ₹", num: true, fmt: v => v ? inrP(v) : "—", total: "sum" },
    { key: "cashBalancePaise", label: "Cash Balance ₹", num: true,
      fmt: v => v == null ? "—" : <b>{inrP(v)}</b>, csv: v => v == null ? "" : (v / 100).toFixed(2) },
  ];

  const D = data?.day;
  const fact = (label, v, tone) => (
    <div key={label} style={{ minWidth: 130 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase",
        letterSpacing: ".07em", color: "var(--mut)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 900,
        color: tone || "var(--ink)" }}>{v}</div>
    </div>);

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="DayBook"
        subtitle="One branch, one day — every rupee in and out, with the running cash balance"
        csvDisabled={!data} onCsv={() => downloadCsv("daybook.csv", cols, data.moves)} />
      <Bar busy={busy} onRun={() => run(f)}>
        <F label="Branch" width={190}>
          <Sel value={f.branch} onChange={branch => setF({ ...f, branch })}
            options={branches.map(b => [String(b.id), `${b.code} · ${b.name}`])} />
        </F>
        <F label="Date" width={150}>
          <DateInput value={f.date} onChange={date => setF({ ...f, date })} />
        </F>
      </Bar>
      {data && (
        <div className="rpt-print">
          <ScopeLine scope={data.scope} asOn={data.date} />
          <div className="card" style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 14 }}>
            {D ? (<>
              {fact("Opening cash", inrP(D.openingPaise))}
              {fact("Day begun by", D.begunBy || "—")}
              {fact("Closing cash (live)", inrP(data.closingCashPaise))}
              {D.endSigned ? (<>
                {fact("Day-end expected", inrP(D.endExpectedPaise))}
                {fact("Counted", inrP(D.endCountedPaise))}
                {fact("Variance", inrP(D.variancePaise),
                  Number(D.variancePaise) === 0 ? "var(--ok)" : "var(--bad)")}
                {fact("Signed off by", D.endedBy || "—")}
              </>) : fact("Day-end", "not signed yet", "var(--warn)")}
            </>) : (
              <span className="chip warn">No day-begin was signed at this branch on this date —
                movements below are shown against an opening of ₹0</span>)}
          </div>
          <Tbl cols={cols} rows={data.moves} empty="No money moved on this day." />
          {data.accounts.length > 0 && (<>
            <h2 style={{ fontSize: 14, fontWeight: 900, margin: "18px 0 8px" }}>
              Non-cash, per SLF account</h2>
            <Tbl cols={[
              { key: "account", label: "Account" },
              { key: "inPaise", label: "Received ₹", num: true, fmt: inrP, total: "sum" },
              { key: "outPaise", label: "Paid Out ₹", num: true, fmt: inrP, total: "sum" },
            ]} rows={data.accounts} />
          </>)}
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the branch and date, then press <b>Run report</b>. Leaving the date blank reads today.</div>}
    </ReportFrame>
  );
}
