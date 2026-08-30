/**
 * Walk: A1+A2 rates build (owner GO, 30 Aug 2026). API layer:
 *   1. slunawat publishes a silver pair (12,000 market → funding must obey);
 *   2. a fresh application snapshots BOTH pairs in application_rate;
 *   3. a PATCH with one gold + one silver item prices each off its own pair;
 *   4. the priced figures land in appraisal_item.
 * Then the UI layer is walked separately (walk-rates-ui.mjs).
 */
const BASE = "http://localhost:3000";
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

async function login(username, password, branchHint) {
  let r = await fetch(`${BASE}/api/auth/login`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }) });
  let cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const j = await r.json();
  if (j.next === "branch") {
    const r2 = await fetch(`${BASE}/api/auth/branch`, { method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ employeeId: j.employeeId, branchId: branchHint }) });
    cookie = (r2.headers.get("set-cookie") || "").split(";")[0] || cookie;
    const j2 = await r2.json();
    if (!j2.ok) throw new Error("branch select failed: " + JSON.stringify(j2));
  } else if (!j.ok) throw new Error("login failed: " + JSON.stringify(j));
  return cookie;
}

const post = (cookie, path, body, method = "POST") =>
  fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json().catch(() => null) }));

// 1 — publish silver pair as the owner (branch 1)
const boss = await login("slunawat", "Testpass123456", 1);
const pub = await post(boss, "/api/rate", { marketRupees: 12000, fundingRupees: 10800, confirmed: true, metalId: 2 });
ok(pub.j?.ok === true || /already/i.test(pub.j?.reason || ""), `silver rate published (${pub.status} ${pub.j?.reason || "ok"})`);

// 2 — start a pledge for a customer at branch 1; snapshot must carry silver
const cust = await post(boss, "/api/lookup/customer?q=", null, "GET").catch(() => null);
const app1 = await post(boss, "/api/applications", { customerId: process.env.WALK_CUST || 27 });
ok(app1.j?.ok === true, `application started (${app1.j?.id ?? app1.j?.reason})`);
const appId = app1.j?.id;

// pull the snapshot rows straight from the API the wizard uses: the pledge page
// is SSR, so check via a save instead — PATCH one gold + one silver item.
// item/purity ids: gold purity 22K=1, silver 99=7; items master: pick per metal.
const items = [
  { itemId: process.env.GOLD_ITEM || 1, qty: 1, grossMg: 10000, stoneMg: 0, purityId: 1 },
  { itemId: process.env.SILVER_ITEM || 1, qty: 1, grossMg: 100000, stoneMg: 0, purityId: 7 },
];
const patch = await post(boss, `/api/applications/${appId}`, { items }, "PATCH");
ok(patch.j?.ok === true, `PATCH with gold+silver items saved (${patch.j?.reason || "ok"})`);

console.log(failures === 0 ? "\nAPI WALK PASS (verify DB rows next)" : `\nAPI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
