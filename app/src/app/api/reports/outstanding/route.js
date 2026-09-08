import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { resolveBranchScope, activePositions } from "@/lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outstanding amount report — one row per ACTIVE loan as on today, priced by
 * the same engine replay the collect screen uses (running view).
 * Total due = principal outstanding + interest due + penal due + charges due.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, sp.branch);
  if (!scope) return NextResponse.json({ ok: false, reason: "That branch is not allotted to you" }, { status: 403 });

  try {
    let rows = await activePositions(scope.ids);
    if (sp.scheme) rows = rows.filter(r => r.loan.scheme_code === sp.scheme);
    if (sp.overdue === "1") rows = rows.filter(r => r.overdue);

    const out = rows.map(r => {
      const p = r.dues._paise;
      const principalOut = Math.round(r.state.principal * 100);
      return {
        branch: `${r.loan.branch_code} ${r.loan.branch_name}`,
        loanNo: r.loan.loan_no,
        disbursedAt: r.loan.disbursed_at,
        ageDays: Number(r.loan.age_days),
        tenureDays: r.scheme.tenureDays,
        overdue: r.overdue,
        custNo: r.loan.cust_no,
        customer: r.loan.customer_name,
        mobile: r.loan.mobile,
        scheme: r.loan.scheme_code,
        netGrams: Number(r.loan.net_mg) / 1000,
        sanctionedPaise: Number(r.loan.principal_paise),
        principalPaise: principalOut,
        interestPaise: p.interestDue,
        penalPaise: p.penalDue,
        chargesPaise: p.chargesDue,
        totalDuePaise: principalOut + p.interestDue + p.penalDue + p.chargesDue,
        lastPaidOn: r.loan.last_paid_on,
        lastPaidPaise: r.loan.last_paid_paise == null ? null : Number(r.loan.last_paid_paise),
      };
    });
    const asOn = rows[0]?.today || new Date().toISOString().slice(0, 10);
    return NextResponse.json({ ok: true, asOn, scope: scope.label, rows: out });
  } catch (e) {
    console.error("[reports/outstanding] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
