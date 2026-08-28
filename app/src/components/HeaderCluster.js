"use client";
import { useState } from "react";

/** Right-hand header cluster: branch (with switch for multi-branch users),
 *  user initials, and an icon-only sign-out. Server shell passes plain data. */
export default function HeaderCluster({ employeeId, branches, actingBranchId, initials }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const acting = branches.find(b => b.id === actingBranchId);

  async function switchTo(branchId) {
    if (busy || branchId === actingBranchId) { setOpen(false); return; }
    setBusy(true);
    const r = await fetch("/api/auth/branch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId, branchId, keep: true }),
    }).then(r => r.json()).catch(() => null);
    if (r?.ok) { window.location.href = "/home"; return; }
    setBusy(false); setOpen(false);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
      {/* branch pill — a switcher when posted to more than one branch */}
      {branches.length > 1 ? (
        <>
          <button onClick={() => setOpen(o => !o)} disabled={busy}
            style={{ display: "flex", alignItems: "center", gap: 7, background: "#123227",
              border: "1px solid #1b4434", color: "#cfe4da", borderRadius: 99,
              padding: "7px 14px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--brass)" }} />
            {acting ? `${acting.code} · ${acting.name}` : "pick branch"}
            <span style={{ fontSize: 10, opacity: .7 }}>▾</span>
          </button>
          {open && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200,
              background: "#123227", border: "1px solid #1b4434", borderRadius: 14,
              padding: 6, minWidth: 220, boxShadow: "0 12px 30px rgba(0,0,0,.35)" }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", color: "#5f8f7b",
                textTransform: "uppercase", padding: "7px 12px 4px" }}>Work at branch</div>
              {branches.map(b => (
                <button key={b.id} onClick={() => switchTo(b.id)} disabled={busy}
                  style={{ display: "flex", width: "100%", alignItems: "center", gap: 8,
                    background: b.id === actingBranchId ? "#0c231b" : "transparent",
                    border: 0, color: "#cfe4da", borderRadius: 10, padding: "9px 12px",
                    fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                  <span className="mono" style={{ color: "var(--brass-soft)", fontSize: 12 }}>{b.code}</span>
                  {b.name}
                  {b.id === actingBranchId &&
                    <span style={{ marginLeft: "auto", color: "var(--brass)", fontSize: 12 }}>✓</span>}
                </button>))}
            </div>)}
        </>
      ) : (
        <span style={{ display: "flex", alignItems: "center", gap: 7, background: "#123227",
          border: "1px solid #1b4434", color: "#cfe4da", borderRadius: 99,
          padding: "7px 14px", fontSize: 12.5, fontWeight: 800 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--brass)" }} />
          {acting ? `${acting.code} · ${acting.name}` : "no branch"}
        </span>
      )}

      {/* user initials */}
      <span title={undefined} style={{ width: 36, height: 36, borderRadius: 99,
        background: "var(--brass)", color: "#0c231b", display: "grid", placeItems: "center",
        fontWeight: 900, fontSize: 13, letterSpacing: ".02em" }}>{initials}</span>

      {/* icon-only sign out */}
      <form action="/api/auth/logout" method="post" style={{ display: "flex" }}>
        <button title="Sign out" aria-label="Sign out"
          style={{ width: 36, height: 36, borderRadius: 99, background: "transparent",
            border: "1px solid #2c5a46", color: "#cfe4da", cursor: "pointer",
            display: "grid", placeItems: "center", padding: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 3v8" /><path d="M6.3 6.5a8 8 0 1 0 11.4 0" />
          </svg>
        </button>
      </form>
    </div>
  );
}
