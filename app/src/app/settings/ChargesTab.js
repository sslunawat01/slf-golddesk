"use client";
import { useEffect, useState } from "react";

const inr = (p) => p == null ? "—" : "₹" + Math.round(p / 100).toLocaleString("en-IN");
const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 42, fontSize: 14, background: "#fff" };

const EMPTY = { id: null, name: "", calc: "", amountRs: "", pct: "", minRs: "", maxRs: "", gstPct: "18", active: true };

export default function ChargesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/settings/charges").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason)).catch(() => setErr("Could not load charges"));
  useEffect(() => { load(); }, []);

  if (err) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/charges", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(form) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) setErr(r.reason); else { setForm(null); load(); }
  }

  const basisText = (c) => c.calc === "fixed" ? "Fixed" : "% of amount";
  const valueText = (c) => c.calc === "fixed" ? inr(c.amount_paise) : (Number(c.pct) + "%");
  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13.5 };

  return (
    <>
      {data.canEdit && !form && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="btn" onClick={() => setForm({ ...EMPTY })}>+ Add charge</button>
        </div>)}
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead><tr style={{ background: "#f0eee6" }}>
            {["Charge", "Basis", "Value", "Min / max", "GST", "Used on", ""].map(h =>
              <th key={h} style={{ ...td, textAlign: "left", fontSize: 11, textTransform: "uppercase",
                letterSpacing: ".07em" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.rows.map(c => (
              <tr key={c.id} style={{ opacity: c.active ? 1 : .45 }}>
                <td style={{ ...td, fontWeight: 700 }}>{c.name}
                  {!c.active && <span className="chip mut" style={{ marginLeft: 8 }}>off</span>}</td>
                <td style={td}>{basisText(c)}</td>
                <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{valueText(c)}</td>
                <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>
                  {c.calc === "percent" ? `${inr(c.min_paise)} / ${inr(c.max_paise)}` : "—"}</td>
                <td style={td}>{Number(c.gst_pct)}%</td>
                <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{c.used_on} loan{c.used_on === 1 ? "" : "s"}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {data.canEdit && (
                    <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
                      onClick={() => setForm({ id: c.id, name: c.name, calc: c.calc,
                        amountRs: c.amount_paise ? String(c.amount_paise / 100) : "",
                        pct: c.pct == null ? "" : String(Number(c.pct)),
                        minRs: c.min_paise ? String(c.min_paise / 100) : "",
                        maxRs: c.max_paise ? String(c.max_paise / 100) : "",
                        gstPct: String(Number(c.gst_pct)), active: c.active })}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        A charge that has been used on a loan can never be deleted — switch it off instead.
        Its history stays priced as it was.</p>


      {form && (
        <div className="card" style={{ marginTop: 14, border: "1px dashed #cfc9ba" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 12 }}>
            {form.id ? "Edit charge" : "New charge"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            <div><label style={F}>Name *</label>
              <input style={I} value={form.name} onChange={set("name")} placeholder="e.g. Registered notice" /></div>
            <div><label style={F}>Charged as *</label>
              <select style={I} value={form.calc} onChange={set("calc")}>
                <option value="">— select —</option>
                <option value="fixed">Fixed amount</option>
                <option value="percent">Percentage of amount</option>
              </select></div>
            {form.calc === "fixed" && (
              <div><label style={F}>Amount ₹ *</label>
                <input style={I} value={form.amountRs} onChange={set("amountRs")} inputMode="decimal" /></div>)}
            {form.calc === "percent" && (<>
              <div><label style={F}>Rate % *</label>
                <input style={I} value={form.pct} onChange={set("pct")} inputMode="decimal" /></div>
              <div><label style={F}>Minimum ₹</label>
                <input style={I} value={form.minRs} onChange={set("minRs")} inputMode="numeric" /></div>
              <div><label style={F}>Maximum ₹</label>
                <input style={I} value={form.maxRs} onChange={set("maxRs")} inputMode="numeric" /></div>
            </>)}
            <div><label style={F}>GST %</label>
              <input style={I} value={form.gstPct} onChange={set("gstPct")} inputMode="decimal" /></div>
          </div>
          {form.id && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12,
              fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              <input type="checkbox" checked={!!form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                style={{ width: 16, height: 16 }} />
              Active — visible on the add-charge screen
            </label>
          )}
          {err && <div style={{ marginTop: 10 }}><span className="chip bad">{err}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => { setForm(null); setErr(null); }}>Cancel</button>
            <button className="btn" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save charge"}</button>
          </div>
        </div>
      )}
    </>
  );
}
