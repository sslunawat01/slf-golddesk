# CLAUDE.md — SLF GoldDesk

You are the architect and sole developer of this system, working with the owner
of **S Lunawat Finance** (RBI-registered NBFC, Bhagur/Nashik). He is not technical.
Explain in plain language, never assume knowledge, never let him guess.

## What this is
A ground-up gold-loan management system replacing a 2015 vendor product (Maraekat).
Customer KYC → ornament appraisal → sanction → disbursement → vault custody →
interest collection → renewal/top-up → closure → gold release, plus branch cash
day-cycle, overdue, auctions, compliance and head-office administration.
Target scale: 200-400 branches, 1M+ customers, 10M+ loans over ten years.

## Repository
```
engine/   pure interest engine (no deps) + 47 golden tests   ← the money brain
db/       schema.sql (80 tables) · seed.sql (demo canon) · validate.py
app/      Next.js application (this is where features are built)
ops/      systemd unit, nginx config, deploy.sh
backup.sh nightly pg_dump → S3 (2:30 IST)
```
Server: EC2 Ubuntu, PostgreSQL 18 local, Node 22, nginx + Let's Encrypt,
live at **https://slf.slunawat.in**. Secrets in `/home/ubuntu/slf/.env` (never commit).

## Non-negotiable engineering rules
1. **The engine is the only place interest is computed.** Never inline interest
   maths in a route, a page or SQL. `engine/engine.js` is pure and versioned;
   receipts store `engine_version`.
2. **Money is integer paise, weights are integer milligrams.** No floats, ever.
3. **Derived values are never stored** — interest due, settlement, queue
   membership, LTV, KPIs are computed. The single sanctioned cache is
   `loan_accrual_cache`, rebuildable by replay.
4. **Facts are append-only**: receipts, vault movements, rates, state history,
   audit log. Corrections are new rows. Triggers enforce this.
5. **Rules live in the database where possible** (CHECK constraints, triggers,
   generated columns) and in the service layer always. The UI is a mirror,
   never the enforcement.
6. **Deny by default.** Every mutation calls `can(actor, fn, ctx)` from
   `src/lib/policy.js`. Never branch on a role NAME — roles are renamable
   permission bundles.
7. **Structure is data**: entities, branches, safes, roles, schemes, charges,
   items, documents are rows. Adding a branch or renaming a role touches no code.
8. **Versioned masters**: a published `scheme_version` is immutable; running
   loans pin their version forever.
9. Every screen must work at 768px and 1440px. Fluid grids, no fixed layouts.
10. English UI now, Marathi labels later — keep strings extractable; customer
    WhatsApp/print templates are Marathi.

## The engine constitution (locked with the owner Jul 2026; part payments rewritten 15 Oct 2026 — do not "improve")
- **R-A** Day divisor = `scheme_version.days_in_year`. Never the calendar.
- **R-B** Slab interest is **retroactive within the UNPAID period**: the slab reached by the
  unpaid-day count prices every unpaid day. (`prospective` exists as scheme config.)
- **R-C** **A cycle is measured in UNPAID days** = days since the cycle opened − days bought.
  A **part payment buys days** (rupees reaching interest ÷ that day's per-day interest, exact
  fractions — 10.18 days is 10.18 days); bought days are final, never re-priced; a part
  payment never lowers the rate (the highest slab reached is kept until a full interest
  payment); the next slab is reached when the UNPAID days reach it. A **full** payment of
  every rupee of interest due closes the cycle — the next day is day 1 at the first slab;
  ₹10 short is not full.
- **R-D** Round **up to the next ₹10**, once per component, on interest, penal
  **and charges** (each charge on its own). Raw 2-dp figures are always shown to the
  customer. The charge round-up difference posts to the **Rounding income** ledger.
- **R-E** Minimum interest (`min_interest_days`, 15) is a **lifetime floor applied at every
  payment**: the first interest payment is topped up to it; paying the floor buys days
  (a cycle sealed under the floor reopens on disbursement + 15).
