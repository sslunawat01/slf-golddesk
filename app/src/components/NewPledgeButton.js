"use client";
import { useState } from "react";
import TopNotice from "@/app/ui/TopNotice.js";

/** Starts (or resumes) a pledge, then opens the wizard. Any refusal is shown verbatim. */
export default function NewPledgeButton({ customerId }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function start() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/applications", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId }),
    }).then(async r => {
      const body = await r.json().catch(() => null);
      return body ?? { ok: false, reason: `Server error ${r.status} — nothing was saved` };
    }).catch(() => ({ ok: false, reason: "Cannot reach the server — check the connection" }));
    if (!r.ok) { setBusy(false); setErr(r.reason); return; }
    window.location.href = `/pledge/${r.id}`;
  }

  return (
    <div>
      <button className="btn" onClick={start} disabled={busy}
        style={{ width: "100%", background: "var(--brass)", color: "var(--vault)" }}>
        {busy ? "Starting…" : "+ New pledge"}
      </button>
      {err && <div style={{ marginTop: 8 }}><span className="chip bad">{err}</span></div>}
      <TopNotice notice={err} onClose={() => setErr(null)} />
    </div>
  );
}
