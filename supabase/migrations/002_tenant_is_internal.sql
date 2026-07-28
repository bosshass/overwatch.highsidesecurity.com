-- ============================================
-- Jovelin — internal tenants
-- ============================================
-- JNB LLC is a tenant like any other in the schema, but it is not a
-- client: it is the firm's own books. Staff work across every client, so
-- without a marker they roam into JNB's revenue, profit and billing the
-- same way they roam into a client's.
--
-- is_internal is that marker. Enforced server-side in api/_auth.js and in
-- the route gate, not just hidden in the nav.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

UPDATE tenants SET is_internal = true WHERE id = '57c9b0d1-c79e-4af0-862b-fb2148b21b29';

CREATE INDEX IF NOT EXISTS idx_tenants_is_internal ON tenants (is_internal) WHERE is_internal;
