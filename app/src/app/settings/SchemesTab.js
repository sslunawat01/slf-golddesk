"use client";
import { useEffect, useState } from "react";
import SavedToast from "@/app/ui/SavedToast.js";
import { validSchemeVersion, slabSample } from "@/lib/masters.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 42, fontSize: 14, background: "#fff" };
const inr = (r) => "₹" + Math.round(Number(r || 0)).toLocaleString("en-IN");
const dmy = (d) => d ? String(d).split("-").reverse().join("-") : "—";

const STEPS = ["Identity", "Interest", "Charges", "Limits", "Review"];
// a draft version row → the wizard form (mirror of the server's toForm)
function rowToForm(v, slabs) {
  return {
    code: "", name: "",   // filled by the wizard from the scheme row
    calcMethod: v.calc_method, interestPct: v.interest_pct == null ? "" : Number(v.interest_pct),
    slabMode: v.slab_mode || "retroactive",
    slabs: (slabs || []).length
      ? slabs.map(s => ({ fromDay: Number(s.from_day), toDay: Number(s.to_day), ratePct: Number(s.rate_pct) }))
      : [{ fromDay: 1, toDay: "", ratePct: "" }],
    daysInYear: Number(v.days_in_year), minInterestDays: Number(v.min_interest_days),
    tenureDays: Number(v.tenure_days), penalRatePct: Number(v.penal_rate_pct),
    penalGraceDays: Number(v.penal_grace_days), fundingPct: Number(v.funding_pct),
    minLoanRs: Number(v.min_loan_paise) / 100, maxLoanRs: Number(v.max_loan_paise) / 100,
    docChargePct: Number(v.doc_charge_pct), docMinRs: Number(v.doc_charge_min_paise) / 100,
    docMaxRs: Number(v.doc_charge_max_paise) / 100,
    effectiveFrom: String(v.effective_from).slice(0, 10),
  };
}

const BLANK = { code: "", name: "", calcMethod: "", interestPct: "", slabMode: "retroactive",
  slabs: [{ fromDay: 1, toDay: "", ratePct: "" }, { fromDay: "", toDay: "", ratePct: "" }],
  daysInYear: 365, minInterestDays: 15, tenureDays: "", penalRatePct: 2, penalGraceDays: 7,
  fundingPct: "", minLoanRs: 5000, maxLoanRs: 1000000, docChargePct: 0, docMinRs: 0,
  docMaxRs: 0, effectiveFrom: new Date().toISOString().slice(0, 10) };

