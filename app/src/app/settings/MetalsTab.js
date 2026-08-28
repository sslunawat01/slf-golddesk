"use client";
import { useEffect, useState } from "react";
import { rateAtPurity } from "@/lib/metals.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const inr = (p) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

export default function MetalsTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);   // {id, karat, pct, metal}
  const [add, setAdd] = useState(null);     // {mode:'grade'|'metal', ...}

  const load = () => fetch("/api/settings/metals").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason))
    .catch(() => setErr("Could not load metals"));
  useEffect(() => { load(); }, []);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const canEdit = data.canEdit;
  const gold = data.metals.find(m => m.kind === "gold");

  /** the base a grade multiplies: its own metal's rate — or GOLD's for %-of-gold metals */
  const baseFor = (metal) => metal.valuedAsPctOfGold ? (gold?.rate?.basePaise ?? null)
    : (metal.rate?.basePaise ?? null);

  async function post(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/metals", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return null; }
    return r;
  }

  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13 };
  const mono = { fontFamily: "ui-monospace,monospace", fontVariantNumeric: "tabular-nums" };

  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--mut)", marginBottom: 8 }}>
        Metals &amp; purity — what the valuation engine multiplies by</div>

      {canEdit && !edit && !add && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="btn" onClick={() => setAdd({ mode: "grade", metalId: gold?.id || "",
            karat: "", pct: "", kind: data.addableKinds[0] || "", valuedAsPctOfGold: false })}>
            + Add metal or purity</button>
        </div>)}

      {err && <div style={{ marginBottom: 10 }}><span className="chip bad">{err}</span></div>}

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 660 }}>
          <thead><tr style={{ background: "#f0eee6" }}>
            {["Metal", "Purity name", "Purity %", "Base rate ₹/g", "Rate at purity", "Lending"]
              .map((h, i) => <th key={h} style={{ ...td, fontSize: 10.5, letterSpacing: ".07em",
                textTransform: "uppercase", textAlign: i >= 2 && i <= 4 ? "right" : "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.purities.map(p => {
              const metal = data.metals.find(m => m.id === p.metalId) || {};
              const base = baseFor(metal);
              const derived = base != null ? rateAtPurity(base, p.pct) : null;
              return (
                <tr key={p.id} style={{ opacity: p.active && metal.enabled ? 1 : .5 }}>
                  <td style={{ ...td, fontWeight: 800 }}>{cap(metal.kind)}
                    {metal.valuedAsPctOfGold &&
                      <span className="chip mut" style={{ marginLeft: 6 }}>% of gold</span>}</td>
                  <td style={td}>{p.karat}</td>
                  <td style={{ ...td, ...mono, textAlign: "right", fontWeight: 700 }}>{p.pct}%</td>
                  <td style={{ ...td, ...mono, textAlign: "right", color: "var(--mut)" }}>
                    {base != null ? inr(base) : "no rate"}</td>
                  <td style={{ ...td, ...mono, textAlign: "right", fontWeight: 800,
                    color: "var(--brass)" }}>{derived != null ? inr(derived) : "—"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 7, justifyContent: "flex-end",
                      alignItems: "center", flexWrap: "wrap" }}>
                      <span className={"chip " + (p.active && metal.enabled && base != null
                        ? "ok" : "mut")}>
                        {!metal.enabled ? "metal off" : !p.active ? "off"
                          : base == null ? "no rate" : "lending"}</span>
                      {p.usedOn > 0 && <span className="chip mut">{p.usedOn} loans</span>}
                      {canEdit && <>
                        <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                          disabled={busy}
                          onClick={async () => { const r = await post({ action: "toggle_purity", id: p.id });
                            if (r) load(); }}>{p.active ? "Disable" : "Enable"}</button>
                        <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                          onClick={() => { setAdd(null);
                            setEdit({ id: p.id, karat: p.karat, pct: String(p.pct),
                              metal, usedOn: p.usedOn }); }}>Edit</button>
                      </>}
                    </div>
                  </td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>

      {/* ——— edit a grade (versioned) ——— */}
      {edit && (
        <div className="card" style={{ border: "1px dashed #cfc9ba", marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>
            Edit purity — {cap(edit.metal.kind)} {edit.karat}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 12 }}>
            <div><span style={F}>Grade name</span>
              <input style={I} value={edit.karat}
                onChange={e => setEdit({ ...edit, karat: e.target.value })} /></div>
            <div><span style={F}>Purity % of pure metal</span>
              <input style={{ ...I, ...mono }} inputMode="decimal" value={edit.pct}
                onChange={e => setEdit({ ...edit, pct: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            <div><span style={F}>Rate at this purity</span>
              <div style={{ ...I, display: "flex", alignItems: "center", background: "#faf9f4",
                fontWeight: 800, color: "var(--brass)", ...mono }}>
                {(() => { const b = baseFor(edit.metal);
                  return b != null && Number(edit.pct) > 0 ? inr(rateAtPurity(b, Number(edit.pct))) : "—"; })()}
              </div></div>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Base rate comes from the daily publish. This edit affects NEW valuations only — running
            loans keep the values they were sanctioned on{edit.usedOn > 0
              ? ` (${edit.usedOn} loans hold snapshots of the old figure)` : ""}.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn" disabled={busy || !edit.karat.trim() || !(Number(edit.pct) > 0)}
              onClick={async () => { const r = await post({ action: "edit_purity", id: edit.id,
                karat: edit.karat, pct: edit.pct });
                if (r) { setEdit(null); load(); } }}>
              {busy ? "Saving…" : "Save purity"}</button>
          </div>
        </div>
      )}

      <div className="hint" style={{ marginTop: 8 }}>
        Rate at purity = base rate × purity %. The scheme's funding % then applies on top.
        Adding a grade here makes it selectable on the appraisal grid — no code change.
      </div>

      {/* ——— add modal (two modes) ——— */}
      {add && (
        <div className="card" style={{ border: "1px dashed #cfc9ba", marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["grade", "Add a purity grade"], ["metal", "Add a metal"]].map(([m, label]) => (
              <button key={m} onClick={() => setAdd({ ...add, mode: m })}
                style={{ borderRadius: 99, border: "1px solid " + (add.mode === m ? "var(--vault)" : "#cfc9ba"),
                  background: add.mode === m ? "var(--vault)" : "#fff",
                  color: add.mode === m ? "#fff" : "var(--mut)", padding: "8px 14px",
                  fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>{label}</button>))}
          </div>

          {add.mode === "grade" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
              gap: 12 }}>
              <div><span style={F}>Metal</span>
                <select style={I} value={add.metalId}
                  onChange={e => setAdd({ ...add, metalId: Number(e.target.value) })}>
                  {data.metals.map(m => <option key={m.id} value={m.id}>{cap(m.kind)}</option>)}
                </select></div>
              <div><span style={F}>Grade name *</span>
                <input style={I} value={add.karat} placeholder="e.g. 23K"
                  onChange={e => setAdd({ ...add, karat: e.target.value })} /></div>
              <div><span style={F}>Purity % *</span>
                <input style={{ ...I, ...mono }} inputMode="decimal" value={add.pct} placeholder="92"
                  onChange={e => setAdd({ ...add, pct: e.target.value.replace(/[^\d.]/g, "") })} />
                <div className="hint" style={{ marginTop: 4 }}>
                  {(() => { const m = data.metals.find(x => x.id === Number(add.metalId));
                    const b = m ? baseFor(m) : null;
                    return b != null && Number(add.pct) > 0
                      ? "rate at this purity: " + inr(rateAtPurity(b, Number(add.pct)))
                      : "\u00a0"; })()}
                </div></div>
            </div>
          ) : data.addableKinds.length === 0 ? (
            <div className="hint" style={{ padding: "8px 0" }}>
              Every metal kind the database knows ({data.metals.map(m => cap(m.kind)).join(", ")})
              already exists. A brand-new kind is a database change, not a settings click — ask for it.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
              gap: 12 }}>
              <div><span style={F}>Metal kind</span>
                <select style={I} value={add.kind}
                  onChange={e => setAdd({ ...add, kind: e.target.value })}>
                  {data.addableKinds.map(k => <option key={k} value={k}>{cap(k)}</option>)}
                </select></div>
              <div><span style={F}>How it prices</span>
                <button onClick={() => setAdd({ ...add, valuedAsPctOfGold: !add.valuedAsPctOfGold })}
                  style={{ ...I, textAlign: "left", cursor: "pointer", fontWeight: 700,
                    color: add.valuedAsPctOfGold ? "var(--vault)" : "var(--mut)" }}>
                  {add.valuedAsPctOfGold ? "✓ As a % of the GOLD rate" : "Own daily rate pair"}</button>
                <div className="hint" style={{ marginTop: 4 }}>
                  New lending on it stays locked until a rate exists (Daily rate screen).</div></div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setAdd(null)}>Cancel</button>
            {(add.mode === "grade" || data.addableKinds.length > 0) &&
              <button className="btn" disabled={busy ||
                  (add.mode === "grade" ? (!add.karat.trim() || !(Number(add.pct) > 0)) : !add.kind)}
                onClick={async () => {
                  const r = await post(add.mode === "grade"
                    ? { action: "add_purity", metalId: add.metalId, karat: add.karat, pct: add.pct }
                    : { action: "add_metal", kind: add.kind, valuedAsPctOfGold: add.valuedAsPctOfGold });
                  if (r) { setAdd(null); load(); } }}>
                {busy ? "Saving…" : add.mode === "grade" ? "Save grade" : "Add metal"}</button>}
          </div>
        </div>
      )}

      {/* ——— rate sources ——— */}
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--mut)", margin: "20px 0 8px" }}>Rate sources</div>
      <div className="card" style={{ padding: "2px 16px" }}>
        {data.metals.map(m => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, padding: "12px 0", flexWrap: "wrap",
            borderBottom: "1px solid #f4f1e8" }}>
            <div>
              <div style={{ fontWeight: 700 }}>{cap(m.kind)}
                {canEdit && <>
                  <button className="btn ghost" disabled={busy}
                    style={{ marginLeft: 10, padding: "4px 10px", fontSize: 11.5 }}
                    onClick={async () => { const r = await post({ action: "toggle_metal", id: m.id });
                      if (r) load(); }}>{m.enabled ? "Disable metal" : "Enable metal"}</button>
                  {m.kind !== "gold" &&
                    <button className="btn ghost" disabled={busy}
                      style={{ marginLeft: 6, padding: "4px 10px", fontSize: 11.5 }}
                      onClick={async () => { const r = await post({ action: "toggle_pct_of_gold", id: m.id });
                        if (r) load(); }}>
                      {m.valuedAsPctOfGold ? "Unlink from gold" : "Link to gold"}</button>}
                </>}
              </div>
              <div className="hint" style={{ marginTop: 2 }}>
                {m.valuedAsPctOfGold
                  ? "prices as a % of the gold rate — grades above carry the percentage"
                  : m.rate
                    ? `set ${String(m.rate.date).slice(0, 10)} · market ${inr(m.rate.basePaise)} · funding ${inr(m.rate.fundingPaise)} per g`
                    : "no rate pair has ever been set for this metal"}
              </div>
            </div>
            <span className={"chip " + (!m.enabled ? "mut"
              : (m.valuedAsPctOfGold ? !!gold?.rate : !!m.rate) ? "ok" : "warn")}>
              {!m.enabled ? "disabled" :
                (m.valuedAsPctOfGold ? !!gold?.rate : !!m.rate)
                  ? "rate in force" : "no rate — not lendable"}</span>
          </div>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Unlinking a metal gives it its own pair on the Daily rate screen; after unlinking, revise
        its grades above to TRUE purity percentages (e.g. Silver99 → 99, not 1.75).
        Counter note: the appraisal grid prices gold today. Silver rows still refuse to price until
        the per-metal snapshot work lands (open decision O7) — this screen manages the grades so
        that day needs no migration.
      </div>
    </>
  );
}