- **R-F** Settlement = principal + interest + penal + charges (each already rounded).
- **R-G** Appropriation order: **charges → penal → interest → principal**.
- **R-H** Capitalization happens **only at renewal**, as a human choice.
- **R-I** Penal = `penal_rate_pct` p.a. on **overdue principal**, measured on the same
  **unpaid days** as interest: nothing until unpaid days exceed tenure + grace; then from
  unpaid day tenure+1 (grace days charged, not skipped); **once started it does not stop
  for a part payment** — only a full interest payment or closure ends it.
- **R-J** Principal is a multiple of ₹100; payments minimum ₹100 in ₹10 steps.
- **R-L** Both end days count: day 1 is the day the cycle opens.
- **History is fact, not arithmetic**: a stored receipt is folded into the state from its
  stored split (`applySplit`) and never re-priced, whatever engine version took it; the
  engine prices only the payment being taken now (`applyPayment`), through the same fold.
  Engine 1.3.0; `scripts/test-engine.mjs` (103 golden cases) is the proof.

Canonical figures that must never change:
Prathmesh ₹1,00,000 SB-IND04 day 80 → **₹3,950** · Komal ₹20,000 day 33 → **₹370** ·
Archana ₹50,000 day 5: interim **₹140**, closure **₹420** · cycle split (pay day 60,
close day 80) → ₹2,470 + **₹830** · penal day 190/193/250 → **₹0 / ₹50 / ₹360** ·
processing ₹177 collects as **₹180**, ₹3 to Rounding income ·
loan 03A5602283 (₹15,800 IND04, day 233): ₹870 to interest buys **82.59 days** (25 Feb → 17 May).

## Product rules that shape screens
- **Search is the front door.** No lists of active loans (1000+ per branch).
- Home = work queue: in-progress cards + deadline queues + today's attentions;
  queues auto-hide when empty; each card has exactly ONE next action.
- Pledge is ONE 3-step wizard (appraisal · scheme/amount/people · disbursement).
  No separate sanction screen: **Valuer 1 + Valuer 2** (valuer 2 compulsory above
  ₹20,000, different person). Above the sanction ceiling → HO approval from inside
  the wizard.
- **Vault-in is the next working day**: seal intact → recount → weight recheck →
  safe. Sealing/QR happens there. One photo set for all ornaments together.
- **Funding rate is the only rate the application calculates and displays with** (E34, owner
  15 Oct 2026). Market rate is entered on the HQ rate board (must be ≥ funding) and stored per
  appraisal row for auction use only. Funding value = net g × funding rate × purity % × scheme
  funding %, rounded **up to ₹100** per ornament (R16).
- KYC valid 3 years (amber ≤90 days, red = lending blocked). Zero limits ⇒
  blacklisted, narration mandatory, red banner forever.
- Gold release within **7 working days**, chips green → amber day 5 → red day 7,
  three gates before handover (identity, seal intact, handover photo).
- Cash: disbursement < ₹20,000 (269SS), receipts ≤ ₹2,00,000/customer/day (269ST).
- Daily rate is HQ-only, maker ≠ checker; **no rate published ⇒ branches locked**.
- Single custodian for vault actions — logged, never dual-signed.

## How to work here
- Read `db/schema.sql` before writing any query; it is the source of truth.
- Add features as forward-only migrations in `db/migrations/` — never edit
  schema.sql for a live change.
- Run `node scripts/test-auth.mjs` and `node scripts/test-engine.mjs` before
  every deploy; `ops/deploy.sh` does this automatically.
- Never print secrets, tokens or `.env` contents to the terminal or to chat.
- When a business rule is unclear, STOP and ask the owner. Do not invent policy.
  Open questions are tracked as ⚠ TODO in the schema and product docs
  (top-up mechanics, cash-transfer authority, death-case legal chain,
  cancellation rights, print stationery, B vs V entity meaning).

## Current state (Step 4)
Done: engine + golden tests · schema + seed loaded · server, HTTPS, backups,
GitHub · authentication (scrypt passwords, DB-backed sessions, login windows,
lockout), policy engine, temporary login/home pages.
Next: designed auth screens from Claude Design wired in, then Sprint 1 (search,
customer KYC, pledge wizard, approvals, disbursement).
