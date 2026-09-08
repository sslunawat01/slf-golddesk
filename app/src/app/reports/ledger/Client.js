"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, StdFilters, F, Sel, Tbl, ScopeLine,
         downloadCsv, useReport, inrP, dmyS } from "../shared.js";

export default function LedgerClient({ fyOptions, fyCurrent, branches }) {
  const [f, setF] = useState({ fy: fyCurrent, from: "", to: "", branch: "all", head: "" });
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/ledger");

  const sumCols = [
    { key: "head", label: "Account Head" },
    { key: "entries", label: "Entries", num: true, total: "sum" },
    { key: "drPaise", label: "Debits ₹", num: true, fmt: inrP, total: "sum" },
    { key: "crPaise", label: "Credits ₹", num: true, fmt: inrP, total: "sum" },
    { key: "netPaise", label: "Net (Dr − Cr) ₹", num: true,
      fmt: v => <b style={{ color: v < 0 ? "var(--ok)" : undefined }}>{inrP(v)}</b> },
  ];
  const detCols = [
    { key: "date", label: "Date", fmt: dmyS },
    { key: "ref", label: "Ref" },
    { key: "particulars", label: "Particulars", fmt: v => <span style={{ whiteSpace: "normal",
        maxWidth: 320, display: "inline-block" }}>{v}</span>, csv: v => v },
    { key: "drPaise", label: "Debit ₹", num: true, fmt: v => v ? inrP(v) : "—", total: "sum" },
    { key: "crPaise", label: "Credit ₹", num: true, fmt: v => v ? inrP(v) : "—", total: "sum" },
    { key: "balancePaise", label: "Running ₹", num: true, fmt: v => <b>{inrP(v)}</b>,
      csv: v => (v / 100).toFixed(2) },
  ];

  const heads = data?.summary?.map(s => s.head) || [];

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Ledger Report"
        subtitle="Account heads with Dr/Cr entries derived from the stored money facts — cash basis, v1"
        csvDisabled={!data}
        onCsv={() => data.detail
          ? downloadCsv(`ledger-${data.head}.csv`, detCols, data.detail)
          : downloadCsv("ledger-summary.csv", sumCols, data.summary)} />
      <Bar busy={busy} onRun={() => run(f)}>
        <StdFilters f={f} setF={setF} fyOptions={fyOptions} branches={branches} />
        <F label="Account head (for the entry list)" width={210}>
          <Sel value={f.head} onChange={head => setF({ ...f, head })}
            options={[["", "Summary of all heads"],
              ...(heads.length ? heads : ["Cash in hand", "Gold loan principal", "Interest income",
                "Penal income", "Charges income", "Rounding income", "GST payable"]).map(h => [h, h])]} />
        </F>
      </Bar>
      {data && (
        <div className="rpt-print">
          <ScopeLine scope={data.scope} period={data} />
          <div className="rpt-noprint" style={{ marginBottom: 10 }}>
            <span className="chip warn">{data.basis}</span>
          </div>
          {data.detail ? (<>
            <h2 style={{ fontSize: 15, fontWeight: 900, margin: "0 0 8px" }}>{data.head}</h2>
            <Tbl cols={detCols} rows={data.detail} empty="No entries for this head in the period." />
          </>) : (
            <Tbl cols={sumCols} rows={data.summary} empty="No money moved in this period." />)}
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Choose the period and press <b>Run report</b>. Pick an account head to see its
        entry-by-entry list with a running balance.</div>}
    </ReportFrame>
  );
}
