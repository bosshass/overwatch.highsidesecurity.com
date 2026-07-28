-- ============================================================
-- JOVELIN — Initial Schema (Migration 001 — CLEAN, 2026-07-21)
-- Structure forked from Overwatch; ALL DRH residue removed:
--   ✗ drh_id column gone — short_code is the one canonical ID
--   ✗ security-vertical columns gone (alula/cms/elk/ubiquiti/cameras,
--     panel/wifi passwords, monitoring tiers, cs_number, gate codes)
--     → replaced by one generic access_notes field
--   ✗ registry_id remnants gone; jr_notes → manager_notes
--   ✗ no DRH tenant seed — neutral default tenant, rename freely
-- KEPT (per direction): full scheduling stack (techs, job_assignments,
--   calendar fields, time_entries, return_cards, clock), core tables,
--   pipeline, P/S numbering, financial tables.
-- ADDED: QBO plumbing (qbo_connections) and the Estimates module
--   (catalog_items, estimates, estimate_lines, estimate_payments)
--   encoding the contractor-cost → markup → client-price flow.
-- Every dollar comes from QBO; hours never become dollars in-app.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Tenants ----------
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz DEFAULT now()
);
INSERT INTO public.tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Tenant', 'default');

-- ---------- QBO connection (per tenant) ----------
-- NOTE: tokens must be encrypted at the app layer (or moved to Vault)
-- before any real credentials land here.
CREATE TABLE public.qbo_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id),
  realm_id text NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  sync_cursor jsonb DEFAULT '{}',
  connected_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ---------- Techs / scheduling people ----------
CREATE TABLE public.techs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  name text NOT NULL,
  email text NOT NULL,
  calendar_id text,
  color text DEFAULT '#3498db',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX techs_tenant_email_key ON public.techs (tenant_id, email);