export default function SchemesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);      // scheme id being viewed
  const [wiz, setWiz] = useState(null);        // { schemeId|null, form, step }
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);   // №4: flashes the shared Saved banner
  const [daysDef, setDaysDef] = useState("365");

  const load = () => fetch("/api/settings/schemes").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason)).catch(() => setErr("Could not load schemes"));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (data?.daysDefault != null) setDaysDef(String(data.daysDefault)); },
    [data?.daysDefault]);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const versionsOf = (sid) => data.versions.filter(v => v.scheme_id === sid);
  const current = (sid) => versionsOf(sid).filter(v => v.status === "published").slice(-1)[0];
  const slabsOf = (vid) => data.slabs.filter(s => s.scheme_version_id === vid);
  const allocOf = (vid) => data.alloc.filter(a => a.scheme_version_id === vid).map(a => a.branch_id);

  async function post(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/schemes", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return null; }
    setSavedAt(Date.now());   // №4: every successful save announces itself
    return r;
  }

  // ————————————————————— the wizard —————————————————————
  if (wiz) return <Wizard data={data} wiz={wiz} setWiz={setWiz} post={post} busy={busy}
    err={err} setErr={setErr} reload={load} />;

  // ————————————————————— scheme detail —————————————————————
  if (open) {
    const sc = data.schemes.find(s => s.id === open);
    const vers = [...(versionsOf(open))].sort((a, b) => Number(b.version_no) - Number(a.version_no));
    const td = { padding: "9px 11px", borderBottom: "1px solid #efece3", fontSize: 13 };
    return (
      <>
        <button className="btn ghost" style={{ marginBottom: 12 }}
          onClick={() => setOpen(null)}>← all schemes</button>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>{sc.code}</h2>
              <p style={{ color: "var(--mut)", fontSize: 13.5, margin: "4px 0 0" }}>{sc.name}</p>
            </div>
            {data.canEdit && (
              <button className="btn" onClick={() => {
                const cur = current(open) || vers.slice(-1)[0];
                const sl = cur ? slabsOf(cur.id) : [];
                setWiz({ schemeId: open, versionId: null, step: 0, form: cur ? {
                  ...BLANK, code: sc.code, name: sc.name,
                  calcMethod: cur.calc_method,
                  interestPct: cur.interest_pct == null ? "" : Number(cur.interest_pct),
                  slabMode: cur.slab_mode,
                  slabs: sl.length ? sl.map(x => ({ fromDay: Number(x.from_day),
                    toDay: Number(x.to_day), ratePct: Number(x.rate_pct) })) : BLANK.slabs,
                  daysInYear: Number(cur.days_in_year), minInterestDays: Number(cur.min_interest_days),
                  tenureDays: Number(cur.tenure_days), penalRatePct: Number(cur.penal_rate_pct),
                  penalGraceDays: Number(cur.penal_grace_days), fundingPct: Number(cur.funding_pct),
                  minLoanRs: Number(cur.min_loan_paise) / 100, maxLoanRs: Number(cur.max_loan_paise) / 100,
                  docChargePct: Number(cur.doc_charge_pct), docMinRs: Number(cur.doc_charge_min_paise) / 100,
                  docMaxRs: Number(cur.doc_charge_max_paise) / 100,
                  effectiveFrom: new Date().toISOString().slice(0, 10),
                } : { ...BLANK, code: sc.code, name: sc.name } });
              }}>+ New version</button>
            )}
          </div>
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 900, margin: "18px 0 8px" }}>Version history</h3>
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead><tr style={{ background: "#f0eee6" }}>
              {["Version", "Runs from", "Runs until", "Terms", "Loans on it", "State", ""].map(h =>
                <th key={h} style={{ ...td, textAlign: "left", fontSize: 10.5,
                  textTransform: "uppercase", letterSpacing: ".07em" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vers.map(v => (
                <VersionRow key={v.id} v={v} td={td} data={data} slabsOf={slabsOf}
                  allocOf={allocOf} post={post} reload={load} busy={busy} err={err}
                  onEdit={() => setWiz({ schemeId: v.scheme_id, versionId: v.id, step: 0,
                    form: rowToForm(v, slabsOf(v.id)) })} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          A loan keeps the version it was sanctioned on for its whole life — superseded
          versions never disappear.</p>
        {err && <div style={{ marginTop: 10 }}><span className="chip bad">{err}</span></div>}
      </>
    );
  }

  // ————————————————————— the list —————————————————————
  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13.5 };
  return (
    <>
      <SavedToast when={savedAt} />
      {data.canEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="btn"
            onClick={() => setWiz({ schemeId: null, versionId: null, step: 0,
              form: { ...BLANK, daysInYear: data.daysDefault ?? 365 } })}>
            + New scheme</button>
        </div>)}
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr style={{ background: "#f0eee6" }}>
            {["Scheme", "Terms", "Min interest", "Calculation", "Version", ""].map(h =>
              <th key={h} style={{ ...td, textAlign: "left", fontSize: 11,
                textTransform: "uppercase", letterSpacing: ".07em" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.schemes.map(sc => {
              const cur = current(sc.id);
              return (
                <tr key={sc.id}>
                  <td style={{ ...td, fontWeight: 800 }}>{sc.code}
                    <div style={{ fontSize: 12, color: "var(--mut)", fontWeight: 400 }}>{sc.name}</div></td>
                  <td style={td}>{cur ? (cur.calc_method === "simple"
                    ? `${Number(cur.interest_pct)}% p.a. · fund ${Number(cur.funding_pct)}% · ${cur.tenure_days}d`
                    : `slab · fund ${Number(cur.funding_pct)}% · ${cur.tenure_days}d`) : "no published version"}</td>
                  <td style={td}>{cur ? `${cur.min_interest_days} days` : "—"}</td>
                  <td style={td}><span className="chip mut">{cur ? cur.calc_method : "—"}</span></td>
                  <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>
                    {cur ? `v${cur.version_no}` : "—"}
                    {versionsOf(sc.id).some(v => v.status === "draft") &&
                      <span className="chip warn" style={{ marginLeft: 6 }}>draft waiting</span>}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
                      onClick={() => setOpen(sc.id)}>Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.canEdit && (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 10,
            flexWrap: "wrap", marginBottom: 12, padding: "10px 14px" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
              textTransform: "uppercase", color: "var(--mut)" }}>
              Common setting · days in a year for NEW schemes</span>
            <input value={daysDef} inputMode="numeric"
              onChange={e => setDaysDef(e.target.value.replace(/\D/g, "").slice(0, 3))}
              style={{ width: 70, border: "1px solid #cfc9ba", borderRadius: 9, height: 34,
                padding: "0 10px", fontFamily: "ui-monospace,monospace", fontSize: 13 }} />
            <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12 }}
              disabled={busy || daysDef === String(data.daysDefault)}
              onClick={async () => { const r = await post({ action: "set_days_default",
                days: Number(daysDef) }); if (r) load(); }}>Save default</button>
            <span className="hint">Pre-fills the wizard only — every published scheme keeps its
              own figure for life; running loans never move.</span>
          </div>
        )}
      <p className="hint" style={{ marginTop: 8 }}>
        Editing never overwrites: a new version carries an effective date and running loans
        keep the version they were sanctioned on.</p>
    </>
  );
}

// ————————————————————— version row with publish and allocation —————————————————————
function VersionRow({ v, td, data, slabsOf, allocOf, post, reload, busy, onEdit }) {
  const [showAll, setShowAll] = useState(false);
  const [alloc, setAlloc] = useState(null); // branch ids while editing
  const termsText = v.calc_method === "simple"
    ? `${Number(v.interest_pct)}% p.a.`
    : "slab: " + slabsOf(v.id).map(s => `${s.from_day}–${s.to_day}d @ ${Number(s.rate_pct)}%`).join(" · ");
  const chip = v.status === "published" ? (v.effective_to ? "superseded" : "in force") : v.status;
  const chipClass = v.status === "published" && !v.effective_to ? "ok" : v.status === "draft" ? "warn" : "mut";
  const lendable = data.branches.filter(b => !b.is_ho);

  const [perr, setPerr] = useState(null);       // panel-local error (the old setErr was out of scope and crashed)
  const [confirmDel, setConfirmDel] = useState(false);
  async function publish() {
    const ids = alloc ?? [];
    // zero ticks publishes a live-but-parked version (offered nowhere) — allowed
    const r = await post({ action: "publish", versionId: v.id, branchIds: ids });
    if (r) { setAlloc(null); setPerr(null); reload(); }
  }
  async function deleteDraft() {
    const r = await post({ action: "delete_draft", versionId: v.id });
    if (r) reload();
  }
  async function saveAlloc() {
    const r = await post({ action: "allocate", versionId: v.id, branchIds: alloc });
    if (r) { setAlloc(null); reload(); }
  }

  return (
    <>
      <tr>
        <td style={{ ...td, fontFamily: "ui-monospace,monospace", fontWeight: 800 }}>v{v.version_no}</td>
        <td style={td}>{dmy(v.effective_from)}</td>
        <td style={td}>{v.effective_to ? dmy(v.effective_to) : "open"}</td>
        <td style={{ ...td, fontSize: 12.5 }}>{termsText}
          <div style={{ fontSize: 11.5, color: "var(--mut)" }}>
            fund {Number(v.funding_pct)}% · min {v.min_interest_days}d · penal {Number(v.penal_rate_pct)}%+{v.penal_grace_days}d grace</div></td>
        <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{v.loans_on_it}</td>
        <td style={td}><span className={"chip " + chipClass}>{chip}</span></td>
        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
          <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12,
              marginRight: 6 }}
            onClick={() => setShowAll(!showAll)}>{showAll ? "Hide details" : "Details"}</button>
          {data.canEdit && v.status === "draft" && (<>
            <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12, marginRight: 6 }}
              disabled={busy} onClick={onEdit}>Edit</button>
            {!confirmDel
              ? <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12,
                  marginRight: 6, color: "var(--bad)" }} disabled={busy}
                  onClick={() => setConfirmDel(true)}>Delete</button>
              : <button className="btn" style={{ padding: "6px 11px", fontSize: 12,
                  marginRight: 6, background: "var(--bad)" }} disabled={busy}
                  onClick={deleteDraft}>Confirm delete?</button>}
            <button className="btn" style={{ padding: "6px 12px", fontSize: 12.5 }}
              disabled={busy} onClick={() => { setPerr(null);
                setAlloc(alloc ?? allocOf(v.id)); }}>Publish…</button></>)}
          {data.canEdit && v.status === "published" && !v.effective_to && (
            <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
              onClick={() => setAlloc(allocOf(v.id))}>Branches</button>)}
        </td>
      </tr>
      {alloc && (
        <tr><td colSpan={7} style={{ ...td, background: "#faf9f4" }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
            Tick every branch that may lend on v{v.version_no}</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 11.5 }}
                onClick={() => setAlloc(lendable.map(b => b.id))}>Select all</button>
              <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 11.5 }}
                onClick={() => setAlloc([])}>Clear all</button>
            </div>
            {lendable.map(b => {
              const on = alloc.includes(b.id);
              return (
                <button key={b.id} onClick={() => setAlloc(on
                  ? alloc.filter(x => x !== b.id) : [...alloc, b.id])}
                  style={{ border: "1px solid " + (on ? "var(--vault)" : "#cfc9ba"),
                    background: on ? "#e2f2e9" : "#fff", color: on ? "#1e7a4f" : "var(--mut)",
                    borderRadius: 10, padding: "8px 12px", fontWeight: 800, fontSize: 12,
                    cursor: "pointer" }}>
                  {on ? "✓ " : ""}{b.code} {b.name}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
              onClick={() => { setAlloc(null); setPerr(null); }}>Cancel</button>
            {v.status === "draft"
              ? <button className="btn green" style={{ padding: "6px 12px", fontSize: 12.5 }}
                  disabled={busy} onClick={publish}>
                  {busy ? "Publishing…" : "Publish to ticked branches"}</button>
              : <button className="btn" style={{ padding: "6px 12px", fontSize: 12.5 }}
                  disabled={busy} onClick={saveAlloc}>Save allocation</button>}
          </div>
          {perr && <div style={{ marginTop: 8, textAlign: "right" }}>
            <span className="chip bad">{perr}</span></div>}
        </td></tr>
      )}
      {showAll && (
        <tr><td colSpan={9} style={{ padding: 0, border: 0 }}>
        <div style={{ background: "#faf9f4", border: "1px solid #f0ede4",
          borderRadius: 10, padding: "10px 14px", margin: "6px 0", fontSize: 12.5 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 6 }}>
            Every figure of v{v.version_no} — what a loan on this version lives by</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: "4px 18px" }}>
            {[["Funding %", v.funding_pct + "%"],
              ["Tenure", v.tenure_days + " days"],
              ["Days in year", v.days_in_year],
              ["Min interest", v.min_interest_days + " days"],
              ["Rounding step", "₹" + (v.round_step_paise / 100)],
              ["Penal rate", v.penal_rate_pct + "% p.a."],
              ["Penal grace", v.penal_grace_days + " days"],
              ["Slab mode", v.slab_mode],
              ["Doc charge", v.doc_charge_pct + "% (₹" + (v.doc_charge_min_paise / 100)
                + "–₹" + (v.doc_charge_max_paise / 100) + ")"],
              ["Admin fee", "₹" + (v.admin_fee_paise / 100)],
              ["Loan band", "₹" + (v.min_loan_paise / 100).toLocaleString("en-IN")
                + " – ₹" + (v.max_loan_paise / 100).toLocaleString("en-IN")],
              ["Status", v.status]].map(([k2, v2]) => (
              <div key={k2} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "var(--mut)" }}>{k2}</span>
                <b className="mono">{String(v2)}</b></div>))}
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{ color: "var(--mut)" }}>Interest slabs: </span>
            {(slabsOf(v.id) || []).map(sl =>
              <span key={sl.from_day} className="chip mut" style={{ marginRight: 4 }}>
                day {sl.from_day}{sl.to_day ? "–" + sl.to_day : "+"} · {sl.rate_pct}%</span>)}
          </div>
        </div>
        </td></tr>
      )}
    </>
  );
}

