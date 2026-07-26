import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Form-post entry point: start (or resume) a pledge, then land on the wizard. */
export async function POST(req) {
  const form = await req.formData();
  const customerId = Number(form.get("customerId"));
  const r = await fetch(new URL("/api/applications", req.url), {
    method: "POST", headers: { "content-type": "application/json", cookie: req.headers.get("cookie") || "" },
    body: JSON.stringify({ customerId }),
  }).then(r => r.json()).catch(() => ({ ok: false, reason: "could not start" }));

  const url = r.ok ? `/pledge/${r.id}`
    : `/customers/${customerId}?err=${encodeURIComponent(r.reason || "could not start")}`;
  return NextResponse.redirect(new URL(url, req.url), 303);
}
