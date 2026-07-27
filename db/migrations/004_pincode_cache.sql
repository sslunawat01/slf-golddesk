-- 004 · pincode directory becomes a cache of the India Post API
BEGIN;
ALTER TABLE pincode_directory ALTER COLUMN taluka DROP NOT NULL;
ALTER TABLE pincode_directory ADD COLUMN IF NOT EXISTS cached_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE pincode_directory ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';
COMMIT;
