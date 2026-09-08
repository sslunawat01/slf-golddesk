"use client";
/**
 * Reports — shared client pieces (E27, owner order 8 Sep 2026).
 * Every report screen composes these: a filter bar (FY · dates · branch ·
 * report-specific extras · Run), a results table with a totals row, CSV
 * download and a print button that prints ONLY the report region.
 */
import { useState } from "react";
import DateInput from "@/components/DateInput.js";
import TopNotice from "@/app/ui/TopNotice.js";
import { dmy } from "@/lib/format.js";

export const inrP = (paise) => paise == null ? "—" : "₹" + Math.round(Number(paise) / 100).toLocaleString("en-IN");
export const dmyS = (iso) => iso ? dmy(String(iso).slice(0, 10)) : "—";
export const gm = (g) => g == null ? "—" : Number(g).toLocaleString("en-IN", { maximumFractionDigits: 3 }) + " g";

/* ——— layout ——— */

export function ReportHeader({ title, subtitle, onCsv, csvDisabled }) {
  return (
    <div className="rpt-noprint" style={{ display: "flex", justifyContent: "space-between",
      alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
      <div>
        <a href="/reports" style={{ fontSize: 12.5, fontWeight: 800, color: "var(--mut)",
          textDecoration: "none" }}>← All reports</a>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: "4px 0 0" }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: "var(--mut)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn ghost" disabled={csvDisabled} onClick={onCsv}>⬇ CSV</button>
        <button className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
      </div>
    </div>
  );
}

export function Bar({ children, onRun, busy }) {
  return (
    <div className="card rpt-noprint" style={{ display: "flex", gap: 14, flexWrap: "wrap",
      alignItems: "flex-end", marginBottom: 16 }}>
      {children}
      <button className="btn green" disabled={busy} onClick={onRun}
        style={{ height: 40, minWidth: 110 }}>{busy ? "…" : "Run report"}</button>
    </div>
  );
}

export function F({ label, children, width = 170 }) {
  return (
    <div style={{ minWidth: width }}>
      <label className="f">{label}</label>
      {children}
    </div>
  );
}

export function Sel({ value, onChange, options, style }) {
  return (
    <select className="i" value={value} onChange={e => onChange(e.target.value)}
      style={{ height: 40, ...style }}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

/** The standard filter head: FY · from · to · branch. */
export function StdFilters({ f, setF, fyOptions, branches, showDates = true }) {
  return (<>
    <F label="Financial year" width={130}>
      <Sel value={f.fy} onChange={fy => setF({ ...f, fy, from: "", to: "" })}
        options={fyOptions.map(o => [o, `FY ${o}`])} />
    </F>
    {showDates && <>
      <F label="From (within FY)" width={150}>
        <DateInput value={f.from} onChange={from => setF({ ...f, from })} /></F>
      <F label="To" width={150}>
        <DateInput value={f.to} onChange={to => setF({ ...f, to })} /></F>
    </>}
    <F label="Branch" width={190}>
      <Sel value={f.branch} onChange={branch => setF({ ...f, branch })}
        options={[...(branches.length > 1 ? [["all", "All my branches"]] : []),
          ...branches.map(b => [String(b.id), `${b.code} · ${b.name}`])]} />
    </F>
  </>);
}

/* ——— results ——— */

const TH = { padding: "9px 10px", fontSize: 10.5, textAlign: "left", whiteSpace: "nowrap",
  textTransform: "uppercase", letterSpacing: ".07em", color: "var(--mut)",
  borderBottom: "2px solid var(--line)", background: "#f0eee6" };
const TD = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #efece3",
  whiteSpace: "nowrap", verticalAlign: "top" };

/**
 * cols: [{ key, label, num?:bool, fmt?:(v,row)=>node, total?:"sum"|"count" }]
 */
export function Tbl({ cols, rows, empty = "Nothing in this period." }) {
  const totals = cols.map(c => c.total === "sum"
    ? rows.reduce((a, r) => a + Number(r[c.key] || 0), 0)
    : c.total === "count" ? rows.length : null);
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
        <thead><tr>
          {cols.map((c, i) => <th key={c.id || c.key || i} style={{ ...TH, textAlign: c.num ? "right" : "left" }}>{c.label}</th>)}
        </tr></thead>
        <tbody>
          {rows.length === 0 &&
            <tr><td colSpan={cols.length} style={{ ...TD, color: "var(--mut)", padding: 16 }}>{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c, ci) => (
                <td key={c.id || c.key || ci} className={c.num ? "mono" : undefined}
                  style={{ ...TD, textAlign: c.num ? "right" : "left" }}>
                  {c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? "—")}
                </td>))}
            </tr>))}
        </tbody>
        {rows.length > 0 && cols.some(c => c.total) && (
          <tfoot><tr>
            {cols.map((c, i) => (
              <td key={c.id || c.key || i} className="mono" style={{ ...TD, fontWeight: 900,
                borderTop: "2px solid var(--line)", background: "#faf8f2",
                textAlign: c.num ? "right" : "left" }}>
                {i === 0 && !c.total ? `TOTAL · ${rows.length} row${rows.length === 1 ? "" : "s"}`
                  : c.total === "sum" ? (c.fmt ? c.fmt(totals[i]) : totals[i].toLocaleString("en-IN"))
                  : c.total === "count" ? totals[i] : ""}
              </td>))}
          </tr></tfoot>)}
      </table>
    </div>
  );
}

