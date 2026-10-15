/**
 * Walk: E33 — Follow-ups, API + DATABASE layer. Run TWICE (rows are append-only; each run picks fresh loans).
 *  · logging through /api/followups (columns, audit), the due derivation (latest row with a next date, no later row)
 *  · presets, custom range, assigned / type / channel / text filters, counts
 *  · a later row without a next date clears the due item
 *  · validation refusals, permission 403s, the branch wall, the assignee-posting check, closed-loan 409
 *  · missed items, the Home card, the nav badge
 *  · PTP kept / broken from receipts; the Follow-up Register API (due / done / promises / by staff)
 *  · the legacy /api/overdue POST still writes the same table with a channel
 *  · the pages themselves answer (tab, loan page section, report page)
 */
import pg from "pg";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
async function call(path, body, cookie, method = body == null ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method, redirect: "manual",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, loc: r.headers.get("location"), setCookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
async function loginAt(username, branchId) {
  const a = await call("/api/auth/login", { username, password: "Testpass123456" });
  let c = a.setCookie;
  if (a.j?.next === "branch") c = (await call("/api/auth/branch", { ticket: a.j.ticket, branchId })).setCookie;
  const s = await call("/api/auth/branch", { branchId }, c);
  return s.setCookie || c;
}
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const RUN = String(Date.now()).slice(-6);
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;
// append-only table: neutralise due items left by earlier walk runs so the bands hold only this run's fixtures
await pool.query(`INSERT INTO collection_call (loan_id, method, outcome, note, by_employee, fu_type, channel)
  SELECT x.loan_id, 'call', 'other', 'walk cleanup', 1, 'other', 'call'
    FROM (SELECT DISTINCT ON (cc.loan_id) cc.loan_id, cc.next_follow_up, cc.note FROM collection_call cc JOIN loan l ON l.id = cc.loan_id
           WHERE l.branch_id = 3 ORDER BY cc.loan_id, cc.at DESC, cc.id DESC) x
   WHERE x.next_follow_up IS NOT NULL AND (x.note LIKE 'Walk %' OR x.note LIKE 'UI walk %')`);
const own = await loginAt("slunawat", 3);
const nag = await loginAt("nagin.kothari", 3);          // Branch Manager, posted everywhere incl. B3 → collect full
const NAG = 11, OWN = 1, SSHINDE_B1 = 5;
// two throwaway employees (the seeded users' passwords differ): NoRole at B3 (no Collect, no Reports) and a Branch Manager at B2 only
async function mkUser(label, roleId, branchId) {
  const u = `walkfu${label}${String(Date.now()).slice(-5)}`;
  const mk = await call("/api/settings/employees", { action: "create", fullName: `Walk FU ${label}`,
    mobile: "97" + String(Date.now() + roleId).slice(-8), panNo: "WALKF" + String(Date.now()).slice(-4) + "Q",
    designation: "Walk", doj: today, roleIds: [roleId], branchIds: [branchId], primaryBranchId: branchId,
    username: u, password: "Walkpass2026x", confirm: "Walkpass2026x", dupAcknowledged: true }, own);
  ok(mk.j?.ok === true, `created walk employee ${u} (${mk.j?.reason || "ok"})`);
  const a = await call("/api/auth/login", { username: u, password: "Walkpass2026x" });
  if (a.j?.next === "branch") return (await call("/api/auth/branch", { ticket: a.j.ticket, branchId })).setCookie;
  return a.setCookie;
}
const val = await mkUser("norole", 8, 3);               // no Collect, no Reports
const rp = await mkUser("b2mgr", 2, 2);                 // Branch Manager at B2 only — the branch wall

// fixtures: two running B3 loans nobody has followed up yet, one B3 loan with receipts, one released loan
const [A, B] = await sql(`SELECT l.id, l.loan_no FROM loan l WHERE l.status='active' AND l.branch_id=3
  AND NOT EXISTS (SELECT 1 FROM collection_call cc WHERE cc.loan_id=l.id) ORDER BY l.id LIMIT 2`);
const C = await sql1(`SELECT l.id, l.loan_no, (SELECT max(business_date) FROM receipt r WHERE r.loan_id=l.id) AS last_rcpt
  FROM loan l WHERE l.status='active' AND l.branch_id=3 AND NOT EXISTS (SELECT 1 FROM collection_call cc WHERE cc.loan_id=l.id)
  AND (SELECT count(*) FROM receipt r WHERE r.loan_id=l.id) >= 3
  AND (SELECT max(business_date) FROM receipt r WHERE r.loan_id=l.id) <= CURRENT_DATE - 7
  ORDER BY (SELECT max(business_date) FROM receipt r WHERE r.loan_id=l.id) DESC LIMIT 1`);
const REL = await sql1(`SELECT id FROM loan WHERE status='released' AND branch_id=3 LIMIT 1`);
ok(A && B && C && REL, `fixtures: A=${A?.loan_no} B=${B?.loan_no} C=${C?.loan_no} (last receipt ${C?.last_rcpt}) released=${REL?.id}`);

// ═════ 1 · permissions ═════
const g403 = await call(`/api/followups?preset=today`, null, val);
ok(g403.status === 403, `a Valuer cannot read the worklist (${g403.status})`);
const p403 = await call(`/api/followups`, { loanId: A.id, type: "interest", channel: "call", outcome: "no_answer" }, val);
ok(p403.status === 403, `a user without Collect cannot log a follow-up (${p403.status})`);
const wall = await call(`/api/followups`, { loanId: A.id, type: "interest", channel: "call", outcome: "no_answer" }, rp);
ok(wall.status === 403 && /not posted/i.test(wall.j?.reason || ""), `branch wall: a B2 manager cannot log on a B3 loan — ${wall.j?.reason}`);
const wallH = await call(`/api/followups/loan/${A.id}`, null, rp);
ok(wallH.status === 403, `branch wall: nor read its history (${wallH.status})`);
const wallW = await call(`/api/followups?branch=3`, null, rp);
ok(wallW.status === 403, `branch wall: nor ask for B3's worklist (${wallW.status})`);
const pg403 = await call(`/followups`, null, val);
ok([302, 307].includes(pg403.status) && /\/home/.test(pg403.loc || ""), `the Follow-ups page sends a user without Collect home (${pg403.status} → ${pg403.loc})`);
const rp403 = await call(`/api/reports/followups`, null, val);
ok(rp403.status === 403, `a user without Reports cannot read the Follow-up Register (${rp403.status})`);

// ═════ 2 · log a promise with a next follow-up, assigned to Nagin ═════
const d3 = addDays(today, 3);
const l1 = await call(`/api/followups`, { loanId: A.id, type: "interest", channel: "call", outcome: "promised",
  remark: `Walk ${RUN} promised`, ptpDate: d3, ptpAmountPaise: 500000, nextFollowUp: d3, nextType: "ptp", assignedTo: NAG }, own);
ok(l1.j?.ok === true && l1.j.id > 0 && l1.j.next === d3, `logged on A: id ${l1.j?.id}, next ${l1.j?.next} (${l1.j?.reason || "ok"})`);
const r1 = await sql1(`SELECT fu_type::text t, channel::text ch, method, outcome::text o, ptp_date, ptp_amount_paise::int amt, next_follow_up nf, next_type::text nt, assigned_to::int a, note, by_employee::int by
  FROM collection_call WHERE id=$1`, [l1.j.id]);
ok(r1.t === "interest" && r1.ch === "call" && r1.method === "call" && r1.o === "promised" && r1.ptp_date === d3 && r1.amt === 500000
  && r1.nf === d3 && r1.nt === "ptp" && r1.a === NAG && r1.note === `Walk ${RUN} promised` && r1.by === OWN, "the row carries every new column (type, channel, PTP amount, next type, assignee)");
const au1 = await sql1(`SELECT action, after FROM audit_log WHERE entity_table='collection_call' AND entity_id=$1 AND action='follow_up' ORDER BY id DESC LIMIT 1`, [l1.j.id]);
ok(au1 && au1.after.loanNo === A.loan_no && au1.after.ptpAmountPaise === 500000 && au1.after.assignedTo === NAG, "audit row follow_up carries loan, PTP amount and assignee");

// ═════ 3 · the due derivation and the filters ═════
const findDue = (r, loanNo) => (r.j?.due || []).find(x => x.loanNo === loanNo);
const wToday = await call(`/api/followups?preset=today`, null, own);
ok(wToday.j?.ok && wToday.j.today === today && !findDue(wToday, A.loan_no), `preset today: A is not due yet (today ${wToday.j?.today})`);
ok((wToday.j?.done || []).some(d => d.loanNo === A.loan_no && d.outcomeLabel && d.remark === `Walk ${RUN} promised`), "preset today: A's log appears under DONE today");
const wWeek = await call(`/api/followups?preset=week`, null, own);
const dA = findDue(wWeek, A.loan_no);
ok(dA && dA.status.state === "upcoming" && dA.status.days === 3 && dA.type === "ptp" && dA.ptp === "open" && dA.ptpAmountPaise === 500000
  && dA.assignedTo === NAG && /nagin/i.test(dA.assignedName) && dA.dueTodayPaise >= 0 && typeof dA.unpaidDays === "number", `preset week: A due in 3 days as PTP, open, ₹5,000, for Nagin, priced (due today ₹${Math.round((dA?.dueTodayPaise || 0) / 100)})`);
ok(wWeek.j.counts.week >= 1 && typeof wWeek.j.counts.missed === "number", `counts: week ${wWeek.j.counts.week}, missed ${wWeek.j.counts.missed}, today ${wWeek.j.counts.today}`);
ok(wWeek.j.me === OWN && wWeek.j.canLog === true && wWeek.j.staff.some(s => s.id === NAG), "response carries me, canLog and the branch staff");
const wRange = await call(`/api/followups?from=${d3}&to=${d3}`, null, own);
ok(findDue(wRange, A.loan_no), "custom range on the exact day finds A");
const wRange2 = await call(`/api/followups?from=${addDays(today, 4)}&to=${addDays(today, 9)}`, null, own);
ok(!findDue(wRange2, A.loan_no), "a range after the day does not");
const wMine = await call(`/api/followups?preset=week&assigned=me`, null, nag);
ok(findDue(wMine, A.loan_no), "assigned=me as Nagin: A is hers");
const wMineOwn = await call(`/api/followups?preset=week&assigned=me`, null, own);
ok(!findDue(wMineOwn, A.loan_no), "assigned=me as the owner: not his");
const wNone = await call(`/api/followups?preset=week&assigned=none`, null, own);
ok(!findDue(wNone, A.loan_no), "assigned=none: not unassigned");
const wId = await call(`/api/followups?preset=week&assigned=${NAG}`, null, own);
ok(findDue(wId, A.loan_no), "assigned=<Nagin's id>: found");
const wT1 = await call(`/api/followups?preset=week&type=ptp`, null, own);
const wT2 = await call(`/api/followups?preset=week&type=renewal`, null, own);
ok(findDue(wT1, A.loan_no) && !findDue(wT2, A.loan_no), "type filter: ptp yes, renewal no");
const wQ1 = await call(`/api/followups?preset=week&q=${A.loan_no}`, null, own);
const wQ2 = await call(`/api/followups?preset=week&q=zzzz${RUN}`, null, own);
ok(findDue(wQ1, A.loan_no) && !findDue(wQ2, A.loan_no), "text filter: by loan no yes, nonsense no");
const wB2 = await call(`/api/followups?preset=week&branch=2`, null, own);
ok(wB2.j?.ok && !findDue(wB2, A.loan_no) && /B2|02/i.test(wB2.j.scope), `centre select: B2's list does not hold a B3 loan (scope ${wB2.j?.scope})`);
const wAll = await call(`/api/followups?preset=week&branch=all`, null, own);
ok(findDue(wAll, A.loan_no), "centre = all my branches holds it");
const wNoSug = await call(`/api/followups?preset=today&suggestions=0`, null, own);
ok(wNoSug.j?.ok && wNoSug.j.suggestions.length === 0, "suggestions=0 switches the suggestions off");
const wSug = await call(`/api/followups?preset=today`, null, own);
ok(wSug.j?.ok && Array.isArray(wSug.j.suggestions) && wSug.j.suggestions.every(s => s.kind === "suggested" && s.reason && s.typeLabel)
  && wSug.j.suggestions.length <= 30 && wSug.j.suggestedTotal >= wSug.j.suggestions.length, `suggestions: a shortlist of ${wSug.j?.suggestions?.length} out of ${wSug.j?.suggestedTotal} candidates`);
const ranks = wSug.j?.suggestions.map(s => ({ ptp: 0, overdue: 1, renewal: 2, interest: 3 }[s.type]));
ok(ranks && ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), "shortlist ordered: broken promises → past tenure → renewals → unpaid interest");
const wSugQ = await call(`/api/followups?preset=today&q=${encodeURIComponent(wSug.j?.suggestions?.[0]?.customer || "zz")}`, null, own);
ok(wSugQ.j?.ok && wSugQ.j.suggestions.length >= 1 && wSugQ.j.suggestions.every(s => s.customer === wSug.j.suggestions[0].customer), "text filter narrows the suggestions too");

