import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { one } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pincode → area/taluka/district/state · IFSC → bank/branch. Local directories. */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const p = new URL(req.url).searchParams;

  if (p.get("pincode")) {
    const r = await one(`SELECT area, taluka, district, state FROM pincode_directory WHERE pincode = $1`,
      [p.get("pincode")]);
    return NextResponse.json({ ok: !!r, ...(r || {}) });
  }
  if (p.get("ifsc")) {
    const r = await one(`SELECT bank, branch_name AS "branchName" FROM ifsc_directory WHERE ifsc = $1`,
      [p.get("ifsc").toUpperCase()]);
    return NextResponse.json({ ok: !!r, ...(r || {}) });
  }
  return NextResponse.json({ ok: false, reason: "nothing to look up" }, { status: 400 });
}
