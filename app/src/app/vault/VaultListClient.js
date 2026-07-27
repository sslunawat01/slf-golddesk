"use client";
import { useEffect, useState } from "react";
import { bucketCounts, vaultInBucket, mgToGrams } from "@/lib/vault.js";

const dmy = (d) => { const [y, m, dd] = String(d).split("-"); return `${dd}-${m}-${y}`; };

export default function VaultListClient() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/vault").then(r => r.json())
      .then(r => r.ok ? setData(r) : setErr(r.reason))
      .catch(() => setErr("Could not load the vault list"));
  }, []);

  if (err) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const waiting = data.rows.filter(r => r.status === "at_counter");
  const frozen = data.rows.filter(r => r.status === "frozen");
  const counts = bucketCounts(waiting, data.today);

  const shown = waiting.filter(r =>
    filter === "all" ? true
    : filter === "today" ? vaultInBucket(r.disbursedAt, data.today) === "today"
    : vaultInBucket(r.disbursedAt, data.today) === "since_yesterday");

  const chips = [
    ["all", "All", counts.all],
    ["since", "Since yesterday", counts.sinceYesterday],
    ["today", "Disbursed today", counts.disbursedToday],
  ];

  return (
    <>
      <p style={{ color: "var(--mut)", fontSize: 13.5, margin: "0 0 14px", maxWidth: 640 }}>
        Disbursed pledges still in counter custody · recheck, then safe.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {chips.map(([k, label, n]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{ border: "1px solid " + (filter === k ? "var(--vault)" : "#cfc9ba"),
              background: filter === k ? "var(--vault)" : "#fff",
              color: filter === k ? "#fff" : "var(--mut)",
              borderRadius: 99, padding: "6px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            {label} · {n}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "var(--mut)", padding: "28px 16px" }}>
          Nothing waiting — every packet is in a safe.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {shown.map(r => (
          <div key={r.id} className="card" style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{r.customerName}</div>
              <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 3 }}>
                {r.loanNo} · packet {r.packetNo} · {mgToGrams(r.netMg)} g · disbursed {dmy(r.disbursedAt)}
              </div>
            </div>
            {data.canAct
              ? <a href={`/vault/${r.id}`} className="btn" style={{ textDecoration: "none" }}>
                  Recheck &amp; vault-in →</a>
              : <span className="chip mut">view only</span>}
          </div>
        ))}
      </div>

      {frozen.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 900, margin: "26px 0 10px" }}>
            Frozen after a mismatch — Head Office must clear these</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {frozen.map(r => (
              <div key={r.id} className="card" style={{ borderColor: "var(--bad)" }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{r.customerName}</div>
                <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 3 }}>
                  {r.loanNo} · packet {r.packetNo} · {mgToGrams(r.netMg)} g
                </div>
                <div style={{ marginTop: 8 }}><span className="chip bad">frozen — not in a safe</span></div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