// ————————————————————— five-step wizard —————————————————————
function Wizard({ data, wiz, setWiz, post, busy, err, setErr, reload }) {
  const f = wiz.form;
  const set = (k) => (e) => setWiz({ ...wiz, form: { ...f, [k]: e.target.value } });
  const setV = (k, v) => setWiz({ ...wiz, form: { ...f, [k]: v } });
  const isNew = !wiz.schemeId;

  const check = validSchemeVersion({ ...f, isNewScheme: isNew,
    existingCodes: data.schemes.map(s => s.code),
    slabs: (f.slabs || []).filter(s => s.toDay !== "" && s.ratePct !== "")
      .map(s => ({ fromDay: Number(s.fromDay), toDay: Number(s.toDay), ratePct: Number(s.ratePct) })) });

  async function saveDraft() {
    const clean = { ...f,
      slabs: (f.slabs || []).filter(s => s.toDay !== "" && s.ratePct !== "")
        .map(s => ({ fromDay: Number(s.fromDay), toDay: Number(s.toDay), ratePct: Number(s.ratePct) })) };
    const r = await post({ action: "save_draft", schemeId: wiz.schemeId,
      versionId: wiz.versionId, code: f.code, name: f.name, form: clean });
    if (r) { setWiz(null); reload(); }
  }

  const slabRows = f.slabs || [];
  const setTenure = (v) => {
    const tenure = Number(v);
    let s2 = slabRows;
    if (tenure > 0) {
      // clamp every toDay to the new tenure, re-chain, drop dead rows
      s2 = slabRows.map(x => ({ ...x,
        toDay: x.toDay !== "" && Number(x.toDay) > tenure ? String(tenure) : x.toDay }));
      for (let j = 1; j < s2.length; j++) {
        const prevEnd = Number(s2[j - 1].toDay);
        if (!prevEnd) break;
        if (prevEnd >= tenure) { s2 = s2.slice(0, j); break; }
        s2[j] = { ...s2[j], fromDay: prevEnd + 1,
          toDay: s2[j].toDay !== "" && Number(s2[j].toDay) <= prevEnd ? "" : s2[j].toDay };
      }
      const last = s2[s2.length - 1];
      if (Number(last?.toDay) > 0 && Number(last.toDay) < tenure)
        s2 = [...s2, { fromDay: Number(last.toDay) + 1, toDay: "", ratePct: "" }];
    }
    setWiz({ ...wiz, form: { ...f, tenureDays: v, slabs: s2 } });
  };
  const setSlab = (i, k, v) => {
    const tenure = Number(f.tenureDays);
    let s = slabRows.map((x, j) => j === i ? { ...x, [k]: v } : x);
    if (k === "toDay" && v !== "") {
      // №E10-1: a slab can never run past the tenure — clamped as you type
      if (tenure > 0 && Number(v) > tenure) s[i] = { ...s[i], toDay: String(tenure) };
      // №E10-1: overlaps are impossible — every later row re-chains off this one,
      // and rows squeezed past the tenure fall away
      for (let j = i + 1; j < s.length; j++) {
        const prevEnd = Number(s[j - 1].toDay);
        if (!prevEnd) break;
        if (tenure > 0 && prevEnd >= tenure) { s = s.slice(0, j); break; }
        s[j] = { ...s[j], fromDay: prevEnd + 1,
          toDay: s[j].toDay !== "" && Number(s[j].toDay) <= prevEnd ? "" : s[j].toDay };
      }
      // №10: last row ends before tenure → a fresh row appears by itself
      const last = s[s.length - 1];
      const lastEnd = Number(last.toDay);
      if (tenure > 0 && lastEnd > 0 && lastEnd < tenure)
        s.push({ fromDay: lastEnd + 1, toDay: "", ratePct: "" });
    }
    setV("slabs", s);
  };

  const step = wiz.step;
  return (
    <div className="card" style={{ maxWidth: 780 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
          textTransform: "uppercase", color: "var(--mut)" }}>
          {isNew ? "New scheme" : `New version of ${f.code}`}</div>
        <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
          onClick={() => { setWiz(null); setErr(null); }}>Close</button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 18px" }}>
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setWiz({ ...wiz, step: i })}
            style={{ border: "1px solid " + (i === step ? "var(--vault)" : "#cfc9ba"),
              background: i === step ? "var(--vault)" : "#fff",
              color: i === step ? "#fff" : "var(--mut)", borderRadius: 99,
              padding: "6px 13px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
            {i + 1} · {s}</button>
        ))}
      </div>

      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div><label style={F}>Scheme code *</label>
            <input style={{ ...I, fontFamily: "ui-monospace,monospace",
              background: isNew ? "#fff" : "#f0eee6" }} value={f.code} readOnly={!isNew}
              onChange={e => setV("code", e.target.value.toUpperCase())} placeholder="e.g. GL2575" />
            {!isNew && <div className="hint">locked — versions share the code</div>}</div>
          <div><label style={F}>Description *</label>
            <input style={I} value={f.name} readOnly={!isNew} onChange={set("name")}
              placeholder="one line staff will read" /></div>
          <div><label style={F}>Days in a year *</label>
            <input style={I} value={f.daysInYear} onChange={set("daysInYear")} inputMode="numeric" />
            <div className="hint">365 or 366 — the divisor in every interest calculation</div></div>
          <div><label style={F}>Scheme start date *</label>
            <input style={I} type="date" value={f.effectiveFrom} onChange={set("effectiveFrom")} />
            <div className="hint">first day branches may sanction on it</div></div>
        </div>
      )}

      {step === 1 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <div><label style={F}>Calculation method *</label>
              <select style={I} value={f.calcMethod} onChange={set("calcMethod")}>
                <option value="">— select —</option>
                <option value="simple">Simple interest</option>
                <option value="slab">Slab-wise</option>
                <option value="" disabled>Compound — needs the engine extended</option>
                <option value="" disabled>EMI — needs the engine extended</option>
              </select></div>
            {f.calcMethod === "simple" && (
              <div><label style={F}>Interest % per annum *</label>
                <input style={I} value={f.interestPct} onChange={set("interestPct")} inputMode="decimal" /></div>)}
            <div><label style={F}>Minimum interest days *</label>
              <input style={I} value={f.minInterestDays} onChange={set("minInterestDays")} inputMode="numeric" />
              <div className="hint">charged on every loan even if it closes earlier</div></div>
            <div><label style={F}>Tenure days * — slabs must cover it</label>
              <input style={I} value={f.tenureDays}
                onChange={e => setTenure(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric" placeholder="e.g. 365" />
              <div className="hint">a slab can never run past the tenure — entries clamp to it</div></div>
          </div>

          {f.calcMethod === "slab" && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
                <div><label style={F}>Slab mode *</label>
                  <select style={I} value={f.slabMode} onChange={set("slabMode")}>
                    <option value="retroactive">Retroactive — reached slab prices all days</option>
                    <option value="prospective">Prospective — each slab its own days</option>
                  </select></div>
              </div>
              <label style={{ ...F, marginTop: 14 }}>Slab table *</label>
              {slabRows.map((sl, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input style={{ ...I, width: 90 }} value={sl.fromDay} readOnly={i > 0}
                    onChange={e => setSlab(i, "fromDay", e.target.value.replace(/\D/g, ""))}
                    placeholder="from" inputMode="numeric" />
                  <span style={{ color: "var(--mut)" }}>to</span>
                  <input style={{ ...I, width: 90 }} value={sl.toDay}
                    onChange={e => setSlab(i, "toDay", e.target.value.replace(/\D/g, ""))}
                    placeholder="day" inputMode="numeric" />
                  <input style={{ ...I, width: 110 }} value={sl.ratePct}
                    onChange={e => setSlab(i, "ratePct", e.target.value)}
                    placeholder="% p.a." inputMode="decimal" />
                  {slabRows.length > 2 && (
                    <button className="btn ghost" style={{ padding: "6px 10px" }}
                      onClick={() => setV("slabs", slabRows.filter((_, j) => j !== i))}>✕</button>)}
                </div>
              ))}
              <button className="btn ghost" style={{ padding: "7px 13px", fontSize: 12.5 }}
                onClick={() => setV("slabs", [...slabRows,
                  { fromDay: Number(slabRows[slabRows.length - 1]?.toDay) + 1 || "", toDay: "", ratePct: "" }])}>
                + Add slab</button>
              <div className="hint">slabs must join with no gaps and cover the whole tenure</div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div><label style={F}>Doc charge % of sanction</label>
            <input style={I} value={f.docChargePct} onChange={set("docChargePct")} inputMode="decimal" /></div>
          <div><label style={F}>Doc charge minimum ₹</label>
            <input style={I} value={f.docMinRs} onChange={set("docMinRs")} inputMode="numeric" /></div>
          <div><label style={F}>Doc charge maximum ₹</label>
            <input style={I} value={f.docMaxRs} onChange={set("docMaxRs")} inputMode="numeric" /></div>
          <div><label style={F}>Penal % per annum</label>
            <input style={I} value={f.penalRatePct} onChange={set("penalRatePct")} inputMode="decimal" />
            <div className="hint">on overdue principal, after tenure</div></div>
          <div><label style={F}>Penal grace days</label>
            <input style={I} value={f.penalGraceDays} onChange={set("penalGraceDays")} inputMode="numeric" />
            <div className="hint">closing within tenure + grace forgives penal entirely</div></div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div><label style={F}>Funding % *</label>
            <input style={I} value={f.fundingPct} onChange={set("fundingPct")} inputMode="decimal" />
            <div className="hint">of the funding valuation — what may actually be lent</div></div>
          <div><label style={F}>Minimum loan ₹</label>
            <input style={I} value={f.minLoanRs} onChange={set("minLoanRs")} inputMode="numeric" /></div>
          <div><label style={F}>Maximum loan ₹</label>
            <input style={I} value={f.maxLoanRs} onChange={set("maxLoanRs")} inputMode="numeric" />
            <div className="hint">per pledge, before HO routing</div></div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            {[["Code", f.code], ["Method", f.calcMethod || "—"],
              ["Interest", f.calcMethod === "simple" ? f.interestPct + "% p.a." : "slab table"],
              ["Tenure", f.tenureDays + " days"], ["Min interest", f.minInterestDays + " days"],
              ["Funding", f.fundingPct + "%"],
              ["Loan range", `${inr(f.minLoanRs)} – ${inr(f.maxLoanRs)}`],
              ["Doc charge", `${f.docChargePct}% · ${inr(f.docMinRs)}–${inr(f.docMaxRs)}`],
              ["Penal", `${f.penalRatePct}% + ${f.penalGraceDays}d grace`],
              ["Starts", dmy(f.effectiveFrom)]].map(([k, v]) => (
              <div key={k}>
                <div style={F}>{k}</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{v}</div>
              </div>
            ))}
          </div>
          {f.calcMethod === "slab" && (
            <div style={{ marginTop: 14, background: "#faf9f4", border: "1px solid #e2ddd1",
              borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                color: "var(--mut)", marginBottom: 8 }}>Slab table · worked on ₹1,00,000</div>
              {slabRows.filter(s => s.toDay && s.ratePct).map((sl, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between",
                  fontSize: 13, padding: "3px 0", fontFamily: "ui-monospace,monospace" }}>
                  <span>day {sl.fromDay}–{sl.toDay} @ {sl.ratePct}%</span>
                  <span>{inr(slabSample({ fromDay: Number(sl.fromDay), toDay: Number(sl.toDay),
                    ratePct: Number(sl.ratePct) }, Number(f.daysInYear)))} for the band</span>
                </div>
              ))}
            </div>
          )}
          {!check.ok && (
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {check.problems.map((p, i) => <span key={i} className="chip warn">{p}</span>)}
            </div>
          )}
          <p className="hint" style={{ marginTop: 12 }}>
            Saving creates a <b>draft</b>. Publishing happens from the version table — tick the
            branches there. A published version can never be edited again.</p>
        </div>
      )}

      {err && <div style={{ marginTop: 12 }}><span className="chip bad">{err}</span></div>}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
        <button className="btn ghost" disabled={step === 0}
          onClick={() => setWiz({ ...wiz, step: step - 1 })}>← Back</button>
        {step < 4
          ? <button className="btn" onClick={() => setWiz({ ...wiz, step: step + 1 })}>Next →</button>
          : <button className="btn" disabled={busy || !check.ok} onClick={saveDraft}
              style={{ opacity: check.ok ? 1 : .45 }}>
              {busy ? "Saving…" : "Save draft"}</button>}
      </div>
    </div>
  );
}
