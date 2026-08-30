"use client";
import { useEffect, useMemo, useState } from "react";
import DateInput from "@/components/DateInput.js";
import SavedToast from "@/app/ui/SavedToast.js";
import PhotoInput from "@/components/PhotoInput.js";
import TopNotice from "@/app/ui/TopNotice.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const BLOOD = ["A+", "A−", "B+", "B−", "AB+", "AB−", "O+", "O−"];

const blank = () => ({ fullName: "", gender: "", dob: "", photo: null, photoFileId: null, mobile: "", altMobile: "",
  personalEmail: "", bloodGroup: "", fatherSpouseName: "",
  aadhaarLast4: "", panNo: "", address: {},
  designation: "", department: "",
  doj: new Date().toISOString().slice(0, 10),   // today by default — editable
  reportsTo: "", employmentType: "",
  roleIds: [], branchIds: [], primaryBranchId: 0,
  username: "", officialEmail: "", password: "", confirm: "" });

const STEPS = ["Identity", "KYC & documents", "Employment", "System access",
  "Location & geo-fence", "Review"];

export default function EmployeesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);   // №4: flashes the shared Saved banner
  const [qs, setQs] = useState("");                 // search
  const [fRole, setFRole] = useState(0);
  const [fBranch, setFBranch] = useState(0);
  const [fStatus, setFStatus] = useState("active");
  const [open, setOpen] = useState(null);           // expanded employee id
  const [mem, setMem] = useState(null);             // membership draft for the open row
  const [wiz, setWiz] = useState(null);             // wizard form (create)
  const [step, setStep] = useState(1);
  const [made, setMade] = useState(null);           // credentials shown once
  const [action, setAction] = useState(null);       // {kind:'suspend'|'reset', id, ...fields}
  const [confirm, setConfirm] = useState(null);      // { kind: 'master'|'dup', text }

  const load = () => fetch("/api/settings/employees").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason))
    .catch(() => setErr("Could not load employees"));
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(e =>
      (fStatus === "all" || (fStatus === "active" ? e.status === "active" : e.status !== "active")) &&
      (!fRole || e.roleIds.includes(fRole)) &&
      (!fBranch || e.branchIds.includes(fBranch)) &&
      (!qs || (e.fullName + " " + e.username + " " + (e.empCode || ""))
        .toLowerCase().includes(qs.toLowerCase())));
  }, [data, qs, fRole, fBranch, fStatus]);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const canEdit = data.canEdit;
  const roleName = (id) => data.roles.find(r => r.id === id)?.name || "?";
  const branchCode = (id) => data.branches.find(b => b.id === id)?.code || "?";

  async function postRaw(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/employees", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    return r;
  }
  async function post(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/employees", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return null; }
    setSavedAt(Date.now());   // №4: every successful save announces itself
    return r;
  }

  // ——— wizard helpers ———
  const w = wiz || blank();
  const setW = (k) => (e) => setWiz({ ...w, [k]: e?.target ? e.target.value : e });
  const toggle = (k, id) => setWiz({ ...w,
    [k]: w[k].includes(id) ? w[k].filter(x => x !== id) : [...w[k], id] });

  const miss = [
    !w.fullName.trim() || !/^[6-9]\d{9}$/.test(w.mobile.replace(/\D/g, "")),
    !w.aadhaarLast4 && !w.panNo,
    !w.designation.trim() || !w.doj || w.roleIds.length === 0 || w.branchIds.length === 0,
    !w.username.trim() || !w.password || w.password !== w.confirm,
    false,  // step 5 stores nothing yet
  ];
  const reachable = (n) => n === 1 || miss.slice(0, n - 1).every(m => !m);

  async function createEmployee(ack) {
    // typed a designation/department not in the master? one explicit confirmation.
    if (!ack) {
      const newbies = [];
      const dg = (w.designation || "").trim(), dp = (w.department || "").trim();
      if (dg && !(data.designations || []).some(x => x.toLowerCase() === dg.toLowerCase()))
        newbies.push(`designation "${dg}"`);
      if (dp && !(data.departments || []).some(x => x.toLowerCase() === dp.toLowerCase()))
        newbies.push(`department "${dp}"`);
      if (newbies.length) {
        setConfirm({ kind: "master",
          text: `This will add a NEW ${newbies.join(" and a NEW ")} to the master. Are you sure?` });
        return;
      }
    }
    const r = await postRaw({ action: "create", ...w,
      primaryBranchId: w.primaryBranchId || w.branchIds[0],
      reportsTo: w.reportsTo || null, dupAcknowledged: confirm?.kind === "dup" && ack });
    if (r?.needsDupConfirm) { setConfirm({ kind: "dup", text: r.reason }); return; }
    if (!r?.ok) { if (r) setErr(r.reason); return; }
    setConfirm(null);
    setMade({ username: r.username, empCode: r.empCode, password: w.password });
    setWiz(null); setStep(1); load();
  }

  async function saveMembership(e) {
    const r = await post({ action: "membership", id: e.id, roleIds: mem.roleIds,
      branchIds: mem.branchIds, primaryBranchId: mem.primaryBranchId });
    if (r) { setOpen(null); setMem(null); load(); }
  }

  async function doAction() {
    const body = action.kind === "suspend"
      ? { action: "suspend", id: action.id, dol: action.dol, reason: action.reason }
      : { action: "reset_password", id: action.id, password: action.password, confirm: action.confirm };
    const r = await post(body);
    if (r) {
      if (action.kind === "reset") setMade({ username: action.username, password: action.password, reset: true });
      setAction(null); load();
    }
  }

  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13.5 };

  return (
    <>
      <SavedToast when={savedAt} />
      {/* ——— credentials shown ONCE ——— */}
      {made && (
        <div className="card" style={{ border: "2px solid var(--vault)", marginBottom: 14 }}>
          <div style={{ fontWeight: 900 }}>
            {made.reset ? "Password reset" : "Employee created"} — pass these on now, they are shown once</div>
          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 15, margin: "10px 0" }}>
            {made.empCode && <>Code&nbsp; <b>{made.empCode}</b><br /></>}
            Username&nbsp; <b>{made.username}</b><br />
            Password&nbsp; <b>{made.password}</b>
          </div>
          <div className="hint">This password works as-is — they may change it themselves later from the sign-in menu.</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button className="btn ghost" onClick={() =>
              navigator.clipboard?.writeText(`SLF GoldDesk — https://slf.slunawat.in\nUsername: ${made.username}\nTemporary password: ${made.password}`)}>
              Copy message</button>
            <button className="btn" onClick={() => setMade(null)}>Done — hide it</button>
          </div>
        </div>
      )}

      {/* ——— filters ——— */}
      {!wiz && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input style={{ ...I, width: 200 }} placeholder="Search name / username"
            value={qs} onChange={e => setQs(e.target.value)} />
          <select style={{ ...I, width: 170 }} value={fRole} onChange={e => setFRole(Number(e.target.value))}>
            <option value={0}>All roles</option>
            {data.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select style={{ ...I, width: 150 }} value={fBranch} onChange={e => setFBranch(Number(e.target.value))}>
            <option value={0}>All branches</option>
            {data.branches.map(b => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}
          </select>
          {["active", "suspended", "all"].map(s => (
            <button key={s} onClick={() => setFStatus(s)}
              style={{ borderRadius: 99, border: "1px solid " + (fStatus === s ? "var(--vault)" : "#cfc9ba"),
                background: fStatus === s ? "var(--vault)" : "#fff",
                color: fStatus === s ? "#fff" : "var(--mut)", padding: "8px 13px",
                fontWeight: 800, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>{s}</button>
          ))}
          {canEdit &&
            <button className="btn" style={{ marginLeft: "auto" }}
              onClick={() => { setWiz(blank()); setStep(1); setErr(null); }}>+ New employee</button>}
        </div>
      )}

      {err && <div style={{ marginBottom: 10 }}><span className="chip bad">{err}</span></div>}
      <TopNotice notice={err} onClose={() => setErr(null)} />

      {/* ——— the list ——— */}
      {!wiz && (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr style={{ background: "#f0eee6" }}>
              {["Employee", "Designation", "Roles", "Branches", "Status", ""].map(h =>
                <th key={h} style={{ ...td, textAlign: "left", fontSize: 11,
                  textTransform: "uppercase", letterSpacing: ".07em" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(e => (
                <RowGroup key={e.id} e={e} td={td} open={open === e.id}
                  onOpen={() => { setOpen(open === e.id ? null : e.id);
                    setMem({ roleIds: [...e.roleIds], branchIds: [...e.branchIds],
                      primaryBranchId: e.primaryBranchId || e.branchIds[0] || 0 }); setErr(null); }}
                  data={data} mem={open === e.id ? mem : null} setMem={setMem}
                  canEdit={canEdit} busy={busy} selfId={data.selfId}
                  onSaveMem={() => saveMembership(e)}
                  onSuspend={() => setAction({ kind: "suspend", id: e.id, name: e.fullName, dol: "", reason: "" })}
                  onReactivate={async () => { const r = await post({ action: "reactivate", id: e.id }); if (r) load(); }}
                  onReset={() => setAction({ kind: "reset", id: e.id, username: e.username, password: "", confirm: "" })}
                  roleName={roleName} branchCode={branchCode} />
              ))}
              {rows.length === 0 &&
                <tr><td colSpan={6} style={{ ...td, color: "var(--mut)" }}>Nobody matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ——— suspend / reset dialogs ——— */}
      {action && (
        <div className="card" style={{ border: "1px solid var(--bad)", marginTop: 14 }}>
          {action.kind === "suspend" ? (<>
            <div style={{ fontWeight: 900 }}>Suspend {action.name}</div>
            <div className="hint" style={{ margin: "4px 0 12px" }}>
              Their sign-in stops immediately and open sessions end. Everything they ever did stays
              attributed to them. Reactivation is one button — nothing is deleted.</div>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
              <div><span style={F}>Date of leaving *</span>
                <DateInput style={I} value={action.dol}
                  onChange={v => setAction({ ...action, dol: v })} /></div>
              <div><span style={F}>Reason · min 5 characters *</span>
                <input style={I} value={action.reason} placeholder="e.g. Resigned, last day 31 Aug"
                  onChange={e => setAction({ ...action, reason: e.target.value })} /></div>
            </div>
          </>) : (<>
            <div style={{ fontWeight: 900 }}>Reset password — {action.username}</div>
            <div className="hint" style={{ margin: "4px 0 12px" }}>
              Type the new password. Their open sessions end; the new password works as-is.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><span style={F}>Password *</span>
                <input style={I} value={action.password}
                  onChange={e => setAction({ ...action, password: e.target.value })} /></div>
              <div><span style={F}>Type it again *</span>
                <input style={I} value={action.confirm}
                  onChange={e => setAction({ ...action, confirm: e.target.value })} /></div>
            </div>
          </>)}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setAction(null)}>Cancel</button>
            <button className="btn" disabled={busy} onClick={doAction}
              style={action.kind === "suspend" ? { background: "var(--bad)" } : undefined}>
              {busy ? "Saving…" : action.kind === "suspend" ? "Suspend" : "Reset password"}</button>
          </div>
        </div>
      )}

      {/* ——— the six-step wizard ——— */}
      {wiz && (
        <div className="card">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {STEPS.map((label, i) => {
              const n = i + 1;
              return (
                <button key={n} onClick={() => reachable(n) && setStep(n)}
                  style={{ border: 0, padding: "8px 13px", borderRadius: 11, fontWeight: 800,
                    fontSize: 12.5, cursor: reachable(n) ? "pointer" : "default",
                    background: step === n ? "var(--vault)" : "#eceadf",
                    color: step === n ? "#fff" : "var(--mut)",
                    opacity: reachable(n) ? 1 : .45 }}>{n} · {label}</button>);
            })}
          </div>

          {step === 1 && <div style={{ display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
            <div style={{ gridColumn: "1/-1" }}><span style={F}>Full name *</span>
              <input style={I} value={w.fullName} onChange={setW("fullName")}
                onBlur={e => setWiz({ ...w, fullName: toTitle(e.target.value) })}
                placeholder="As on Aadhaar / PAN" /></div>
            <div><span style={F}>Gender</span>
              <select style={I} value={w.gender} onChange={setW("gender")}>
                <option value="">—</option>
                {data.enums.genders.map(g => <option key={g} value={g}>{g}</option>)}
              </select></div>
            <div><span style={F}>Date of birth</span>
              <DateInput style={I} value={w.dob} onChange={v => setW("dob")({ target: { value: v } })} /></div>
            <div><span style={F}>Blood group</span>
              <select style={I} value={w.bloodGroup} onChange={setW("bloodGroup")}>
                <option value="">—</option>{BLOOD.map(b => <option key={b}>{b}</option>)}
              </select></div>
            <div><span style={F}>Father / spouse name</span>
              <input style={I} value={w.fatherSpouseName} onChange={setW("fatherSpouseName")}
                onBlur={e => setWiz({ ...w, fatherSpouseName: toTitle(e.target.value) })} /></div>
            <div><span style={F}>Mobile *</span>
              <input style={I} inputMode="numeric" maxLength={10} value={w.mobile}
                onChange={e => setWiz({ ...w, mobile: e.target.value.replace(/\D/g, "") })} /></div>
            <div><span style={F}>Alternate mobile</span>
              <input style={I} inputMode="numeric" maxLength={10} value={w.altMobile}
                onChange={e => setWiz({ ...w, altMobile: e.target.value.replace(/\D/g, "") })} /></div>
            <div><span style={F}>Personal email</span>
              <input style={I} value={w.personalEmail} onChange={setW("personalEmail")} /></div>
            <div style={{ gridColumn: "1/-1" }}>
              <PhotoInput kind="employee_face" label="Photo at the counter" square
                value={w.photo} onChange={(v) => setWiz({ ...w, photo: v, photoFileId: v?.fileId ?? null })}
                hint="Optional now — used on the employee card and for face sign-in later." /></div>
          </div>}

          {step === 2 && <div style={{ display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
            <div><span style={F}>Aadhaar *¹</span>
              <input style={I} inputMode="numeric" maxLength={14} value={w.aadhaarLast4}
                onChange={e => { const d = e.target.value.replace(/\D/g, "").slice(0, 12);
                  setWiz({ ...w, aadhaarLast4: d.replace(/(\d{4})(?=\d)/g, "$1 ") }); }}
                placeholder="4444 4444 4444" /></div>
            <div><span style={F}>PAN *¹</span>
              <input style={I} maxLength={10} value={w.panNo}
                onChange={e => setWiz({ ...w, panNo: panFilter(e.target.value) })}
                placeholder="BIWPK2312M" /></div>
            <div style={{ gridColumn: "1/-1" }} className="hint">
              *¹ At least one of the two. The full Aadhaar is stored on the employee's record
              (owner decision, 12 Aug 2026). Document uploads join in a later phase.</div>
          </div>}

          {step === 3 && <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
              gap: 12, marginBottom: 14 }}>
              <div><span style={F}>Designation *</span>
                <input style={I} value={w.designation} onChange={setW("designation")}
                  list="desig-master" placeholder="pick or type a new one" />
                <datalist id="desig-master">
                  {(data.designations || []).map(d => <option key={d} value={d} />)}
                </datalist></div>
              <div><span style={F}>Department</span>
                <input style={I} value={w.department} onChange={setW("department")}
                  list="dept-master" placeholder="pick or type a new one" />
                <datalist id="dept-master">
                  {(data.departments || []).map(d => <option key={d} value={d} />)}
                </datalist></div>
              <div><span style={F}>Date of joining *</span>
                <DateInput style={I} value={w.doj} onChange={v => setW("doj")({ target: { value: v } })} /></div>
              <div><span style={F}>Employment type</span>
                <select style={I} value={w.employmentType} onChange={setW("employmentType")}>
                  <option value="">permanent (default)</option>
                  {data.enums.types.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div><span style={F}>Reports to — type to search</span>
                <input style={I} list="emp-reports-to" value={w.reportsToName || ""}
                  placeholder="Start typing a name…"
                  onChange={e => {
                    const txt = e.target.value;
                    const hit = data.rows.find(x => x.status === "active"
                      && (x.fullName + " · " + x.empCode) === txt);
                    setWiz({ ...w, reportsToName: txt, reportsTo: hit ? hit.id : "" });
                  }} />
                <datalist id="emp-reports-to">
                  {data.rows.filter(x => x.status === "active").map(x =>
                    <option key={x.id} value={x.fullName + " · " + x.empCode} />)}
                </datalist></div>
            </div>
            <span style={F}>Role * — what they may do (one only)</span>
            <TickRow items={data.roles.map(r => [r.id, r.name])} on={w.roleIds}
              toggle={(id) => setW({ ...w,
                roleIds: w.roleIds.includes(id) ? [] : [id] })} />
            <span style={{ ...F, marginTop: 12 }}>Branches * — where they may work
              (tap ★ to set the primary)</span>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {data.branches.map(b => {
                const on = w.branchIds.includes(b.id);
                const isPrimary = w.primaryBranchId === b.id;
                return (
                  <button key={b.id} onClick={() => toggle("branchIds", b.id)}
                    style={tick(on)}>
                    {on && <span onClick={(ev) => { ev.stopPropagation();
                        setWiz({ ...w, primaryBranchId: b.id }); }}
                      style={{ marginRight: 5 }}>{isPrimary ? "★" : "☆"}</span>}
                    {b.code} {b.name}</button>);
              })}
            </div>
          </>}

          {step === 4 && <div style={{ display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
            <div><span style={F}>Username * — permanent, lowercase</span>
              <input style={I} value={w.username}
                onChange={e => setWiz({ ...w, username: e.target.value.toLowerCase().replace(/\s/g, "") })} /></div>
            <div><span style={F}>Official email</span>
              <input style={I} value={w.officialEmail} onChange={setW("officialEmail")} /></div>
            <div><span style={F}>Password *</span>
              <input style={I} value={w.password} onChange={setW("password")}
                placeholder="10+ chars, a letter and a number" /></div>
            <div><span style={F}>Type it again *</span>
              <input style={I} value={w.confirm} onChange={setW("confirm")} /></div>
            <div style={{ gridColumn: "1/-1" }} className="hint">
              This password works as-is — no forced change at first sign-in (owner decision).
              2-factor and face sign-in are visible in the design but switched off until that
              machinery lands.</div>
          </div>}

          {step === 5 && <div className="hint" style={{ padding: "20px 0" }}>
            Geo-fence and IP restriction are designed but not yet enforced anywhere in the system —
            recording them now would only pretend. This step activates in a later phase. Nothing to
            fill in; continue to Review.</div>}

          {step === 6 && <>
            <div style={{ background: "#faf9f4", border: "1px solid #f0ede4", borderRadius: 12,
              padding: "10px 16px", marginBottom: 14 }}>
              {[["Name", w.fullName], ["Mobile", w.mobile],
                ["ID", [w.aadhaarLast4 && "Aadhaar ····" + w.aadhaarLast4, w.panNo]
                  .filter(Boolean).join(" · ")],
                ["Designation", w.designation + (w.department ? " · " + w.department : "")],
                ["Joining", w.doj],
                ["Roles", w.roleIds.map(roleName).join(", ")],
                ["Branches", w.branchIds.map(branchCode).join(", ")
                  + " · primary " + branchCode(w.primaryBranchId || w.branchIds[0])],
                ["Username", w.username],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14,
                  padding: "7px 0", borderBottom: "1px dashed #e8e4d8", fontSize: 14 }}>
                  <span style={{ color: "var(--mut)" }}>{k}</span>
                  <b style={{ textAlign: "right" }}>{v || "—"}</b></div>))}
            </div>
            <div className="hint">Read it back to yourself. The username can never change afterwards.</div>
          </>}

          {confirm && (
            <div style={{ background: "var(--warn-bg, #fdf1d8)", border: "1px solid #e8c97a",
              borderRadius: 12, padding: "12px 14px", marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#a06407" }}>{confirm.text}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn" disabled={busy} onClick={() => createEmployee(true)}>
                  {busy ? "Saving…" : "Yes — save"}</button>
                <button className="btn ghost" disabled={busy}
                  onClick={() => setConfirm(null)}>Go back</button>
              </div>
            </div>)}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18,
            borderTop: "1px solid #f0ede4", paddingTop: 14 }}>
            <button className="btn ghost" onClick={() => setWiz(null)}>Cancel</button>
            <div style={{ display: "flex", gap: 10 }}>
              {step > 1 && <button className="btn ghost" onClick={() => setStep(step - 1)}>← Back</button>}
              {step < 6 && <button className="btn" disabled={miss[step - 1]}
                onClick={() => setStep(step + 1)}>Next →</button>}
              {step === 6 && !confirm && <button className="btn" disabled={busy}
                onClick={() => createEmployee(false)}>
                {busy ? "Creating…" : "Create employee →"}</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ——— one row + its expansion ———
function RowGroup({ e, td, open, onOpen, data, mem, setMem, canEdit, busy, selfId,
  onSaveMem, onSuspend, onReactivate, onReset, roleName, branchCode }) {
  return (
    <>
      <tr onClick={onOpen} style={{ cursor: "pointer",
        opacity: e.status === "active" ? 1 : .55 }}>
        <td style={td}><b>{e.fullName}</b>
          <div style={{ fontSize: 11.5, color: "var(--mut)", fontFamily: "ui-monospace,monospace" }}>
            {e.empCode} · {e.username}</div></td>
        <td style={td}>{e.designation || "—"}</td>
        <td style={td}>{e.roleIds.map(roleName).join(", ") || "—"}</td>
        <td style={td}>{e.branchIds.map(branchCode).join(" ") || "—"}</td>
        <td style={td}><span className={"chip " + (e.status === "active" ? "ok" : "bad")}>
          {e.status}</span></td>
        <td style={{ ...td, color: "var(--mut)" }}>{open ? "▲" : "▼"}</td>
      </tr>
      {open && mem && (
        <tr><td colSpan={6} style={{ ...td, background: "#faf9f4" }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 6 }}>Roles</span>
          <TickRow items={data.roles.map(r => [r.id, r.name])} on={mem.roleIds}
            toggle={canEdit ? (id) => setMem({ ...mem,
              roleIds: mem.roleIds.includes(id) ? [] : [id] }) : null} />
          <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
            textTransform: "uppercase", color: "var(--mut)", margin: "10px 0 6px" }}>
            Branches (★ primary)</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {data.branches.map(b => {
              const on = mem.branchIds.includes(b.id);
              return (
                <button key={b.id} disabled={!canEdit}
                  onClick={() => setMem({ ...mem,
                    branchIds: on ? mem.branchIds.filter(x => x !== b.id)
                      : [...mem.branchIds, b.id] })}
                  style={tick(on)}>
                  {on && <span onClick={(ev) => { ev.stopPropagation();
                      setMem({ ...mem, primaryBranchId: b.id }); }}
                    style={{ marginRight: 5 }}>{mem.primaryBranchId === b.id ? "★" : "☆"}</span>}
                  {b.code}</button>);
            })}
          </div>
          {canEdit && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12,
              flexWrap: "wrap" }}>
              <button className="btn ghost" onClick={onReset}>Reset password</button>
              {e.status === "active"
                ? (Number(e.id) !== Number(selfId) &&
                    <button className="btn ghost" style={{ color: "var(--bad)",
                      borderColor: "var(--bad)" }} onClick={onSuspend}>Suspend…</button>)
                : <button className="btn ghost" onClick={onReactivate}>Reactivate</button>}
              <button className="btn" disabled={busy} onClick={onSaveMem}>
                {busy ? "Saving…" : "Save roles & branches"}</button>
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}

function TickRow({ items, on, toggle }) {
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {items.map(([id, label]) => (
        <button key={id} disabled={!toggle} onClick={() => toggle && toggle(id)}
          style={tick(on.includes(id))}>{on.includes(id) ? "✓ " : ""}{label}</button>))}
    </div>
  );
}

/** PAN as you type: positions 1-5 letters, 6-9 digits, 10 a letter. */
function panFilter(v) {
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  let out = "";
  for (const ch of s) {
    const i = out.length;
    if (i >= 10) break;
    if (i < 5 || i === 9) { if (/[A-Z]/.test(ch)) out += ch; }
    else { if (/[0-9]/.test(ch)) out += ch; }
  }
  return out;
}

function toTitle(v) {
  return String(v).toLowerCase().replace(/(^|[\s.'-])([a-z\u00e0-\u00ff])/g,
    (m, p, c) => p + c.toUpperCase()).trim();
}

function tick(on) {
  return { border: "1px solid " + (on ? "var(--vault)" : "#cfc9ba"),
    background: on ? "var(--vault)" : "#fff", color: on ? "#fff" : "var(--mut)",
    borderRadius: 10, padding: "8px 12px", fontWeight: 800, fontSize: 12, cursor: "pointer" };
}
