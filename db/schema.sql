-- ============================================================================
-- SLF GoldDesk — DATABASE SCHEMA v1
-- PostgreSQL 16 · generated Step 2 · authoritative DDL
-- Sources: DB-Design-Input (field mapping) + Product Doc §12 + Dev Input §1/§6
--          + owner Q&A Jul-2026 (engine constitution R-A…R-J)
-- Conventions:
--   * money  = BIGINT paise, column suffix _paise
--   * weight = INTEGER milligrams, suffix _mg  (3-dp grams exactly)
--   * pct    = NUMERIC(7,4)   · dates = DATE   · instants = TIMESTAMPTZ
--   * PKs    = BIGINT GENERATED ALWAYS AS IDENTITY (per DB doc)
--   * created_by/updated_by = BIGINT employee ids WITHOUT FK (audit metadata;
--     avoids circular deps; integrity via app + audit_log)
--   * append-only tables have triggers that FORBID update/delete
--   * business rules as CHECKs where constants are law; config-driven rules
--     (valuer-2 threshold, charge floors vs master) enforced in service layer
-- ============================================================================

BEGIN;

-- ————————————————————————————— ENUMS —————————————————————————————
CREATE TYPE entity_series      AS ENUM ('B','V','HO');
CREATE TYPE emp_status         AS ENUM ('active','inactive');
CREATE TYPE employment_type    AS ENUM ('permanent','contract','probation');
CREATE TYPE face_angle         AS ENUM ('front','left','right');
CREATE TYPE perm_function      AS ENUM ('appraise','sanction','vault','disburse','collect',
                                        'renew','release','dayend','cash_transfer',
                                        'rate_maker','rate_checker','reports','settings');
CREATE TYPE perm_level         AS ENUM ('none','view','full');
CREATE TYPE calc_method        AS ENUM ('simple','slab','compound','emi');
CREATE TYPE interest_basis     AS ENUM ('flat','reducing');
CREATE TYPE slab_mode          AS ENUM ('retroactive','prospective');
CREATE TYPE scheme_status      AS ENUM ('draft','awaiting_checker','published','superseded');
CREATE TYPE metal_kind         AS ENUM ('gold','silver');
CREATE TYPE charge_calc        AS ENUM ('flat','pct_of_sanction','at_actuals');
CREATE TYPE doc_category       AS ENUM ('id_proof','address_proof');
CREATE TYPE ledger_nature      AS ENUM ('assets','liabilities','income','expenses');
CREATE TYPE ledger_affects     AS ENUM ('balance_sheet','pnl');
CREATE TYPE cust_type          AS ENUM ('individual','corporate','huf','partnership','trust');
CREATE TYPE gender_kind        AS ENUM ('male','female','other');
CREATE TYPE risk_band          AS ENUM ('low','medium','high');
CREATE TYPE addr_kind          AS ENUM ('current','permanent');
CREATE TYPE verify_method      AS ENUM ('penny_drop','cheque_photo','none');
CREATE TYPE app_status         AS ENUM ('draft','appraised','pending_ho','approved',
                                        'cancelled','activated');
CREATE TYPE loan_status        AS ENUM ('active','closed','closed_by_renewal','released',
                                        'auctioned','death_case');
CREATE TYPE loan_purpose       AS ENUM ('personal','business','agriculture','medical',
                                        'education','other');
CREATE TYPE pay_mode           AS ENUM ('cash','upi','bank');
CREATE TYPE leg_kind           AS ENUM ('cash','bank');
CREATE TYPE ho_status          AS ENUM ('waiting','approved','rejected');
CREATE TYPE approp_bucket      AS ENUM ('charge','charge_rounding','penal','interest','principal');
CREATE TYPE move_dir           AS ENUM ('in','out');
CREATE TYPE move_reason        AS ENUM ('vault_in','release','auction','death_case','spot_check');
CREATE TYPE day_phase          AS ENUM ('begin','end');
CREATE TYPE transfer_dest      AS ENUM ('bank','ho');
CREATE TYPE call_outcome       AS ENUM ('no_answer','promised','disputed','paid','wrong_number','other');
CREATE TYPE notice_channel     AS ENUM ('print','whatsapp','sms');
CREATE TYPE dc_status          AS ENUM ('draft','sent_to_hq','approved','released');
CREATE TYPE auction_status     AS ENUM ('notice','published','held','settled');
CREATE TYPE outbox_status      AS ENUM ('pending','sent','failed','dead');
CREATE TYPE file_kind          AS ENUM ('customer_photo','ornament_set','presence','coborrower',
                                        'seal','handover','deposit_slip','cheque','kyc_scan',
                                        'employee_face','employee_doc','packet_qr','other');
CREATE TYPE series_doc         AS ENUM ('loan','receipt','packet','noc','application','voucher','auction_lot');

-- ——————————————————————— helper functions & triggers ———————————————————————

CREATE FUNCTION fn_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION fn_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'table % is append-only (corrections are new rows)', TG_TABLE_NAME; END $$;

