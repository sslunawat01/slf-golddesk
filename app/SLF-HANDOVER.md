# SLF GoldDesk — COMPLETE HANDOVER CONTEXT
**Paste this whole file as the first message of the new chat, then attach the files listed at the very end.**
Written 9 Aug 2026, at the close of the Sprint-2 session. This file supersedes all earlier resume files.

---

## 0 · Who you are, who I am, how we work

You are my **software product architect, senior developer and only full-stack developer**.
I own **S Lunawat Finance** — an RBI-registered NBFC in Bhagur/Nashik, Maharashtra, doing gold loans.
**I have no technical background.** Speak plain language. Give me commands to paste, never instructions
to interpret. Tell me in advance exactly what output I should see. I paste terminal output and
screenshots back; you diagnose from the real code and real data.

Working rules proven over this project:
- **The frozen UX is the truth.** Before building or changing ANY screen, decode the frozen UX HTML
  and extract that screen's exact fields, wording and behaviour. Never reconstruct from memory.
  Building the disbursement screen without doing this first produced a wrong layout once. Never again.
- **Plain-English plan before code.** I review and approve the plan; then you build.
- **Diagnose before fixing.** Read the actual code path and query the actual data before proposing a
  cause. Two wrong theories on 27 July cost an hour each.
- **Read the schema before building on it** (`\d table` via psql). The schema is sometimes ahead of the
  plan (release table had all gates built in), sometimes behind it (vault_in_check would have bricked
  packets). Never assume column names — a gender enum and a safe "name vs label" column both broke
  scripts that guessed.
- **Every business rule gets a test that states the rule in English.**
- Never print secrets, tokens or `.env` contents. **Never output base64 image data.**
- When my instruction contradicts a "locked" rule, it is an **amendment**: state the consequence
  plainly first, change it once, rewrite the affected tests (never silently), record it.
- When something is ambiguous and I say **"decide for me"**, you decide, state the reasoning, and
  record it as an owner-accepted decision.
- **A clean compile is not a working screen.** A crash shipped on 9 Aug: the repay done-screen
  referenced a variable declared lower in the file; it passed the build and 226 rule tests and died on
  first human use. Browser-test every new screen before declaring it done.
- Commit to GitHub at every stable checkpoint with a descriptive message. Work left only on the
  server has nearly been lost before.

---

## 1 · Server, credentials, deployment — facts that cost time to rediscover