-- ---------- Customers (generic field-service, QBO-linked) ----------
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  short_code text,
  name text NOT NULL,
  phone text, email text, address text, city text,
  state text DEFAULT 'CO', zip text,
  customer_type text DEFAULT 'residential',
  access_notes text,                 -- replaces gate codes / key locations etc.
  notes text,
  images text[] DEFAULT '{}',
  calendar_aliases jsonb DEFAULT '[]',
  default_tech uuid REFERENCES public.techs(id),
  billing_rate numeric,
  invoice_frequency text,
  qbo_customer_id text,
  qbo_customer_name text,
  ytd_invoiced numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  is_cancelled boolean DEFAULT false,
  cancelled_at timestamptz,
  merged_into uuid REFERENCES public.customers(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX customers_tenant_short_code_key ON public.customers (tenant_id, short_code);
CREATE UNIQUE INDEX customers_tenant_qbo_id_key ON public.customers (tenant_id, qbo_customer_id);
CREATE INDEX idx_customers_name ON public.customers (name);
CREATE INDEX idx_customers_name_trgm ON public.customers USING gin (name gin_trgm_ops);
CREATE INDEX customers_merged_into_idx ON public.customers (merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX idx_customers_tenant ON public.customers (tenant_id);

-- ---------- Jobs (spine) ----------
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  customer_id uuid REFERENCES public.customers(id),
  customer_name text,
  customer_address text, customer_phone text, customer_email text,
  status text DEFAULT 'accepted',
  job_type text DEFAULT 'service',
  priority text DEFAULT 'normal',
  -- QBO money fields (dollars come from QBO)
  qbo_estimate_id text, qbo_estimate_ref text, qbo_estimate_status text,
  estimate_amount numeric DEFAULT 0,
  invoiced_amount numeric DEFAULT 0,
  remaining_amount numeric DEFAULT 0,
  deposit_amount numeric DEFAULT 0,
  deposit_invoiced boolean DEFAULT false,
  is_no_charge boolean DEFAULT false,
  invoice_id text, invoice_number text, invoice_ref text,
  materials_invoice_number text,
  invoiced_at timestamptz, collected_at timestamptz,
  -- Scheduling stack (kept in full)
  calendar_event_id text, calendar_summary text, calendar_id text,
  scheduled_event_id text, scheduled_calendar_id text,
  scheduled_date date, estimated_hours numeric,
  tech_assigned uuid REFERENCES public.techs(id),
  tech_name text,
  is_multi_day boolean DEFAULT false,
  day_number integer, total_days integer,
  -- Field workflow
  parts_ordered boolean DEFAULT false,
  parts_received boolean DEFAULT false,
  parts_notes text, parts text,
  sub_required boolean DEFAULT false,
  sub_name text,
  sub_confirmed boolean DEFAULT false,
  customer_confirmed boolean DEFAULT false,
  office_notified boolean DEFAULT false,
  is_complete boolean DEFAULT false,
  completed_at timestamptz,
  completion_notes text, materials_used text, return_reason text,
  actual_hours numeric,
  time_in timestamptz, time_out timestamptz,
  needs_notes boolean DEFAULT false,
  needs_notes_flagged_at timestamptz,
  action_note text, issue text, notes text,
  blocked_tags text[] DEFAULT '{}',
  p_number text, s_number text,
  created_by text, updated_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  synced_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX jobs_tenant_qbo_estimate_id_key ON public.jobs (tenant_id, qbo_estimate_id);
CREATE UNIQUE INDEX idx_jobs_p_number ON public.jobs (tenant_id, p_number) WHERE p_number IS NOT NULL;
CREATE UNIQUE INDEX idx_jobs_s_number ON public.jobs (tenant_id, s_number) WHERE s_number IS NOT NULL;
CREATE INDEX idx_jobs_customer ON public.jobs (customer_id);
CREATE INDEX idx_jobs_status ON public.jobs (status);
CREATE INDEX idx_jobs_scheduled ON public.jobs (scheduled_date);
CREATE INDEX idx_jobs_tech ON public.jobs (tech_assigned);
CREATE INDEX idx_jobs_calendar ON public.jobs (calendar_event_id);
CREATE INDEX idx_jobs_qbo_estimate ON public.jobs (qbo_estimate_id);
CREATE INDEX idx_jobs_remaining ON public.jobs (remaining_amount) WHERE remaining_amount > 0::numeric;
CREATE INDEX idx_jobs_needs_notes ON public.jobs (needs_notes) WHERE needs_notes = true;
CREATE INDEX idx_jobs_tenant ON public.jobs (tenant_id);

-- ---------- Scheduling: assignments ----------
CREATE TABLE public.job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  tech_id uuid REFERENCES public.techs(id),
  day_number integer DEFAULT 1,
  scheduled_for timestamptz,
  estimated_hours numeric DEFAULT 2,
  calendar_event_id text,
  calendar_synced_at timestamptz,
  time_in timestamptz, time_out timestamptz,
  actual_hours numeric,
  is_complete boolean DEFAULT false,
  completion_notes text,
  action_note text,
  action_complete boolean DEFAULT false,
  created_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (job_id, tech_id, day_number)
);
CREATE INDEX idx_assignments_job ON public.job_assignments (job_id);
CREATE INDEX idx_assignments_tech ON public.job_assignments (tech_id);
CREATE INDEX idx_assignments_scheduled ON public.job_assignments (scheduled_for);
CREATE INDEX idx_assignments_calendar_event ON public.job_assignments (calendar_event_id);
CREATE INDEX idx_assignments_tech_schedule ON public.job_assignments (tech_id, scheduled_for);

CREATE TABLE public.job_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz DEFAULT now(),
  notes text,
  snapshot jsonb
);
CREATE INDEX idx_job_history_job ON public.job_history (job_id, changed_at);

