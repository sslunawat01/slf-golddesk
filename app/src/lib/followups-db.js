/**
 * SLF GoldDesk — FOLLOW-UPS, the database half (E33).
 * Everything the tab, the loan section, the home card and the register read.
 * Rules live in followups.js; this file only fetches rows and prices loans
 * through the same engine replay as the collect screen.
 */
import { q, one } from "./db.js";
import { schemeFromRow, replayLoan } from "./loanstate.js";
import { dues, countDays } from "./engine.js";
import { dueStatus, ptpStatus, suggestFor, rankSuggestions, labelType, labelChannel, labelOutcome } from "./followups.js";

const SEL_CALL = `cc.id, cc.loan_id, cc.fu_type::text AS type, cc.channel::text AS channel, cc.method,
   cc.outcome::text AS outcome, cc.ptp_date::text AS ptp_date, cc.ptp_amount_paise,
   cc.next_follow_up::text AS next_follow_up, cc.next_type::text AS next_type, cc.assigned_to,
   cc.note, cc.at, (cc.at AT TIME ZONE 'Asia/Kolkata')::date::text AS on_day,
   cc.by_employee, e.full_name AS by_name, a.full_name AS assigned_name`;
const FROM_CALL = `FROM collection_call cc JOIN employee e ON e.id = cc.by_employee
   LEFT JOIN employee a ON a.id = cc.assigned_to`;

/** The latest follow-up row of each loan in the set. */
export async function latestPerLoan(loanIds) {
  if (!loanIds.length) return {};
  const rows = await q(`SELECT DISTINCT ON (cc.loan_id) ${SEL_CALL} ${FROM_CALL}
     WHERE cc.loan_id = ANY($1::bigint[]) ORDER BY cc.loan_id, cc.at DESC, cc.id DESC`, [loanIds]);
  return Object.fromEntries(rows.map(r => [Number(r.loan_id), r]));
}

/** Engine position of one loan today: what it owes and how long interest has been unpaid. */
export async function loanPosition(loanId, today) {
  const loan = await one(
    `SELECT sv.*, l.id, l.loan_no, l.principal_paise, l.disbursed_at::text AS disbursed_at, l.status, l.branch_id,
            l.customer_id, l.scheme_version_id, s.code AS scheme_code
       FROM loan l JOIN scheme_version sv ON sv.id = l.scheme_version_id JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.id = $1`, [loanId]);   // l.* after sv.* so the loan's id/status win the name clash
  if (!loan) return null;
  const slabs = await q(`SELECT from_day, to_day, rate_pct FROM scheme_slab WHERE scheme_version_id=$1 ORDER BY from_day`, [loan.scheme_version_id]);
  const charges = await q(`SELECT lc.id, lc.total_paise, lc.added_at::date::text AS added_on FROM loan_charge lc
                            WHERE lc.loan_id=$1 AND lc.removed_at IS NULL ORDER BY lc.added_at, lc.id`, [loanId]);
  const receipts = await q(`SELECT business_date::text AS business_date, amount_paise, closes_loan, engine_version
                             FROM receipt WHERE loan_id=$1 ORDER BY business_date, id`, [loanId]);
  const scheme = schemeFromRow(loan, slabs, loan.scheme_code);
  const state = replayLoan({ principalPaise: loan.principal_paise, disbursedAt: loan.disbursed_at, scheme, charges, receipts });
  const d = loan.status === "active" ? dues(scheme, state, today) : null;
  return {
    loanNo: loan.loan_no, status: loan.status, principalPaise: Number(state.principal),
    dueTodayPaise: d ? d._paise.settlement : 0,
    interestDuePaise: d ? d._paise.interestDue : 0, penalDuePaise: d ? d._paise.penalDue : 0,
    unpaidDays: countDays(state.interestClock || loan.disbursed_at, today),
    ageDays: countDays(loan.disbursed_at, today),
    tenureDays: Number(loan.tenure_days), graceDays: Number(loan.penal_grace_days || 0),
    receipts,
  };
}

