# SLF GoldDesk — Decision Record
**Every decision made, and why.** For S Lunawat Finance (NBFC, Bhagur/Nashik).
Last updated: 28 July 2026 · Keep this file with the code; it is the constitution.

---

## 1 · Product

| # | Decision | Note |
|---|---|---|
| P1 | Build a gold-loan system from scratch, replacing the 2015 vendor product (Maraekat) | Rules become data, not code |
| P2 | Two front doors, one database: **Counter** (branch) and **HQ** (head office) | Same codebase |
| P3 | **Search is the front door** — no browsable lists of active loans | A branch carries 1000+ loans |
| P4 | Home shows work-in-progress + deadline queues only; queues hide when empty | The system drives the work |
| P5 | UX frozen in Claude Design first, then built | **The frozen `.dc.html` is the truth** — it beats written specs wherever they disagree. Where the schema and the frozen UX disagree, the difference is put to the owner, never silently chosen |
| P6 | Target scale: 200–400 branches, 1M+ customers, 10M+ loans over ten years | Modest for Postgres; the constraint is operations, not throughput |

---

## 2 · The interest engine (locked with the owner, July 2026)

These are the rules money is made by. Changing one requires a written owner decision.
The engine lives at **`src/lib/engine.js`** (moved into the app 28 Jul) with **55 golden tests**
at `scripts/test-engine.mjs` that run on every deploy.

| # | Rule | Detail |
|---|---|---|
| R-A | **Day divisor comes from the scheme** (`days_in_year`, 365 today) | Never the calendar; leap years irrelevant |
| R-B | **Slabs are retroactive within a cycle** | The slab the cycle's age reaches prices *all* its days. `prospective` exists as scheme config |
| R-C | **Cycles are anchored by interest payments** | A payment clearing all interest due seals that period and restarts the slab clock. Partial payments reduce dues but never move the anchor. Penal has its own anchor. **See R-E for where the clock restarts when the minimum floor was applied** |
| R-D | **Round UP to the next ₹10.** Interest and penal round once on their own totals. **CHARGES ROUND INDIVIDUALLY** *(amended by owner, 28 Jul 2026 — previously the charges total rounded once)* | ₹118 + ₹112 bills as **₹120 + ₹120 = ₹240**, not ₹230. Each charge's payable figure is fixed at its own rounded amount, so a part payment never rounds twice. The round-up posts to **Rounding income**; the exact GST split underneath stays untouched |
| R-D2 | **Charges are NEVER deducted at disbursement** *(owner, 27 Jul 2026)* | The customer receives the **full sanctioned amount**. The processing charge is raised on the loan at activation and collected at the first repayment, where appropriation puts charges first. **Live and verified: loans 01A6702302/03 paid out in full** |
| R-E | **Minimum interest is a lifetime floor applied at EVERY payment** *(amended by owner, 28 Jul 2026 — the earlier "closure-only" reading was wrong)* | `min_interest_days` (15). A loan's first interest payment is topped up to the minimum if short — even a same-day repayment pays 15 days. Because the floor is on *lifetime* interest it can bind only once per loan. **Paying the floor buys DAYS, not a reset**: the cycle anchor moves to disbursement + 15 days, so a customer who paid on day 3 and returns on day 20 owes 5 days, never 17. The screen names the date the customer is covered to |
| R-F | **Settlement = principal + interest + penal + charges**, each already rounded | No second rounding |
| R-G | **Appropriation order: charges → penal → interest → principal** | The repayment screen shows the live split, including a To-penal line when penal runs |
| R-H | **Capitalization only at renewal**, by human choice, scheme-gated | Interest never compounds automatically |
| R-I | **Penal = % p.a. on overdue principal from tenure end.** Grace **forgives entirely** if closed within tenure+grace; past that, penal runs **from tenure end** (grace days counted, not skipped) | ⚠ **Under owner review**: loans seeded at day 372 (no penal) and day 380 (penal from day 365) demonstrate the cliff — one day late costs eight days of penal. Verdict pending; the rule stands until changed |
| R-J | **Principal is a multiple of ₹100**; payments minimum ₹100 in ₹10 steps | Exact settlement always accepted. Enforced twice: in the engine and by a CHECK on `receipt` |
| **R-K** | **A receipt is dated today, always. Backdating is impossible** *(owner, 28 Jul 2026)* | The receipt API has no date field; `business_date` is the database's own CURRENT_DATE. A backdated payment would silently reduce interest and break day-end reconciliation. If a genuine need ever arises it will be a separate HO action with its own approval, never a counter capability |

