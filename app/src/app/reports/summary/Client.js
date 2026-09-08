"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, StdFilters, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, gm } from "../shared.js";

export default function SummaryClient({ fyOptions, fyCurrent, branches }) {
  const [f, setF] = useState({ fy: fyCurrent, from: "", to: "", branch: "all" });
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/summary");

  const cols = [
    { key: "branch", label: "Branch" },
    { key: "disbursedCount", label: "Loans Disb", num: true, total: "sum" },
    { key: "disbursedPaise", label: "Disb ₹", num: true, fmt: inrP, total: "sum" },
    { key: "disbursedGrams", label: "Disb Gold", num: true, fmt: gm, csv: v => v },
    { key: "closedCount", label: "Closed", num: true, total: "sum" },
    { key: "closedPaise", label: "Closed ₹", num: true, fmt: inrP, total: "sum" },
    { key: "activeCount", label: "Active", num: true, total: "sum" },
    { key: "activePrincipalPaise", label: "Principal O/s ₹", num: true, fmt: inrP, total: "sum" },
    { key: "activeInterestPaise", label: "Interest Due ₹", num: true, fmt: inrP, total: "sum" },
    { key: "activeChargesPaise", label: "Penal+Chg Due ₹", num: true, fmt: inrP, total: "sum" },
    { key: "activeTotalDuePaise", label: "TOTAL DUE ₹", num: true,
      fmt: (v) => <b>{inrP(v)}</b>, total: "sum" },
    { key: "goldGrams", label: "Gold Held", num: true, fmt: gm, csv: v => v },
    { key: "overdueCount", label: "Overdue", num: true, total: "sum" },
    { key: "overduePrincipalPaise", label: "Overdue ₹", num: true, fmt: inrP, total: "sum" },
    { key: "appsStarted", label: "Apps Started", num: true, total: "sum" },
    { key: "appsApproved", label: "Approved", num: true, total: "sum" },
    { key: "appsCancelled", label: "Cancelled", num: true, total: "sum" },
    { key: "receiptCount", label: "Receipts", num: true, total: "sum" },
    { key: "collectedPaise", label: "Collected ₹", num: true, fmt: inrP, total: "sum" },
    { key: "cashPaise", label: "Cash ₹", num: true, fmt: inrP, total: "sum" },
    { key: "upiPaise", label: "UPI ₹", num: true, fmt: inrP, total: "sum" },
    { key: "bankPaise", label: "Bank ₹", num: true, fmt: inrP, total: "sum" },
    { key: "interestCollectedPaise", label: "Int Collected ₹", num: true, fmt: inrP, total: "sum" },
    { key: "penalCollectedPaise", label: "Penal Coll ₹", num: true, fmt: inrP, total: "sum" },
    { key: "chargesCollectedPaise", label: "Chg Collected ₹", num: true, fmt: inrP, total: "sum" },
    { key: "principalCollectedPaise", label: "Prin Collected ₹", num: true, fmt: inrP, total: "sum" },
  ];

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Branch Loan Summary"
        subtitle="Business written, live book as on today, applications and collections — one line per branch"
        csvDisabled={!data} onCsv={() => downloadCsv("branch-loan-summary.csv", cols, data.rows)} />
      <Bar busy={busy} onRun={() => run(f)}>
        <StdFilters f={f} setF={setF} fyOptions={fyOptions} branches={branches} />
      </Bar>
      {data && (
        <div className="rpt-print">
          <ScopeLine scope={data.scope} period={data} />
          <Tbl cols={cols} rows={data.rows} />
          <p className="hint" style={{ marginTop: 8 }}>
            Disbursed / closed / applications / collections belong to the chosen period.
            Active, overdue, gold-held and due figures are as on today, from the engine replay.</p>
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the period and press <b>Run report</b>.</div>}
    </ReportFrame>
  );
}