-- Gapless per-series numbering, issued INSIDE the caller's transaction.
CREATE TABLE number_series (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id     BIGINT NOT NULL,
  branch_id     BIGINT,                       -- NULL = entity-level series
  doc_type      series_doc NOT NULL,
  fy_label      TEXT NOT NULL,                -- e.g. '26-27'
  prefix        TEXT NOT NULL,                -- e.g. '01A67' / 'RCPT-01-26-'
  pad           SMALLINT NOT NULL DEFAULT 5,
  next_no       BIGINT NOT NULL DEFAULT 1,
  UNIQUE (entity_id, branch_id, doc_type, fy_label)
);

CREATE FUNCTION issue_number(p_entity BIGINT, p_branch BIGINT, p_doc series_doc, p_fy TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r number_series; out_no TEXT;
BEGIN
  SELECT * INTO r FROM number_series
   WHERE entity_id = p_entity AND branch_id IS NOT DISTINCT FROM p_branch
     AND doc_type = p_doc AND fy_label = p_fy
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'number series missing for % % % %', p_entity, p_branch, p_doc, p_fy; END IF;
  out_no := r.prefix || lpad(r.next_no::TEXT, r.pad, '0');
  UPDATE number_series SET next_no = next_no + 1 WHERE id = r.id;
  RETURN out_no;
END $$;

-- ————————————————————————————— ORG & ACCESS —————————————————————————————

CREATE TABLE entity (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  series        entity_series NOT NULL,
  code          TEXT NOT NULL UNIQUE,          -- 'SLF','VBOOK','HO'
  legal_name    TEXT NOT NULL,
  pan           TEXT, gstin TEXT, rbi_cor_no TEXT,
  fy_start_month SMALLINT NOT NULL DEFAULT 4,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);

CREATE TABLE branch (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id     BIGINT NOT NULL REFERENCES entity(id),
  code          TEXT NOT NULL UNIQUE,          -- '01','02','V1','999'
  name          TEXT NOT NULL,
  print_name    TEXT,
  is_ho         BOOLEAN NOT NULL DEFAULT FALSE,
  address_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  phone         TEXT,
  drawer_cap_paise BIGINT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);
CREATE INDEX idx_branch_entity ON branch(entity_id);

CREATE TABLE safe (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id     BIGINT NOT NULL REFERENCES branch(id),
  label         TEXT NOT NULL,                 -- 'Safe A — main vault'
  location_note TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT,
  UNIQUE (branch_id, label)
);

CREATE TABLE employee (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_code      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  gender        gender_kind,
  dob           DATE,
  photo_file_id BIGINT,                        -- → file_object (FK added later)
  aadhaar_last4 TEXT, aadhaar_verified_at TIMESTAMPTZ,
  pan_no        TEXT, pan_verified_at TIMESTAMPTZ,
  address_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  designation   TEXT, department TEXT,
  doj           DATE, dol DATE,
  reports_to    BIGINT REFERENCES employee(id),
  employment_type employment_type NOT NULL DEFAULT 'permanent',
  primary_branch_id BIGINT REFERENCES branch(id),
  username      TEXT NOT NULL UNIQUE,
  official_email TEXT,
  password_hash TEXT NOT NULL,
  force_change  BOOLEAN NOT NULL DEFAULT TRUE,
  otp_2fa_secret TEXT,
  status        emp_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT,
  CHECK (status = 'active' OR dol IS NOT NULL)
);

CREATE TABLE employee_face_enrolment (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employee(id),
  angle face_angle NOT NULL,
  file_id BIGINT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, angle)
);

CREATE TABLE employee_document (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employee(id),
  doc_type_id BIGINT NOT NULL,                 -- → document_type (FK added later)
  number TEXT, expiry_d DATE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT
);

CREATE TABLE employee_geo_fence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id BIGINT NOT NULL UNIQUE REFERENCES employee(id),
  branch_ids BIGINT[] NOT NULL DEFAULT '{}',
  fence_radius_m INTEGER,
  offsite_with_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ip_restriction CIDR[]
);

CREATE TABLE role (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  login_from TIME, login_to TIME,
  login_days SMALLINT NOT NULL DEFAULT 127,    -- bitmask Mon=1 … Sun=64
  grace_min SMALLINT NOT NULL DEFAULT 0,
  perm_version INTEGER NOT NULL DEFAULT 1,     -- bump on any permission edit
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);

CREATE TABLE role_permission (
  role_id BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  fn perm_function NOT NULL,
  level perm_level NOT NULL DEFAULT 'none',
  PRIMARY KEY (role_id, fn)
);

CREATE TABLE role_scheme (
  role_id BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  scheme_id BIGINT NOT NULL,                   -- → scheme (FK added later)
  PRIMARY KEY (role_id, scheme_id)
);

CREATE TABLE employee_role (
  employee_id BIGINT NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES role(id),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  PRIMARY KEY (employee_id, role_id)
);

CREATE TABLE employee_branch (
  employee_id BIGINT NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  PRIMARY KEY (employee_id, branch_id)
);

