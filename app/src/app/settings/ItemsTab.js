"use client";
import { useEffect, useMemo, useState } from "react";
import SavedToast from "@/app/ui/SavedToast.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

const BLANK = { name: "", printName: "", metalId: 0, description: "" };

export default function ItemsTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);   // №4: flashes the shared Saved banner
  const [qs, setQs] = useState("");
  const [form, setForm] = useState(null);   // {id?} + BLANK fields

  const load = () => fetch("/api/settings/items").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason))
    .catch(() => setErr("Could not load items"));
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    if (!qs) return data.rows;
    const s = qs.toLowerCase();
    return data.rows.filter(i =>
      (i.name + " " + i.printName + " " + (i.description || "")).toLowerCase().includes(s));
  }, [data, qs]);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const canEdit = data.canEdit;

  async function post(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/items", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return null; }
    setSavedAt(Date.now());   // №4: every successful save announces itself
    return r;
  }

  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13 };

  return (
    <>
      <SavedToast when={savedAt} />
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--mut)", marginBottom: 8 }}>
        Item master — what the appraisal grid may list</div>

      {canEdit && !form && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="btn" onClick={() => setForm({ ...BLANK })}>+ Add item</button>
        </div>)}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        marginBottom: 10 }}>
        <input style={{ ...I, flex: "1 1 220px", minWidth: 180 }} value={qs}
          placeholder="Search item, print name or description…" onChange={e => setQs(e.target.value)} />
        <span className="hint" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
          {rows.length} of {data.rows.length} items</span>
      </div>

      {err && <div style={{ marginBottom: 10 }}><span className="chip bad">{err}</span></div>}

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead><tr style={{ background: "#f0eee6" }}>
            {["Item name", "Print name", "Metal", "Description", "Status"].map((h, i) =>
              <th key={h} style={{ ...td, fontSize: 10.5, letterSpacing: ".07em",
                textTransform: "uppercase", textAlign: i === 4 ? "right" : "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.id} style={{ opacity: i.active ? 1 : .5 }}>
                <td style={{ ...td, fontWeight: 700 }}>{i.name}</td>
                <td style={{ ...td, fontFamily: "ui-monospace,monospace", fontSize: 12,
                  color: "var(--mut)" }}>{i.printName}</td>
                <td style={{ ...td, color: "var(--mut)" }}>{cap(i.metal)}</td>
                <td style={{ ...td, color: "var(--mut)", fontSize: 12, maxWidth: 280 }}>
                  {i.description || "—"}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 7, justifyContent: "flex-end",
                    alignItems: "center", flexWrap: "wrap" }}>
                    <span className={"chip " + (i.active ? "ok" : "mut")}>
                      {i.active ? "active" : "off"}</span>
                    {i.usedOn > 0 && <span className="chip mut">{i.usedOn} loans</span>}
                    {canEdit && <>
                      <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                        disabled={busy}
                        onClick={async () => { const r = await post({ action: "toggle", id: i.id });
                          if (r) load(); }}>{i.active ? "Deactivate" : "Reactivate"}</button>
                      <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                        onClick={() => setForm({ id: i.id, name: i.name, printName: i.printName,
                          metalId: i.metalId, description: i.description || "" })}>Edit</button>
                    </>}
                  </div>
                </td>
              </tr>))}
            {rows.length === 0 &&
              <tr><td colSpan={5} style={{ ...td, color: "var(--mut)" }}>Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="card" style={{ border: "1px dashed #cfc9ba", marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 12 }}>
            {form.id ? "Edit item — " + form.name : "New item"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 12 }}>
            <div><span style={F}>Item name *</span>
              <input style={I} value={form.name} placeholder="e.g. Necklace / Haar"
                onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><span style={F}>Print name *</span>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.printName}
                placeholder="NECKLACE"
                onChange={e => setForm({ ...form, printName: e.target.value.toUpperCase() })} />
              <div className="hint" style={{ marginTop: 4 }}>
                on the pledge card: {form.printName || "—"}</div></div>
            <div><span style={F}>Metal</span>
              <select style={I} value={form.metalId}
                onChange={e => setForm({ ...form, metalId: Number(e.target.value) })}>
                <option value={0}>— select metal * —</option>
                {data.metals.map(m => <option key={m.id} value={m.id}>{cap(m.kind)}</option>)}
              </select></div>
          </div>
          <span style={{ ...F, marginTop: 14 }}>Description — guidance shown to the appraiser</span>
          <input style={I} value={form.description} placeholder="e.g. Deduct stone weight separately"
            onChange={e => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn" disabled={busy || form.name.trim().length < 2
                || form.printName.trim().length < 2 || !form.metalId}
              onClick={async () => {
                const r = await post(form.id
                  ? { action: "edit", id: form.id, ...form }
                  : { action: "create", ...form });
                if (r) { setForm(null); load(); } }}>
              {busy ? "Saving…" : "Save item"}</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <span className="hint">
          Deactivating an item hides it from new appraisals — loans already carrying it are untouched.</span>
      </div>
    </>
  );
}