**Figures that must never change** (enforced by the golden tests):
Prathmesh ₹1,00,000 SB-IND04 day 80 → **₹3,950** · Komal ₹20,000 day 33 → **₹370** ·
Archana ₹50,000 day 5: **₹420 whether interim or closing** (R-E amended; the old ₹140 interim figure is gone) ·
day-3 floor payment on ₹40,000 @ 20% → ₹330, and day 20 then owes **₹110 for 5 days**, the clock having moved to day 15 ·
cycle split (pay day 60, close day 80) → ₹2,470 + **₹830** · penal at day 190 / 193 / 250 → **₹0 / ₹50 / ₹360** ·
charges ₹118 + ₹112 → **₹240 billed, ₹10 to Rounding income**.

---

## 3 · Rates and valuation

| # | Decision | Detail |
|---|---|---|
| V1 | **Two rates per metal: market and funding** | Funding ≤ market, enforced by constraint |
| V2 | The gap is the **haircut, taken before the scheme's funding %** | e.g. 6.2% haircut + 70% scheme ≈ 65% of market |
| V3 | Rate/gram = rate × purity % (× scheme funding % for the lendable figure) | Verified against legacy: 12,100 × 83% × 70% = **₹7,030.10/g** |
| V4 | **Publishing is optional — a rate carries forward until changed** | Confirmed again by owner 28 Jul. ⚠ The pair in force is **₹12,300/₹12,300 — zero haircut**, flagged repeatedly; correction to 12,040/11,290 still pending |
| V5 | **One person sets the rate**, with a >5% sanity confirmation recorded on the row | |
| V6 | Market and funding shown **separately**, each rounded up to ₹100 | |
| V7 | Every application **snapshots both rates** | |
| V8 | **One rate pair per application, and it is the gold pair** | Silver rows refuse to price rather than borrow the gold rate — blocked on O7 |

---

## 4 · Customers and KYC

*(unchanged from 27 Jul — C1 through C12 as previously recorded)*

| # | Decision | Detail |
|---|---|---|
| C1 | **Five tabs**: Identity · Contact · Documents · Nominee · Loan settings | Bank accounts live inside Documents |
| C2 | **Aadhaar *or* PAN is enough** | The asterisk moves |
| C3 | A **verified Aadhaar also proves address** | With only PAN, one address document required |
| C4 | **GST optional for everyone** | |
| C5 | **KYC valid 3 years**; amber within 90 days; red blocks new lending | |
| C6 | **Zero on either limit ⇒ blacklisted**; narration mandatory | The seed script learned this the hard way — `max_outstanding_paise` defaults to 0, which reads as blacklisted |
| C7 | Mobile OTP manual until the SMS gateway exists | |
| C8 | Pincode → India Post API, cached | |
| C9 | IFSC → public IFSC API, cached | |
| C10 | Money only to a **verified** account, enforced by trigger | |
| C11 | Aadhaar/PAN/mobile display formatting only; storage clean | |
| C12 | **Names normalise to Title Case**; nominee and bank-holder names untouched | |

---

## 5 · Lending flow

