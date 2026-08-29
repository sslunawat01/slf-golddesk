"use client";
/**
 * E14 №4 (owner, 28 Aug 2026): one prominent "Saved" banner for every form.
 * Render <SavedToast when={savedAt} /> and bump `savedAt` (Date.now()) on any
 * successful save — the banner slides in top-centre, holds ~2.4 s, and hides
 * itself. Nothing to clean up, nothing to dismiss.
 */
import { useEffect, useState } from "react";

export default function SavedToast({ when, text = "Saved ✓" }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!when) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 2400);
    return () => clearTimeout(t);
  }, [when]);
  if (!show) return null;
  return (
    <div style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)",
      zIndex: 9999, background: "#1e7a4f", color: "#fff", fontWeight: 900,
      fontSize: 15.5, letterSpacing: ".02em", padding: "12px 26px", borderRadius: 999,
      boxShadow: "0 6px 24px rgba(30,122,79,.35)", pointerEvents: "none" }}>
      {text}
    </div>
  );
}
