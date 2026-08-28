"use client";
import { Fragment, useEffect, useState } from "react";
import { FUNCTION_LABELS, DAY_PRESETS, presetForDays } from "@/lib/roles.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff" };
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

const LEVEL_LABELS = { none: "None", view: "View", full: "Full" };

export default function RolesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null);        // selected role id
  const [draft, setDraft] = useState(null);    // editable copy of the selected role
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [naming, setNaming] = useState(null);  // {mode:'rename'|'clone'|'create', value}

  const load = () => fetch("/api/settings/roles").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason))
    .catch(() => setErr("Could not load roles"));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!data) return;
    const id = sel ?? data.rows[0]?.id ?? null;
    if (id !== sel) setSel(id);
    const row = data.rows.find(r => r.id === id);
    setDraft(row ? {
      permissions: { ...row.permissions },
      window: { from: row.loginFrom || "", to: row.loginTo || "",
        days: row.loginDays, graceMin: row.graceMin },
      limit: { limitRs: row.limit.isUnlimited || row.limit.limitPaise === 0
          ? "" : String(row.limit.limitPaise / 100),
        isUnlimited: row.limit.isUnlimited, reason: row.limit.reason || "" },
      schemeIds: [...row.schemeIds],
    } : null);
    setSaved(false);
  }, [data, sel]);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  const role = data ? data.rows.find(r => r.id === sel) : null;
  if (!data || !draft || !role)
    return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const canEdit = data.canEdit;

  async function post(body) {
    setBusy(true); setErr(null); setSaved(false);
    const r = await fetch("/api/settings/roles", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return null; }
    return r;
  }

  async function saveAll() {
    const r = await post({ action: "update", id: role.id, permissions: draft.permissions,
      window: draft.window, limit: draft.limit, schemeIds: draft.schemeIds });
    if (r) { setSaved(true); load(); }
  }
  async function saveName() {
    const body = naming.mode === "create"
      ? { action: "create", name: naming.value }
      : { action: naming.mode, id: role.id, name: naming.value };
    const r = await post(body);
    if (r) {
      setNaming(null);
      await fetch("/api/settings/roles").then(x => x.json())
        .then(x => { if (x.ok) { setData(x); if (r.id) setSel(r.id); } })
        .catch(() => load());
    }
  }

  const VERBS = ["view", "add", "edit", "delete"];
  const bitsOf = (fn) => {
    const v = draft.permissions[fn];
    if (!v || v === "none") return { view: false, add: false, edit: false, delete: false };
    if (typeof v === "string")   // legacy level on an unsaved old draft
      return { view: true, add: v === "full", edit: v === "full", delete: v === "full" };
    return { view: !!v.view, add: !!v.add, edit: !!v.edit, delete: !!v.delete };
  };
  const setBit = (fn, verb) => {
    const cur = bitsOf(fn);
    const next = { ...cur, [verb]: !cur[verb] };
    if (verb !== "view" && next[verb]) next.view = true;         // power implies view
    if (verb === "view" && !next.view) next.add = next.edit = next.delete = false;
    setDraft({ ...draft, permissions: { ...draft.permissions, [fn]: next } });
  };
  const setColumn = (verb, on) => {
    const perms = { ...draft.permissions };
    for (const fn of Object.keys(FUNCTION_LABELS)) {
      if (fn === "settings") continue;                            // legacy umbrella stays untouched
      const cur = (typeof perms[fn] === "object" && perms[fn]) ||
        { view: false, add: false, edit: false, delete: false };
      const next = { ...cur, [verb]: on };
      if (on && verb !== "view") next.view = true;
      if (!on && verb === "view") { next.add = next.edit = next.delete = false; }
      perms[fn] = next;
    }
    setDraft({ ...draft, permissions: perms });
  };
  const setWin = (k, v) => setDraft({ ...draft, window: { ...draft.window, [k]: v } });
  const setLim = (k, v) => setDraft({ ...draft, limit: { ...draft.limit, [k]: v } });
  const toggleScheme = (id) => setDraft({ ...draft,
    schemeIds: draft.schemeIds.includes(id)
      ? draft.schemeIds.filter(x => x !== id) : [...draft.schemeIds, id] });

  const limitText = draft.limit.isUnlimited ? "UNLIMITED — explicit grant"
    : !draft.limit.limitRs || Number(draft.limit.limitRs) === 0
      ? "₹0 — every loan routes to Head Office"
      : inr(Number(draft.limit.limitRs) * 100) + " per loan · above it routes to HO";

  return (
    <>
      {/* ——— role pills ——— */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {data.rows.map(r => (
          <button key={r.id} onClick={() => setSel(r.id)}
            style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 99,
              border: "1px solid " + (sel === r.id ? "var(--vault)" : "#cfc9ba"),
              background: sel === r.id ? "var(--vault)" : "#fff",
              color: sel === r.id ? "#fff" : "var(--mut)",
              padding: "9px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            {r.name}
            <span style={{ minWidth: 20, textAlign: "center", padding: "1px 7px",
              borderRadius: 99, fontSize: 11, fontWeight: 800,
              background: sel === r.id ? "rgba(255,255,255,.22)" : "#eceadf",
              color: sel === r.id ? "#fff" : "var(--mut)" }}>{r.members}</span>
          </button>
        ))}
        {canEdit &&
          <button onClick={() => setNaming({ mode: "create", value: "" })}
            style={{ borderRadius: 99, border: "1px dashed #cfc9ba", background: "#fff",
              color: "var(--mut)", padding: "9px 14px", fontWeight: 800, fontSize: 13,
              cursor: "pointer" }}>+ Add role</button>}
      </div>

      {/* ——— naming form (create / rename / clone) ——— */}
      {naming && (
        <div className="card" style={{ border: "1px dashed #cfc9ba", marginBottom: 14 }}>
          <span style={F}>{naming.mode === "create" ? "New role name" :
            naming.mode === "rename" ? "Rename " + role.name : "Clone " + role.name + " as"} *</span>
          <input style={{ ...I, width: "100%", maxWidth: 340 }} value={naming.value}
            placeholder="e.g. Compliance officer" autoFocus
            onChange={e => setNaming({ ...naming, value: e.target.value })} />
          {naming.mode === "create" &&
            <div className="hint" style={{ marginTop: 6 }}>
              Starts with no permissions and no schemes — deny by default. Grant after creating.</div>}
          {naming.mode === "clone" &&
            <div className="hint" style={{ marginTop: 6 }}>
              Copies permissions, login window, schemes and the sanction limit. Members are not copied.</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setNaming(null)}>Cancel</button>
            <button className="btn" disabled={busy || naming.value.trim().length < 3}
              onClick={saveName}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}

      {/* ——— selected role card ——— */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{role.name}
            {role.isSystem && <span className="chip mut" style={{ marginLeft: 8 }}>system role</span>}
          </div>
          {canEdit && <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => setNaming({ mode: "rename", value: role.name })}>Rename</button>
            <button className="btn ghost" onClick={() => setNaming({ mode: "clone", value: "Copy of " + role.name })}>Clone</button>
          </div>}
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          Renaming never changes what the role may do — rules attach to the operation, not the title.
        </div>

        {/* ——— permission grid: View / Add / Edit / Delete (D-B) ——— */}
        <div style={{ ...F, marginTop: 18 }}>Permissions — tick what this role may do</div>
        <div style={{ background: "#faf9f4", border: "1px solid #f0ede4", borderRadius: 12,
          padding: "4px 14px 10px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 4px", fontSize: 10.5,
                  letterSpacing: ".07em", textTransform: "uppercase", color: "var(--mut)" }}>
                  Operation</th>
                {VERBS.map(v => (
                  <th key={v} style={{ padding: "10px 4px", fontSize: 10.5, letterSpacing: ".07em",
                    textTransform: "uppercase", color: "var(--mut)", width: 86 }}>
                    {v === "delete" ? "Delete" : v[0].toUpperCase() + v.slice(1)}
                    {canEdit && <div style={{ marginTop: 3, fontWeight: 600, fontSize: 10 }}>
                      <button onClick={() => setColumn(v, true)} style={{ border: 0,
                        background: "none", color: "var(--brass)", cursor: "pointer",
                        fontSize: 10, fontWeight: 800, padding: 1 }}>all</button>
                      {" · "}
                      <button onClick={() => setColumn(v, false)} style={{ border: 0,
                        background: "none", color: "var(--mut)", cursor: "pointer",
                        fontSize: 10, fontWeight: 800, padding: 1 }}>none</button>
                    </div>}
                  </th>))}
              </tr>
            </thead>
            <tbody>
              {[["Desk operations", Object.keys(FUNCTION_LABELS).filter(f =>
                  !f.startsWith("set_") && f !== "settings")],
                ["Settings — every tab separately", Object.keys(FUNCTION_LABELS).filter(f =>
                  f.startsWith("set_"))]].map(([groupLabel, fns]) => (
                <Fragment key={groupLabel}>
                  <tr><td colSpan={5} style={{ padding: "12px 4px 5px", fontSize: 10.5,
                    fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase",
                    color: "#a89968", borderBottom: "1px solid #eee9dd" }}>{groupLabel}</td></tr>
                  {fns.map(fn => {
                    const bit = bitsOf(fn);
                    return (
                      <tr key={fn} style={{ borderBottom: "1px solid #f0ede4" }}>
                        <td style={{ padding: "8px 4px", fontWeight: 700, fontSize: 13 }}>
                          {FUNCTION_LABELS[fn].replace("Settings · ", "")}</td>
                        {VERBS.map(v => (
                          <td key={v} style={{ textAlign: "center", padding: "6px 4px" }}>
                            <input type="checkbox" checked={bit[v]} disabled={!canEdit}
                              onChange={() => setBit(fn, v)}
                              style={{ width: 17, height: 17, accentColor: "var(--vault)",
                                cursor: canEdit ? "pointer" : "default" }} />
                          </td>))}
                      </tr>);
                  })}
                </Fragment>))}
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 6 }}>
            View = see the screens · Add = perform the desk&rsquo;s actions / create records ·
            Edit = change existing · Delete = remove. Ticking any power ticks View with it.
          </div>
        </div>

        {/* ——— sanction limit ——— */}
        <div style={{ ...F, marginTop: 18 }}>Sanction limit — per loan</div>
        <div style={{ background: "#faf9f4", border: "1px solid #f0ede4", borderRadius: 12,
          padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input style={{ ...I, width: 160, fontFamily: "ui-monospace,monospace" }}
              inputMode="numeric" placeholder="0" disabled={!canEdit || draft.limit.isUnlimited}
              value={draft.limit.limitRs}
              onChange={e => setLim("limitRs", e.target.value.replace(/[^\d]/g, ""))} />
            <button disabled={!canEdit}
              onClick={() => setLim("isUnlimited", !draft.limit.isUnlimited)}
              style={{ border: "1px solid " + (draft.limit.isUnlimited ? "var(--bad)" : "#cfc9ba"),
                background: draft.limit.isUnlimited ? "var(--bad)" : "#fff",
                color: draft.limit.isUnlimited ? "#fff" : "var(--mut)",
                borderRadius: 99, padding: "8px 14px", fontWeight: 800, fontSize: 12,
                cursor: canEdit ? "pointer" : "default" }}>
              {draft.limit.isUnlimited ? "✓ Unlimited" : "Unlimited"}</button>
            <span className={"chip " + (draft.limit.isUnlimited ? "bad"
              : (!draft.limit.limitRs || Number(draft.limit.limitRs) === 0) ? "mut" : "ok")}>
              {limitText}</span>
          </div>
          {draft.limit.isUnlimited && (
            <div style={{ marginTop: 10 }}>
              <span style={F}>Reason for unlimited authority · mandatory</span>
              <input style={{ ...I, width: "100%" }} value={draft.limit.reason}
                disabled={!canEdit}
                placeholder="Why does this role need no ceiling? (min 5 characters)"
                onChange={e => setLim("reason", e.target.value)} />
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            Blank means ₹0 — nothing is sanctioned at the branch; every loan routes to Head Office.
            Unlimited is an explicit, recorded grant, never the silent default.
          </div>
        </div>

        {/* ——— login window ——— */}
        <div style={{ ...F, marginTop: 18 }}>Allowed login period</div>
        <div style={{ background: "#faf9f4", border: "1px solid #f0ede4", borderRadius: 12,
          padding: "12px 14px", display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12 }}>
          <div><span style={F}>From</span>
            <input type="time" style={{ ...I, width: "100%" }} disabled={!canEdit}
              value={draft.window.from} onChange={e => setWin("from", e.target.value)} /></div>
          <div><span style={F}>To</span>
            <input type="time" style={{ ...I, width: "100%" }} disabled={!canEdit}
              value={draft.window.to} onChange={e => setWin("to", e.target.value)} /></div>
          <div><span style={F}>Days</span>
            <select style={{ ...I, width: "100%" }} disabled={!canEdit}
              value={presetForDays(draft.window.days)}
              onChange={e => { const hit = DAY_PRESETS.find(([l]) => l === e.target.value);
                if (hit) setWin("days", hit[1]); }}>
              {DAY_PRESETS.map(([l]) => <option key={l} value={l}>{l}</option>)}
              {presetForDays(draft.window.days) === "Custom" && <option>Custom</option>}
            </select></div>
          <div><span style={F}>Grace minutes</span>
            <input inputMode="numeric" style={{ ...I, width: "100%" }} disabled={!canEdit}
              value={draft.window.graceMin}
              onChange={e => setWin("graceMin", Number(e.target.value.replace(/[^\d]/g, "") || 0))} /></div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Leave From and To empty for any time. Outside the window, sign-in is refused with the
          hours named. Grace lets an open session finish past the To time.
        </div>

        {/* ——— schemes ——— */}
        <div style={{ ...F, marginTop: 18 }}>Loan schemes this role may sanction</div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {data.schemes.map(s => {
            const on = draft.schemeIds.includes(Number(s.id));
            return (
              <button key={s.id} disabled={!canEdit}
                onClick={() => toggleScheme(Number(s.id))}
                style={{ display: "flex", alignItems: "center", gap: 7,
                  border: "1px solid " + (on ? "var(--vault)" : "#cfc9ba"),
                  background: on ? "var(--vault)" : "#fff",
                  color: on ? "#fff" : "var(--mut)", borderRadius: 10,
                  padding: "8px 12px", fontWeight: 800, fontSize: 12,
                  cursor: canEdit ? "pointer" : "default" }}>
                <span style={{ width: 15, height: 15, borderRadius: 4,
                  border: "2px solid currentColor",
                  background: on ? "rgba(255,255,255,.25)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 900 }}>{on ? "✓" : ""}</span>
                {s.code}</button>
            );
          })}
        </div>

        {/* ——— save ——— */}
        {canEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center",
            gap: 12, marginTop: 20, borderTop: "1px solid #f0ede4", paddingTop: 14 }}>
            {err && <span className="chip bad">{err}</span>}
            {saved && !err && <span className="chip ok">Saved — live sessions pick it up in seconds</span>}
            <button className="btn" disabled={busy} onClick={saveAll}>
              {busy ? "Saving…" : "Save " + role.name}</button>
          </div>
        )}
      </div>
    </>
  );
}
