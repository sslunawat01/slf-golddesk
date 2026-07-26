"use client";
import { useState, useEffect, useRef } from "react";

const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");

export default function SearchClient() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes(null); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const r = await fetch("/api/search?q=" + encodeURIComponent(q.trim())).then(r => r.json()).catch(() => null);
      setRes(r); setBusy(false);
    }, 220);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div style={{ maxWidth: 760 }}>
      <input className="i mono" autoFocus value={q} onChange={e => setQ(e.target.value)}
        placeholder="Customer at counter? Type mobile, name, or loan no…"
        style={{ fontSize: 17, height: 54 }} />
      <div className="hint" style={{ marginTop: 6 }}>
        Search is the front door — new pledge, payment, renewal, enquiry, everything.
      </div>

      {busy && <div style={{ marginTop: 16, color: "var(--mut)", fontSize: 14 }}>searching…</div>}

      {res && (
        <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
          {res.loans?.map(l => (
            <a key={l.id} href={`/customers/${l.customerId}`} className="card"
              style={{ textDecoration: "none", color: "inherit", display: "flex",
                       justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="mono" style={{ fontWeight: 800 }}>{l.loanNo}</div>
                <div style={{ color: "var(--mut)", fontSize: 13 }}>
                  {l.customerName} · {l.scheme} · principal {inr(l.principalPaise)}</div>
              </div>
              <span className="chip info" style={{ alignSelf: "center" }}>loan → open customer</span>
            </a>
          ))}

          {res.customers?.map(c => (
            <a key={c.id} href={`/customers/${c.id}`} className="card"
              style={{ textDecoration: "none", color: "inherit", display: "flex",
                       justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800 }}>{c.fullName}</div>
                <div className="mono" style={{ color: "var(--mut)", fontSize: 13 }}>
                  {c.custNo} · {c.mobile}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {c.isBlacklisted
                  ? <span className="chip bad">blacklisted</span>
                  : <span className={"chip " + (c.kyc.state === "valid" ? "ok" : c.kyc.state === "expiring" ? "warn" : "bad")}>
                      {c.kyc.label}</span>}
                <div style={{ color: "var(--mut)", fontSize: 13, marginTop: 4 }}>
                  {c.openLoans} open · {inr(c.outPaise)} out</div>
              </div>
            </a>
          ))}

          {q.trim().length >= 2 && (
            <a href={`/customers/new?q=${encodeURIComponent(q.trim())}`}
              style={{ display: "block", border: "1px dashed #b8b2a2", borderRadius: 14, padding: 14,
                       textAlign: "left", color: "var(--mut)", fontWeight: 700, fontSize: 14,
                       textDecoration: "none" }}>
              + New customer “{q.trim()}” — full KYC capture
            </a>
          )}

          {!res.loans?.length && !res.customers?.length && (
            <div style={{ color: "var(--mut)", fontSize: 14 }}>
              Nothing matched. Create the customer above, or check the spelling.</div>
          )}
        </div>
      )}
    </div>
  );
}
