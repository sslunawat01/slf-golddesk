# SLF GoldDesk — Decision Record
**Every decision made, and why.** For S Lunawat Finance (NBFC, Bhagur/Nashik).
Last updated: 27 July 2026 · Keep this file with the code; it is the constitution.

---

## 1 · Product

| # | Decision | Note |
|---|---|---|
| P1 | Build a gold-loan system from scratch, replacing the 2015 vendor product (Maraekat) | Rules become data, not code |
| P2 | Two front doors, one database: **Counter** (branch) and **HQ** (head office) | Same codebase |
| P3 | **Search is the front door** — no browsable lists of active loans | A branch carries 1000+ loans |
| P4 | Home shows work-in-progress + deadline queues only; queues hide when empty | The system drives the work |
| P5 | UX frozen in Claude Design first, then built | **The frozen `.dc.html` is the truth** — it beats written specs wherever they disagree |
| P6 | Target scale: 200–400 branches, 1M+ customers, 10M+ loans over ten years | Modest for Postgres; the constraint is operations, not throughput |

---

## 2 · The interest engine (locked with the owner, July 2026)

These are the rules money is made by. Changing one requires a written owner decision.

| # | Rule | Detail |
|---|---|---|
| R-A | **Day divisor comes from the scheme** (`days_in_year`, 365 today) | Never the calendar; leap years irrelevant |
| R-B | **Slabs are retroactive within a cycle** | The slab the cycle's age reaches prices *all* its days. `prospective` exists as scheme config |
| R-C | **Cycles are anchored by interest payments** | A payment clearing all interest due seals that period and **restarts the slab clock from day 1**. Partial payments reduce dues but never move the anchor. Penal has its own anchor |
| R-D | **Round UP to the next ₹10, once per component** | Applies to interest, penal **and charges**. Raw 2-dp figures always shown. The charge round-up posts to the **Rounding income** ledger; the GST split underneath stays exact |
| R-E | **Minimum interest is a lifetime, closure-only floor** | `min_interest_days` (15). Tops up the loan's *total* interest only if it closes short. Interim payments are at actual days |
| R-F | **Settlement = principal + interest + penal + charges**, each already rounded | No second rounding |
| R-G | **Appropriation order: charges → penal → interest → principal** | |
| R-H | **Capitalization only at renewal**, by human choice, scheme-gated | Interest never compounds automatically |
| R-I | **Penal = % p.a. on overdue principal from tenure end.** Grace **forgives entirely** if closed within tenure+grace; past that, penal runs **from tenure end** (grace days counted, not skipped) | Rate and grace are scheme fields. Never capitalized |
| R-J | **Principal is a multiple of ₹100**; payments minimum ₹100 in ₹10 steps | Exact settlement always accepted |

**Figures that must never change** (47 golden tests enforce them):
Prathmesh ₹1,00,000 SB-IND04 day 80 → **₹3,950** · Komal ₹20,000 day 33 → **₹370** ·
Archana ₹50,000 day 5: interim **₹140**, closure **₹420** · cycle split (pay day 60, close day 80) → ₹2,470 + **₹830** ·
penal at day 190 / 193 / 250 → **₹0 / ₹50 / ₹360** · processing ₹177 collects as **₹180** (₹3 to Rounding income).

---

## 3 · Rates and valuation

