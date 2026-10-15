import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q } from "@/lib/db.js";
import { resolveBranchScope, resolvePeriod, activePositions, bookPrincipalAt } from "@/lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Branch Loan Summary (MIS) — one row per allotted branch for the period:
 * business written, closures, live book as on today (engine replay),
 * applications, and collections split by mode and by appropriation bucket.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, sp.branch);
  if (!scope) return NextResponse.json({ ok: false, reason: "That branch is not allotted to you" }, { status: 403 });
  const { from, to } = await resolvePeriod(sp);

  try {
    const P = [scope.ids, from, to];
    const [disb, closed, apps, appr, canc, recs, buckets] = await Promise.all([
      q(`SELECT l.branch_id, count(*)::int AS n, coalesce(sum(l.principal_paise),0)::bigint AS principal,
                coalesce(sum((SELECT sum(ai.net_mg) FROM appraisal_item ai
                               WHERE ai.application_id = l.application_id)),0)::bigint AS net_mg
           FROM loan l WHERE l.branch_id = ANY($1::bigint[])
            AND l.disbursed_at BETWEEN $2 AND $3 GROUP BY l.branch_id`, P),
      q(`SELECT branch_id, count(*)::int AS n, coalesce(sum(principal_paise),0)::bigint AS principal
           FROM loan WHERE branch_id = ANY($1::bigint[])
            AND closed_at::date BETWEEN $2 AND $3 GROUP BY branch_id`, P),
      q(`SELECT branch_id, count(*)::int AS n FROM loan_application
          WHERE branch_id = ANY($1::bigint[]) AND created_at::date BETWEEN $2 AND $3
          GROUP BY branch_id`, P),
      q(`SELECT a.branch_id, count(DISTINCT h.application_id)::int AS n
           FROM loan_state_history h JOIN loan_application a ON a.id = h.application_id
          WHERE a.branch_id = ANY($1::bigint[]) AND h.to_state = 'approved'
            AND h.at::date BETWEEN $2 AND $3 GROUP BY a.branch_id`, P),
      q(`SELECT a.branch_id, count(DISTINCT h.application_id)::int AS n
           FROM loan_state_history h JOIN loan_application a ON a.id = h.application_id
          WHERE a.branch_id = ANY($1::bigint[]) AND h.to_state = 'cancelled'
            AND h.at::date BETWEEN $2 AND $3 GROUP BY a.branch_id`, P),
      q(`SELECT branch_id, count(*)::int AS n, coalesce(sum(amount_paise),0)::bigint AS total,
                coalesce(sum(amount_paise) FILTER (WHERE mode='cash'),0)::bigint AS cash,
                coalesce(sum(amount_paise) FILTER (WHERE mode='upi'),0)::bigint AS upi,
                coalesce(sum(amount_paise) FILTER (WHERE mode='bank'),0)::bigint AS bank
           FROM receipt WHERE branch_id = ANY($1::bigint[])
            AND business_date BETWEEN $2 AND $3 GROUP BY branch_id`, P),
      q(`SELECT r.branch_id,
                coalesce(sum(ra.amount_paise) FILTER (WHERE ra.bucket='interest'),0)::bigint AS interest,
                coalesce(sum(ra.amount_paise) FILTER (WHERE ra.bucket='penal'),0)::bigint AS penal,
                coalesce(sum(ra.amount_paise) FILTER (WHERE ra.bucket IN ('charge','charge_rounding')),0)::bigint AS charges,
                coalesce(sum(ra.amount_paise) FILTER (WHERE ra.bucket='principal'),0)::bigint AS principal
           FROM receipt_appropriation ra JOIN receipt r ON r.id = ra.receipt_id
          WHERE r.branch_id = ANY($1::bigint[]) AND r.business_date BETWEEN $2 AND $3
          GROUP BY r.branch_id`, P),
    ]);
    const positions = await activePositions(scope.ids);

    // E27b (owner, 9 Sep 2026): outstanding AMOUNT as at the period start
    // (close of the day before `from`) and the period end (close of `to`), by
    // ENGINE REPLAY as of each date — the collect screen's own arithmetic, so
    // with `to` covering today the End figure equals Principal O/s exactly.
    const dayBefore = (await q(`SELECT ($1::date - 1)::text AS d`, [from]))[0].d;
    const [OS1, OS2] = await Promise.all([
      bookPrincipalAt(scope.ids, dayBefore), bookPrincipalAt(scope.ids, to)]);

    const branches = (actor.branches || []).filter(b => scope.ids.includes(Number(b.id)));
    const by = (list) => Object.fromEntries(list.map(r => [Number(r.branch_id), r]));
    const [D, C, A, AP, CN, R, B] = [by(disb), by(closed), by(apps), by(appr), by(canc), by(recs), by(buckets)];

    const rows = branches.map(b => {
      const id = Number(b.id);
      const live = positions.filter(p => Number(p.loan.branch_id) === id);
      const liveDue = live.reduce((a, p) => {
        const pr = Number(p.state.principal), d = p.dues._paise;   // already paise (E27b)
        a.principal += pr; a.interest += d.interestDue; a.charges += d.chargesDue + d.penalDue;
        a.total += pr + d.interestDue + d.penalDue + d.chargesDue; return a;
      }, { principal: 0, interest: 0, charges: 0, total: 0 });
      const od = live.filter(p => p.overdue);
      return {
        branch: `${b.code} ${b.name}`,
        osStartPaise: Number(OS1[id] || 0),
        osEndPaise: Number(OS2[id] || 0),
        disbursedCount: D[id]?.n || 0, disbursedPaise: Number(D[id]?.principal || 0),
        disbursedGrams: Number(D[id]?.net_mg || 0) / 1000,
        closedCount: C[id]?.n || 0, closedPaise: Number(C[id]?.principal || 0),
        activeCount: live.length,
        activePrincipalPaise: liveDue.principal, activeInterestPaise: liveDue.interest,
        activeChargesPaise: liveDue.charges, activeTotalDuePaise: liveDue.total,
        overdueCount: od.length,
        overduePrincipalPaise: od.reduce((a, p) => a + Number(p.state.principal), 0),
        goldGrams: live.reduce((a, p) => a + Number(p.loan.net_mg), 0) / 1000,
        appsStarted: A[id]?.n || 0, appsApproved: AP[id]?.n || 0, appsCancelled: CN[id]?.n || 0,
        receiptCount: R[id]?.n || 0, collectedPaise: Number(R[id]?.total || 0),
        cashPaise: Number(R[id]?.cash || 0), upiPaise: Number(R[id]?.upi || 0),
        bankPaise: Number(R[id]?.bank || 0),
        interestCollectedPaise: Number(B[id]?.interest || 0),
        penalCollectedPaise: Number(B[id]?.penal || 0),
        chargesCollectedPaise: Number(B[id]?.charges || 0),
        principalCollectedPaise: Number(B[id]?.principal || 0),
      };
    });
    return NextResponse.json({ ok: true, from, to, scope: scope.label, rows });
  } catch (e) {
    console.error("[reports/summary] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