// history endpoint
const h1 = await call(`/api/followups/loan/${A.id}`, null, nag);
ok(h1.j?.ok && h1.j.items.length === 1 && h1.j.items[0].ptp === "open" && h1.j.due?.dueOn === d3 && h1.j.due.assignedTo === NAG && h1.j.loan.loanNo === A.loan_no && h1.j.canLog === true,
  "history: one item, PTP open, due item set, loan header present");

// ═════ 4 · a later row WITHOUT a next date clears the due item ═════
const l2 = await call(`/api/followups`, { loanId: A.id, type: "ptp", channel: "visit", outcome: "paid", remark: `Walk ${RUN} paid` }, nag);
ok(l2.j?.ok === true && l2.j.next == null, `second log on A (visit, paid, no next) → id ${l2.j?.id}`);
const wWeek2 = await call(`/api/followups?preset=week`, null, own);
ok(!findDue(wWeek2, A.loan_no), "A is no longer due anywhere");
ok((wWeek2.j?.done || []).filter(d => d.loanNo === A.loan_no).length === 2, "…and DONE today shows both logs");
const h2 = await call(`/api/followups/loan/${A.id}`, null, own);
ok(h2.j?.ok && h2.j.items.length === 2 && h2.j.due === null && h2.j.items[0].channel === "visit", "history: two items newest first, no due item");