-- ---------- Scheduling: calendar-driven time capture ----------
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  customer_id uuid REFERENCES public.customers(id),
  customer_name_raw text,
  calendar_event_id text NOT NULL,
  calendar_id text NOT NULL,
  event_title text,
  event_start timestamptz,
  tech_email text, tech_name text,
  time_in timestamptz, time_out timestamptz,
  total_minutes integer NOT NULL DEFAULT 0,
  entry_method text,
  disposition text NOT NULL,
  notes text, materials text, project_ref text,
  billed boolean NOT NULL DEFAULT false,
  billed_at timestamptz,
  invoice_ref text,
  job_id uuid REFERENCES public.jobs(id),
  archived boolean DEFAULT false,
  archived_at timestamptz, archived_by text, archive_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_entries_customer ON public.time_entries (customer_id);
CREATE INDEX idx_time_entries_job_id ON public.time_entries (job_id);
CREATE INDEX idx_time_entries_event ON public.time_entries (calendar_event_id);
CREATE INDEX idx_time_entries_disposition ON public.time_entries (disposition);
CREATE INDEX idx_time_entries_unbilled ON public.time_entries (disposition, billed) WHERE billed = false;
CREATE INDEX idx_time_entries_queue ON public.time_entries (archived, billed) WHERE COALESCE(archived, false) = false;
CREATE INDEX idx_time_entries_tech ON public.time_entries (tech_email, created_at DESC);
CREATE INDEX idx_time_entries_project_ref ON public.time_entries (project_ref) WHERE project_ref IS NOT NULL;
CREATE INDEX idx_time_entries_tenant ON public.time_entries (tenant_id);

-- ---------- Scheduling: return cards ----------
CREATE TABLE public.return_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  customer_id uuid REFERENCES public.customers(id),
  customer_name_raw text,
  original_event_id text NOT NULL,
  original_calendar_id text NOT NULL,
  original_event_title text,
  original_location text,
  flagged_by_email text, flagged_by_name text,
  reason text,
  time_entry_id uuid REFERENCES public.time_entries(id),
  status text NOT NULL DEFAULT 'pending_schedule',
  scheduled_at timestamptz,
  new_event_id text, new_calendar_id text,
  job_id uuid REFERENCES public.jobs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_return_cards_customer ON public.return_cards (customer_id);
CREATE INDEX idx_return_cards_job_id ON public.return_cards (job_id);
CREATE INDEX idx_return_cards_status ON public.return_cards (status);
CREATE INDEX idx_return_cards_pending ON public.return_cards (status, created_at DESC) WHERE status = 'pending_schedule';

-- ---------- Pipeline ----------
CREATE TABLE public.pipeline_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  customer text NOT NULL,
  contact text, phone text, scope text,
  amount numeric DEFAULT 0,
  stage text NOT NULL DEFAULT 'estimate_needed',
  install_stage text,
  sent_at timestamptz,
  source text, notes text,
  manager_notes text,
  materials jsonb DEFAULT '[]',
  created_from_job_id uuid REFERENCES public.jobs(id),
  created_by text,
  estimate_number text,
  est_hours numeric, est_materials numeric,
  change_order boolean DEFAULT false,
  change_order_amount numeric DEFAULT 0,
  invoiced_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_pipeline_deals_stage ON public.pipeline_deals (stage);
CREATE INDEX idx_pipeline_deals_created_from ON public.pipeline_deals (created_from_job_id);

-- ---------- Clock ----------
CREATE TABLE public.clock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  tech_id uuid NOT NULL REFERENCES public.techs(id),
  entry_type text NOT NULL,
  job_id uuid REFERENCES public.jobs(id),
  clock_in timestamptz NOT NULL DEFAULT now(),
  clock_out timestamptz,
  duration_minutes numeric,
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_clock_entries_tech ON public.clock_entries (tech_id);
CREATE INDEX idx_clock_entries_date ON public.clock_entries (clock_in);
CREATE INDEX idx_clock_entries_type ON public.clock_entries (entry_type);

CREATE TABLE public.clock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text,
  gcal_event_id text,
  event_type text,
  notes text,
  logged_at timestamptz DEFAULT now()
);