const shape = (r) => ({
  id: Number(r.id), loanId: Number(r.loan_id), type: r.type, typeLabel: labelType(r.type),
  channel: r.channel, channelLabel: r.channel ? labelChannel(r.channel) : (r.method || "—"),
  outcome: r.outcome, outcomeLabel: labelOutcome(r.outcome),
  ptpDate: r.ptp_date, ptpAmountPaise: r.ptp_amount_paise == null ? null : Number(r.ptp_amount_paise),
  nextFollowUp: r.next_follow_up, nextType: r.next_type, nextTypeLabel: r.next_type ? labelType(r.next_type) : null,
  assignedTo: r.assigned_to == null ? null : Number(r.assigned_to), assignedName: r.assigned_name,
  remark: r.note, at: r.at, onDay: r.on_day, byId: Number(r.by_employee), by: r.by_name,
});

/** One loan's full log with promise status and receipts in between, newest first. */
export async function loanHistory(loanId, today) {
  const rows = await q(`SELECT ${SEL_CALL} ${FROM_CALL} WHERE cc.loan_id = $1 ORDER BY cc.at DESC, cc.id DESC`, [loanId]);
  const receipts = await q(`SELECT receipt_no, business_date::text AS business_date, amount_paise FROM receipt
                             WHERE loan_id=$1 ORDER BY business_date, id`, [loanId]);
  const items = rows.map(r => ({ ...shape(r),
    ptp: ptpStatus({ ptpDate: r.ptp_date, loggedOn: r.on_day, receipts, today }) }));
  const latest = items[0] || null;
  const due = latest?.nextFollowUp ? { dueOn: latest.nextFollowUp, type: latest.nextType || latest.type,
    typeLabel: labelType(latest.nextType || latest.type), assignedName: latest.assignedName,
    assignedTo: latest.assignedTo, setBy: latest.by, setOn: latest.onDay,
    ptpDate: latest.ptpDate, ptpAmountPaise: latest.ptpAmountPaise, status: dueStatus(latest.nextFollowUp, today) } : null;
  const kept = items.filter(i => i.ptp === "kept").length, broken = items.filter(i => i.ptp === "broken").length;
  return { items, due, receipts: receipts.map(r => ({ receiptNo: r.receipt_no, on: r.business_date, amountPaise: Number(r.amount_paise) })),
    ptpRecord: { kept, broken } };
}

/**
 * The worklist: DUE items (scheduled next follow-ups in [from, to] with no
 * later row, on running loans of the branches), DONE items (rows logged in
 * [from, to]) and, when the range holds today, the system's SUGGESTIONS.
 * Every due item is priced today by the engine.
 */
