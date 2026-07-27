-- 007 · A branch may withdraw a pledge from the HO queue before HO decides it.
ALTER TYPE ho_status ADD VALUE IF NOT EXISTS 'withdrawn';