/** CSV from the same cols/rows the table shows (raw values, rupees not paise). */
export function downloadCsv(name, cols, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const val = (c, r) => {
    const v = r[c.key];
    if (v == null) return "";
    if (c.csv) return c.csv(v, r);
    if (/Paise$/.test(c.key)) return (Number(v) / 100).toFixed(2);
    return v;
  };
  const lines = [cols.map(c => esc(c.label)).join(",")]
    .concat(rows.map(r => cols.map(c => esc(val(c, r))).join(",")));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Wrap the whole report screen: print CSS prints ONLY .rpt-print. */
export function ReportFrame({ children, notice, onCloseNotice }) {
  return (
    <div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .rpt-print, .rpt-print * { visibility: visible !important; }
        .rpt-print { position: absolute; top: 0; left: 0; width: 100%; }
        .rpt-noprint { display: none !important; }
        .card { box-shadow: none !important; border: 1px solid #ccc; }
      }`}</style>
      <TopNotice notice={notice} onClose={onCloseNotice} />
      {children}
    </div>
  );
}

/** One line of context that also prints: scope + period + printed-at stamp. */
export function ScopeLine({ scope, period, asOn }) {
  return (
    <div style={{ fontSize: 12.5, color: "var(--mut)", margin: "0 0 10px", fontWeight: 700 }}>
      {scope && <>Branch scope: <b style={{ color: "var(--ink)" }}>{scope}</b></>}
      {period && <> · Period: <b style={{ color: "var(--ink)" }}>{dmyS(period.from)} – {dmyS(period.to)}</b></>}
      {asOn && <> · As on <b style={{ color: "var(--ink)" }}>{dmyS(asOn)}</b></>}
      <> · Printed {new Date().toLocaleString("en-IN", { hour12: true })}</>
    </div>
  );
}

/** Shared fetch: GET an API with query params, funnel refusals to the notice. */
export function useReport(endpoint) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  async function run(params) {
    setBusy(true); setNotice(null);
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
    const r = await fetch(`${endpoint}?${qs}`).then(async res =>
      (await res.json().catch(() => null)) ?? { ok: false, reason: `Server error ${res.status}` })
      .catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setNotice({ tone: "bad", text: r.reason }); setData(null); return; }
    setData(r);
  }
  return { data, busy, notice, setNotice, run };
}
