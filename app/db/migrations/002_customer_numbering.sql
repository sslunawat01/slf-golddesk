-- 002 · global customer numbering (IND0000000) + search indexes
BEGIN;

CREATE SEQUENCE IF NOT EXISTS customer_no_seq START WITH 12700 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION next_customer_no() RETURNS TEXT LANGUAGE sql AS $$
  SELECT 'IND' || lpad(nextval('customer_no_seq')::TEXT, 7, '0');
$$;

-- search: fuzzy name matching at branch scale
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_customer_name_trgm ON customer USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customer_custno ON customer (cust_no);
CREATE INDEX IF NOT EXISTS idx_loan_no ON loan (loan_no);

COMMIT;