export async function worklist({ branchIds, from, to, today, assignedTo = null, employeeId = null,
                                 type = null, channel = null, text = null, withSuggestions = true }) {
  const loans = await q(
    `SELECT l.id, l.loan_no, l.branch_id, b.code AS branch_code, c.id AS customer_id, c.cust_no, c.full_name AS customer,
            c.mobile, c.warning_remark, c.blacklist_remark, s.code AS scheme_code,
            l.disbursed_at::text AS disbursed_at, l.principal_paise
       FROM loan l JOIN customer c ON c.id = l.customer_id JOIN branch b ON b.id = l.branch_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.status = 'active' AND l.branch_id = ANY($1::bigint[])`, [branchIds]);
  const byLoan = Object.fromEntries(loans.map(l => [Number(l.id), l]));
  const latest = await latestPerLoan(loans.map(l => Number(l.id)));

  const matchText = (l) => !text || [l.customer, l.cust_no, l.loan_no, l.mobile].some(v => String(v || "").toLowerCase().includes(text.toLowerCase()));
  const matchAssign = (r) => assignedTo == null ? true
    : assignedTo === "me" ? Number(r.assigned_to) === Number(employeeId)
    : assignedTo === "none" ? r.assigned_to == null : Number(r.assigned_to) === Number(assignedTo);

  // —— counts for the "When" pills, independent of the chosen range ——
  const counts = { missed: 0, today: 0, tomorrow: 0, week: 0 };
  for (const r of Object.values(latest)) {
    if (!r.next_follow_up) continue;
    const s = dueStatus(r.next_follow_up, today);
    if (s.state === "missed") counts.missed++;
    if (s.state === "today") counts.today++;
    if (s.state === "tomorrow") counts.tomorrow++;
    if (s.state !== "missed" && s.days <= 6) counts.week++;
  }

  // —— due items in the range; MISSED items are carried into any range that holds today ——
  const carry = from <= today && to >= today;
  const due = [];
  for (const [lid, r] of Object.entries(latest)) {
    const l = byLoan[lid]; if (!l || !r.next_follow_up) continue;
    const inRange = r.next_follow_up >= from && r.next_follow_up <= to;
    if (!inRange && !(carry && r.next_follow_up < today)) continue;
    const t = r.next_type || r.type;
    if (type && t !== type) continue;
    if (!matchAssign(r) || !matchText(l)) continue;
    const pos = await loanPosition(Number(lid), today);
    due.push({ kind: "due", loanId: Number(lid), loanNo: l.loan_no, branchCode: l.branch_code,
      customerId: Number(l.customer_id), customer: l.customer, custNo: l.cust_no, mobile: l.mobile,
      warningRemark: l.warning_remark, blacklistRemark: l.blacklist_remark, scheme: l.scheme_code,
      dueOn: r.next_follow_up, status: dueStatus(r.next_follow_up, today),
      type: t, typeLabel: labelType(t),
      ptpDate: r.ptp_date, ptpAmountPaise: r.ptp_amount_paise == null ? null : Number(r.ptp_amount_paise),
      ptp: ptpStatus({ ptpDate: r.ptp_date, loggedOn: r.on_day, receipts: pos.receipts, today }),
      assignedTo: r.assigned_to == null ? null : Number(r.assigned_to), assignedName: r.assigned_name,
      last: { at: r.at, onDay: r.on_day, channelLabel: r.channel ? labelChannel(r.channel) : (r.method || "—"), outcomeLabel: labelOutcome(r.outcome), by: r.by_name, remark: r.note },
      principalPaise: pos.principalPaise, dueTodayPaise: pos.dueTodayPaise, unpaidDays: pos.unpaidDays, ageDays: pos.ageDays });
  }

  // —— suggestions: a ranked SHORTLIST of loans with NO open due item, only when the range includes today ——
  const suggestions = [];
  let suggestedTotal = 0;
  if (withSuggestions && carry && !type && !channel && (!assignedTo || assignedTo === "none")) {
    const withDue = Object.values(latest).filter(r => r.next_follow_up).map(r => Number(r.loan_id));
    const cands = await q(
      `SELECT l.id, l.loan_no,
              (CURRENT_DATE - coalesce((SELECT max(r.business_date) FROM receipt r WHERE r.loan_id = l.id), l.disbursed_at))::int AS proxy_days,
              (CURRENT_DATE - l.disbursed_at)::int AS age_days, sv.tenure_days::int AS tenure_days, coalesce(sv.penal_grace_days, 0)::int AS grace_days,
              EXISTS (SELECT 1 FROM notice n WHERE n.loan_id = l.id) AS notice_sent,
              coalesce((SELECT cc.ptp_date < CURRENT_DATE
                          AND NOT EXISTS (SELECT 1 FROM receipt r2 WHERE r2.loan_id = l.id
                                            AND r2.business_date BETWEEN (cc.at AT TIME ZONE 'Asia/Kolkata')::date AND cc.ptp_date)
                          FROM collection_call cc WHERE cc.loan_id = l.id ORDER BY cc.at DESC, cc.id DESC LIMIT 1), false) AS broken_ptp
         FROM loan l JOIN scheme_version sv ON sv.id = l.scheme_version_id
        WHERE l.status = 'active' AND l.branch_id = ANY($1::bigint[]) AND NOT (l.id = ANY($2::bigint[]))`, [branchIds, withDue]);
    const ranked = rankSuggestions(cands.filter(c => matchText(byLoan[Number(c.id)] || {})).map(c => ({
      id: Number(c.id), loanNo: c.loan_no, proxyDays: c.proxy_days, ageDays: c.age_days, tenureDays: c.tenure_days,
      graceDays: c.grace_days, noticeSent: c.notice_sent, brokenPtp: c.broken_ptp })));
    suggestedTotal = ranked.total;
    for (const c of ranked.shortlist) {
      const l = byLoan[c.id]; if (!l) continue;
      const r = latest[c.id];
      const pos = await loanPosition(c.id, today);          // exact figures for the shortlist only
      const s = suggestFor({ unpaidDays: pos.unpaidDays, ageDays: pos.ageDays, tenureDays: pos.tenureDays,
        graceDays: pos.graceDays, noticeSent: c.noticeSent, brokenPtp: c.brokenPtp, hasOpenDue: false })
        || { type: c.type, reason: `${c.proxyDays} days since the last payment` };
      suggestions.push({ kind: "suggested", loanId: c.id, loanNo: l.loan_no, branchCode: l.branch_code,
        customerId: Number(l.customer_id), customer: l.customer, custNo: l.cust_no, mobile: l.mobile,
        warningRemark: l.warning_remark, blacklistRemark: l.blacklist_remark, scheme: l.scheme_code,
        dueOn: today, status: { state: "suggested", days: 0, label: "suggested" }, type: s.type, typeLabel: labelType(s.type),
        reason: s.reason, assignedTo: null, assignedName: null,
        last: r ? { at: r.at, onDay: r.on_day, channelLabel: r.channel ? labelChannel(r.channel) : (r.method || "—"), outcomeLabel: labelOutcome(r.outcome), by: r.by_name, remark: r.note } : null,
        principalPaise: pos.principalPaise, dueTodayPaise: pos.dueTodayPaise, unpaidDays: pos.unpaidDays, ageDays: pos.ageDays });
    }
  }

  // —— done in the range ——
  const doneRows = await q(`SELECT ${SEL_CALL}, l.loan_no, l.customer_id, c.full_name AS customer, c.cust_no, c.mobile, s.code AS scheme_code, b.code AS branch_code
     ${FROM_CALL} JOIN loan l ON l.id = cc.loan_id JOIN customer c ON c.id = l.customer_id JOIN branch b ON b.id = l.branch_id
     JOIN scheme_version sv ON sv.id = l.scheme_version_id JOIN scheme s ON s.id = sv.scheme_id
     WHERE l.branch_id = ANY($1::bigint[]) AND (cc.at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2 AND $3
     ORDER BY cc.at DESC`, [branchIds, from, to]);
  const done = doneRows
    .filter(r => (!type || r.type === type) && (!channel || r.channel === channel)
      && matchText({ customer: r.customer, cust_no: r.cust_no, loan_no: r.loan_no, mobile: r.mobile }))
    .map(r => ({ ...shape(r), kind: "done", loanNo: r.loan_no, customerId: Number(r.customer_id), customer: r.customer,
      custNo: r.cust_no, mobile: r.mobile, scheme: r.scheme_code, branchCode: r.branch_code }));

  due.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.loanNo.localeCompare(b.loanNo));
  return { due, suggestions, suggestedTotal, done, counts };
}