// ═════ 5 · validation ═════
const v1 = await call(`/api/followups`, { loanId: B.id, type: "interest", channel: "call" }, own);
ok(v1.status === 400 && /what happened/i.test(v1.j?.reason || ""), `no outcome → 400 ${v1.j?.reason}`);
const v2 = await call(`/api/followups`, { loanId: B.id, type: "interest", channel: "call", outcome: "promised", ptpDate: addDays(today, -1) }, own);
ok(v2.status === 400 && /past/i.test(v2.j?.reason || ""), `PTP in the past → 400 ${v2.j?.reason}`);
const v3 = await call(`/api/followups`, { loanId: B.id, type: "interest", channel: "call", outcome: "no_answer", nextFollowUp: addDays(today, -1) }, own);
ok(v3.status === 400 && /past/i.test(v3.j?.reason || ""), `next in the past → 400 ${v3.j?.reason}`);
const v4 = await call(`/api/followups`, { loanId: B.id, type: "interest", channel: "call", outcome: "no_answer", nextFollowUp: addDays(today, 1), assignedTo: SSHINDE_B1 }, own);
ok(v4.status === 400 && /not posted/i.test(v4.j?.reason || ""), `assignee not posted to B3 → 400 ${v4.j?.reason}`);
const v5 = await call(`/api/followups`, { loanId: REL.id, type: "interest", channel: "call", outcome: "no_answer" }, own);
ok(v5.status === 409, `released loan → 409 ${v5.j?.reason}`);
const v6 = await call(`/api/followups`, { loanId: 999999999, type: "interest", channel: "call", outcome: "no_answer" }, own);
ok(v6.status === 404, `unknown loan → 404`);
const v7 = await call(`/api/followups`, { loanId: B.id, type: "bogus", channel: "fax", outcome: "no_answer" }, own);
ok(v7.status === 400 && v7.j?.problems?.length === 2, `bogus type + channel → 400 with ${v7.j?.problems?.length} problems`);
ok((await sql1(`SELECT count(*)::int n FROM collection_call WHERE loan_id=$1`, [B.id])).n === 0, "none of the refused posts wrote a row");