| Thing | Truth |
|---|---|
| Server | AWS EC2 Mumbai, Ubuntu. Elastic IP **65.1.199.62**, domain **https://slf.slunawat.in** (Let's Encrypt/certbot, nginx) |
| **Prompt check** | The correct prompt is `ubuntu@ip-172-31-14-129`. **I once pasted commands into `ip-172-26-2-91` — that is a DIFFERENT project (agam-abhyas). Always verify the prompt before any command.** |
| Connect | PuTTY as `ubuntu` with my `.ppk` key · FileZilla (SFTP) for uploads |
| App code | `/home/ubuntu/slf/app` (Next.js **15.5.22**, Node 22) |
| `.env` | `/home/ubuntu/slf/.env` — one level ABOVE the app, NOT inside it |
| **Git repo root** | `/home/ubuntu/slf` (one level above app). Running `git add -A` from `/home/ubuntu/slf/app` is safe; from `/home/ubuntu/slf` it could catch `.env` — it is supposed to be gitignored but VERIFY before ever committing from there |
| Service | systemd `slf-golddesk`, `WorkingDirectory=/home/ubuntu/slf/app`, `EnvironmentFile=/home/ubuntu/slf/.env` |
| Logs | `/home/ubuntu/slf/app.log` — **written only on startup or unhandled crash.** Handled errors NEVER appear there |
| **Where errors actually are** | Browser: **F12 → Network → red row → Response** (server errors) or **F12 → Console** (client crashes). Look here FIRST |
| Database | PostgreSQL, db `golddesk`, owner role `golddesk`. Query as: `sudo -u postgres psql -d golddesk -P pager=off -c "..."` — the `-P pager=off` matters or output stops at `(END)` |
| psql permission trap | `psql -f /home/ubuntu/file.sql` fails (postgres user can't read /home/ubuntu). Use `psql ... < /home/ubuntu/file.sql` instead |
| Tables | ~105 (80 base + monthly partitions for outbox, print_event, whatsapp_message) |
| Migrations applied | **through 011** (`011_release_noc_no.sql`). Runner: `node scripts/migrate.mjs`, forward-only, numbered |
| Backups | nightly 02:30 → `/home/ubuntu/slf/backups` (confirmed running) |
| GitHub | private repo `sslunawat01/slf-golddesk`, branch `main`. **Last commit `0101f2f`** (repay hotfix). Credentials are cached on the server |
| Home dir clutter | ~25 old deploy tarballs in `/home/ubuntu` — safe to delete when convenient. Also `/home/ubuntu/golddesk` + `golddesk.zip`: **owner said ignore this folder entirely, never ask about it again** |
| `/home/ubuntu/slf/engine/` | The ORIGINAL interest engine + golden tests. Now COPIED INTO the app (src/lib/engine.js); the outside copy is historical |

**My standard deploy block** (you build `.tar.gz` archives containing an `slf-app/` folder mirroring the app tree; I upload with FileZilla to /home/ubuntu):
```bash
cd /home/ubuntu
tar -xzf FILENAME.tar.gz
cp -r slf-app/* /home/ubuntu/slf/app/ && rm -rf slf-app
cd /home/ubuntu/slf/app
node scripts/migrate.mjs        # only when the archive carries a migration
node scripts/test-NAME.mjs | tail -2
npm run build 2>&1 | grep -E "error|Compiled" | tail -2
sudo systemctl restart slf-golddesk && sleep 5 && systemctl is-active slf-golddesk
```
To ship code to you for reading: `cd /home/ubuntu && tar --exclude=node_modules --exclude=.next --exclude=.git -czf slf-src.tar.gz slf/app/src slf/app/scripts slf/app/db` (~100 KB, excludes .env).

### Test logins (I know the passwords; never ask for them)
| user | role | note |
|---|---|---|
| `slunawat` | Owner, unlimited, employee id 1 | works at HO **and** B1 — **must pick B1 at sign-in to lend** |
| `saritap` | Counter Operator at B1, id 4 | |
| `dkaranjkar` | HO Accounts, id 2 | |
| others | `vgatir` (3), `sshinde` (5), `rpatil` (6) | |

**Sessions freeze permissions at sign-in.** After any DB grant, sign out and back in.

---

## 2 · Technology stack & architecture principles

- **Next.js 15.5.22 (App Router) + PostgreSQL, one monolith.** Server routes under `src/app/api/*`,
  client screens under `src/app/*`, shared logic in `src/lib/*`.
- **All money is integer paise; all weight integer milligrams.** Rupees only at the UI edge.
- **Append-only facts**: receipts, receipt_appropriation, vault_movement, vault_in_check,
  disbursement_leg (and others) carry `fn_forbid_mutation()` triggers — UPDATE/DELETE refused forever.
- **Derived values are never stored** — a loan's position is REPLAYED from its immutable receipts +
  charges every time (see §5). `loan_accrual_cache` is a cache only, overwritten after each payment.
- **Rules live in the database too**: CHECK constraints mirror the engine (receipt amount rules,
  release gates, day-end variance-needs-reason, maker≠checker). The DB agrees with the code so a bug
  in one is caught by the other.
- **Structure is data, not code**: schemes, charges, branches, safes, roles are rows managed in the
  Settings screens, not constants.
- **Deny-by-default policy engine** in `src/lib/policy.js`: function+level per role
  (`view`/`full`), sanction limits per role. A missing sanction-limit row once read as "unlimited" —
  fixed early; keep it deny-by-default.
- **Versioned schemes**: `scheme` → `scheme_version` (immutable once published) → `scheme_slab`.
  Every loan pins `scheme_version_id` for life.
- **RLS by entity**: policies on loan/receipt/etc. filter by `app.entity_ids` session setting; the
  `tx()` helper in `src/lib/db.js` sets it (`{ entityIds: actor.entityIds }` or `"ALL"` for masters).
- Photos: device-side compression, stored via `file_object` (S3-backed), `PhotoInput` component.
- Number series: gapless per entity+branch+doc-type+FY via `issue_number()` /
  `ensure_series()` (migration 005). Doc types: `loan · receipt · packet · application · noc`.
  Formats seen: loans `01A6702300`, packets `PKT-01-26-4468`, receipts `RCPT-01-26-00848`.
  FY is April–March, e.g. '26-27'.

### Frontend house style (used across all built screens)
Design-token CSS vars: `var(--mut)` muted text, `var(--vault)` deep green (primary), `var(--brass)`
amber, `var(--bad)` red, `var(--line)` hairline. Components: `.card`, `.btn`, `.btn ghost`,
`.chip ok|warn|bad|mut`, `.mono`, `.f` (field label), `.hint`. Screens are mobile-first, max-width
~620–780px, pill-shaped filter chips, tick-boxes as big tappable buttons. `Shell` component wraps
every page with nav (Home · Search · Settings by permission).

---

## 3 · How to decode the frozen UX (CRITICAL SKILL)

The frozen UX files are bundler pages — screens gzipped+base64 inside; grep finds nothing. Decode:
```python
import re, json, gzip, base64
s = open('SLF_GoldDesk__standalone.html', encoding='utf-8').read()
j = json.loads(re.search(r'<script type="__bundler/manifest">(.*?)</script>', s, re.S).group(1))
for k, v in j.items():
    raw = gzip.decompress(base64.b64decode(v['data'])).decode('utf-8', 'replace')
    open(f"parts/{k}." + ('html' if 'html' in v['mime'] else 'js'), 'w').write(raw)
```
Six parts come out. **Counter screens are the ~334 KB HTML part; HQ screens the ~481 KB part;
customer form the ~84 KB part** (earlier notes wrongly said counter = largest). Search decoded parts
for `{{ isScreenName }}` blocks and the JS drivers (e.g. `o.rpBtn =`, `bandOf`, `stPills`).
Screen keys: `wizard vaultin vaultduelist releaselist reports done addcharge loanprofile repay receipt
renew renewed release released dayend dayenddone vaultreg topup overdue cashx deathcase cancel print
printpreview editcust`. HQ settings sections: `Entities, Daily rate, Products, Schemes, Metals, Items,
Ledgers, Documents, Employees, Roles, Charges, Templates, Application, Audit log, Compliance`.
There is also `SLF_Auth (standalone).html` (sign-in, 2FA, branch picker screens).

---

## 4 · Database design — the tables that matter (verified via \d)

**Reference data:** `entity` (2 rows: SLF BOOK id 1, V BOOK id 2 — series enum, fy_start_month 4) ·
`branch` (1=`01` B1 Bhagur, 2=`02` B2 Nasikroad, 3=`03` B3 Nashik, 4–6 V1/V2/V3, **7=`999` HO,
is_ho, cannot lend**; `drawer_cap_paise` exists but is NULL everywhere **by owner decision — no cap,
column ignored, left off the branch form**) · `safe` (B1 only: 1 "Safe A — main vault", 2 "Safe B —
overflow"; **branches 2–6 have NO safes** — the branches settings tab warns) · `metal` (1 gold,
2 silver) · `purity` (22K 92%, 21K 87%, 20K 83%, 18K 74%, Silver99 1.75, Silver80 1.25) · `item`
(Bangle/Patlya, Chain/Gof, Thushi, Ring, Earring, Bor-Mala, Kada, Pendant/Shikka, Ranihar,
Mangalsutra…) · `holiday` (2 rows) · `charge_type` (7 rows: Processing, Notice, Postage/Courier,
Legal Notice, Auction, Lost Document, Document Charge % — columns: calc `fixed|percent`,
amount_paise, pct, min_paise, max_paise, gst_pct, is_penal, ledger_id, active).

**Roles** (`role` + `role_permission(fn, level)` + `sanction_limit`): 1 Owner · 2 Branch Manager ·
3 Counter Operator · 4 Valuer · 5 HO Accounts. Functions seen: sanction, disburse, vault, collect,
dayend, cash_transfer, rate_maker, rate_checker, reports, settings (+ more in policy.js). Roles
attach through **employee_role** (no role_id on employee). `vault` is full for roles 1,2,3.
Desks derive from permissions in policy.js (e.g. `dayCycle: p("dayend")` — **key is dayCycle not
dayend**; this mismatch caused a hidden home card once).

**Customers:** `customer` — cust_no (`IND0012619` style), first/middle/last name,
**full_name GENERATED** (never insert), mobile, aadhaar_last4, pan_no, kyc_done_at, max_open_loans,
max_outstanding_paise, is_blacklisted… **TRAP: `customer_check` reads
`max_open_loans=0 OR max_outstanding_paise=0` as blacklisted and demands narration — seed data must
set both > 0.** `gender` is a custom enum `gender_kind` — omit it rather than guess labels.
`customer_bank_account` requires verification before money can be sent (trigger
`fn_leg_requires_verified_bank`).

**Lending:** `loan_application` (app_no, status enum incl. 'activated', scheme_version_id,
rate_date + base/funding_paise_snapshot, valuer1/2, borrower_present…) · `appraisal_item`
(qty, gross_mg, stone_mg, **net_mg GENERATED = gross−stone**, purity_id + purity_pct_snapshot,
market_paise, funding_paise — both must be multiples of 10000 i.e. whole ₹100) · `loan` (loan_no,
principal_paise multiple of ₹100 CHECK, disbursed_at date, status enum:
`active closed closed_by_renewal released auctioned death_case`, closed_at) · `disbursement` +
`disbursement_leg` (kind `cash|bank`; cash legs must be < ₹20,000 each — Sec 269SS/T; bank legs need
verified account; frozen) · `ho_approval` (status incl. `withdrawn` from migration 007).

**Money in:** `receipt` — receipt_no, business_date, amount_paise, mode enum `cash|upi|bank`,
utr (**CHECK: non-cash requires utr**), is_exact_settlement, closes_loan, seals_cycle,
engine_version, received_by; **CHECK: exact settlement OR (≥ ₹100 AND multiple of ₹10)**; frozen.
`receipt_appropriation` — bucket enum **`charge · charge_rounding · penal · interest · principal`**,
loan_charge_id FK for charge rows; frozen. `loan_charge` — base/gst/total/floor paise, narration
≥5 chars CHECK, added_by/at, removed_by/at (soft delete). `loan_accrual_cache` — cycle_anchor,
penal_anchor, interest/penal due, lifetime_interest_paid, engine_version (cache only).
`loan_state_history` — from/to state + note.

**Custody:** `packet` — packet_no, loan_id, sealed_at, qr_payload, **status enum
`at_counter|in_safe|frozen|out`** (migration 008), seal_photo_file_id, frozen_at/by; CHECKs:
in_safe requires sealed+photo; frozen requires stamp. `vault_in_check` — seal_intact, counted_items,
rechecked_net_mg, ok, checked_by/at, **mismatch_reason enum
`seal_broken|item_count|weight|other`, note, photo_file_id** (008); CHECKs: NOT ok ⇒ reason+note;
ok ⇒ no reason; **repeatable per packet** (the original UNIQUE(packet_id) was dropped — it would have
permanently bricked a packet after one failed check); frozen trigger added. `vault_movement` —
direction `in|out`, safe_id, reason enum **`vault_in|release|auction|death_case|spot_check`**,
by_employee; frozen. `vault_spot_check(+_line)` exist, unbuilt.

**Release:** `release` — one per loan, due_from, identity_ok, seal_ok, handover_photo_id,
released_at/by, noc_file_id, **noc_no (migration 011)**; **CHECK: released_at requires
identity_ok AND seal_ok AND photo**.

**Day cycle:** `day_cycle` — UNIQUE(branch,business_date); begin: opening_paise, checks jsonb
(`{rate,seal,queues,report}`), counted_paise, diff_reason, signed_by/at; end: expected/counted/
variance paise, reason, signed_by/at; **CHECK: end signed ⇒ variance 0 OR reason ≥5 chars**.
`day_denomination` — day_cycle_id, phase enum (day_phase, 'end' used), note_value, note_count;
UNIQUE(cycle,phase,note). One seed row exists: B1 2026-07-24, ₹1,84,500 clean close — **it is the
carry-forward for B1's first real day-begin**.

**Schemes:** `scheme` (code, name, metal_id) · `scheme_version` — version_no, effective_from/to,
funding_pct, calc_method enum (incl. compound/emi — UNSUPPORTED by engine), interest_pct,
slab_mode `retroactive|prospective`, days_in_year, min_interest_days, tenure_days, penal_rate_pct,
penal_grace_days, capitalization_on, doc_charge pct/min/max, admin_fee, min/max_loan_paise,
round_step_paise (must be 1000), status enum draft/published(+…), maker_id, checker_id,
published_at; **CHECK relaxed by migration 010 (W6): published requires maker only** (was
maker≠checker) · `scheme_slab` (from_day, to_day, rate_pct; UNIQUE(version,from_day)) ·
`scheme_branch` (version↔branch allocation) · `role_scheme` (**owner: every role ticked always** —
auto-seeded on scheme creation).

**Published schemes in force:** GL2070/GL2080/GL2090 — simple 20% p.a., funding 70/80/90%, tenure
365 · SB-IND04 — slab retroactive, funding 75%, tenure 185, slabs 1–62d @15%, 63–123 @18%,
124–185 @21% (first slab stored from_day 1; the loanstate bridge normalises 1→0 for the engine).
All: days 365, min 15, round ₹10, penal 2% + 7d grace, doc 0.25% floor ₹100 cap ₹1,500,
loans ₹5,000–₹10,00,000, individuals only. Scheme_version ids 1–4 = the four codes in order.

**Rates:** `daily_rate` per metal, base_paise + funding_paise per gram of 24K.
**⚠ STILL WRONG: market ₹12,300 = funding ₹12,300 (zero haircut) for all recent days. Should be
market 12,040 · funding 11,290. Fix in browser (HQ → Rate) — one-time; rate carries forward until
changed (owner-confirmed; no daily publishing).** Rate maths verified: rate/g = 24K rate × purity%;
lendable = funding rate/g × scheme funding% (legacy check: 12,100 × 83% × 70% = ₹7,030.10/g).

---

## 5 · The interest engine — THE MONEY RULES (all owner-locked)

Engine: **`src/lib/engine.js`** (pure fold over events; also still at /home/ubuntu/slf/engine as the
original). Golden tests `scripts/test-engine.mjs` — **55 passing**. Bridge:
**`src/lib/loanstate.js`** (scheme row→engine shape; replay receipts+charges→state;
appropriation rows; cash cap; UTR check) — `scripts/test-loanstate.mjs`, **46 passing**.
`ENGINE_VERSION = "1.0.0"` stamped on every receipt.

| Rule | Content |
|---|---|
| R-A | Day divisor from scheme `days_in_year` (365), never the calendar |
| R-B | Slabs retroactive within a cycle (reached slab prices ALL its days); `prospective` supported as config |
| R-C | Cycles anchored by interest payments: clearing all interest due seals the cycle, restarts the clock; partial payments reduce dues but never move the anchor; penal has its own anchor |
| R-D **(amended 28 Jul)** | Round UP to next ₹10: interest and penal once each on their totals; **CHARGES ROUND INDIVIDUALLY** — ₹118+₹112 bills ₹120+₹120=₹240; a charge's payable is fixed at its own rounded figure (part payment never re-rounds); round-up → Rounding income; exact GST split preserved underneath |
| R-D2 (27 Jul) | **Charges never deducted at disbursement** — full sanctioned amount paid; charge raised on loan, collected at first repayment (charges-first appropriation). Verified live |
| R-E **(amended 28 Jul — critical)** | **Minimum interest (15d) is a lifetime floor applied at EVERY payment**, not just closure. Binds once per loan (lifetime). **Paying the floor buys DAYS, not a reset**: anchor moves to disbursement+15d. Worked: ₹40,000 @20%, pay day 3 → ₹330 (covered to day 15); return day 20 → 5 days = **₹110**, never 17 days. Same-day repayment still pays 15 days (₹330 on ₹40,000 — verified in production receipt RCPT-01-26-00848) |
| R-F | Settlement = principal + interest + penal + charges, each already rounded; no second rounding |
| R-G | Appropriation: **charges → penal → interest → principal** (screen shows live split incl. To penal) |
| R-H | Capitalization only at renewal, human choice, scheme-gated |
| R-I | Penal = % p.a. on overdue principal from tenure end; grace forgives ENTIRELY if closed within tenure+grace; past grace, penal runs FROM TENURE END (grace days counted, not skipped). **⚠ O13 OPEN: owner has seeded day-372 (₹0 penal) vs day-380 (penal from day 365) loans to decide if this cliff stands** |
| R-J | Principal multiple of ₹100; payments ≥ ₹100 in ₹10 steps; exact settlement always allowed (engine + DB CHECK) |
| R-K (28 Jul) | **Receipts are dated today, ALWAYS. No backdating exists** — no date field in the API; business_date = DB CURRENT_DATE. Future backdating, if ever, = separate HO-approved action |

**Never-change figures (in golden tests):** Prathmesh ₹1,00,000 SB-IND04 day 80 → ₹3,950 ·
Komal ₹20,000 day 33 → ₹370 · Archana ₹50,000 day 5 → **₹420 interim AND closing** (old ₹140
interim retired by R-E amendment) · cycle split pay-60/close-80 → ₹2,470 + ₹830 · penal day
190/193/250 → ₹0/₹50/₹360 · ₹118+₹112 → ₹240 billed, ₹10 rounding income.

**Replay design (T14):** position = `replayLoan(principal, disbursedAt, scheme, charges, receipts)`;
charge events sort before payments on the same date; the receipt endpoint **re-prices from replay and
ignores the browser's amount**; `dues()` computed twice (running vs closing) because floor/grace
apply at closure. Cash cap: ₹2,00,000/customer/day across ALL their loans (Sec 269ST), engine-checked
AND the disbursement side keeps cash legs under ₹20,000 each.

---

## 6 · Everything built and live (Sprint 1 + 2 complete)

**Full counter loop proven end-to-end:** pledge → disburse → vault-in → repay → release.
Test suites at deploy: **55 engine · 46 bridge · 32 vault · 31 release · 30 masters ·
14 add-charge · 18 day-cycle = 226**.

| Area | Files / routes | Key behaviours |
|---|---|---|
| Search + KYC + Customer 360 + pledge wizard + HO approvals + disbursement | Sprint 1 (pre-existing) | R-D2 full-amount payout; withdraw-from-HO (migration 007); cash auto-allocation; Metal column (silver refuses to price — O7); Title Case names |
| **Vault-in** | `/vault`, `/vault/[packetId]`, `api/vault`, `lib/vault.js` | List with All/Since-yesterday/Disbursed-today chips; 3 amber rechecks + 50×75mm tag (QR payload `SLF|branch|packet|loan`, deliberately not a URL) + sealed-packet photo gate (print does NOT gate); safe dropdown from safes master; **mismatch path (O10 resolved)**: reason+note(≥10)+photo → packet frozen, NO movement row, immutable; frozen section on list |
| **Packets** | patched `api/applications/[id]/action` | **Born at disbursement**, unsealed at_counter (L15). Backfill 009 + a rerun after seeding (lesson 13) |
| **Repayment** | `/repay/[loanId]`, `api/loans/[id]/dues`, `api/loans/[id]/receipt`, `lib/engine.js`, `lib/loanstate.js` | Table shows ONLY rounded figures and ONLY rows still owing (owner request); penal row when running; charge rows show balance-still-owing; quick buttons (Charges+interest / Close loan); mode UPI/Cash/Bank (**Card explicitly rejected by owner**); UTR field non-cash; warning chips; floor note names covered-to date; closes loan + release row timing starts |
| **Add charge** | `/addcharge/[loanId]`, `api/loans/[id]/charges`, `lib/addcharge.js` | Tick-list from master with search; defaults computed per loan (percent clamps floor/cap; GST shown); **increase-only over default**; manual (no-amount) types demand a figure; one narration ≥5 covers batch; server recomputes defaults; linked from repay header |
| **Receipt print** | repay done-screen | पावती screen, LOAN CLOSED banner, Marathi WhatsApp text + copy button, 🖨 print via visibility-hidden stylesheet printing an SLF-headed receipt with full split (charges+penal lines added over frozen mockup), mode+UTR, *** LOAN CLOSED *** |
| **Release** | `/release`, `/release/[loanId]`, `api/release`, `lib/release.js` | SLA list: All/Within SLA/Day 5–6/Day 7+; working-day counting (Sundays+holiday table; closed-Sunday ⇒ Monday = day 1); two ticks + handover photo gates (DB CHECK mirrors); **borrower-only** (collectedBy param ready for future relative path); frozen never releases; in_safe releases with OUT movement to same safe, at_counter releases without movement; NOC number issued (series `noc`, migration 011); loan → `released`; Marathi WhatsApp + copy; home card when due |
| **Day begin/end** | `/daycycle`, `api/daycycle`, `lib/daycycle.js` | **Record NOT lock** (owner); begin: carry-forward from last signed close (first day = 0; B1 will carry ₹1,84,500 from the 24-Jul seed row), 4 ticks (rate/seal/queues/report), count, diff⇒reason; end: opening+cash receipts−cash disbursement legs = expected, ₹500…₹10 denomination table, **variance signs off with reason ≥5, never blocks** (owner + DB CHECK); **no drawer cap — O12 CLOSED**; history 30 days; home card via `desks.dayCycle` |
| **Masters (Settings)** | `/settings` (Charges/Branches/Schemes tabs), `api/settings/*`, `lib/masters.js` | Charges: full CRUD, used-on counts, deactivate-not-delete; Branches: entity cards w/ safes+schemes+loans counts and "no safe" warning, add branch (2–3 digit permanent code, auto number-series, drawer cap OFF the form), edit (code immutable; active-loan branches refuse deactivation), entity creation READ-ONLY (O6); Schemes: list→detail→version history (loans_on_it, in force/superseded/draft)→**5-step wizard** (Identity/Interest/Charges/Limits/Review, slab rows auto-chain, worked ₹1,00,000 table, Compound & EMI visible-disabled), save draft → publish from version row with branch allocation (HO refused), supersession sets old effective_to, **single-person publish = W6** |

**Recent git history:** `66e2840` Sprint 1 → `c976309` decisions → `d32ac52` Sprint-1 fixes →
`79cf10d` vault-in → `38302f5` (repayment work) → `2b2e2bf`… masters `c9db0e9` → release `2b2e2bf` →
charge/print/daycycle `2bddb44` → **hotfix `0101f2f`** (repay done-screen TDZ crash: `amtN` used
before declaration — fixed with `paidR` local; lesson: browser-test every screen).

---

## 7 · Test data currently in the database

Six customers `Zztest …` (cust_no `IND9900001–06`, mobiles 90000000xx, max limits set high to dodge
the blacklist CHECK, gender omitted) and **eight loans at B1**, seeded backdated (legitimate for
fixtures only — R-K applies to counter receipts, not seeds):

| Age | Scheme | Principal | Charges | Exercises |
|---|---|---|---|---|
| 0d | GL2070 | ₹40,000 | — | same-day 15-day floor (**paid: ₹330 interim, receipt 848 — this is loan id 12; do not re-pay**) |
| 5d | GL2080 | ₹50,000 | ₹118 | floor + charge |
| 14d | GL2070 | ₹25,000 | — | one day short of floor |
| 30d | GL2090 | ₹1,00,000 | ₹118+₹112 | per-charge rounding ₹240 (**₹2,590 interim paid, receipt 847 — loan id 18**) |
| 95d | SB-IND04 | ₹60,000 | — | slab band 2 |
| 190d | SB-IND04 | ₹75,000 | ₹118 | 5 days past 185d tenure — in grace |
| 372d | GL2070 | ₹30,000 | — | **O13 exhibit A: no penal** |
| 380d | GL2070 | ₹35,000 | ₹118+₹112 | **O13 exhibit B: penal from day 365** |

One loan (id 14, the 14-day one) was **closed and likely released** in testing (receipt 846,
₹25,360 closing). Gold on each ≈145% of loan at ₹12,040/g, 22K, item Bangle. All 8 have packets
(after the backfill rerun). Original seed loans 1–5 + real test loans 6–7 (01A6702300/01, pre-R-D2)
also exist, with some historical vault movements including double-ins (harmless bootstrap noise).
**Cleanup**: `purge-test-loans.sql` deletes all IND99% data (temporarily disables frozen triggers —
NEVER adapt it for real data). Seed script: `seed-test-loans.sql` (both were uploaded to /home/ubuntu).

---

## 8 · Every open decision & todo (the working list for the new chat)

**Owner decisions pending:**
1. **O13 — penal grace cliff (R-I)**: compare repay screens of the 372d vs 380d loans; keep cliff or change?
2. **O2 — cash transfer authority**: who authorises, above what amount (blocks cash-transfer screen)
3. O1 top-up mechanics · O3 death-case legal chain · O4 cancellation after sanction ·
   O5 print stationery (A4 vs 80mm, Marathi font) · O6 what B-book/V-book entities are (entity
   creation stays read-only until answered) · O7 silver rate pair + per-metal snapshot ·
   O8 IBJA feed · O9 slab-boundary warning at counter
4. **Set the rate pair** — market 12040 / funding 11290 (browser, HQ → Rate, 2.1% move so no >5% confirm)

**⚠ W1–W6 testing weakenings — ALL STILL LIVE, reverse before any real staff:**
W1 role 3 has `sanction` full → delete row + bump perm_version · W2/W3 sanction_limit ₹10L for roles
3 and 4 (reason ILIKE '%TEMPORARY%') → delete · W4 Branch Manager raised to ₹10L → restore ₹3,00,000 ·
W5 stray `disburse` on HO Accounts/Valuer → delete · **W6 single-person scheme publish** →
restore SQL inside `db/migrations/010_scheme_single_publish.sql` (give existing single-signed
versions a checker first).

**Build queue (rough order):**
1. **O11 — bank account verification (penny drop) screen** — the last blocker before a real customer
   can receive a bank payout (trigger already refuses unverified accounts)
2. Browser-verify the day-cycle + add-charge + receipt-print flows (deployed, only partially walked)
3. Vault register screen (`vaultreg`) + vault spot-check
4. Cash transfer (`cashx`) — after O2
5. Renewals (`renew`/`renewed`), top-up (`topup`), overdue/collections (`overdue`), death case,
   cancel, auction — Sprint 3
6. Print layouts proper (NOC document, pledge card) — after O5
7. Maker/checker approval strip for schemes (retires W6) · notifications/outbox (WhatsApp is
   copy-paste today by design) · penny-drop, EMI/compound engines only if ever wanted
8. Commit the updated **SLF-DECISIONS.md** (v28-Jul edition exists as an output file; add: O12 closed,
   the 9-Aug hotfix lesson, this handover)

**Housekeeping:** delete old tarballs in /home/ubuntu · name the PuTTY session "SLF GoldDesk
65.1.199.62" (wrong-server incident happened) · don't upgrade npm mid-project.

---

## 9 · Attach these files to the new chat

1. **This file.**
2. **`SLF-DECISIONS.md`** — the updated constitution (28 Jul edition, from the previous chat's
   outputs; commit it to the repo too).
3. **`SLF_GoldDesk__standalone.html`** — the frozen counter+HQ UX (files (2) and (3) previously
   uploaded are byte-identical; one copy is enough).
4. **`SLF_Auth__standalone.html`** — the frozen auth UX.
5. **`DATABASE.md`** — table-by-table prose (note: schema has evolved past it; \d is the truth).
6. **Fresh code archive** — build on the server:
   ```bash
   cd /home/ubuntu && tar --exclude=node_modules --exclude=.next --exclude=.git \
     -czf slf-src.tar.gz slf/app/src slf/app/scripts slf/app/db && ls -lh slf-src.tar.gz
   ```
   (~100 KB; excludes .env. THIS is the current truth of the code — the new chat must read key files
   from it before modifying anything.)
7. Optional but useful: `SLF-GoldDesk-PRODUCT-DOCUMENTATION.md` if you still have it.

**First actions in the new chat:** verify last deploy is live (`git log --oneline -3` should start
`0101f2f`) · walk the day-cycle/add-charge/receipt-print browser tests · then the O13 penal verdict ·
then W-reversals or O11, owner's choice.