-- ---------- Estimates module (contractor markup flow) ----------
CREATE TABLE public.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  name text NOT NULL,
  category text,
  unit text DEFAULT 'ls',
  default_markup_pct numeric DEFAULT 25,
  std_rate numeric,
  qbo_item_id text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX catalog_items_tenant_name_key ON public.catalog_items (tenant_id, name);

CREATE TABLE public.estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  est_no text NOT NULL,
  status text NOT NULL DEFAULT 'draft',   -- draft | sent | accepted | declined
  customer_id uuid REFERENCES public.customers(id),
  job_id uuid REFERENCES public.jobs(id),
  project text,
  contractor_name text,
  contractor_ref text,
  quote_date date,
  default_markup_pct numeric DEFAULT 25,
  tax_rate numeric DEFAULT 0,
  terms text,
  qbo_estimate_id text,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX estimates_tenant_est_no_key ON public.estimates (tenant_id, est_no);
CREATE INDEX idx_estimates_customer ON public.estimates (customer_id);
CREATE INDEX idx_estimates_status ON public.estimates (status);

CREATE TABLE public.estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  position integer DEFAULT 0,
  catalog_item_id uuid REFERENCES public.catalog_items(id),
  item_name text,
  description text,
  qty numeric DEFAULT 1,
  unit text DEFAULT 'ls',
  contractor_unit_cost numeric,
  markup_pct numeric,            -- NULL = use estimate default
  override_unit_price numeric,   -- NULL = compute from cost x markup
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_estimate_lines_estimate ON public.estimate_lines (estimate_id, position);

CREATE TABLE public.estimate_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),  -- in = customer, out = contractor
  paid_on date,
  ref text,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_estimate_payments_estimate ON public.estimate_payments (estimate_id);