// ═════ 6 · missed items, the Home card, the nav badge ═════
const dm2 = addDays(today, -2);
await pool.query(`INSERT INTO collection_call (loan_id, method, outcome, next_follow_up, note, by_employee, at, fu_type, channel, next_type, assigned_to)
  VALUES ($1,'call','no_answer',$2,$3,$4, now() - interval '5 days','interest','call','interest',$4)`, [B.id, dm2, `Walk ${RUN} missed`, OWN]);
const wMissed = await call(`/api/followups?preset=missed`, null, own);
const dB = findDue(wMissed, B.loan_no);
ok(dB && dB.status.state === "missed" && dB.status.days === 2 && wMissed.j.counts.missed >= 1, `preset missed: B is 2 days late (counts.missed ${wMissed.j?.counts?.missed})`);
const wT = await call(`/api/followups?preset=today`, null, own);
ok(findDue(wT, B.loan_no)?.status.state === "missed", "preset today CARRIES the missed item forward (its own band)");
const wTm = await call(`/api/followups?preset=tomorrow`, null, own);
ok(!findDue(wTm, B.loan_no), "…a range without today does not");
const home = await call(`/home`, null, own);
ok(home.status === 200 && /data-fu-home/.test(home.text) && home.text.includes(B.loan_no) && /Follow-ups due today/i.test(home.text), "Home card lists the missed loan");
ok(/\/followups\?focus=\d+/.test(home.text), "Home card's Log → links into the tab with a focus");
const dueN = (await sql1(`SELECT count(*)::int n FROM (SELECT DISTINCT ON (cc.loan_id) cc.next_follow_up nf FROM collection_call cc JOIN loan l ON l.id=cc.loan_id
  WHERE l.branch_id=3 AND l.status='active' ORDER BY cc.loan_id, cc.at DESC, cc.id DESC) x WHERE nf IS NOT NULL AND nf <= CURRENT_DATE`)).n;
