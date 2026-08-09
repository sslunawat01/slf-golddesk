import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { chargeDefault, splitTotal, validChargeBatch } from "@/lib/addcharge.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "collect", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view charges" }, { status: 403 });

  const { id } = await params;
  const loan = await one(
    `SELECT l.id, l.loan_no, l.status, l.principal_paise, c.full_name AS customer_name,
            s.code AS scheme_code
       FROM loan l JOIN customer c ON c.id = l.customer_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.id = $1 AND l.branch_id = $2`, [Number(id), actor.actingBranchId]);
  if (!loan) return NextResponse.json({ ok: false, reason: "Loan not found at this branch" }, { status: 404 });

  const types = await q(
    `SELECT id, name, calc, amount_paise, pct, min_paise, max_paise, gst_pct
       FROM charge_type WHERE active ORDER BY name`);

  return NextResponse.json({ ok: true,
    loan: { id: loan.id, loanNo: loan.loan_no, status: loan.status,
      customerName: loan.customer_name, schemeCode: loan.scheme_code },
    types: types.map(t => {
      const d = chargeDefault(t, loan.principal_paise);
      const basis = t.calc === "percent"
        ? `${Number(t.pct)}% of sanction` +
          (t.min_paise ? ` · min ₹${Math.round(t.min_paise / 100)}` : "") +
          (t.max_paise ? ` · max ₹${Math.round(t.max_paise / 100)}` : "")
        : d.manual ? "at actuals, as billed" : "flat";
      return { id: t.id, name: t.name, basis, gstPct: Number(t.gst_pct),
        manual: d.manual, defaultTotalPaise: d.totalPaise,
        defaultBasePaise: d.basePaise, defaultGstPaise: d.gstPaise };
    }),
    canAct: can(actor, "collect", { need: "full" }).ok });
}

export async function POST(req, { params }) {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
    if (!can(actor, "collect", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not add charges" }, { status: 403 });

    const { id } = await params;
    const b = await req.json().catch(() => ({}));
    const narration = String(b.narration || "").trim();

    const loan = await one(
      `SELECT l.id, l.loan_no, l.status, l.principal_paise FROM loan l
        WHERE l.id = $1 AND l.branch_id = $2`, [Number(id), actor.actingBranchId]);
    if (!loan) return NextResponse.json({ ok: false, reason: "Loan not found at this branch" }, { status: 404 });

    // Recompute every default server-side; the browser's figures are display only.
    const picks = [];
    for (const p of b.picks || []) {
      const ct = await one(`SELECT * FROM charge_type WHERE id=$1 AND active`, [p.chargeTypeId]);
      if (!ct) return NextResponse.json({ ok: false, reason: "Unknown charge type" }, { status: 400 });
      const d = chargeDefault(ct, loan.principal_paise);
      picks.push({ ct, d, enteredPaise: Math.round(Number(p.totalPaise || 0)),
        manual: d.manual, defaultTotalPaise: d.totalPaise });
    }
    const v = validChargeBatch({ picks, narration, loanStatus: loan.status });
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });

    const out = await tx(async (cl) => {
      const added = [];
      for (const p of picks) {
        const split = splitTotal(p.enteredPaise, Number(p.ct.gst_pct || 0));
        const floor = p.manual ? p.enteredPaise : p.defaultTotalPaise;
        const { rows: [r] } = await cl.query(
          `INSERT INTO loan_charge (loan_id, charge_type_id, base_paise, gst_paise,
             total_paise, floor_paise, narration, added_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [loan.id, p.ct.id, split.basePaise, split.gstPaise, p.enteredPaise,
           floor, narration, actor.employeeId]);
        added.push({ id: Number(r.id), name: p.ct.name, totalPaise: p.enteredPaise });
      }
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "loan_charge", entityId: loan.id, action: "charges_added",
        after: { loanNo: loan.loan_no, narration, charges: added } });
      return { added };
    }, { entityIds: actor.entityIds });

    return NextResponse.json({ ok: true, ...out,
      totalPaise: out.added.reduce((s, a) => s + a.totalPaise, 0) });
  } catch (e) {
    console.error("[addcharge] failed", e);
    return NextResponse.json({ ok: false,
      reason: "Save failed — " + (e.message || "unknown error") + " (nothing was saved)" },
      { status: 500 });
  }
}
