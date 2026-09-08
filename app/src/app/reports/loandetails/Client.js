"use client";
import { useState } from "react";
import { ReportFrame, ReportHeader, Bar, F, Tbl, ScopeLine,
         useReport, inrP, dmyS, gm } from "../shared.js";

const dt = (v) => v ? new Date(v).toLocaleString("en-IN",
  { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

export default function LoanDetailsClient() {
  const [loanNo, setLoanNo] = useState("");
  const { data, busy, notice, setNotice, run } = useReport("/api/reports/loandetails");

  const L = data?.loan, P = data?.position;
  const fact = (label, v) => (
    <div key={label} style={{ minWidth: 150 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase",
        letterSpacing: ".07em", color: "var(--mut)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{v}</div>
    </div>);
  const H = ({ children }) => (
    <h2 style={{ fontSize: 14, fontWeight: 900, margin: "18px 0 8px" }}>{children}</h2>);

  return (
    <ReportFrame notice={notice} onCloseNotice={() => setNotice(null)}>
      <ReportHeader title="Loan Details"
        subtitle="The full dossier of one loan — ornaments to release, printable"
        csvDisabled onCsv={() => {}} />
      <Bar busy={busy} onRun={() => run({ loanNo })}>
        <F label="Loan number" width={240}>
          <input className="i mono" style={{ height: 40 }} value={loanNo}
            onChange={e => setLoanNo(e.target.value)} placeholder="e.g. 01A6702302"
            onKeyDown={e => { if (e.key === "Enter") run({ loanNo }); }} />
        </F>
      </Bar>
      {data && L && (
        <div className="rpt-print">
          <ScopeLine scope={L.branch} />
          <div className="card" style={{ borderLeft: "6px solid var(--vault3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 900 }}>{L.loanNo}</div>
                <div style={{ fontSize: 13.5, color: "var(--mut)" }}>
                  {L.custNo} · <b style={{ color: "var(--ink)" }}>{L.customer}</b> · {L.mobile}</div>
              </div>
              <span className={"chip " + (L.status === "active" ? "ok" : "mut")}
                style={{ alignSelf: "flex-start" }}>{L.status}</span>
            </div>
            <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginTop: 14 }}>
              {fact("Scheme", L.scheme)}
              {fact("Principal", inrP(L.principalPaise))}
              {fact("Disbursed", dmyS(L.disbursedAt))}
              {fact("Day today", L.ageDays)}
              {L.closedAt && fact("Closed", dt(L.closedAt))}
              {fact("Interest", L.terms.calc === "simple" ? `${L.terms.interestPct}% p.a.` : "slab rates")}
              {fact("Tenure", `${L.terms.tenureDays} days`)}
              {fact("Min interest", `${L.terms.minInterestDays} days`)}
              {fact("Penal", L.terms.penalRatePct
                ? `${L.terms.penalRatePct}% after ${L.terms.penalGraceDays}d grace` : "none")}
            </div>
          </div>

          {P && (<>
            <H>Position as on {dmyS(P.asOn)} — engine replay</H>
            <div className="card" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
              {fact("Principal outstanding", inrP(P.principalPaise))}
              {fact("Interest due", inrP(P.interestPaise))}
              {fact("Penal due", inrP(P.penalPaise))}
              {fact("Charges due", inrP(P.chargesPaise))}
              {fact("TOTAL DUE", <b>{inrP(P.totalDuePaise)}</b>)}
            </div>
          </>)}

          <H>Ornaments pledged</H>
          <Tbl cols={[
            { key: "item", label: "Item" }, { key: "karat", label: "Purity" },
            { key: "qty", label: "Qty", num: true, total: "sum" },
            { key: "grossMg", label: "Gross", num: true, fmt: v => gm(v / 1000), total: "sum",
              csv: v => (v / 1000).toFixed(3) },
            { key: "stoneMg", label: "Stone", num: true, fmt: v => gm(v / 1000), total: "sum",
              csv: v => (v / 1000).toFixed(3) },
            { key: "netMg", label: "Net", num: true, fmt: v => gm(v / 1000), total: "sum",
              csv: v => (v / 1000).toFixed(3) },
            { key: "marketPaise", label: "Market ₹", num: true, fmt: inrP, total: "sum" },
            { key: "fundingPaise", label: "Lendable ₹", num: true, fmt: inrP, total: "sum" },
          ]} rows={data.items} empty="No items on file." />

          <H>Disbursement</H>
          <Tbl cols={[
            { key: "on", label: "When", fmt: dt },
            { key: "kind", label: "Mode" },
            { key: "fromAccount", label: "From SLF Account", fmt: v => v || "—" },
            { key: "toAccount", label: "To Customer A/c", fmt: v => v || "cash in hand" },
            { key: "utr", label: "UTR" },
            { key: "by", label: "By" },
            { key: "amountPaise", label: "Amount ₹", num: true, fmt: inrP, total: "sum" },
          ]} rows={data.legs} empty="Not disbursed yet." />

          <H>Receipts & appropriation</H>
          <Tbl cols={[
            { key: "receiptNo", label: "Receipt No" },
            { key: "onDate", label: "Date", fmt: dmyS },
            { key: "mode", label: "Mode", fmt: (v, r) => r.slfAccount ? `${v} → ${r.slfAccount}` : v, csv: v => v },
            { key: "amountPaise", label: "Amount ₹", num: true, fmt: v => <b>{inrP(v)}</b>, total: "sum" },
            { id: "splitChg", key: "split", label: "To Charges ₹", num: true, fmt: s => inrP((s?.charge || 0) + (s?.charge_rounding || 0)), csv: s => (((s?.charge || 0) + (s?.charge_rounding || 0)) / 100).toFixed(2) },
            { id: "splitPen", key: "split", label: "To Penal ₹", num: true, fmt: s => inrP(s?.penal || 0), csv: s => ((s?.penal || 0) / 100).toFixed(2) },
            { id: "splitInt", key: "split", label: "To Interest ₹", num: true, fmt: s => inrP(s?.interest || 0), csv: s => ((s?.interest || 0) / 100).toFixed(2) },
            { id: "splitPrin", key: "split", label: "To Principal ₹", num: true, fmt: s => inrP(s?.principal || 0), csv: s => ((s?.principal || 0) / 100).toFixed(2) },
            { key: "sealsCycle", label: "Seals Cycle", fmt: v => v ? "✓" : "—", csv: v => v ? "yes" : "no" },
            { key: "closesLoan", label: "Settles", fmt: v => v ? "✓" : "—", csv: v => v ? "yes" : "no" },
            { key: "by", label: "Received By" },
          ]} rows={data.receipts} empty="No payments yet." />

          {data.charges.length > 0 && (<>
            <H>Charges raised</H>
            <Tbl cols={[
              { key: "name", label: "Charge" },
              { key: "addedOn", label: "Added", fmt: dmyS },
              { key: "basePaise", label: "Base ₹", num: true, fmt: inrP, total: "sum" },
              { key: "gstPaise", label: "GST ₹", num: true, fmt: inrP, total: "sum" },
              { key: "totalPaise", label: "Total ₹", num: true, fmt: inrP, total: "sum" },
              { key: "narration", label: "Narration" },
              { key: "removed", label: "", fmt: v => v ? <span className="chip bad">removed</span> : "", csv: v => v ? "removed" : "" },
            ]} rows={data.charges} />
          </>)}

          <H>File history</H>
          <Tbl cols={[
            { key: "at", label: "When", fmt: dt },
            { key: "fromState", label: "From", fmt: v => v || "—" },
            { key: "toState", label: "To" },
            { key: "by", label: "By", fmt: v => v || "—" },
            { key: "note", label: "Note", fmt: v => <span style={{ whiteSpace: "normal",
                maxWidth: 380, display: "inline-block" }}>{v || "—"}</span>, csv: v => v },
          ]} rows={data.history} empty="No history rows." />

          {data.custody.length > 0 && (<>
            <H>Gold custody</H>
            <Tbl cols={[
              { key: "at", label: "When", fmt: dt },
              { key: "direction", label: "Movement" },
              { key: "safe", label: "Safe", fmt: v => v || "—" },
              { key: "by", label: "By" },
            ]} rows={data.custody} />
          </>)}

          {data.release && (<>
            <H>Release</H>
            <div className="card" style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
              {fact("SLA clock from", dmyS(data.release.dueFrom))}
              {fact("Released", dt(data.release.releasedAt))}
              {fact("NOC No", data.release.nocNo || "—")}
              {fact("By", data.release.by || "—")}
            </div>
          </>)}
        </div>)}
      {!data && !busy && <div className="card" style={{ color: "var(--mut)", fontSize: 13.5 }}>
        Type a loan number and press <b>Run report</b>.</div>}
    </ReportFrame>
  );
}