const badge = home.text.match(/data-fu-badge[^>]*>(\d+)</);
ok(badge && Number(badge[1]) === dueN, `nav badge shows ${badge?.[1]} = DB's open-due count ${dueN}`);
const homeVal = await call(`/home`, null, val);
ok(homeVal.status === 200 && !/data-fu-home/.test(homeVal.text) && !/data-fu-badge/.test(homeVal.text), "a user without the Collect desk sees neither the card nor the badge");

// ═════ 7 · PTP kept / broken from receipts ═════
const lr = C.last_rcpt;
await pool.query(`INSERT INTO collection_call (loan_id, method, outcome, ptp_date, note, by_employee, at, fu_type, channel, ptp_amount_paise)
  VALUES ($1,'call','promised',$2,$3,$4, ($5::date - 2)::timestamptz + interval '10 hours','interest','call',100000)`, [C.id, lr, `Walk ${RUN} kept`, NAG, lr]);
await pool.query(`INSERT INTO collection_call (loan_id, method, outcome, ptp_date, note, by_employee, at, fu_type, channel, ptp_amount_paise)
  VALUES ($1,'visit','promised',$2,$3,$4, now() - interval '3 days','interest','visit',200000)`, [C.id, addDays(today, -1), `Walk ${RUN} broken`, NAG]);
const hC = await call(`/api/followups/loan/${C.id}`, null, own);
const kept = hC.j?.items.find(i => i.remark === `Walk ${RUN} kept`), broken = hC.j?.items.find(i => i.remark === `Walk ${RUN} broken`);
ok(kept?.ptp === "kept" && broken?.ptp === "broken", `history: promise before the receipt is KEPT, promise with no receipt is BROKEN (kept ${hC.j?.ptpRecord?.kept}, broken ${hC.j?.ptpRecord?.broken})`);
ok(hC.j?.suggestion?.type === "ptp" && /broken/.test(hC.j.suggestion.reason), `suggestion on C: ${hC.j?.suggestion?.typeLabel} — ${hC.j?.suggestion?.reason}`);
ok(hC.j?.receipts?.length >= 3, `receipts interleaved in the history (${hC.j?.receipts?.length})`);

// ═════ 8 · the Follow-up Register ═════
const reg = await call(`/api/reports/followups?from=${addDays(today, -10)}&to=${addDays(today, 10)}&branch=3`, null, own);
ok(reg.j?.ok && reg.j.kpis.kept >= 1 && reg.j.kpis.broken >= 1 && reg.j.kpis.missed >= 1 && reg.j.kpis.done >= 2,
  `register: kpis ${JSON.stringify(reg.j?.kpis)}`);
