"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, StdFilters, F, Sel, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, dmyS } from "../shared.js";

export default function RepayClient({ fyOptions, fyCurrent, branches, accounts }) {
  const [f, setF] = useState({ fy: fyCurrent, from: "", to: "", branch: "all",
    mode: "", account: "", closes: "" });
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/repay");

  const cols = [
    { key: "receiptNo", label: "Receipt No" },
    { key: "onDate", label: "Date", fmt: dmyS },
    { key: "branch", label: "Branch" },
    { key: "loanNo", label: "Loan No" },
    { key: "custNo", label: "Cust No" },
    { key: "customer", label: "Customer" },
    { key: "mobile", label: "Mobile" },
    { key: "mode", label: "Mode", fmt: (v, r) => v === "cash" ? "cash"
        : `${v}${r.slfAccount ? " → " + r.slfAccount : ""}`, csv: v => v },
    { key: "utr", label: "UTR / Ref" },
    { key: "amountPaise", label: "Amount ₹", num: true, fmt: v => <b>{inrP(v)}</b>, total: "sum" },
    { key: "chargePaise", label: "To Charges ₹", num: true, fmt: inrP, total: "sum" },
    { key: "roundingPaise", label: "To Rounding ₹", num: true, fmt: inrP, total: "sum" },
    { key: "penalPaise", label: "To Penal ₹", num: true, fmt: inrP, total: "sum" },
    { key: "interestPaise", label: "To Interest ₹", num: true, fmt: inrP, total: "sum" },
    { key: "principalPaise", label: "To Principal ₹", num: true, fmt: inrP, total: "sum" },
    { key: "closesLoan", label: "Settles", fmt: v => v ? "✓ closes loan" : "—", csv: v => v ? "yes" : "no" },
    { key: "receivedBy", label: "Received By" },
  ];

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Loan Repay Register"
        subtitle="Every receipt with its stored appropriation split — charges → penal → interest → principal"
        csvDisabled={!data} onCsv={() => downloadCsv("repay-register.csv", cols, data.rows)} />
      <Bar busy={busy} onRun={() => run(f)}>
        <StdFilters f={f} setF={setF} fyOptions={fyOptions} branches={branches} />
        <F label="Mode" width={120}>
          <Sel value={f.mode} onChange={mode => setF({ ...f, mode })}
            options={[["", "All modes"], ["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"]]} />
        </F>
        <F label="SLF account" width={170}>
          <Sel value={f.account} onChange={account => setF({ ...f, account })}
            options={[["", "All accounts"], ...accounts.map(a => [String(a.id), a.nickname])]} />
        </F>
        <F label="Show" width={150}>
          <Sel value={f.closes} onChange={closes => setF({ ...f, closes })}
            options={[["", "All receipts"], ["1", "Settlements only"]]} />
        </F>
      </Bar>
      {data && (
        <div className="rpt-print">
          <ScopeLine scope={data.scope} period={data} />
          <Tbl cols={cols} rows={data.rows} empty="No receipts in this period." />
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the period and press <b>Run report</b>.</div>}
    </ReportFrame>
  );
}
