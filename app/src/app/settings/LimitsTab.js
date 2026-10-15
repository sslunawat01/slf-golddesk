"use client";
import { useEffect, useState } from "react";
import SavedToast from "@/app/ui/SavedToast.js";

const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");
const LABELS = {
  cash_disburse_below_paise: { title: "Cash paid out on a loan must be below",
    law: "Sec 269SS of the Income-tax Act: a loan of ₹20,000 or more may not be given in cash" },
  cash_receipt_day_max_paise: { title: "Cash received from one customer in a day, at most",
    law: "Sec 269ST of the Income-tax Act: ₹2,00,000 or more in cash from one person in a day is prohibited" },
};

/** E32 №6 — Settings · Limits: the two cash caps, with the legal figure beside each. */
export default function LimitsTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const load = () => fetch("/api/settings/limits").then(r => r.json())
    .then(r => { if (!r.ok) return setErr(r.reason); setData(r);
      setVals(Object.fromEntries(Object.entries(r.limits).map(([k, v]) => [k, String(v.paise / 100)]))); })
    .catch(() => setErr("Could not load limits"));
  useEffect(() => { load(); }, []);
  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  async function save() {
    setBusy(true); setErr(null);
    const body = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Math.round(Number(v || 0) * 100)]));
    const r = await fetch("/api/settings/limits", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr(r?.reason || "Could not save"); return; }
    setSavedAt(Date.now()); load();
  }

  return (
    <div className="card">
      <SavedToast when={savedAt} />
      <h2 style={{ fontSize: 16, fontWeight: 900, margin: "0 0 4px" }}>Cash limits</h2>
      <div className="hint" style={{ marginBottom: 14 }}>
        Read by every disbursement and every receipt, at every branch, the moment they are saved.
        The legal figure is shown beside each; a figure above it is your decision and is recorded as such.</div>
      {Object.entries(data.limits).map(([k, v]) => {
        const paise = Math.round(Number(vals[k] || 0) * 100);
        const above = paise > v.legalPaise;
        return (
          <div key={k} style={{ borderTop: "1px solid var(--line)", padding: "14px 0" }}>
            <label className="f">{LABELS[k].title}</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: 10, color: "var(--mut)", fontWeight: 800 }}>₹</span>
                <input className="i mono" style={{ width: 200, paddingLeft: 26, fontSize: 17, fontWeight: 800 }}
                  value={vals[k] ?? ""} disabled={!data.canEdit} data-limit={k}
                  onChange={e => setVals({ ...vals, [k]: e.target.value.replace(/[^\d]/g, "") })} />
              </div>
              <span className={"chip " + (above ? "bad" : "ok")}>
                {above ? `ABOVE the legal figure of ${inr(v.legalPaise)}` : `within the legal figure of ${inr(v.legalPaise)}`}</span>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{LABELS[k].law}
              {v.by && <> · last set by {v.by} on {new Date(v.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</>}</div>
          </div>);
      })}
      {data.canEdit && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button type="button" className="btn green" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save limits"}</button>
          {err && <span className="chip bad">{err}</span>}
        </div>)}
    </div>
  );
}
