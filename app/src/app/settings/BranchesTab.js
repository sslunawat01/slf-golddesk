"use client";
import { useEffect, useState } from "react";
import SavedToast from "@/app/ui/SavedToast.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 42, fontSize: 14, background: "#fff" };

const EMPTY = { id: null, entityId: "", code: "", name: "", printName: "", phone: "",
  phone2: "", email: "", address: "", latitude: "", longitude: "", active: true };

export default function BranchesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(null);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);   // №4: flashes the shared Saved banner
  const [note, setNote] = useState(null);
  const [safes, setSafes] = useState([]);
  const [safeForm, setSafeForm] = useState(null);   // {branchId, branchName, id?, label, locationNote}
  const [safeBusy, setSafeBusy] = useState(false);
  const [safeErr, setSafeErr] = useState(null);

  const load = () => {
    fetch("/api/settings/branches").then(r => r.json())
      .then(r => r.ok ? setData(r) : setErr(r.reason)).catch(() => setErr("Could not load branches"));
    fetch("/api/settings/safes").then(r => r.json())
      .then(r => { if (r.ok) setSafes(r.rows); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function postSafe(body) {
    setSafeBusy(true); setSafeErr(null);
    const r = await fetch("/api/settings/safes", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setSafeBusy(false);
    if (!r.ok) { setSafeErr(r.reason); return null; }
    return r;
  }

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true); setErr(null); setNote(null);
    const r = await fetch("/api/settings/branches", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(form) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) setErr(r.reason);
    else { setSavedAt(Date.now()); setForm(null); if (r.note) setNote(r.note); load(); }
  }

  return (
    <>
      <SavedToast when={savedAt} />
      {note && <div style={{ marginBottom: 12 }}><span className="chip warn">{note}</span></div>}

      {!form && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 10 }}>
          <input value={find} onChange={e => setFind(e.target.value)}
            placeholder="🔍 Find branch — code, name, email"
            style={{ flex: "1 1 220px", maxWidth: 340, height: 40, border: "1px solid #ddd8ca",
              borderRadius: 10, padding: "0 13px", fontSize: 13.5, outline: "none",
              background: "#fff" }} />
          {data.canEdit &&
            <button className="btn" onClick={() => setForm({ ...EMPTY })}>+ Add branch</button>}
        </div>)}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
        {data.entities.map(e => (
          <div key={e.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{e.legal_name}</div>
              <span className="chip mut mono">{e.code}</span>
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {data.branches.filter(b => b.entity_id === e.id)
                .filter(b => !find.trim() || [b.code, b.name, b.print_name, b.email]
                  .some(x => String(x || "").toLowerCase().includes(find.trim().toLowerCase())))
                .map(b => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 8,
                  opacity: b.active ? 1 : .45 }}>
                  <div>
                    <span className="mono" style={{ fontWeight: 800 }}>{b.code}</span>
                    {" "}<span style={{ fontWeight: 700 }}>{b.name}</span>
                    {b.is_ho && <span className="chip mut" style={{ marginLeft: 6 }}>HO — cannot lend</span>}
                    {!b.active && <span className="chip mut" style={{ marginLeft: 6 }}>off</span>}
                    <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>
                      {b.is_ho ? "" :
                        `${b.safes} safe${b.safes === 1 ? "" : "s"} · ${b.schemes} scheme${b.schemes === 1 ? "" : "s"} · ${b.active_loans} active loan${b.active_loans === 1 ? "" : "s"}`}
                      {!b.is_ho && b.safes === 0 && <span style={{ color: "#a06407", fontWeight: 700 }}> · no safe — cannot vault gold</span>}
                    </div>
                    {!b.is_ho && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {safes.filter(sf => sf.branchId === b.id).map(sf => (
                          <span key={sf.id} className={"chip " + (sf.active ? "ok" : "mut")}
                            title={sf.locationNote || ""}
                            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            🔐 {sf.label}
                            {sf.inside > 0 && <b>· {sf.inside} pkt</b>}
                            {data.canEdit && <>
                              <button onClick={() => { setSafeErr(null);
                                  setSafeForm({ branchId: b.id, branchName: b.name, id: sf.id,
                                    label: sf.label, locationNote: sf.locationNote || "" }); }}
                                style={{ border: 0, background: "none", cursor: "pointer",
                                  fontWeight: 800, color: "inherit", padding: 0 }}>✎</button>
                              <button disabled={safeBusy}
                                onClick={async () => { const r = await postSafe({ action: "toggle", id: sf.id });
                                  if (r) load(); }}
                                style={{ border: 0, background: "none", cursor: "pointer",
                                  fontWeight: 800, color: "inherit", padding: 0 }}
                                title={sf.active ? "Switch off" : "Switch on"}>
                                {sf.active ? "⏻" : "▶"}</button>
                            </>}
                          </span>
                        ))}
                        {data.canEdit && b.active &&
                          <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 11.5 }}
                            onClick={() => { setSafeErr(null);
                              setSafeForm({ branchId: b.id, branchName: b.name, id: null,
                                label: "", locationNote: "" }); }}>+ Safe</button>}
                      </div>
                    )}
                  </div>
                  {data.canEdit && (
                    <button className="btn ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
                      onClick={() => setForm({ id: b.id, entityId: b.entity_id, code: b.code,
                        name: b.name, printName: b.print_name || "", phone: b.phone || "",
                        address: b.address_json?.text || b.address_json?.line1 || "",
                        phone2: b.phone2 || "", email: b.email || "",
                        latitude: b.latitude ?? "", longitude: b.longitude ?? "",
                        active: b.active })}>Edit</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {safeForm && (
        <div className="card" style={{ marginTop: 14, border: "1px dashed #cfc9ba" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 12 }}>
            {safeForm.id ? "Edit safe — " + safeForm.branchName : "New safe at " + safeForm.branchName}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            gap: 12 }}>
            <div><label style={F}>Label * — unique within the branch</label>
              <input style={I} value={safeForm.label} placeholder="e.g. Safe A — main vault"
                onChange={e => setSafeForm({ ...safeForm, label: e.target.value })} /></div>
            <div><label style={F}>Location note</label>
              <input style={I} value={safeForm.locationNote} placeholder="e.g. strong room, ground floor"
                onChange={e => setSafeForm({ ...safeForm, locationNote: e.target.value })} /></div>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            The vault-in screen offers this safe the moment it is saved. A safe holding packets can
            never be switched off — move the gold out first.</div>
          {safeErr && <div style={{ marginTop: 10 }}><span className="chip bad">{safeErr}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setSafeForm(null)}>Cancel</button>
            <button className="btn" disabled={safeBusy || safeForm.label.trim().length < 2}
              onClick={async () => {
                const r = await postSafe(safeForm.id
                  ? { action: "rename", id: safeForm.id, label: safeForm.label,
                      locationNote: safeForm.locationNote }
                  : { action: "create", branchId: safeForm.branchId, label: safeForm.label,
                      locationNote: safeForm.locationNote });
                if (r) { setSafeForm(null); load(); } }}>
              {safeBusy ? "Saving…" : safeForm.id ? "Save safe" : "Create safe"}</button>
          </div>
        </div>
      )}


      {form && (
        <div className="card" style={{ marginTop: 14, border: "1px dashed #cfc9ba" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 12 }}>
            {form.id ? `Edit branch ${form.code}` : "New branch"}</div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em",
            textTransform: "uppercase", color: "var(--mut)", margin: "2px 0 8px" }}>Identity</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            {!form.id && (
              <div><label style={F}>Entity *</label>
                <select style={I} value={form.entityId} onChange={set("entityId")}>
                  <option value="">— select —</option>
                  {data.entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
                </select></div>)}
            <div><label style={F}>Branch code * — 2 letters/digits</label>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace", textTransform: "uppercase" }}
                value={form.code}
                onChange={e => setForm({ ...form,
                  code: e.target.value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase().slice(0, 3) })}
                placeholder="e.g. 04 or B4" />
              {form.id
                ? <div className="hint">changing it: numbers issued from that moment use the new
                    code, counters continue, old numbers stay as printed</div>
                : <div className="hint">printed into every document number this branch issues</div>}</div>
            <div><label style={F}>Name *</label>
              <input style={I} value={form.name} onChange={set("name")} placeholder="e.g. B4 Sinnar" /></div>
            <div><label style={F}>Print name — receipts show this</label>
              <input style={I} value={form.printName} onChange={set("printName")}
                placeholder="defaults to the name" /></div>
          </div>

          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em",
            textTransform: "uppercase", color: "var(--mut)", margin: "16px 0 8px" }}>Contact — all compulsory</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
            <div><label style={F}>Phone 1 *</label>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                inputMode="tel" placeholder="98220 12345" /></div>
            <div><label style={F}>Phone 2 *</label>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.phone2}
                onChange={e => setForm({ ...form, phone2: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                inputMode="tel" placeholder="0253 231234" /></div>
            <div><label style={F}>Branch email *</label>
              <input style={I} type="email" value={form.email} onChange={set("email")}
                placeholder="bhagur@slunawat.in" autoCapitalize="none" /></div>
          </div>

          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em",
            textTransform: "uppercase", color: "var(--mut)", margin: "16px 0 8px" }}>Address &amp; location — all compulsory</div>
          <div><label style={F}>Full address *</label>
            <textarea rows={3} value={form.address} onChange={set("address")}
              placeholder="Shop no, building, road, area, city, PIN"
              style={{ ...I, height: "auto", minHeight: 84, padding: "10px 13px",
                resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 12, marginTop: 12 }}>
            <div><label style={F}>Latitude * — e.g. 19.9975</label>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.latitude}
                onChange={e => setForm({ ...form,
                  latitude: e.target.value.replace(/[^0-9.\-]/g, "").slice(0, 11) })}
                inputMode="decimal" placeholder="19.997500" /></div>
            <div><label style={F}>Longitude * — e.g. 73.7898</label>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.longitude}
                onChange={e => setForm({ ...form,
                  longitude: e.target.value.replace(/[^0-9.\-]/g, "").slice(0, 11) })}
                inputMode="decimal" placeholder="73.789800" /></div>
          </div>
          {form.id && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12,
              fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              <input type="checkbox" checked={!!form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                style={{ width: 16, height: 16 }} />
              Active — a branch with active loans cannot be switched off
            </label>
          )}
          {err && <div style={{ marginTop: 10 }}><span className="chip bad">{err}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => { setForm(null); setErr(null); }}>Cancel</button>
            <button className="btn" disabled={busy} onClick={save}>
              {busy ? "Saving…" : form.id ? "Save changes" : "Create branch"}</button>
          </div>
        </div>
      )}
    </>
  );
}