CREATE TABLE sanction_limit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id BIGINT REFERENCES role(id),
  employee_id BIGINT REFERENCES employee(id),
  limit_paise BIGINT NOT NULL CHECK (limit_paise >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  reason TEXT NOT NULL,
  approved_by BIGINT,                          -- second admin (maker–checker)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  CHECK (num_nonnulls(role_id, employee_id) = 1)
);

CREATE TABLE session (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  employee_id BIGINT NOT NULL REFERENCES employee(id),
  acting_branch_id BIGINT NOT NULL REFERENCES branch(id),
  perm_snapshot JSONB NOT NULL,
  perm_version INTEGER NOT NULL,
  device TEXT, ip INET,
  face_ok BOOLEAN, geo_ok BOOLEAN,
  login_selfie_file_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_session_emp ON session(employee_id) WHERE revoked_at IS NULL;

-- ————————————————————————————— MASTERS —————————————————————————————

CREATE TABLE metal (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind metal_kind NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  valued_as_pct_of_gold BOOLEAN NOT NULL DEFAULT FALSE  -- legacy silver model
);

CREATE TABLE purity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metal_id BIGINT NOT NULL REFERENCES metal(id),
  karat TEXT NOT NULL,                         -- '22K', 'Silver99'
  purity_pct NUMERIC(7,4) NOT NULL CHECK (purity_pct > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  UNIQUE (metal_id, karat, effective_from)
);

CREATE TABLE item (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  print_name TEXT NOT NULL,
  metal_id BIGINT NOT NULL REFERENCES metal(id),
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT,
  UNIQUE (name, metal_id)
);

CREATE TABLE scheme (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                   -- 'GL2070'
  name TEXT NOT NULL,
  metal_id BIGINT NOT NULL REFERENCES metal(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);
ALTER TABLE role_scheme ADD CONSTRAINT fk_role_scheme FOREIGN KEY (scheme_id) REFERENCES scheme(id) ON DELETE CASCADE;

CREATE TABLE scheme_version (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scheme_id BIGINT NOT NULL REFERENCES scheme(id),
  version_no INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  cust_types cust_type[] NOT NULL DEFAULT '{individual}',
  funding_pct NUMERIC(7,4) NOT NULL CHECK (funding_pct > 0 AND funding_pct <= 100),
  calc_method calc_method NOT NULL,
  interest_basis interest_basis,
  interest_pct NUMERIC(7,4),                   -- simple/compound/emi annual
  compounding_freq TEXT,                       -- dormant (R-H: renewal-only today)
  emi_config JSONB,                            -- dormant
  slab_mode slab_mode NOT NULL DEFAULT 'retroactive',   -- R-B
  days_in_year SMALLINT NOT NULL DEFAULT 365,           -- R-A  (owner: scheme-driven)
  min_interest_days SMALLINT NOT NULL DEFAULT 15,       -- R-E
  round_step_paise INTEGER NOT NULL DEFAULT 1000,       -- R-D  (₹10)
  tenure_days INTEGER NOT NULL,
  penal_rate_pct NUMERIC(7,4) NOT NULL DEFAULT 0,       -- R-I  scheme-driven
  penal_grace_days SMALLINT NOT NULL DEFAULT 0,         -- R-I  scheme-driven
  capitalization_on BOOLEAN NOT NULL DEFAULT FALSE,     -- R-H  renewal-gated
  doc_charge_pct NUMERIC(7,4) NOT NULL DEFAULT 0,
  doc_charge_min_paise BIGINT NOT NULL DEFAULT 0,
  doc_charge_max_paise BIGINT NOT NULL DEFAULT 0,
  admin_fee_paise BIGINT NOT NULL DEFAULT 0,
  min_loan_paise BIGINT NOT NULL DEFAULT 0,
  max_loan_paise BIGINT NOT NULL DEFAULT 0,
  status scheme_status NOT NULL DEFAULT 'draft',
  maker_id BIGINT REFERENCES employee(id),
  checker_id BIGINT REFERENCES employee(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT,
  UNIQUE (scheme_id, version_no),
  CHECK (status <> 'published' OR (maker_id IS NOT NULL AND checker_id IS NOT NULL AND maker_id <> checker_id)),
  CHECK (calc_method <> 'simple' OR interest_pct IS NOT NULL)
);
CREATE INDEX idx_sv_scheme ON scheme_version(scheme_id, effective_from);

CREATE TABLE scheme_slab (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scheme_version_id BIGINT NOT NULL REFERENCES scheme_version(id) ON DELETE CASCADE,
  from_day INTEGER NOT NULL,
  to_day INTEGER NOT NULL,
  rate_pct NUMERIC(7,4) NOT NULL,
  CHECK (to_day >= from_day),
  UNIQUE (scheme_version_id, from_day)
);

CREATE TABLE scheme_branch (
  scheme_version_id BIGINT NOT NULL REFERENCES scheme_version(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  PRIMARY KEY (scheme_version_id, branch_id)
);

CREATE TABLE charge_type (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  calc charge_calc NOT NULL,
  amount_paise BIGINT,                          -- flat
  pct NUMERIC(7,4), min_paise BIGINT, max_paise BIGINT,  -- pct_of_sanction
  gst_pct NUMERIC(7,4) NOT NULL DEFAULT 0,
  is_penal BOOLEAN NOT NULL DEFAULT FALSE,
  ledger_id BIGINT,                             -- → ledger (FK added later)
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);

CREATE TABLE document_type (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  category doc_category NOT NULL,
  is_ovd BOOLEAN NOT NULL DEFAULT FALSE,
  requires_number BOOLEAN NOT NULL DEFAULT TRUE,
  expiry_tracked BOOLEAN NOT NULL DEFAULT FALSE,
  min_scans SMALLINT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (name, category)
);
ALTER TABLE employee_document ADD CONSTRAINT fk_empdoc_type FOREIGN KEY (doc_type_id) REFERENCES document_type(id);

CREATE TABLE document_type_field (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_type_id BIGINT NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
  field_label TEXT NOT NULL,
  ord SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE ledger_group (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  under_group_id BIGINT REFERENCES ledger_group(id),
  nature ledger_nature NOT NULL,
  affects ledger_affects NOT NULL
);

CREATE TABLE ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_id BIGINT NOT NULL REFERENCES ledger_group(id),
  entity_id BIGINT REFERENCES entity(id),
  branch_id BIGINT REFERENCES branch(id),
  opening_paise BIGINT NOT NULL DEFAULT 0,
  opening_dr BOOLEAN NOT NULL DEFAULT TRUE,
  is_interest_income BOOLEAN NOT NULL DEFAULT FALSE,
  is_rounding_income BOOLEAN NOT NULL DEFAULT FALSE,     -- owner's ₹180 rule
  is_cash_in_hand BOOLEAN NOT NULL DEFAULT FALSE,
  is_gold_loan_asset BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);
ALTER TABLE charge_type ADD CONSTRAINT fk_charge_ledger FOREIGN KEY (ledger_id) REFERENCES ledger(id);

CREATE TABLE app_setting (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by BIGINT
);

CREATE TABLE pincode_directory (
  pincode TEXT PRIMARY KEY,
  area TEXT NOT NULL, taluka TEXT NOT NULL, district TEXT NOT NULL, state TEXT NOT NULL
);

CREATE TABLE ifsc_directory (
  ifsc TEXT PRIMARY KEY,
  bank TEXT NOT NULL, branch_name TEXT NOT NULL
);

CREATE TABLE holiday (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  on_date DATE NOT NULL,
  description TEXT NOT NULL,
  entity_id BIGINT REFERENCES entity(id),      -- NULL = all
  branch_id BIGINT REFERENCES branch(id),
  UNIQUE (on_date, entity_id, branch_id)
);

CREATE TABLE daily_rate (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_date DATE NOT NULL,
  metal_id BIGINT NOT NULL REFERENCES metal(id),
  base_paise BIGINT NOT NULL CHECK (base_paise > 0),   -- 24K/g for gold
  source_ref TEXT,
  maker_id BIGINT NOT NULL REFERENCES employee(id),
  checker_id BIGINT NOT NULL REFERENCES employee(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rate_date, metal_id),
  CHECK (maker_id <> checker_id)               -- R12 maker–checker
);

-- ————————————————————————————— FILES —————————————————————————————

CREATE TABLE file_object (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind file_kind NOT NULL,
  s3_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width_px INTEGER, height_px INTEGER,
  thumb_s3_key TEXT,
  captured_by BIGINT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE employee ADD CONSTRAINT fk_emp_photo FOREIGN KEY (photo_file_id) REFERENCES file_object(id);
ALTER TABLE employee_face_enrolment ADD CONSTRAINT fk_face_file FOREIGN KEY (file_id) REFERENCES file_object(id);
ALTER TABLE session ADD CONSTRAINT fk_session_selfie FOREIGN KEY (login_selfie_file_id) REFERENCES file_object(id);

-- ————————————————————————————— CUSTOMER —————————————————————————————

CREATE TABLE customer (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cust_no TEXT NOT NULL UNIQUE,                -- IND00xxxxx (global series)
  cust_type cust_type NOT NULL DEFAULT 'individual',
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  full_name TEXT GENERATED ALWAYS AS (btrim(first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name)) STORED,
  gender gender_kind,
  dob DATE,
  relative_name TEXT,
  mobile TEXT NOT NULL,
  alt_mobile TEXT, email TEXT, email_verified_at TIMESTAMPTZ,
  app_access BOOLEAN NOT NULL DEFAULT FALSE,
  aadhaar_last4 TEXT, aadhaar_verified_at TIMESTAMPTZ,
  pan_no TEXT, pan_verified_at TIMESTAMPTZ,
  gstin TEXT,
  risk risk_band,
  kyc_done_at DATE NOT NULL,
  max_open_loans SMALLINT NOT NULL DEFAULT 3,
  max_outstanding_paise BIGINT NOT NULL DEFAULT 0,
  blacklist_narration TEXT,
  is_blacklisted BOOLEAN GENERATED ALWAYS AS (max_open_loans = 0 OR max_outstanding_paise = 0) STORED,  -- R14
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT,
  CHECK (NOT (max_open_loans = 0 OR max_outstanding_paise = 0) OR blacklist_narration IS NOT NULL)
);
CREATE INDEX idx_customer_mobile ON customer(mobile);
CREATE INDEX idx_customer_name ON customer USING gin (to_tsvector('simple', full_name));

CREATE TABLE customer_address (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  kind addr_kind NOT NULL,
  line1 TEXT NOT NULL, line2 TEXT,
  pincode TEXT NOT NULL, area TEXT, taluka TEXT, district TEXT, state TEXT,
  same_as_current BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (customer_id, kind)
);

CREATE TABLE customer_photo (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES file_object(id),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_document (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  doc_type_id BIGINT NOT NULL REFERENCES document_type(id),
  number TEXT,
  expiry_d DATE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE customer_document_scan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_document_id BIGINT NOT NULL REFERENCES customer_document(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES file_object(id)
);

CREATE TABLE nominee (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relation TEXT NOT NULL,
  mobile TEXT,
  is_current BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE customer_bank_account (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  bank TEXT NOT NULL, bank_branch TEXT,
  account_no TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  acct_type TEXT,
  upi_id TEXT, upi_verified_at TIMESTAMPTZ,
  verify_method verify_method NOT NULL DEFAULT 'none',
  verified_at TIMESTAMPTZ,
  cheque_file_id BIGINT REFERENCES file_object(id),
  UNIQUE (customer_id, account_no, ifsc)
);

CREATE TABLE cibil_report (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  score SMALLINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ————————————————————————————— LENDING —————————————————————————————

CREATE TABLE slf_bank_account (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES entity(id),
  branch_id BIGINT REFERENCES branch(id),
  nickname TEXT NOT NULL UNIQUE,
  bank TEXT NOT NULL, ifsc TEXT NOT NULL, account_no_masked TEXT NOT NULL,
  ledger_id BIGINT REFERENCES ledger(id),
  allow_disbursement BOOLEAN NOT NULL DEFAULT TRUE,
  allow_collection BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE loan_application (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app_no TEXT UNIQUE,
  entity_id BIGINT NOT NULL REFERENCES entity(id),
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  customer_id BIGINT NOT NULL REFERENCES customer(id),
  status app_status NOT NULL DEFAULT 'draft',
  scheme_version_id BIGINT REFERENCES scheme_version(id),
  requested_paise BIGINT CHECK (requested_paise IS NULL OR requested_paise % 10000 = 0),  -- R16 ₹100
  purpose loan_purpose NOT NULL DEFAULT 'personal',
  borrower_present BOOLEAN,
  presence_photo_id BIGINT REFERENCES file_object(id),
  coborrower_customer_id BIGINT REFERENCES customer(id),
  coborrower_photo_id BIGINT REFERENCES file_object(id),
  valuer1_id BIGINT REFERENCES employee(id),
  valuer2_id BIGINT REFERENCES employee(id),
  rate_date DATE,
  base_paise_snapshot BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT,
  CHECK (valuer2_id IS NULL OR valuer2_id <> valuer1_id)          -- R17 distinctness
);
CREATE INDEX idx_app_branch_status ON loan_application(branch_id, status);

CREATE TABLE appraisal_item (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES loan_application(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES item(id),
  qty SMALLINT NOT NULL DEFAULT 1 CHECK (qty > 0),
  gross_mg INTEGER NOT NULL CHECK (gross_mg > 0),
  stone_mg INTEGER NOT NULL DEFAULT 0 CHECK (stone_mg >= 0),
  net_mg INTEGER GENERATED ALWAYS AS (gross_mg - stone_mg) STORED,
  purity_id BIGINT NOT NULL REFERENCES purity(id),
  purity_pct_snapshot NUMERIC(7,4) NOT NULL,
  market_paise BIGINT NOT NULL CHECK (market_paise % 10000 = 0),   -- ↑₹100 snapshot (R16)
  funding_paise BIGINT NOT NULL CHECK (funding_paise % 10000 = 0), -- ↑₹100 snapshot (R16)
  narration TEXT,
  CHECK (gross_mg > stone_mg)
);

CREATE TABLE application_photo (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES loan_application(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES file_object(id),
  ord SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE application_document (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES loan_application(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES file_object(id),
  note TEXT
);

CREATE TABLE ho_approval (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL UNIQUE REFERENCES loan_application(id),
  amount_paise BIGINT NOT NULL,
  recommended_by BIGINT NOT NULL REFERENCES employee(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status ho_status NOT NULL DEFAULT 'waiting',
  decided_by BIGINT REFERENCES employee(id),
  decided_at TIMESTAMPTZ,
  reject_reason TEXT,
  CHECK (decided_by IS NULL OR decided_by <> recommended_by)      -- four-eyes
);

CREATE TABLE application_cancellation (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT NOT NULL UNIQUE REFERENCES loan_application(id),
  reason TEXT NOT NULL,
  narration TEXT NOT NULL,
  gold_return_photo_id BIGINT REFERENCES file_object(id),
  cancelled_by BIGINT NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE loan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_no TEXT NOT NULL UNIQUE,
  application_id BIGINT NOT NULL UNIQUE REFERENCES loan_application(id),
  entity_id BIGINT NOT NULL REFERENCES entity(id),
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  customer_id BIGINT NOT NULL REFERENCES customer(id),
  scheme_version_id BIGINT NOT NULL REFERENCES scheme_version(id),  -- R15 pinned forever
  principal_paise BIGINT NOT NULL CHECK (principal_paise % 10000 = 0 AND principal_paise > 0), -- R16
  disbursed_at DATE NOT NULL,
  status loan_status NOT NULL DEFAULT 'active',
  closed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);
CREATE INDEX idx_loan_customer ON loan(customer_id);
CREATE INDEX idx_loan_branch_status ON loan(branch_id, status);

CREATE TABLE loan_state_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id BIGINT REFERENCES loan_application(id),
  loan_id BIGINT REFERENCES loan(id),
  from_state TEXT, to_state TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_employee BIGINT,
  note TEXT
);

CREATE TABLE disbursement (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL UNIQUE REFERENCES loan(id),
  from_slf_account_id BIGINT REFERENCES slf_bank_account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT
);

CREATE TABLE disbursement_leg (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  disbursement_id BIGINT NOT NULL REFERENCES disbursement(id) ON DELETE CASCADE,
  kind leg_kind NOT NULL,
  customer_bank_account_id BIGINT REFERENCES customer_bank_account(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  utr TEXT,
  CHECK (kind = 'bank' OR amount_paise < 2000000),               -- R11 269SS: cash < ₹20,000
  CHECK (kind = 'cash' OR customer_bank_account_id IS NOT NULL)
);

CREATE FUNCTION fn_leg_requires_verified_bank() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok TIMESTAMPTZ;
BEGIN
  IF NEW.kind = 'bank' THEN
    SELECT verified_at INTO ok FROM customer_bank_account WHERE id = NEW.customer_bank_account_id;
    IF ok IS NULL THEN RAISE EXCEPTION 'disbursement to unverified bank account blocked (R19)'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_leg_verified BEFORE INSERT ON disbursement_leg
  FOR EACH ROW EXECUTE FUNCTION fn_leg_requires_verified_bank();

-- ————————————————————————————— CUSTODY —————————————————————————————

CREATE TABLE packet (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  packet_no TEXT NOT NULL UNIQUE,
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  sealed_at TIMESTAMPTZ,
  qr_payload TEXT
);
CREATE INDEX idx_packet_loan ON packet(loan_id);

CREATE TABLE vault_in_check (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  packet_id BIGINT NOT NULL UNIQUE REFERENCES packet(id),
  seal_intact BOOLEAN NOT NULL,
  counted_items SMALLINT NOT NULL,
  rechecked_net_mg INTEGER NOT NULL,
  ok BOOLEAN NOT NULL,
  checked_by BIGINT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vault_movement (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  packet_id BIGINT NOT NULL REFERENCES packet(id),
  direction move_dir NOT NULL,
  safe_id BIGINT NOT NULL REFERENCES safe(id),
  reason move_reason NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_employee BIGINT NOT NULL                    -- R10 single user, logged
);
CREATE INDEX idx_vm_packet ON vault_movement(packet_id, at);

CREATE TABLE vault_spot_check (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  started_by BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ
);

CREATE TABLE vault_spot_check_line (
  spot_check_id BIGINT NOT NULL REFERENCES vault_spot_check(id) ON DELETE CASCADE,
  packet_id BIGINT NOT NULL REFERENCES packet(id),
  found BOOLEAN NOT NULL,
  PRIMARY KEY (spot_check_id, packet_id)
);

-- ————————————————————————————— MONEY —————————————————————————————

CREATE TABLE receipt (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  entity_id BIGINT NOT NULL REFERENCES entity(id),
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  business_date DATE NOT NULL,
  amount_paise BIGINT NOT NULL,
  mode pay_mode NOT NULL,
  utr TEXT,
  is_exact_settlement BOOLEAN NOT NULL DEFAULT FALSE,
  closes_loan BOOLEAN NOT NULL DEFAULT FALSE,
  seals_cycle BOOLEAN NOT NULL DEFAULT FALSE,     -- R-C evidence
  engine_version TEXT NOT NULL,
  received_by BIGINT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (is_exact_settlement OR (amount_paise >= 10000 AND amount_paise % 1000 = 0)),  -- R-J
  CHECK (mode = 'cash' OR utr IS NOT NULL)
);
CREATE INDEX idx_receipt_loan ON receipt(loan_id, business_date);
CREATE INDEX idx_receipt_cash_day ON receipt(branch_id, business_date) WHERE mode = 'cash';

CREATE TABLE receipt_appropriation (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES receipt(id) ON DELETE CASCADE,
  bucket approp_bucket NOT NULL,
  loan_charge_id BIGINT,                          -- FK added after loan_charge
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0)
);

CREATE TABLE loan_charge (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  charge_type_id BIGINT NOT NULL REFERENCES charge_type(id),
  base_paise BIGINT NOT NULL,
  gst_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL,
  floor_paise BIGINT NOT NULL,                    -- snapshot of master default
  narration TEXT NOT NULL,
  added_by BIGINT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by BIGINT, removed_at TIMESTAMPTZ,
  CHECK (total_paise >= floor_paise),             -- upward-only override
  CHECK (char_length(narration) >= 5)
);
ALTER TABLE receipt_appropriation ADD CONSTRAINT fk_ra_charge FOREIGN KEY (loan_charge_id) REFERENCES loan_charge(id);

CREATE TABLE renewal (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  old_loan_id BIGINT NOT NULL UNIQUE REFERENCES loan(id),
  new_loan_id BIGINT NOT NULL UNIQUE REFERENCES loan(id),
  interest_settlement TEXT NOT NULL CHECK (interest_settlement IN ('paid','capitalized')), -- R-H
  capitalized_paise BIGINT NOT NULL DEFAULT 0,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_employee BIGINT NOT NULL
);

CREATE TABLE topup (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  amount_paise BIGINT NOT NULL,
  mechanics TEXT,                                 -- ⚠ TODO owner Q8 (amend vs new loan)
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_employee BIGINT NOT NULL
);

-- Rebuildable performance cache — NEVER the source of truth (engine replay is).
CREATE TABLE loan_accrual_cache (
  loan_id BIGINT PRIMARY KEY REFERENCES loan(id) ON DELETE CASCADE,
  as_of DATE NOT NULL,
  cycle_anchor DATE NOT NULL,
  penal_anchor DATE,
  interest_due_paise BIGINT NOT NULL,
  penal_due_paise BIGINT NOT NULL,
  lifetime_interest_paid_paise BIGINT NOT NULL,
  engine_version TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ————————————————————————————— OPS —————————————————————————————

CREATE TABLE release (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL UNIQUE REFERENCES loan(id),
  due_from DATE NOT NULL,
  identity_ok BOOLEAN NOT NULL DEFAULT FALSE,
  seal_ok BOOLEAN NOT NULL DEFAULT FALSE,
  handover_photo_id BIGINT REFERENCES file_object(id),
  released_at TIMESTAMPTZ,
  released_by BIGINT,
  noc_file_id BIGINT REFERENCES file_object(id),
  CHECK (released_at IS NULL OR (identity_ok AND seal_ok AND handover_photo_id IS NOT NULL))  -- R8 gates
);

CREATE TABLE death_case (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer(id),
  status dc_status NOT NULL DEFAULT 'draft',
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ⚠ TODO legal chain
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);

CREATE TABLE death_case_loan (
  death_case_id BIGINT NOT NULL REFERENCES death_case(id) ON DELETE CASCADE,
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  PRIMARY KEY (death_case_id, loan_id)
);

CREATE TABLE collection_call (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  outcome call_outcome NOT NULL,
  ptp_date DATE,
  note TEXT,
  by_employee BIGINT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notice (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES loan(id),
  level SMALLINT NOT NULL,
  channel notice_channel NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_id BIGINT REFERENCES file_object(id)
);

CREATE TABLE day_cycle (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  business_date DATE NOT NULL,
  begin_opening_paise BIGINT,
  begin_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  begin_counted_paise BIGINT,
  begin_diff_reason TEXT,
  begin_signed_by BIGINT, begin_signed_at TIMESTAMPTZ,
  end_expected_paise BIGINT,
  end_counted_paise BIGINT,
  end_variance_paise BIGINT,
  end_reason TEXT,
  end_signed_by BIGINT, end_signed_at TIMESTAMPTZ,
  UNIQUE (branch_id, business_date),
  CHECK (end_signed_at IS NULL OR end_variance_paise = 0 OR char_length(end_reason) >= 5)
);

CREATE TABLE day_denomination (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_cycle_id BIGINT NOT NULL REFERENCES day_cycle(id) ON DELETE CASCADE,
  phase day_phase NOT NULL,
  note_value INTEGER NOT NULL,
  note_count INTEGER NOT NULL CHECK (note_count >= 0),
  UNIQUE (day_cycle_id, phase, note_value)
);

CREATE TABLE cash_transfer (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES branch(id),
  entity_id BIGINT NOT NULL REFERENCES entity(id),
  destination transfer_dest NOT NULL,
  slf_bank_account_id BIGINT REFERENCES slf_bank_account(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  carrier_employee_id BIGINT NOT NULL,
  slip_photo_id BIGINT REFERENCES file_object(id),
  status TEXT NOT NULL DEFAULT 'booked',          -- ⚠ TODO authority/ack rules
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT
);

CREATE TABLE auction (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL UNIQUE REFERENCES loan(id),
  status auction_status NOT NULL DEFAULT 'notice',
  notice_at DATE, event_at DATE,
  hammer_paise BIGINT, costs_paise BIGINT,
  surplus_paise BIGINT, shortfall_paise BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by BIGINT,
  updated_at TIMESTAMPTZ, updated_by BIGINT
);

CREATE TABLE auction_publication (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id BIGINT NOT NULL REFERENCES auction(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES file_object(id),
  note TEXT
);

CREATE TABLE surplus_payout (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_id BIGINT NOT NULL UNIQUE REFERENCES auction(id),
  paid_at DATE NOT NULL,
  mode pay_mode NOT NULL,
  ref TEXT
);

CREATE TABLE grievance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT REFERENCES customer(id),
  channel TEXT NOT NULL,
  subject TEXT NOT NULL,
  opened_at DATE NOT NULL DEFAULT CURRENT_DATE,
  tat_due DATE,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at DATE,
  resolution TEXT
);

CREATE TABLE year_end_close (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES entity(id),
  fy_label TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_by BIGINT, signed_at TIMESTAMPTZ,
  UNIQUE (entity_id, fy_label)
);

-- ————————————————————— PARTITIONED APPEND-ONLY STREAMS —————————————————————

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  employee_id BIGINT,
  branch_id BIGINT,
  entity_table TEXT NOT NULL,
  entity_id BIGINT,
  action TEXT NOT NULL,
  before JSONB, after JSONB,
  request_id TEXT,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);

CREATE TABLE whatsapp_message (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_id BIGINT,
  loan_id BIGINT,
  template TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'mr',
  payload JSONB NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);

CREATE TABLE outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  attempts SMALLINT NOT NULL DEFAULT 0,
  next_try TIMESTAMPTZ,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);

CREATE TABLE print_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  ref_id BIGINT,
  by_employee BIGINT,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);

-- initial partitions (Jul–Dec 2026 + default catch-alls)
DO $$
DECLARE t TEXT; m DATE;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log','whatsapp_message','outbox','print_event'] LOOP
    FOR i IN 0..5 LOOP
      m := date_trunc('month', DATE '2026-07-01') + (i || ' month')::interval;
      EXECUTE format('CREATE TABLE %I_%s PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        t, to_char(m,'YYYY_MM'), t, m, m + interval '1 month');
    END LOOP;
    EXECUTE format('CREATE TABLE %I_default PARTITION OF %I DEFAULT', t, t);
  END LOOP;
END $$;

-- ————————————————— append-only + updated_at trigger wiring —————————————————

DO $$
DECLARE t TEXT;
BEGIN
  -- forbid UPDATE/DELETE on financial & custody facts (corrections = new rows)
  FOREACH t IN ARRAY ARRAY['receipt','receipt_appropriation','vault_movement',
                           'daily_rate','loan_state_history','audit_log',
                           'disbursement_leg','renewal'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_frozen BEFORE UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION fn_forbid_mutation()', t, t);
  END LOOP;
  -- touch updated_at where the column exists
  FOREACH t IN ARRAY ARRAY['entity','branch','safe','employee','role','item','scheme',
                           'scheme_version','charge_type','ledger','customer','loan',
                           'loan_application','auction','death_case'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ————————————————————— ROW-LEVEL SECURITY (entity walls) —————————————————————
-- App sets: SELECT set_config('app.entity_ids', '1,2', true) per transaction,
-- or 'ALL' for owner/HQ context. Missing setting ⇒ no rows (fail closed).

-- (explicit, table-by-table for clarity)
ALTER TABLE loan_application ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_app_entity ON loan_application USING (
  current_setting('app.entity_ids', true) = 'ALL'
  OR entity_id::TEXT = ANY (string_to_array(COALESCE(current_setting('app.entity_ids', true), ''), ','))
);
ALTER TABLE loan ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_loan_entity ON loan USING (
  current_setting('app.entity_ids', true) = 'ALL'
  OR entity_id::TEXT = ANY (string_to_array(COALESCE(current_setting('app.entity_ids', true), ''), ','))
);
ALTER TABLE receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_receipt_entity ON receipt USING (
  current_setting('app.entity_ids', true) = 'ALL'
  OR entity_id::TEXT = ANY (string_to_array(COALESCE(current_setting('app.entity_ids', true), ''), ','))
);
ALTER TABLE cash_transfer ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_ct_entity ON cash_transfer USING (
  current_setting('app.entity_ids', true) = 'ALL'
  OR entity_id::TEXT = ANY (string_to_array(COALESCE(current_setting('app.entity_ids', true), ''), ','))
);

-- ————————————————————————————— VIEWS —————————————————————————————

-- current vault contents = packets whose latest movement is IN
CREATE VIEW v_vault_register AS
SELECT p.id AS packet_id, p.packet_no, p.loan_id, vm.safe_id, vm.at AS since
FROM packet p
JOIN LATERAL (
  SELECT direction, safe_id, at FROM vault_movement
  WHERE packet_id = p.id ORDER BY at DESC, id DESC LIMIT 1
) vm ON vm.direction = 'in';

CREATE VIEW v_release_queue AS
SELECT r.*, l.branch_id, l.customer_id
FROM release r JOIN loan l ON l.id = r.loan_id
WHERE r.released_at IS NULL;

COMMIT;
