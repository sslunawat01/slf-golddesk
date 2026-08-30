/**
 * Walk: create a customer through the real HTTP API (bug report 30 Aug 2026 —
 * "server error while saving customer"). Logs in as snehal.k (single branch),
 * POSTs a valid new customer, prints status + body. Then the duplicate-mobile
 * and dupAcknowledged cases. Run against the local dev server on :3000.
 */
const BASE = "http://localhost:3000";

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const j = await r.json();
  if (!j.ok) throw new Error(`login failed: ${JSON.stringify(j)}`);
  return cookie;
}

function payload(overrides = {}) {
  return {
    custType: "individual",
    firstName: "Walkrepro", lastName: "Thirty",
    dob: "1990-01-15", gender: "male",
    aadhaar: "555566667777", aadhaarVerified: true,
    photoFileId: 1,
    mobile: "9812345678",
    current: { line1: "12 Test Lane", pincode: "422101" },
    sameAsCurrent: true,
    nominee: { name: "Nom Walk", relation: "spouse" },
    maxOpenLoans: 3, maxOutstandingPaise: 50000000,
    ...overrides,
  };
}

const cookie = await login("snehal.k", "Testpass123456");
console.log("logged in");

async function post(body, label) {
  const r = await fetch(`${BASE}/api/customers`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  console.log(`\n[${label}] HTTP ${r.status}`);
  console.log(text.slice(0, 400));
  return { status: r.status, text };
}

// 1 — plain valid create (the owner's failing action); fresh mobile + aadhaar
await post(payload({ mobile: "9812345679", aadhaar: "555566667799" }),
  "create new customer");

// 2 — same mobile again: must be a 409 NAMING the owning customer, not a 500
await post(payload({ firstName: "Walkrepro2", aadhaar: "555566667700" }),
  "duplicate mobile (cust 37 owns 9812345678)");

// 3 — dupAcknowledged must NOT override a same-table duplicate (E21 №2)
await post(payload({ firstName: "Walkrepro4", aadhaar: "555566667700", dupAcknowledged: true }),
  "duplicate mobile with dupAcknowledged");

// 4 — duplicate full Aadhaar, fresh mobile: 409 naming the owner
await post(payload({ firstName: "Walkrepro5", mobile: "9812345670", aadhaar: "555566667788", dupAcknowledged: true }),
  "duplicate aadhaar with dupAcknowledged");