/** For the home card and the nav badge: what this branch owes the customers' phones today. */
export async function dueSummary(branchId, employeeId, today = null) {
  today = today || (await one(`SELECT CURRENT_DATE::text AS d`)).d;     // the database's day (IST), never the server's UTC clock
  const rows = await q(`SELECT DISTINCT ON (cc.loan_id) cc.loan_id, cc.next_follow_up::text AS next_follow_up, cc.assigned_to,
       cc.next_type::text AS next_type, cc.fu_type::text AS type, l.loan_no, c.full_name AS customer, c.cust_no
     FROM collection_call cc JOIN loan l ON l.id = cc.loan_id JOIN customer c ON c.id = l.customer_id
     WHERE l.branch_id = $1 AND l.status = 'active' ORDER BY cc.loan_id, cc.at DESC, cc.id DESC`, [branchId]);
  const open = rows.filter(r => r.next_follow_up && r.next_follow_up <= today);
  const missed = open.filter(r => r.next_follow_up < today).length;
  const mine = open.filter(r => Number(r.assigned_to) === Number(employeeId)).length;
  const top = open.sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up)).slice(0, 4)
    .map(r => ({ loanId: Number(r.loan_id), loanNo: r.loan_no, customer: r.customer, custNo: r.cust_no,
      dueOn: r.next_follow_up, status: dueStatus(r.next_follow_up, today), typeLabel: labelType(r.next_type || r.type) }));
  return { total: open.length, missed, mine, top };
}

