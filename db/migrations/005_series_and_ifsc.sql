-- 005 · number series for every branch + IFSC cache + bank account type
BEGIN;

-- Series are created on demand by issue_number(); this backfills every existing
-- branch so no counter can ever be blocked by a missing row.
CREATE OR REPLACE FUNCTION ensure_series(p_entity BIGINT, p_branch BIGINT, p_doc series_doc, p_fy TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT; v_code TEXT; v_prefix TEXT; v_pad SMALLINT := 5;
BEGIN
  SELECT id INTO v_id FROM number_series
   WHERE entity_id = p_entity AND branch_id IS NOT DISTINCT FROM p_branch
     AND doc_type = p_doc AND fy_label = p_fy;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT code INTO v_code FROM branch WHERE id = p_branch;
  v_code := COALESCE(v_code, 'XX');
  v_prefix := CASE p_doc
    WHEN 'loan'        THEN v_code || 'L' || replace(p_fy,'-','')
    WHEN 'receipt'     THEN 'RCPT-' || v_code || '-' || split_part(p_fy,'-',1) || '-'
    WHEN 'packet'      THEN 'PKT-'  || v_code || '-' || split_part(p_fy,'-',1) || '-'
    WHEN 'application' THEN 'APP-'  || v_code || '-' || split_part(p_fy,'-',1) || '-'
    WHEN 'noc'         THEN 'NOC-'  || v_code || '-' || split_part(p_fy,'-',1) || '-'
    WHEN 'voucher'     THEN 'VCH-'  || v_code || '-' || split_part(p_fy,'-',1) || '-'
    ELSE 'AUC-' || v_code || '-' END;
  IF p_doc IN ('packet','application') THEN v_pad := 4; END IF;

  INSERT INTO number_series (entity_id, branch_id, doc_type, fy_label, prefix, pad, next_no)
  VALUES (p_entity, p_branch, p_doc, p_fy, v_prefix, v_pad, 1)
  ON CONFLICT (entity_id, branch_id, doc_type, fy_label) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM number_series
     WHERE entity_id = p_entity AND branch_id IS NOT DISTINCT FROM p_branch
       AND doc_type = p_doc AND fy_label = p_fy;
  END IF;
  RETURN v_id;
END $$;

-- issue_number now self-heals instead of failing the transaction
CREATE OR REPLACE FUNCTION issue_number(p_entity BIGINT, p_branch BIGINT, p_doc series_doc, p_fy TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r number_series; out_no TEXT;
BEGIN
  PERFORM ensure_series(p_entity, p_branch, p_doc, p_fy);
  SELECT * INTO r FROM number_series
   WHERE entity_id = p_entity AND branch_id IS NOT DISTINCT FROM p_branch
     AND doc_type = p_doc AND fy_label = p_fy
   FOR UPDATE;
  out_no := r.prefix || lpad(r.next_no::TEXT, r.pad, '0');
  UPDATE number_series SET next_no = next_no + 1 WHERE id = r.id;
  RETURN out_no;
END $$;

-- backfill this financial year for every active branch
DO $$
DECLARE b RECORD; d series_doc; v_fy TEXT;
BEGIN
  v_fy := CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
    THEN to_char(CURRENT_DATE,'YY') || '-' || to_char(CURRENT_DATE + interval '1 year','YY')
    ELSE to_char(CURRENT_DATE - interval '1 year','YY') || '-' || to_char(CURRENT_DATE,'YY') END;
  FOR b IN SELECT id, entity_id FROM branch WHERE active LOOP
    FOREACH d IN ARRAY ARRAY['loan','receipt','packet','application','noc']::series_doc[] LOOP
      PERFORM ensure_series(b.entity_id, b.id, d, v_fy);
    END LOOP;
  END LOOP;
END $$;

-- IFSC directory becomes a cache of the public IFSC API
ALTER TABLE ifsc_directory ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE ifsc_directory ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE ifsc_directory ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE ifsc_directory ADD COLUMN IF NOT EXISTS cached_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- mobile verification (OTP arrives when the SMS gateway is connected)
ALTER TABLE customer ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ;

COMMIT;