| # | Decision | Detail |
|---|---|---|
| V1 | **Two rates per metal: market and funding** | Market = what the ornament is worth (shown to the customer). Funding = what we lend against. Funding ≤ market, enforced by database constraint |
| V2 | The gap is the **haircut, taken before the scheme's funding %** | e.g. 6.2% haircut + 70% scheme ≈ 65% of market value |
| V3 | Rate/gram = rate × purity % (× scheme funding % for the lendable figure) | Verified against the legacy system: 12,100 × 83% × 70% = **₹7,030.10/g** |
| V4 | **Publishing is optional — a rate carries forward until changed** | No rate ever published ⇒ branches locked for new lending |
| V5 | **One person sets the rate** (changed from maker–checker at owner's instruction) | With a **sanity guard**: a move over 5% asks for confirmation, showing old vs new. The confirmation is recorded on the rate row |
| V6 | Market and funding values are shown **separately**, each rounded **up to ₹100** | Both figures honest on their own |
| V7 | Every application **snapshots both rates** | A loan is always re-checkable at the pair it was priced at |

---

## 4 · Customers and KYC

| # | Decision | Detail |
|---|---|---|
| C1 | **Five tabs**: Identity · Contact · Documents · Nominee · Loan settings | Matches the frozen UX. Address lives inside Contact; **bank accounts live inside Documents** |
| C2 | **Aadhaar *or* PAN is enough** | The asterisk moves: verifying one makes the other optional |
| C3 | A **verified Aadhaar also proves address** | No further document demanded. With only PAN, one address document is required |
| C4 | **GST is optional for everyone**, corporate included | |
| C5 | **KYC valid 3 years** | Green → amber within 90 days → red expired, which **blocks new lending** |
| C6 | **Zero on either limit ⇒ blacklisted** | Narration mandatory, confirmation modal, permanent red banner, lending blocked |
| C7 | Mobile OTP **not compulsory** until the SMS gateway is connected | Runs in manual mode: the code shows on screen for the operator to read aloud. OTP appears as a **modal**, not inline |
| C8 | Pincode → **India Post API**, cached locally | Multiple post offices become an Area dropdown. Works offline for known pincodes |
| C9 | IFSC → **public IFSC API**, cached locally | Bank and branch shown under the IFSC field |
| C10 | Money can only reach a **verified** account (penny drop or cancelled cheque) | Enforced by a database trigger |
| C11 | Aadhaar displays as `8687 7868 6868`; PAN shape-guided `BHKYT2345M`; mobile `98220 11223` | Display formatting only; storage stays clean |

---

## 5 · Lending flow

| # | Decision | Detail |
|---|---|---|
| L1 | Pledge is **one 3-step wizard**: Appraisal → Scheme/amount/people → Disbursement | No separate sanction or seal screens |
| L2 | **Valuer 1 + Valuer 2** on appraisal | Valuer 2 compulsory above ₹20,000 and must be a different person |
| L3 | Above the sanction ceiling ⇒ **routes to HO from inside the wizard** | Ceiling = MIN(person override, role limit) |
| L4 | **Deny by default on sanction authority** | No limit row means **zero**, not unlimited. "Unlimited" is an explicit database flag granted deliberately |
| L5 | The person who recommends a file **can never decide it** | Database CHECK |
| L6 | **One photo set for all ornaments together** | Evidence of record |
| L7 | **Vault-in is the next working day**: seal intact → recount → weight recheck → safe | Sealing and QR happen there, not at the counter |
| L8 | **Single custodian** for vault actions, logged | No dual sign-off |
| L9 | Cash disbursement **< ₹20,000** (269SS); receipts ≤ ₹2,00,000/customer/day (269ST) | |
| L10 | **Multi-account disbursement** — cash plus any number of verified accounts, paid from SLF's own account | Must be fully allocated |
| L11 | **All printing after activation** | Appraisal note · loan agreement + KFS · bank-details NOC |
| L12 | Gold release within **7 working days**, three gates before handover | Identity re-verified · seal intact, opened before the borrower · handover photo |

---

## 6 · Access and security

| # | Decision | Detail |
|---|---|---|
| A1 | **Roles are renamable permission bundles** | Never branch on a role name; rules attach to actions |
| A2 | **One policy engine**, server-side, deny by default | Hiding a button is not security |
| A3 | **Database-backed sessions**, not tokens | Force-logout and role changes take effect instantly |
| A4 | Passwords: **scrypt**, Node built-in | No fragile native modules; 10+ chars, letter, digit, not the username |
| A5 | **Login windows per role**, lockout after 5 failed attempts | Refusal names the actual permitted hours |
| A6 | **Two-factor deferred** | Screen exists, dormant, by owner's decision |
| A7 | Users created only via HQ → Employees | No self-signup, ever |
| A8 | **Acting branch is fixed at sign-in** and stamped on every write | Multi-branch staff choose once per session |

---

## 7 · Technical

| # | Decision | Detail |
|---|---|---|
| T1 | **Next.js + PostgreSQL**, modular monolith | No microservices at this scale |
| T2 | **Money in integer paise, weights in integer milligrams** | No floats anywhere |
| T3 | **Facts are append-only**: receipts, vault movements, rates, state history, audit log | Triggers forbid UPDATE and DELETE; corrections are new rows |
| T4 | **Derived values are never stored** | Interest, settlement, queues, LTV all computed. One sanctioned cache (`loan_accrual_cache`), rebuildable |
| T5 | **Rules live in the database where possible** | CHECK constraints, triggers, generated columns — the app is a second line, not the only one |
| T6 | **Versioned schemes**; a published version is immutable and loans pin theirs forever | |
| T7 | **Structure is data**: entities, branches, safes, roles, schemes, charges, items | Adding a branch touches no code |
| T8 | **Forward-only migrations**, one transaction each | A failure rolls back cleanly and can be retried |
| T9 | Photos **compressed on the device** before upload (1600px ≈ 250 KB + thumbnail), stored in S3 | Branch connections are modest |
| T10 | Hosting: **EC2 Ubuntu in Mumbai**, PostgreSQL local for now, S3 for media, nightly backup 02:30 IST | **Move the database to RDS before the second branch goes live** |
| T11 | Deployment: `ops/deploy.sh` — pull, migrate, test, build, restart | Refuses to leave a broken service running |
| T12 | Everything in a **private GitHub repo** owned by SLF | |

---

## 8 · Lessons written into the way we work

These came from real mistakes on this build. They are rules now.

1. **The frozen UX is the truth.** Before building any screen, decode the frozen page and extract its exact fields, wording and behaviour. Never reconstruct from memory or from the written spec alone. *(Cost: the customer form was built with 7 tabs instead of 5, with bank details in the wrong place.)*
2. **Deny by default, everywhere.** The absence of a rule is never permission. *(Cost: a counter operator briefly showed "unlimited" sanction authority because no limit row existed.)*
3. **A display label is never a stored value.** Options carry a machine value and human text separately. *(Cost: `"Low"` vs `low` broke every customer save.)*
4. **Errors must name their cause on screen.** A safe-but-vague message costs more than it protects. *(Cost: "nothing was written" took three exchanges to diagnose.)*
5. **A server route never calls its own application over the network.** Shared logic goes in a function both callers import. *(Cost: "network problem" on New pledge.)*
6. **Every business rule gets a test that states it in English.** 231 tests and counting; each one is a decision made executable.
7. **Never paste secrets into chat.** Commands that touch credentials print only ✓ or ✗.

---

## 9 · Still open — needs an owner decision

| # | Question | Blocks |
|---|---|---|
| O1 | **Top-up mechanics** — amend the running loan, or a second loan on the same packet? Interest on the original tranche? Re-appraisal needed? | Sprint 3 |
| O2 | **Cash transfer authority** — who authorises, above what amount, insurance per carry, must HO acknowledge? | Sprint 3 |
| O3 | **Death-case legal chain** — succession certificate threshold vs indemnity bond, dues before handover, HQ signatory | Sprint 3 |
| O4 | **Cancellation after sanction** — who may cancel, is the loan number voided or retained, charge recovery | Sprint 3 |
| O5 | **Print stationery** — A4 vs 80 mm, Marathi font, bilingual KFS on one sheet | Print layouts |
| O6 | **B-book vs V-book** — what the two entity series actually are | GL separation, returns |
| O7 | **Silver** — second metal tab with its own rate pair? | Rate screen |
| O8 | **IBJA reference feed** — paid data source, or manual entry? | Rate screen |
| O9 | Slab-boundary warning to the customer at the counter? | Repayment screen |

---

## 10 · Where the build stands (27 July 2026)

**Done and live at https://slf.slunawat.in**
Interest engine (47 golden tests) · database (80 tables, 6 migrations) · server, HTTPS, nightly backups, GitHub ·
authentication, sessions, permission engine · daily rate with market/funding pair · search · new customer (5-tab KYC) ·
Customer 360 · pledge wizard · HO approvals · disbursement.
**231 tests passing.**

**Next**
Sprint 2 — vault-in, vault register, repayment (wiring the proven engine to the counter), charges, day begin/end, cash transfer.

*Read alongside: `CLAUDE.md` (working rules on the server) · the frozen `.dc.html` UX (pixel truth) · `db/schema.sql` (data truth) · `engine/golden.test.js` (money truth).*