/**
 * The Follow-up Register (report): DUE in the range, DONE in the range,
 * PROMISES falling in the range with kept/broken, and a per-staff tally.
 * `staff` (employee id) narrows due → assigned to, done/promises → logged by.
 */
export async function register({ branchIds, from, to, today, type = null, channel = null, staff = null }) {
  const w = await worklist({ branchIds, from, to, today, type, channel, withSuggestions: false,
    assignedTo: staff ? Number(staff) : null });
  const done = staff ? w.done.filter(d => d.byId === Number(staff)) : w.done;

  const params = [branchIds, from, to];
  let extra = "";
  if (type) { params.push(type); extra += ` AND cc.fu_type = $${params.length}`; }
  if (channel) { params.push(channel); extra += ` AND cc.channel = $${params.length}`; }
  if (staff) { params.push(Number(staff)); extra += ` AND cc.by_employee = $${params.length}`; }
  const prRows = await q(`SELECT ${SEL_CALL}, l.loan_no, l.status AS loan_status, l.customer_id, c.full_name AS customer, c.cust_no, c.mobile, b.code AS branch_code
     ${FROM_CALL} JOIN loan l ON l.id = cc.loan_id JOIN customer c ON c.id = l.customer_id JOIN branch b ON b.id = l.branch_id
     WHERE l.branch_id = ANY($1::bigint[]) AND cc.ptp_date BETWEEN $2 AND $3 ${extra}
     ORDER BY cc.ptp_date, cc.at`, params);
  const prLoanIds = [...new Set(prRows.map(r => Number(r.loan_id)))];
  const rcpt = prLoanIds.length ? await q(`SELECT loan_id, business_date::text AS business_date, amount_paise FROM receipt
     WHERE loan_id = ANY($1::bigint[]) ORDER BY business_date, id`, [prLoanIds]) : [];
  const rcptBy = {};
  for (const r of rcpt) (rcptBy[Number(r.loan_id)] ||= []).push(r);
  const promises = prRows.map(r => {
    const receipts = rcptBy[Number(r.loan_id)] || [];
    const st = ptpStatus({ ptpDate: r.ptp_date, loggedOn: r.on_day, receipts, today });
    const paid = receipts.filter(x => x.business_date >= r.on_day && x.business_date <= r.ptp_date)
      .reduce((a, x) => a + Number(x.amount_paise), 0);
    return { ...shape(r), ptp: st, paidByPtpPaise: paid, loanNo: r.loan_no, loanStatus: r.loan_status,
      customerId: Number(r.customer_id), customer: r.customer, custNo: r.cust_no, mobile: r.mobile, branchCode: r.branch_code };
  });

  // —— per staff: logged, promises taken / kept / broken, due assigned / missed ——
  const tally = {};
  const slot = (id, name) => (tally[id] ||= { employeeId: id, name: name || "—", logged: 0, calls: 0, visits: 0,
    promises: 0, kept: 0, broken: 0, dueAssigned: 0, missed: 0 });
  for (const d of done) { const t = slot(d.byId, d.by); t.logged++; if (d.channel === "call") t.calls++; if (d.channel === "visit") t.visits++; }
  for (const p of promises) { const t = slot(p.byId, p.by); t.promises++; if (p.ptp === "kept") t.kept++; if (p.ptp === "broken") t.broken++; }
  for (const d of w.due) { if (d.assignedTo == null) continue; const t = slot(d.assignedTo, d.assignedName); t.dueAssigned++; if (d.status.state === "missed") t.missed++; }
  const byStaff = Object.values(tally).sort((a, b) => b.logged - a.logged || a.name.localeCompare(b.name));

  const kpis = { due: w.due.length, missed: w.due.filter(d => d.status.state === "missed").length, done: done.length,
    promises: promises.length, kept: promises.filter(p => p.ptp === "kept").length, broken: promises.filter(p => p.ptp === "broken").length,
    unassigned: w.due.filter(d => d.assignedTo == null).length };
  return { due: w.due, done, promises, byStaff, kpis };
}
