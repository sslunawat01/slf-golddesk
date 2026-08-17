import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { loanDay, bucketsFor, validFollowUp } from "@/lib/overdue.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "collect", { need: "view" }).ok)
    return { status: 403, reason: "You may not view collections" };
  return null;
}

// ————————————————————————— GET: the worklist —————————————————————————

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor);
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const today = new Date().toISOString().slice(0, 10);

  // active loans of the acting branch, with cheap-but-exact principal outstanding
  const loans = await q(
    `SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.scheme_version_id,
            c.full_name AS cust, c.mobile,
            s.code AS scheme_code, sv.tenure_days,
            l.principal_paise
              - COALESCE((SELECT SUM(ra.amount_paise) FROM receipt_appropriation ra
                            JOIN receipt r ON r.id = ra.receipt_id
                           WHERE r.loan_id = l.id AND ra.bucket = 'principal'), 0)
              AS outstanding_paise
       FROM loan l
       JOIN loan_application la ON la.id = l.application_id
       JOIN customer c ON c.id = la.customer_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.branch_id = $1 AND l.status = 'active'
      ORDER BY l.disbursed_at`, [actor.actingBranchId]);

  const versionIds = [...new Set(loans.map(l => Number(l.scheme_version_id)))];
  const slabs = versionIds.length ? await q(
    `SELECT scheme_version_id, from_day FROM scheme_slab
      WHERE scheme_version_id = ANY($1::bigint[])`, [versionIds]) : [];

  const loanIds = loans.map(l => Number(l.id));
  const calls = loanIds.length ? await q(
    `SELECT cc.loan_id, cc.method, cc.outcome::text, cc.ptp_date, cc.next_follow_up,
            cc.note, cc.at, e.full_name AS by
       FROM collection_call cc JOIN employee e ON e.id = cc.by_employee
      WHERE cc.loan_id = ANY($1::bigint[]) ORDER BY cc.at DESC`, [loanIds]) : [];
  const notices = loanIds.length ? await q(
    `SELECT loan_id, level, channel::text, sent_at FROM notice
      WHERE loan_id = ANY($1::bigint[]) ORDER BY sent_at DESC`, [loanIds]) : [];

  const outcomes = (await one(
    `SELECT enum_range(NULL::call_outcome)::text[] AS labels`)).labels;
  const branch = await one(`SELECT code, name FROM branch WHERE id=$1`, [actor.actingBranchId]);
  const schemes = [...new Map(loans.map(l => [l.scheme_code, l.scheme_code])).keys()];

  const rows = loans.map(l => {
    const day = loanDay(l.disbursed_at, today);
    const mySlabs = slabs.filter(s => Number(s.scheme_version_id) === Number(l.scheme_version_id))
      .map(s => ({ fromDay: Number(s.from_day) }));
    const myCalls = calls.filter(x => Number(x.loan_id) === Number(l.id));
    const last = myCalls[0] || null;
    const myNotices = notices.filter(x => Number(x.loan_id) === Number(l.id));
    return {
      id: Number(l.id), loanNo: l.loan_no, cust: l.cust, mobile: l.mobile,
      scheme: l.scheme_code, day, tenureDays: Number(l.tenure_days),
      outstandingPaise: Number(l.outstanding_paise),
      buckets: bucketsFor({ day, tenureDays: l.tenure_days, slabs: mySlabs,
        nextFollowUp: last?.next_follow_up || null, today }),
      slabs: mySlabs,
      lastCall: last ? { method: last.method, outcome: last.outcome,
        ptpDate: last.ptp_date, nextFollowUp: last.next_follow_up,
        note: last.note, at: last.at, by: last.by } : null,
      history: myCalls.map(x => ({ kind: "call", at: x.at, by: x.by,
        method: x.method, outcome: x.outcome, ptpDate: x.ptp_date,
        nextFollowUp: x.next_follow_up, note: x.note }))
        .concat(myNotices.map(n => ({ kind: "notice", at: n.sent_at,
          level: Number(n.level), channel: n.channel })))
        .sort((a, b) => String(b.at).localeCompare(String(a.at))),
      noticeCount: myNotices.length,
      noticeTop: myNotices.length ? Math.max(...myNotices.map(n => Number(n.level))) : 0,
    };
  });

  return NextResponse.json({ ok: true, rows, outcomes, schemes, today,
    branch: branch ? `${branch.code} ${branch.name}` : "",
    canSave: can(actor, "collect", { need: "full" }).ok });
}

// ————————————————————————— POST: save a follow-up (append-only) —————————————————————————

export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "collect", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not record follow-ups" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const loan = b.loanId ? await one(
    `SELECT id, loan_no, branch_id, status FROM loan WHERE id=$1`, [b.loanId]) : null;
  if (!loan) return NextResponse.json({ ok: false, reason: "Loan not found" }, { status: 404 });
  if (Number(loan.branch_id) !== Number(actor.actingBranchId))
    return NextResponse.json({ ok: false, reason: "That loan belongs to another branch" }, { status: 403 });
  if (loan.status !== "active")
    return NextResponse.json({ ok: false, reason: "The loan is not active" }, { status: 409 });

  const outcomes = (await one(
    `SELECT enum_range(NULL::call_outcome)::text[] AS labels`)).labels;
  const today = new Date().toISOString().slice(0, 10);
  const v = validFollowUp(b, outcomes, today);
  if (!v.ok)
    return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems },
      { status: 400 });

  try {
    await tx(async (cl) => {
      await cl.query(
        `INSERT INTO collection_call (loan_id, method, outcome, ptp_date, next_follow_up,
           note, by_employee)
         VALUES ($1,$2,$3::call_outcome,$4,$5,$6,$7)`,
        [loan.id, v.method, v.outcome, v.ptpDate, v.nextFollowUp, v.narration,
         actor.employeeId]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "collection_call", entityId: loan.id, action: "follow_up",
        after: { loanNo: loan.loan_no, method: v.method, outcome: v.outcome,
                 ptp: v.ptpDate, next: v.nextFollowUp } });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: "The follow-up could not be saved" },
      { status: 500 });
  }
}
