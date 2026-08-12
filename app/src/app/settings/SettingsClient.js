"use client";
import { useState } from "react";
import ChargesTab from "./ChargesTab.js";
import BranchesTab from "./BranchesTab.js";
import SchemesTab from "./SchemesTab.js";
import RolesTab from "./RolesTab.js";
import EmployeesTab from "./EmployeesTab.js";

const TABS = ["Charges", "Branches", "Schemes", "Roles", "Employees"];

export default function SettingsClient() {
  const [tab, setTab] = useState("Charges");
  return (
    <>
      <p style={{ color: "var(--mut)", fontSize: 14, margin: "0 0 14px", maxWidth: 640 }}>
        Structure is data, not code. What is created here is what the counter screens obey.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ border: "1px solid " + (tab === t ? "var(--vault)" : "#cfc9ba"),
              background: tab === t ? "var(--vault)" : "#fff",
              color: tab === t ? "#fff" : "var(--mut)",
              fontWeight: 800, fontSize: 13, padding: "9px 15px", borderRadius: 99,
              cursor: "pointer" }}>{t}</button>
        ))}
      </div>
      {tab === "Charges" && <ChargesTab />}
      {tab === "Branches" && <BranchesTab />}
      {tab === "Schemes" && <SchemesTab />}
      {tab === "Roles" && <RolesTab />}
      {tab === "Employees" && <EmployeesTab />}
    </>
  );
}
