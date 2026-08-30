"use client";
import { useEffect, useMemo, useState } from "react";
import DateInput from "@/components/DateInput.js";
import { BUCKETS, METHODS, ageTone, daysToNextSlab } from "@/lib/overdue.js";
import TopNotice from "@/app/ui/TopNotice.js";

const I = { border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 10px",
  height: 42, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const F = { fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const PAGE = 25;

export default function OverdueClient() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [bucket, setBucket] = useState("all");
  const [qs, setQs] = useState("");
  const [scheme, setScheme] = useState("");
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [open, setOpen] = useState(null);        // loan id
  const [fu, setFu] = useState(null);            // follow-up draft
  const [histOpen, setHistOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const load = () => fetch("/api/overdue").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason))
    .catch(() => setErr("Could not load the worklist"));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(r =>
      (bucket === "all" || r.buckets.includes(bucket)) &&
      (!scheme || r.scheme === scheme) &&
      (!dayFrom || r.day >= Number(dayFrom)) &&
      (!dayTo || r.day <= Number(dayTo)) &&
      (!qs || (r.cust + " " + r.loanNo).toLowerCase().includes(qs.toLowerCase())));
  }, [data, bucket, qs, scheme, dayFrom, dayTo]);

  useEffect(() => { setShown(PAGE); }, [bucket, qs, scheme, dayFrom, dayTo]);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const anyFilter = bucket !== "all" || qs || scheme || dayFrom || dayTo;
  const clear = () => { setBucket("all"); setQs(""); setScheme(""); setDayFrom(""); setDayTo(""); };
  const counts = Object.fromEntries(BUCKETS.map(([k]) =>
    [k, k === "all" ? data.rows.length : data.rows.filter(r => r.buckets.includes(k)).length]));

  async function saveFu(row) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/overdue", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loanId: row.id, ...fu }) })
      .then(x => x.json()).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setFu(null); setOpen(null); load();
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-.3px", margin: "0 0 10px" }}>
        Overdue worklist <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)" }}>
          · {data.branch}</span></h1>

      {/* bucket pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {BUCKETS.map(([k, label]) => (
          <button key={k} onClick={() => setBucket(k)}
            style={{ border: "1px solid " + (bucket === k ? "var(--vault)" : "#cfc9ba"),
              background: bucket === k ? "var(--vault)" : "#fff",
              color: bucket === k ? "#fff" : "var(--mut)", fontWeight: 800,
              fontSize: 12.5, padding: "7px 13px", borderRadius: 99, cursor: "pointer",
              whiteSpace: "nowrap" }}>
            {label} · {counts[k]}</button>))}
      </div>

      {/* filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
        marginBottom: 14 }}>
        <input value={qs} onChange={e => setQs(e.target.value)}
          placeholder="🔍 Name or loan no…"
          style={{ ...I, flex: "0 1 200px", minWidth: 150, height: 34, fontSize: 12.5 }} />
        <select value={scheme} onChange={e => setScheme(e.target.value)}
          style={{ ...I, height: 34, fontSize: 12, fontWeight: 700 }}>
          <option value="">All schemes</option>
          {data.schemes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#fff",
          border: "1px solid #cfc9ba", borderRadius: 9, padding: "0 8px", height: 34 }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em",
            textTransform: "uppercase", color: "var(--mut)" }}>Loan day</span>
          <input value={dayFrom} onChange={e => setDayFrom(e.target.value.replace(/\D/g, ""))}
            placeholder="from" inputMode="numeric"
            style={{ width: 42, border: 0, fontSize: 12, outline: "none",
              fontFamily: "ui-monospace,monospace", background: "none" }} />
          <span style={{ color: "#cfc9ba", fontWeight: 700 }}>–</span>
          <input value={dayTo} onChange={e => setDayTo(e.target.value.replace(/\D/g, ""))}
            placeholder="to" inputMode="numeric"
            style={{ width: 42, border: 0, fontSize: 12, outline: "none",
              fontFamily: "ui-monospace,monospace", background: "none" }} />
        </div>
        {anyFilter &&
          <button onClick={clear} style={{ border: "1px solid #cfc9ba", background: "#fff",
            color: "var(--mut)", fontWeight: 800, fontSize: 11.5, padding: "0 11px",
            height: 34, borderRadius: 99, cursor: "pointer" }}>✕ clear</button>}
        <span style={{ color: "var(--mut)", fontSize: 11.5, fontWeight: 700 }}>
          {filtered.length} loan{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {err && <div style={{ marginBottom: 10 }}><span className="chip bad">{err}</span></div>}
      <TopNotice notice={err} onClose={() => setErr(null)} />

      {/* rows */}
      {filtered.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {filtered.slice(0, shown).map(r => {
            const isOpen = open === r.id;
            const slabIn = daysToNextSlab(r.day, r.slabs);
            const toTenure = r.tenureDays - r.day;
            const tone = ageTone(r.day, r.tenureDays);
            return (
              <div key={r.id} style={{ borderBottom: "1px solid #efece3" }}>
                <button onClick={() => { setOpen(isOpen ? null : r.id); setHistOpen(false);
                    setFu({ method: "", outcome: "", ptpDate: "", nextFollowUp: "",
                      narration: "" }); setErr(null); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px", border: 0, background: isOpen ? "#faf9f4" : "#fff",
                    cursor: "pointer", textAlign: "left" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5, whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis" }}>{r.cust}</div>
                    <div className="mono" style={{ color: "var(--mut)", fontSize: 11,
                      marginTop: 1, whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis" }}>
                      {r.loanNo} · {r.scheme}</div>
                  </div>
                  {slabIn !== null && slabIn <= 5 && toTenure >= 0 &&
                    <span className="chip warn" style={{ fontSize: 10.5, flexShrink: 0 }}>
                      slab in {slabIn}d</span>}
                  {r.lastCall?.nextFollowUp && String(r.lastCall.nextFollowUp) <= data.today &&
                    <span className="chip warn" style={{ fontSize: 10.5, flexShrink: 0 }}>
                      follow-up due</span>}
                  <span className="mono" style={{ fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                    {inr(r.outstandingPaise)}</span>
                  <span className={"chip mono " + tone} style={{ fontSize: 11, flexShrink: 0 }}>
                    Day {r.day}{toTenure < 0 ? ` · ${-toTenure}d past` : ""}</span>
                  <span style={{ color: "#a9a495", fontSize: 11, flexShrink: 0 }}>
                    {isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && fu && (
                  <div style={{ padding: "2px 12px 12px", background: "#faf9f4" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11.5, color: "var(--mut)", fontWeight: 700 }}>
                        tenure {r.tenureDays}d · {toTenure >= 0
                          ? `${toTenure} day${toTenure === 1 ? "" : "s"} to tenure`
                          : `${-toTenure} day${-toTenure === 1 ? "" : "s"} past tenure`}</span>
                      {r.noticeCount > 0 &&
                        <span className="chip" style={{ background: "#e3eef8", color: "#22608f",
                          fontSize: 11 }}>notice level {r.noticeTop} · {r.noticeCount} sent</span>}
                    </div>

                    {/* follow-up form */}
                    {data.canSave && (
                      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap",
                        alignItems: "flex-end" }}>
                        <div style={{ flex: "0 0 158px", minWidth: 140 }}>
                          <div style={F}>Follow-up method</div>
                          <select style={{ ...I, width: "100%" }} value={fu.method}
                            onChange={e => setFu({ ...fu, method: e.target.value })}>
                            <option value="">—</option>
                            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: "0 0 190px", minWidth: 160 }}>
                          <div style={F}>Outcome</div>
                          <select style={{ ...I, width: "100%" }} value={fu.outcome}
                            onChange={e => setFu({ ...fu, outcome: e.target.value })}>
                            <option value="">—</option>
                            {data.outcomes.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div style={{ flex: "0 0 148px", minWidth: 135 }}>
                          <div style={F}>Promise to pay</div>
                          <DateInput min={data.today} value={fu.ptpDate}
                            onChange={v => setFu({ ...fu, ptpDate: v })}
                            style={{ ...I, width: "100%", fontFamily: "ui-monospace,monospace",
                              fontSize: 13 }} />
                        </div>
                        <div style={{ flex: "0 0 148px", minWidth: 135 }}>
                          <div style={F}>Next follow-up</div>
                          <DateInput min={data.today} value={fu.nextFollowUp}
                            onChange={v => setFu({ ...fu, nextFollowUp: v })}
                            style={{ ...I, width: "100%", fontFamily: "ui-monospace,monospace",
                              fontSize: 13 }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 170 }}>
                          <div style={F}>Narration</div>
                          <input value={fu.narration}
                            onChange={e => setFu({ ...fu, narration: e.target.value })}
                            placeholder="What was discussed, commitments, context…"
                            style={{ ...I, width: "100%" }} />
                        </div>
                        <button className="btn" disabled={busy || !fu.method || !fu.outcome}
                          style={{ height: 42, flexShrink: 0 }}
                          onClick={() => saveFu(r)}>
                          {busy ? "Saving…" : "Save follow-up"}</button>
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: "#a9a495", minWidth: 0 }}>
                        {r.lastCall
                          ? `last: ${String(r.lastCall.at).slice(0, 10)} · ${r.lastCall.method || ""} · ${r.lastCall.outcome}${r.lastCall.ptpDate ? " · PTP " + r.lastCall.ptpDate : ""} · ${r.lastCall.by}`
                          : "no follow-up recorded yet"}</div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button onClick={() => setHistOpen(!histOpen)} className="btn ghost"
                          style={{ padding: "8px 13px", fontSize: 12.5 }}>
                          {histOpen ? "Hide history" : `History · ${r.history.length}`}</button>
                        <a href={`/repay/${r.id}`} className="btn ghost"
                          style={{ padding: "8px 13px", fontSize: 12.5, textDecoration: "none",
                            borderColor: "var(--vault)", color: "var(--vault)" }}>Collect →</a>
                      </div>
                    </div>

                    {histOpen && (
                      <div style={{ marginTop: 10, border: "1px solid var(--line)",
                        borderRadius: 12, background: "#fff", padding: "2px 14px" }}>
                        {r.history.length === 0 &&
                          <div style={{ padding: "10px 0", fontSize: 12, color: "var(--mut)" }}>
                            Nothing recorded yet.</div>}
                        {r.history.map((h, i) => (
                          <div key={i} style={{ display: "flex", gap: 10,
                            alignItems: "flex-start", padding: "9px 0",
                            borderBottom: "1px solid #efece3" }}>
                            <span className="mono" style={{ fontSize: 11.5, color: "var(--mut)",
                              flex: "0 0 84px", paddingTop: 2 }}>
                              {String(h.at).slice(0, 10)}</span>
                            <span className={"chip " + (h.kind === "notice" ? "" : "mut")}
                              style={h.kind === "notice"
                                ? { background: "#e3eef8", color: "#22608f", fontSize: 10.5 }
                                : { fontSize: 10.5 }}>
                              {h.kind === "notice" ? `notice L${h.level}` : h.method || "call"}</span>
                            <span style={{ fontSize: 12.5, color: "#4a4d42", minWidth: 0,
                              lineHeight: 1.5 }}>
                              {h.kind === "notice"
                                ? `sent by ${h.channel}`
                                : <><b>{h.by}</b> · {h.outcome}
                                    {h.ptpDate ? ` · PTP ${h.ptpDate}` : ""}
                                    {h.nextFollowUp ? ` · next ${h.nextFollowUp}` : ""}
                                    {h.note ? ` — ${h.note}` : ""}</>}</span>
                          </div>))}
                        <div style={{ padding: "8px 0", fontSize: 11, color: "#a9a495" }}>
                          Full ledger — every call, notice and saved follow-up stays on the loan
                          for audit.</div>
                      </div>
                    )}
                  </div>
                )}
              </div>);
          })}
        </div>
      ) : (
        <div style={{ border: "1px dashed #cfc9ba", borderRadius: 12, background: "#fff",
          padding: "22px 16px", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>No loans match</div>
          <div style={{ color: "var(--mut)", fontSize: 12, marginTop: 4 }}>
            {data.rows.length === 0
              ? "This branch has no active loans."
              : "Nothing in this bucket with these filters."}</div>
          {anyFilter &&
            <button onClick={clear} className="btn ghost" style={{ marginTop: 10 }}>
              Search all queues — clear filters</button>}
        </div>
      )}

      {filtered.length > shown && (
        <button onClick={() => setShown(shown + PAGE)}
          style={{ marginTop: 12, width: "100%", border: "1px dashed #cfc9ba",
            background: "#fff", color: "var(--mut)", fontWeight: 800, fontSize: 13,
            padding: 13, borderRadius: 12, cursor: "pointer" }}>
          Show more · {filtered.length - shown} remaining</button>)}
    </div>
  );
}