-- ---------- Ops / misc ----------
CREATE TABLE public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  action text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  details jsonb DEFAULT '{}',
  customer_id uuid REFERENCES public.customers(id),
  job_id uuid REFERENCES public.jobs(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_activity_created ON public.activity_log (created_at DESC);
CREATE INDEX idx_activity_job ON public.activity_log (job_id);

CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.weekly_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  week_start date NOT NULL,
  week_end date NOT NULL,
  income numeric DEFAULT 0,
  cogs numeric DEFAULT 0,
  expenses numeric DEFAULT 0,
  net_income numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX weekly_financials_tenant_week_key ON public.weekly_financials (tenant_id, week_start);

CREATE TABLE public.pl_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.tenants(id),
  period_type text NOT NULL,
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  year integer NOT NULL,
  month integer, week_number integer,
  labor_revenue numeric DEFAULT 0, materials_revenue numeric DEFAULT 0, total_revenue numeric DEFAULT 0,
  labor_expense numeric DEFAULT 0, materials_expense numeric DEFAULT 0, other_expense numeric DEFAULT 0,
  total_expense numeric DEFAULT 0, net_amount numeric DEFAULT 0,
  py_labor_revenue numeric, py_materials_revenue numeric, py_total_revenue numeric,
  py_labor_expense numeric, py_materials_expense numeric, py_other_expense numeric,
  py_total_expense numeric, py_net_amount numeric,
  source_file text, uploaded_by text,
  created_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX pl_data_tenant_period_key ON public.pl_data (tenant_id, period_type, period_start, period_end, year);
CREATE INDEX idx_pl_data_period ON public.pl_data (year, month, period_type);
CREATE INDEX idx_pl_data_dates ON public.pl_data (period_start, period_end);

-- ---------- Functions ----------
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

-- Collision-safe, tenant-scoped short_code allocator
CREATE OR REPLACE FUNCTION public.generate_short_code()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  base TEXT; next_num INT; candidate TEXT;
BEGIN
  IF NEW.short_code IS NOT NULL AND trim(NEW.short_code) <> '' THEN
    RETURN NEW;
  END IF;

  base := upper(regexp_replace(COALESCE(NEW.name, ''), '[^A-Za-z]', '', 'g'));
  base := rpad(left(base, 3), 3, 'X');
  IF base = '' OR base = 'XXX' THEN base := 'CUS'; END IF;

  -- global max across every ABC123-style code within this tenant
  SELECT COALESCE(MAX(CAST(right(short_code, 3) AS INT)), 0) + 1
    INTO next_num
    FROM customers
   WHERE tenant_id = NEW.tenant_id
     AND short_code ~ '^[A-Z]{3}[0-9]{3}$';

  LOOP
    candidate := base || lpad(next_num::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM customers
       WHERE tenant_id = NEW.tenant_id
         AND (short_code = candidate
              OR right(short_code, 3) = lpad(next_num::text, 3, '0')));
    next_num := next_num + 1;
  END LOOP;

  NEW.short_code := candidate;
  RETURN NEW;
END; $$;

-- Tenant-scoped P-number assigner
CREATE OR REPLACE FUNCTION public.assign_p_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_num INT;
BEGIN
  IF NEW.status = 'estimate_sent'
     AND (OLD.status IS DISTINCT FROM 'estimate_sent')
     AND NEW.p_number IS NULL
  THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(p_number FROM 3) AS INT)), 0) + 1
      INTO next_num
      FROM jobs
     WHERE tenant_id = NEW.tenant_id
       AND p_number ~ '^P-[0-9]+$';
    NEW.p_number := 'P-' || LPAD(next_num::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END; $$;

-- Tenant-scoped S-number assigner
CREATE OR REPLACE FUNCTION public.assign_s_number(target_job_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  next_num INT; new_s TEXT; existing RECORD;
BEGIN
  SELECT tenant_id, p_number, s_number INTO existing FROM jobs WHERE id = target_job_id;

  IF existing.p_number IS NOT NULL THEN RETURN existing.p_number; END IF;
  IF existing.s_number IS NOT NULL THEN RETURN existing.s_number; END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(s_number FROM 3) AS INT)), 0) + 1
    INTO next_num
    FROM jobs
   WHERE tenant_id = existing.tenant_id
     AND s_number ~ '^S-[0-9]+$';

  new_s := 'S-' || LPAD(next_num::TEXT, 3, '0');
  UPDATE jobs SET s_number = new_s WHERE id = target_job_id;
  RETURN new_s;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_time_entry_job_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_id IS NOT NULL AND NEW.time_entry_id IS NOT NULL THEN
    UPDATE time_entries
       SET job_id = NEW.job_id
     WHERE id = NEW.time_entry_id
       AND job_id IS NULL;
  END IF;
  RETURN NEW;
END; $$;

-- ---------- Triggers ----------
CREATE TRIGGER set_short_code BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION generate_short_code();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_assign_p_number BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION assign_p_number();
CREATE TRIGGER pipeline_deals_updated_at BEFORE UPDATE ON public.pipeline_deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER return_cards_updated_at BEFORE UPDATE ON public.return_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sync_time_entry_job_id AFTER INSERT OR UPDATE ON public.return_cards
  FOR EACH ROW EXECUTE FUNCTION sync_time_entry_job_id();
CREATE TRIGGER estimates_updated_at BEFORE UPDATE ON public.estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER catalog_items_updated_at BEFORE UPDATE ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER qbo_connections_updated_at BEFORE UPDATE ON public.qbo_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------- RLS (one clean policy per table) ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','techs','customers','jobs','job_assignments','job_history',
    'time_entries','return_cards','pipeline_deals','clock_entries','clock_events',
    'catalog_items','estimates','estimate_lines','estimate_payments',
    'activity_log','weekly_financials','pl_data']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_all ON public.%I FOR ALL USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_service_only ON public.settings FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE public.qbo_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY qbo_connections_service_only ON public.qbo_connections FOR ALL USING (auth.role() = 'service_role');

-- ---------- Seed ----------
INSERT INTO public.settings (key, value) VALUES ('schema_version', 'jovelin-001-clean')
ON CONFLICT (key) DO NOTHING;
