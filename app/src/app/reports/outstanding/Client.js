"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, StdFilters, F, Sel, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, dmyS, gm } from "../shared.js";

export default function OutstandingClient({ fyOptions, fyCurrent, branches, schemes }) {
  const [f, setF] = useState({ fy: fyCurrent, from: "", to: "", branch: "all",
    scheme: "", overdue: "" });
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/outstanding");

  const cols = [
    { key: "branch", label: "Branch" },
    { key: "loanNo", label: "Loan No" },
    { key: "disbursedAt", label: "Disbursed", fmt: dmyS },
    { key: "ageDays", label: "Day", num: true,
      fmt: (v, r) => <span>{v}{r.overdue && <span className="chip bad" style={{ marginLeft: 6, fontSize: 10 }}>overdue</span>}</span>,
      csv: (v) => v },
    { key: "custNo", label: "Cust No" },
    { key: "customer", label: "Customer" },
    { key: "mobile", label: "Mobile" },
    { key: "scheme", label: "Scheme" },
    { key: "netGrams", label: "Net Gold", num: true, fmt: gm, csv: v => v },
    { key: "sanctionedPaise", label: "Sanctioned ₹", num: true, fmt: inrP, total: "sum" },
    { key: "principalPaise", label: "Principal O/s ₹", num: true, fmt: inrP, total: "sum" },
    { key: "interestPaise", label: "Interest Due ₹", num: true, fmt: inrP, total: "sum" },
    { key: "penalPaise", label: "Penal Due ₹", num: true, fmt: inrP, total: "sum" },
    { key: "chargesPaise", label: "Charges Due ₹", num: true, fmt: inrP, total: "sum" },
    { key: "totalDuePaise", label: "TOTAL DUE ₹", num: true,
      fmt: (v) => <b>{inrP(v)}</b>, total: "sum" },
    { key: "lastPaidOn", label: "Last Paid", fmt: dmyS },
    { key: "lastPaidPaise", label: "Last Amt ₹", num: true, fmt: inrP },
  ];

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Outstanding Amount Report"
        subtitle="Every active loan priced today by the engine — principal + interest + penal + charges = total due"
        csvDisabled={!data} onCsv={() => downloadCsv("outstanding.csv", cols, data.rows)} />
      <Bar busy={busy} onRun={() => run({ branch: f.branch, scheme: f.scheme, overdue: f.overdue })}>
        <F label="Branch" width={190}>
          <Sel value={f.branch} onChange={branch => setF({ ...f, branch })}
            options={[...(branches.length > 1 ? [["all", "All my branches"]] : []),
              ...branches.map(b => [String(b.id), `${b.code} · ${b.name}`])]} />
        </F>
        <F label="Scheme" width={140}>
          <Sel value={f.scheme} onChange={scheme => setF({ ...f, scheme })}
            options={[["", "All schemes"], ...schemes.map(s => [s, s])]} />
        </F>
        <F label="Show" width={150}>
          <Sel value={f.overdue} onChange={overdue => setF({ ...f, overdue })}
            options={[["", "All active loans"], ["1", "Overdue only"]]} />
        </F>
      </Bar>
      {data && (
        <div className="rpt-print">
          <ScopeLine scope={data.scope} asOn={data.asOn} />
          <Tbl cols={cols} rows={data.rows} empty="No active loans in this scope." />
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the filters and press <b>Run report</b>.</div>}
    </ReportFrame>
  );
}
