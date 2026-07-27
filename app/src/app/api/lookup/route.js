import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { lookupPincode } from "@/lib/pincode.js";
import { lookupIfsc } from "@/lib/ifsc.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const p = new URL(req.url).searchParams;

  if (p.get("pincode")) {
    const r = await lookupPincode(p.get("pincode"));
    if (!r) return NextResponse.json({ ok: false, reason: "Pincode not found — type the address by hand" });
    return NextResponse.json({ ok: true, area: r.area, taluka: r.taluka, district: r.district,
      state: r.state, options: r.options, source: r.source });
  }
  if (p.get("ifsc")) {
    const r = await lookupIfsc(p.get("ifsc"));
    if (!r) return NextResponse.json({ ok: false, reason: "IFSC not found — check the code" });
    return NextResponse.json({ ok: true, bank: r.bank, branchName: r.branchName,
      address: r.address, city: r.city, state: r.state, source: r.source });
  }
  return NextResponse.json({ ok: false, reason: "nothing to look up" }, { status: 400 });
}