const pK = reg.j?.promises.find(p => p.remark === `Walk ${RUN} kept`), pB = reg.j?.promises.find(p => p.remark === `Walk ${RUN} broken`);
ok(pK?.ptp === "kept" && pK.paidByPtpPaise > 0 && pB?.ptp === "broken" && pB.paidByPtpPaise === 0, `promises tab: kept paid ₹${Math.round((pK?.paidByPtpPaise || 0) / 100)} by then, broken paid ₹0`);
ok(reg.j?.due.some(d => d.loanNo === B.loan_no && d.status.state === "missed"), "due tab holds the missed loan");
ok(reg.j?.done.some(d => d.loanNo === A.loan_no), "done tab holds today's logs");
const stN = reg.j?.byStaff.find(s => s.employeeId === NAG);
ok(stN && stN.promises >= 2 && stN.kept >= 1 && stN.broken >= 1 && stN.logged >= 1, `by staff: Nagin promises ${stN?.promises}, kept ${stN?.kept}, broken ${stN?.broken}, logged ${stN?.logged}`);
const regS = await call(`/api/reports/followups?from=${addDays(today, -10)}&to=${addDays(today, 10)}&branch=3&staff=${OWN}`, null, own);
ok(regS.j?.ok && regS.j.promises.every(p => p.byId === OWN) && regS.j.done.every(d => d.byId === OWN) && regS.j.due.every(d => d.assignedTo === OWN), "staff filter narrows done/promises to logged-by and due to assigned-to");
const regT = await call(`/api/reports/followups?from=${addDays(today, -10)}&to=${addDays(today, 10)}&branch=3&channel=visit`, null, own);
ok(regT.j?.ok && regT.j.done.every(d => d.channel === "visit") && regT.j.done.some(d => d.loanNo === A.loan_no), "channel filter: only visits in done");
const regW = await call(`/api/reports/followups?branch=3`, null, rp);
ok(regW.status === 403, `register: branch wall holds (${regW.status})`);
const regPage = await call(`/reports/followups`, null, own);
ok(regPage.status === 200 && /Follow-up Register/.test(regPage.text), "the report page answers");
const repHome = await call(`/reports`, null, own);
ok(repHome.status === 200 && /\/reports\/followups/.test(repHome.text), "Reports home lists the register");

// ═════ 9 · the legacy overdue form still writes the same table ═════
const lg = await call(`/api/overdue`, { loanId: B.id, method: "Home visit", outcome: "not_at_home", narration: `Walk ${RUN} legacy`, nextFollowUp: addDays(today, 1) }, own);
ok(lg.j?.ok === true, `legacy /api/overdue POST accepted (${lg.j?.reason || "ok"})`);
const lgRow = await sql1(`SELECT channel::text ch, next_type::text nt, fu_type::text t, method FROM collection_call WHERE loan_id=$1 AND note=$2`, [B.id, `Walk ${RUN} legacy`]);
ok(lgRow && lgRow.ch === "visit" && lgRow.nt === "other" && lgRow.t === "other" && lgRow.method === "Home visit", "legacy row got channel=visit, type other, next_type other");
const wTom = await call(`/api/followups?preset=tomorrow`, null, own);
const dBt = findDue(wTom, B.loan_no);
ok(dBt && dBt.status.state === "tomorrow" && dBt.last.channelLabel === "Home visit", "the legacy row moved B's due item to tomorrow, last contact = Home visit");
const wMissed2 = await call(`/api/followups?preset=missed`, null, own);
ok(!findDue(wMissed2, B.loan_no), "…and B is no longer missed");
const ov = await call(`/api/overdue`, null, own);
ok(ov.j?.ok !== false && ov.status === 200, "legacy GET /api/overdue still answers");

// ═════ 10 · the pages ═════
const tab = await call(`/followups`, null, own);
ok(tab.status === 200 && /Follow-ups/.test(tab.text), "the Follow-ups tab page answers");
const lp = await call(`/loans/${A.id}`, null, own);
ok(lp.status === 200 && /Follow-ups/.test(lp.text) && /More on this loan/.test(lp.text) && /Payment (&amp;|&) charge history/i.test(lp.text), "loan page: Follow-ups section, 'More on this loan', payment history all present");
const lpVal = await call(`/loans/${A.id}`, null, val);
ok([200, 302, 307].includes(lpVal.status), `loan page for a user without Collect still answers (${lpVal.status})`);
const tabPg = await call(`/followups?focus=${B.id}`, null, own);
ok(tabPg.status === 200, "the tab accepts ?focus=");
const tabBad = await call(`/followups?focus=abc`, null, own);
ok(tabBad.status === 200, "…and ignores a bad focus");

await pool.end();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