| # | Decision | Detail |
|---|---|---|
| L1–L11 | *(unchanged — wizard, valuers, HO routing, deny-by-default sanction, photo set, cash limits, multi-account disbursement, print-after-activation)* | |
| L12 | Gold release within **7 working days**, three gates before handover | Now **built**: identity re-verified · seal intact, opened before the borrower · handover photo. All three enforced twice — in the API and by `release_check` in the database |
| **L12a** | **Working days = calendar days minus Sundays and the holiday table** *(28 Jul 2026)* | A loan closed on Sunday starts its SLA on Monday as day 1. List bands: Within SLA (1–4) · Day 5–6 amber · Day 7+ red |
| **L12b** | **Release is to the BORROWER ONLY** *(owner, 28 Jul 2026)* | A relative-collection path is anticipated — the API carries `collectedBy` — but today any value other than `borrower` is refused. When built, it will be its own designed flow with ID capture, not a checkbox |
| **L12c** | **A frozen packet never releases** | HO must clear the mismatch first. Loans `closed`-but-frozen appear on the release list with a red chip and no button |
| **L12d** | **Release issues an NOC number** from the gapless `noc` series (migration 011) | The printable NOC document itself arrives with print layouts |
| L13 | An approved application may not be edited, but must still be disbursable | |
| L14 | A pledge waiting at HO may be withdrawn by the branch (option B) | Migration 007 |
| **L15** | **The packet is born at disbursement**, unsealed, status `at_counter` *(28 Jul 2026)* | Sealing happens at vault-in the next working day. Every packet's whole life is now: at_counter → in_safe (→ frozen) → out |
| **L16** | **Vault-in mismatch (resolves O10)** *(owner accepted Claude's recommendation, 28 Jul 2026)* | A mismatch requires a reason from a fixed list, a narration of ≥10 characters and a photograph; it **freezes the packet**, writes **no** vault movement (the gold never entered a safe), and cannot be edited or deleted afterwards. Checks are now repeatable per packet — the original UNIQUE(packet_id) would have bricked a packet after one failed check. "Notify HO" today = the frozen packet appears on lists; real alerts come later |

---

## 6 · Access and security

*(A1–A8 unchanged: renamable roles, one server-side policy engine, DB sessions with sign-in
permission snapshots, scrypt, login windows + lockout, 2FA dormant, HQ-only user creation,
acting branch fixed at sign-in.)*

---

## 7 · Technical

*(T1–T12 unchanged: Next.js + PostgreSQL monolith, integer paise/milligrams, append-only facts,
derived values never stored, rules in the database, versioned schemes, structure-as-data,
forward-only migrations, device-side photo compression, EC2 Mumbai with RDS deferred until the
first real disbursement, deploy.sh, private GitHub.)*

Additions:

| # | Decision | Detail |
|---|---|---|
| **T13** | **The interest engine lives inside the app** (`src/lib/engine.js`) with its golden tests in `scripts/` | Moved 28 Jul, unchanged, so the tests run on every deploy instead of sitting outside where nothing checked them |
| **T14** | **A loan's position is replayed, never read from a stored total** | `src/lib/loanstate.js` rebuilds state from immutable receipts + charges on every visit. `loan_accrual_cache` is a cache, overwritten after each payment, rebuildable always. The payment endpoint re-prices from the replay and **ignores the amount the browser claims is due** |
| **T15** | **Test data carries the `Zztest` name prefix and `IND99` customer numbers** | Seeded: 6 customers, 8 loans aged 0–380 days exercising the floor, per-charge rounding, slabs, grace and penal. `purge-test-loans.sql` removes it all; it briefly disables the append-only triggers and must never be adapted for real data |

---

## 8 · Lessons written into the way we work

*(Lessons 1–11 unchanged.)* New:

12. **The schema is younger than the plan — read it before building on it.** *(28 Jul: `vault_in_check`'s UNIQUE constraint would have permanently bricked any packet with one failed check; caught by reading `\d` output, not by testing.)*
13. **Sequencing matters for backfills.** *(28 Jul: the packet backfill ran before the test-loan seed, so the seeded loans had no packets and the vault and release lists were empty. The backfill had to be re-run.)*
14. **When the owner's instruction contradicts a "locked" rule, the rule was wrong or the record was.** Either way it is an amendment, done once, with its consequence stated plainly before the code changes. *(28 Jul: R-E and R-D both amended this way.)*

---

## 9 · Still open — needs an owner decision

| # | Question | Blocks |
|---|---|---|
| O1 | **Top-up mechanics** | Sprint 3 |
| O2 | **Cash transfer authority** — who authorises, above what amount | Cash transfer screen |
| O3 | **Death-case legal chain** | Sprint 3 |
| O4 | **Cancellation after sanction** | Sprint 3 |
| O5 | **Print stationery** — A4 vs 80 mm, Marathi font | Print layouts |
| O6 | **B-book vs V-book** — what the two entity series are | Entity creation stays read-only in Settings until answered |
| O7 | **Silver** — its own rate pair and per-metal snapshot | Metal column exists; silver cannot price |
| O8 | **IBJA reference feed** | Rate screen |
| O9 | Slab-boundary warning at the counter? | Repayment polish |
| ~~O10~~ | ~~Vault-in mismatch~~ | **Resolved 28 Jul → L16** |
| O11 | **Bank-account verification screen** — no way to record a penny drop | Disbursement to any new customer's account |
| O12 | **Drawer cap** — owner asked what it is (28 Jul); decided to **leave the column NULL and off the branch form**. Final cap-or-no-cap decision deferred to day-end build | Day-end's excess-cash check only |
| **O13** | **Penal grace cliff (R-I)** — day 372 pays ₹0, day 373 pays 8 days | Owner has the two seeded loans to compare; verdict pending |

---

## 10 · ⚠ Testing weakenings that MUST be reversed before real staff use the system

Granted deliberately so the owner could test end to end. **None may survive into production.**

| # | What was granted | How to reverse |
|---|---|---|
| W1 | Counter Operator (role 3) `sanction` at `full` | `DELETE FROM role_permission WHERE role_id=3 AND fn='sanction';` then bump `perm_version` |
| W2 | `sanction_limit` for role 3 at ₹10,00,000 (TEMPORARY) | Delete the row |
| W3 | `sanction_limit` for role 4 (Valuer) at ₹10,00,000 (TEMPORARY) | Delete the row |
| W4 | Branch Manager raised ₹3,00,000 → ₹10,00,000 (TEMPORARY) | Restore `limit_paise = 30000000` |
| W5 | Stray `disburse` permissions on HO Accounts / Valuer | Delete those rows |
| **W6** | **Single-person scheme publishing** *(28 Jul, migration 010)* — the maker≠checker CHECK on `scheme_version` relaxed to maker-only until the approval strip is built | Restore SQL is written inside `db/migrations/010_scheme_single_publish.sql`; existing single-signed versions must be given a checker first |

Find the limit rows with: `SELECT * FROM sanction_limit WHERE reason ILIKE '%TEMPORARY%';`

---

## 11 · Where the build stands (28 July 2026)

**Done and live at https://slf.slunawat.in**
Everything from 27 Jul, plus — **vault-in** (recheck · seal · 50×75mm tag · safe entry · mismatch
freeze) · **repayment** (engine wired to the counter; dues + receipt endpoints; appropriation;
₹2,00,000 cash cap across a customer's loans; UTR for non-cash) · **gold release** (SLA list with
working-day banding · borrower-only handover with three gates · vault out-movement · NOC number ·
Marathi WhatsApp copy text) · **masters** (charges · branches with auto number-series · schemes
with five-step wizard, versioning, supersession and branch allocation) · migrations **008–011** ·
test suites: **55 engine · 46 bridge · 32 vault · 31 release · 30 masters**, all run at deploy.

**The counter loop is closed and proven:** pledge → disburse → vault-in → repay → release,
including NOC issue and the custody chain in `vault_movement`.

**Next**
Add-charge screen (extracted, small) · receipt print · day begin/end (needs the O12 cap verdict) ·
cash transfer (needs O2) · then the pending owner verdicts above.

*Read alongside: the frozen `.dc.html` UX (pixel truth) · `db/schema.sql` (data truth) ·
`scripts/test-engine.mjs` (money truth) · `CLAUDE.md` (working rules on the server).*
