-- ============================================================
-- Overwatch — DB-level job numbers + customer snapshots
-- ============================================================
-- Run in Supabase SQL Editor (https://supabase.com/dashboard).
-- Safe to re-run — all statements use IF NOT EXISTS / OR REPLACE.
--
-- Replaces client-side "DRH-NNNN" generation (race-condition prone) with a
-- PostgreSQL sequence + BEFORE INSERT trigger, and enforces that every job
-- snapshots the customer name/phone/address at creation time.
-- ============================================================

-- ── 1. JOB NUMBER SEQUENCE ──────────────────────────────────
-- Human-readable identifiers like DRH-5001. Numbers below 5001 are reserved
-- for legacy/manually entered jobs.
CREATE SEQUENCE IF NOT EXISTS job_number_seq START WITH 5001 INCREMENT BY 1;

-- Advance the sequence past any existing DRH-NNNN values so we never collide
-- with numbers already in use.
SELECT setval(
  'job_number_seq',
  GREATEST(
    5000,
    COALESCE(
      (SELECT MAX(CAST(SUBSTRING(job_number FROM 5) AS INT))
         FROM jobs
        WHERE job_number ~ '^DRH-[0-9]+$'),
      5000
    )
  )
);

-- ── 2. AUTO-ASSIGN JOB NUMBER ON INSERT ─────────────────────
-- Also snapshots customer name/phone/address from the linked customer when the
-- caller did not already provide them (preserves historical accuracy).
CREATE OR REPLACE FUNCTION assign_job_number()
RETURNS TRIGGER AS $$
DECLARE
  cust RECORD;
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := 'DRH-' || nextval('job_number_seq');
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT name, phone, address INTO cust FROM customers WHERE id = NEW.customer_id;
    IF FOUND THEN
      IF NEW.customer_name    IS NULL OR NEW.customer_name    = '' THEN NEW.customer_name    := cust.name;    END IF;
      IF NEW.customer_phone   IS NULL OR NEW.customer_phone   = '' THEN NEW.customer_phone   := cust.phone;   END IF;
      IF NEW.customer_address IS NULL OR NEW.customer_address = '' THEN NEW.customer_address := cust.address; END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_job_number ON jobs;
CREATE TRIGGER trg_assign_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION assign_job_number();

-- ── 3. UNIQUENESS ───────────────────────────────────────────
-- Diagnostic: if this returns rows, resolve duplicates BEFORE the index below
-- (the CREATE UNIQUE INDEX will fail while duplicates exist).
--   SELECT job_number, COUNT(*) FROM jobs
--   WHERE job_number IS NOT NULL
--   GROUP BY job_number HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_job_number
  ON jobs(job_number) WHERE job_number IS NOT NULL;
