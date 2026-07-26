import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { storeImage } from "@/lib/s3.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["customer_photo","ornament_set","presence","coborrower","seal","handover",
               "deposit_slip","cheque","kyc_scan","employee_face","employee_doc","other"];

export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });

  const { kind, dataUrl, thumbDataUrl, width, height } = await req.json().catch(() => ({}));
  if (!KINDS.includes(kind)) return NextResponse.json({ ok: false, reason: "unknown file kind" }, { status: 400 });
  if (!dataUrl?.startsWith("data:image/")) return NextResponse.json({ ok: false, reason: "expected an image" }, { status: 400 });

  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  if (buffer.length > 3000000)
    return NextResponse.json({ ok: false, reason: "image too large after compression" }, { status: 413 });
  const thumbBuffer = thumbDataUrl ? Buffer.from(thumbDataUrl.split(",")[1], "base64") : null;

  try {
    const r = await storeImage({ kind, buffer, thumbBuffer, mime: "image/jpeg",
      width, height, employeeId: actor.employeeId });
    return NextResponse.json({ ok: true, fileId: r.fileId, bytes: buffer.length });
  } catch (e) {
    console.error("[files] upload failed", e);
    return NextResponse.json({ ok: false, reason: "Could not store the photo — check S3 access" }, { status: 500 });
  }
}
