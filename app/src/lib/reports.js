/**
 * SLF GoldDesk — REPORTS (E27, owner order 8 Sep 2026)
 * Shared server-side helpers for the report APIs.
 *
 * Two rules every report obeys, enforced HERE so no route can forget:
 *  · reports permission — can(actor, "reports", { need: "view" })
 *  · branch wall — a user sees ONLY branches they are posted to. "all"
 *    means all of THEIR branches, never all branches of the company.
 *
 * Figures rule: anything a counter screen already shows (dues, splits) is
 * produced by the SAME engine replay / stored appropriation rows — a report
 * must never disagree with the collect screen.
 */
import { q, one } from "@/lib/db.js";
import { dues } from "@/lib/engine.js";
import { schemeFromRow, replayLoan, RECEIPTS_FOR_REPLAY_SQL } from "@/lib/loanstate.js";

/** Indian financial year: 1 Apr – 31 Mar. Label "2026-27". */
export function fyRange(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || ""));
  if (!m) return null;
  const y = Number(m[1]);
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}
export function fyLabelFor(isoDate) {
  const y = Number(isoDate.slice(0, 4)), mth = Number(isoDate.slice(5, 7));
  const start = mth >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
/** FY options from the first loan on record through today. */
export async function fyOptions() {
  const r = await one(`SELECT least(
      coalesce((SELECT min(disbursed_at) FROM loan), CURRENT_DATE),
      coalesce((SELECT min(created_at::date) FROM loan_application), CURRENT_DATE)
    )::text AS d, CURRENT_DATE::text AS t`);
  const first = fyLabelFor(r.d), current = fyLabelFor(r.t);
  const out = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(current.slice(0, 4)); y++)
    out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  return { options: out, current };
}

/**
 * Resolve the requested branch scope against the actor's postings.
 * @returns {{ ids: number[], label: string } | null}  null = refuse (403)
 */
export function resolveBranchScope(actor, branchParam) {
  const mine = (actor.branches || []).map(b => Number(b.id));
  if (!mine.length) return null;
  if (!branchParam || branchParam === "all")
    return { ids: mine, label: mine.length === 1
      ? branchLabel(actor, mine[0]) : "All my branches" };
  const id = Number(branchParam);
  if (!mine.includes(id)) return null;                 // not posted there — refuse
  return { ids: [id], label: branchLabel(actor, id) };
}
const branchLabel = (actor, id) => {
  const b = (actor.branches || []).find(x => Number(x.id) === id);
  return b ? `${b.code} ${b.name}` : String(id);
};

/** Period from query: explicit from/to win; else the FY; else current FY. */
export async function resolvePeriod(sp) {
  const fy = fyRange(sp.fy) || fyRange((await fyOptions()).current);
  const iso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? s : null;
  return { from: iso(sp.from) || fy.from, to: iso(sp.to) || fy.to };
}

/**
 * Replay every ACTIVE loan of the given branches and price it as of today.
 * Same arithmetic as the collect screen (engine dues, running view).
 * Returns rows with both the loan facts and the priced position.
 */
export async function activePositions(branchIds) {
  const loans = await q(
    `SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.status, l.branch_id,
            b.code AS branch_code, b.name AS branch_name,
            c.id AS customer_id, c.cust_no, c.full_name AS customer_name, c.mobile,
            sv.id AS sv_id, sv.round_step_paise, sv.days_in_year, sv.calc_method,
            sv.min_interest_days, sv.tenure_days, sv.penal_rate_pct, sv.penal_grace_days,
            sv.interest_pct, sv.slab_mode, s.code AS scheme_code,
            (CURRENT_DATE - l.disbursed_at)::int + 1 AS age_days,
            (SELECT coalesce(sum(ai.net_mg),0)::bigint FROM appraisal_item ai
              WHERE ai.application_id = l.application_id) AS net_mg,
            (SELECT max(r2.business_date)::text FROM receipt r2 WHERE r2.loan_id = l.id) AS last_paid_on,
            (SELECT r3.amount_paise FROM receipt r3 WHERE r3.loan_id = l.id
              ORDER BY r3.business_date DESC, r3.id DESC LIMIT 1) AS last_paid_paise
       FROM loan l
       JOIN branch b ON b.id = l.branch_id
       JOIN customer c ON c.id = l.customer_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.status = 'active' AND l.branch_id = ANY($1::bigint[])
      ORDER BY b.id, l.loan_no`, [branchIds]);
  if (!loans.length) return [];
  const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;

  const out = [];
  for (const l of loans) {
    const slabs = await q(`SELECT from_day, to_day, rate_pct FROM scheme_slab
                            WHERE scheme_version_id=$1 ORDER BY from_day`, [l.sv_id]);
    const charges = await q(
      `SELECT lc.id, lc.total_paise, lc.added_at::date::text AS added_on FROM loan_charge lc
        WHERE lc.loan_id=$1 AND lc.removed_at IS NULL ORDER BY lc.added_at, lc.id`, [l.id]);
    const receipts = await q(RECEIPTS_FOR_REPLAY_SQL, [l.id]);
    const scheme = schemeFromRow(l, slabs, l.scheme_code);
    const state = replayLoan({ principalPaise: l.principal_paise, disbursedAt: l.disbursed_at,
      scheme, charges, receipts });
    const d = dues(scheme, state, today);
    out.push({ loan: l, scheme, state, dues: d, today,
      overdue: Number.isFinite(scheme.tenureDays) && Number(l.age_days) > scheme.tenureDays });
  }
  return out;
}

/**
 * The branch book (principal outstanding, paise) as at the CLOSE of a date:
 * every loan OPEN on that date (disbursed on or before it, not yet closed),
 * replayed by the engine with only the receipts and charges that existed by
 * then (E27b). Same arithmetic as the collect screen, so a report never
 * disagrees with a counter figure.
 */
export async function bookPrincipalAt(branchIds, d) {
  const loans = await q(
    `SELECT l.id, l.branch_id, l.principal_paise, l.disbursed_at,
            sv.id AS sv_id, sv.round_step_paise, sv.days_in_year, sv.calc_method,
            sv.min_interest_days, sv.tenure_days, sv.penal_rate_pct, sv.penal_grace_days,
            sv.interest_pct, sv.slab_mode, s.code AS scheme_code
       FROM loan l
       JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.branch_id = ANY($1::bigint[]) AND l.disbursed_at <= $2
        AND (l.closed_at IS NULL OR l.closed_at::date > $2)`, [branchIds, d]);
  const out = {};
  for (const l of loans) {
    const slabs = await q(`SELECT from_day, to_day, rate_pct FROM scheme_slab
                            WHERE scheme_version_id=$1 ORDER BY from_day`, [l.sv_id]);
    const charges = await q(
      `SELECT lc.id, lc.total_paise, lc.added_at::date::text AS added_on FROM loan_charge lc
        WHERE lc.loan_id=$1 AND lc.removed_at IS NULL AND lc.added_at::date <= $2
        ORDER BY lc.added_at, lc.id`, [l.id, d]);
    const receipts = await q(`SELECT * FROM (${RECEIPTS_FOR_REPLAY_SQL}) x WHERE x.business_date <= $2 ORDER BY x.business_date, x.id`, [l.id, d]);
    const scheme = schemeFromRow(l, slabs, l.scheme_code);
    const state = replayLoan({ principalPaise: l.principal_paise,
      disbursedAt: l.disbursed_at, scheme, charges, receipts });
    out[Number(l.branch_id)] = (out[Number(l.branch_id)] || 0) + Number(state.principal);
  }
  return out;
}
