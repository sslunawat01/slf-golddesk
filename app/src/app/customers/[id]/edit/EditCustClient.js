"use client";
import { useState } from "react";
import { NOMINEE_RELATIONS } from "@/lib/editcust.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 12px",
  height: 42, fontSize: 14, background: "#fff", boxSizing: "border-box" };
const SEC = { fontSize: 11, fontWeight: 800, letterSpacing: ".1em",
  textTransform: "uppercase", color: "var(--mut)", margin: "18px 0 8px" };

export default function EditCustClient({ customer, contact, address, nominee }) {
  const [c, setC] = useState(contact);
  const [a, setA] = useState(address);
  const [n, setN] = useState(nominee);
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);

  const setNum = (obj, set, k, max) => (e) =>
    set({ ...obj, [k]: e.target.value.replace(/\D/g, "").slice(0, max) });

  const [areaOpts, setAreaOpts] = useState([]);
  async function onPincode(e) {
    const pin = e.target.value.replace(/\D/g, "").slice(0, 6);
    setA({ ...a, pincode: pin });
    setAreaOpts([]);
    if (pin.length === 6) {
      const r = await fetch(`/api/lookup?pincode=${pin}`).then(x => x.json()).catch(() => null);
      if (r?.ok && r.area !== undefined) {
        setA(prev => ({ ...prev, pincode: pin, area: r.area || prev.area,
          taluka: r.taluka || prev.taluka, district: r.district || prev.district,
          state: r.state || prev.state }));
        if (Array.isArray(r.options) && r.options.length > 1) setAreaOpts(r.options);
      }
    }
  }

  async function save() {
    setBusy(true); setChip(null);
    const r = await fetch(`/api/customers/${customer.id}/edit`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact: c, address: a, nominee: n }) })
      .then(x => x.json()).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    if (r.unchanged) { setChip({ tone: "mut", text: "Nothing was changed" }); return; }
    window.location.href = `/customers/${customer.id}?edited=1`;
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <a href={`/customers/${customer.id}`} style={{ background: "none", border: 0,
        color: "var(--mut)", cursor: "pointer", fontSize: 13, fontWeight: 700,
        textDecoration: "none", display: "inline-block", paddingBottom: 10 }}>
        ← {customer.name}</a>

      <div className="card">
        <h1 style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-.3px", margin: "0 0 4px" }}>
          Edit customer</h1>
        <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)", marginBottom: 6 }}>
          {customer.custNo}</div>
        <div className="hint" style={{ marginBottom: 6 }}>
          Name, Aadhaar / PAN and loan limits are identity records — they are not edited here.
          Head Office corrects those.</div>

        <div style={SEC}>Contact</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 12 }}>
          <div><span style={F}>Mobile *</span>
            <input style={I} inputMode="numeric" value={c.mobile}
              onChange={setNum(c, setC, "mobile", 10)} /></div>
          <div><span style={F}>Alt mobile</span>
            <input style={I} inputMode="numeric" value={c.altMobile}
              onChange={setNum(c, setC, "altMobile", 10)} /></div>
          <div><span style={F}>Email</span>
            <input style={I} value={c.email}
              onChange={e => setC({ ...c, email: e.target.value })} /></div>
        </div>

        <div style={SEC}>Address</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}><span style={F}>House / street *</span>
            <input style={I} value={a.line1}
              onChange={e => setA({ ...a, line1: e.target.value })} /></div>
          <div><span style={F}>Pincode * — fills the rest</span>
            <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} inputMode="numeric"
              value={a.pincode} onChange={onPincode} /></div>
          <div><span style={F}>Area{areaOpts.length > 1 ? " — pick the right one" : ""}</span>
            {areaOpts.length > 1
              ? <select style={I} value={a.area}
                  onChange={e => { const o = areaOpts.find(x => x.area === e.target.value);
                    setA({ ...a, area: e.target.value,
                      taluka: o?.taluka || a.taluka, district: o?.district || a.district }); }}>
                  {areaOpts.map(o => <option key={o.area} value={o.area}>{o.area}</option>)}
                </select>
              : <input style={I} value={a.area}
                  onChange={e => setA({ ...a, area: e.target.value })} />}</div>
          <div><span style={F}>Taluka</span>
            <input style={I} value={a.taluka}
              onChange={e => setA({ ...a, taluka: e.target.value })} /></div>
          <div><span style={F}>District</span>
            <input style={I} value={a.district}
              onChange={e => setA({ ...a, district: e.target.value })} /></div>
          <div><span style={F}>State</span>
            <input style={I} value={a.state}
              onChange={e => setA({ ...a, state: e.target.value })} /></div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          If the permanent address was marked "same as current", it follows this change automatically.</div>

        <div style={SEC}>Nominee</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 12 }}>
          <div><span style={F}>Nominee name</span>
            <input style={I} value={n.name}
              onChange={e => setN({ ...n, name: e.target.value })} /></div>
          <div><span style={F}>Relation</span>
            <select style={I} value={n.relation}
              onChange={e => setN({ ...n, relation: e.target.value })}>
              <option value="">—</option>
              {NOMINEE_RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select></div>
          <div><span style={F}>Nominee mobile</span>
            <input style={I} inputMode="numeric" value={n.mobile}
              onChange={setNum(n, setN, "mobile", 10)} /></div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Changing the nominee keeps the old one on record and dates the change — it is never
          overwritten. Clearing all three fields removes the nominee.</div>

        {chip && <div style={{ marginTop: 12 }}>
          <span className={"chip " + chip.tone}>{chip.text}</span></div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <a href={`/customers/${customer.id}`} className="btn ghost"
            style={{ textDecoration: "none" }}>Cancel</a>
          <button className="btn" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
