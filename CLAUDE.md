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

## The engine constitution (locked with the owner, Jul 2026 — do not "improve")
- **R-A** Day divisor = `scheme_version.days_in_year` (365). Never the calendar.
- **R-B** Slab interest is **retroactive within a cycle**: the slab reached by the
  cycle's age prices all its days. (`prospective` exists as scheme config.)
- **R-C** **Cycles are anchored by interest payments**: a payment clearing all
  interest due seals that period and restarts the slab clock from day 1.
  Partial payments reduce dues but never move the anchor. Penal has its own anchor.
- **R-D** Round **up to the next ₹10**, once per component, on interest, penal
  **and charges**. Raw 2-dp figures are always shown to the customer. The charge
  round-up difference posts to the **Rounding income** ledger; GST split stays exact.
- **R-E** Minimum interest (`min_interest_days`, 15) is a **lifetime, closure-only**
  floor: it tops up the loan's total interest only if the loan closes short of it.
  Interim payments are at actual days.
- **R-F** Settlement = principal + interest + penal + charges (each already rounded).
  No second rounding.
- **R-G** Appropriation order: **charges → penal → interest → principal**.
- **R-H** Capitalization happens **only at renewal**, as a human choice, gated by
  `capitalization_on`. Interest never compounds automatically.
- **R-I** Penal = `penal_rate_pct` p.a. on **overdue principal**, from tenure end.
  **Grace forgives entirely** if closed within tenure+grace; past that, penal runs
  from tenure end itself (grace days are counted, not skipped). Never capitalized.
- **R-J** Principal is a multiple of ₹100; payments minimum ₹100 in ₹10 steps
  (exact settlement always accepted).

Canonical figures that must never change:
Prathmesh ₹1,00,000 SB-IND04 day 80 → **₹3,950** · Komal ₹20,000 day 33 → **₹370** ·
Archana ₹50,000 day 5: interim **₹140**, closure **₹420** · cycle split (pay day 60,
close day 80) → ₹2,470 + **₹830** · penal day 190/193/250 → **₹0 / ₹50 / ₹360** ·
processing ₹177 collects as **₹180**, ₹3 to Rounding income.

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
- Valuation and funding values shown separately, both rounded **up to ₹100**.
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
- Run `node scripts/test-auth.mjs` and `node ../engine/golden.test.js` before
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
