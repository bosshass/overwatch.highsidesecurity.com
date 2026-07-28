// ============================================
// Jovelin — shared QBO client helper
// ============================================
// Used by every /api/qbo/* endpoint so token-refresh logic lives in exactly
// one place. Server-side only — never import this from frontend code.
import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ---------- write approval gate ----------
// Anything that writes to a client's live QuickBooks books goes through
// here first. When a tenant requires approval, the request is parked in
// qbo_push_queue with who asked and exactly what would be sent, and
// nothing reaches Intuit until a super admin releases it.
//
// Defaults to requiring approval when the flag can't be read. An
// unreadable setting must not silently become permission to write to
// someone's accounting.
// A deactivated client's books are off limits regardless of role or
// approval setting. Checked server-side so it holds even if a stale tab
// still has the UI open.
export async function tenantIsActive(supabase, tenantId) {
  try {
    const { data, error } = await supabase.from('tenants')
      .select('deactivated_at').eq('id', tenantId).maybeSingle();
    if (error || !data) return false;
    return !data.deactivated_at;
  } catch (e) {
    return false;
  }
}

export async function requiresApproval(supabase, tenantId, requestedBy = null) {
  // Staff always go through review, regardless of a tenant's setting.
  // The whole point of the role is that doing the work and authorising it
  // are separate hands, so a per-tenant "allow direct writes" toggle must
  // not quietly hand a staff member unreviewed access to a client's books.
  if (requestedBy) {
    try {
      const { data: who } = await supabase.from('user_roles')
        .select('role').eq('email', String(requestedBy).toLowerCase()).is('revoked_at', null).maybeSingle();
      if (who?.role === 'staff') return true;
    } catch (e) {
      return true; // can't establish who asked — review it
    }
  }

  try {
    const { data, error } = await supabase.from('tenant_features')
      .select('require_push_approval').eq('tenant_id', tenantId).maybeSingle();
    if (error) return true;
    return data?.require_push_approval !== false;
  } catch (e) {
    return true;
  }
}

export async function enqueuePush(supabase, { tenantId, kind, summary, payload, requestedBy }) {
  const { data, error } = await supabase.from('qbo_push_queue')
    .insert({ tenant_id: tenantId, kind, summary, payload, requested_by: requestedBy || null })
    .select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---------- response cache ----------
// Every screen pulling live from QuickBooks on every render is what pushed
// tenants into Intuit's rate limit. These responses don't change by the
// second, so they're cached per tenant with a short TTL. Any caller can
// force a fresh pull with ?fresh=1 — which is what the Refresh buttons do,
// and what should follow any write.
export async function withCache(supabase, tenantId, key, ttlSeconds, producer, { fresh = false } = {}) {
  if (!fresh) {
    try {
      const { data } = await supabase.from('qbo_cache')
        .select('payload, fetched_at').eq('tenant_id', tenantId).eq('cache_key', key).maybeSingle();
      if (data) {
        const ageMs = Date.now() - new Date(data.fetched_at).getTime();
        if (ageMs < ttlSeconds * 1000) {
          return { ...data.payload, _cached: true, _ageSeconds: Math.round(ageMs / 1000) };
        }
      }
    } catch (e) { /* a cache miss must never break the request */ }
  }

  const payload = await producer();

  // Only cache successes. Caching an error would keep serving it for the
  // whole TTL, long after the underlying problem cleared.
  if (payload && !payload.error) {
    try {
      await supabase.from('qbo_cache').upsert(
        { tenant_id: tenantId, cache_key: key, payload, fetched_at: new Date().toISOString() },
        { onConflict: 'tenant_id,cache_key' }
      );
    } catch (e) { /* caching is best-effort */ }
  }
  return payload;
}

// Drops a tenant's cached responses after a write, so the next read
// reflects the change instead of serving a stale copy for minutes.
export async function invalidateCache(supabase, tenantId, keys = null) {
  try {
    let q = supabase.from('qbo_cache').delete().eq('tenant_id', tenantId);
    if (keys) q = q.in('cache_key', keys);
    await q;
  } catch (e) { /* best-effort */ }
}

export function qboBaseUrl() {
  return (process.env.QBO_ENV || 'sandbox') === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// Thrown when the connection genuinely can't be recovered automatically —
// refresh token expired/revoked, or an access-token error slipped through
// despite proactive refresh. Every endpoint's catch block can check
// err.needsReconnect to tell "reconnect QuickBooks" apart from any other
// failure, instead of surfacing one generic error message for both.
class QboReconnectError extends Error {
  constructor(message) { super(message); this.needsReconnect = true; }
}

export async function refreshQboToken(refreshToken) {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant here specifically means the refresh token itself is
    // dead (expired past its ~100-day lifetime, or revoked) — no amount
    // of retrying fixes this; only reconnecting does.
    if (data?.error === 'invalid_grant') throw new QboReconnectError(`Refresh token invalid or expired: ${JSON.stringify(data)}`);
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  return data; // { access_token, refresh_token, expires_in, ... }
}

// Returns the tenant's connection row with a guaranteed-fresh access_token,
// refreshing and persisting a new one if the current one is expired or
// close to it. Returns null if the tenant has no QBO connection at all.
export async function getValidConnection(supabase, tenantId) {
  const { data: conn, error } = await supabase
    .from('qbo_connections').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn || !conn.access_token) return null;

  // Already known broken from a prior call — don't hammer Intuit's token
  // endpoint again on every request; surface the same reconnect signal
  // immediately instead.
  if (conn.needs_reconnect) throw new QboReconnectError('This connection needs to be reconnected.');

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (needsRefresh && conn.refresh_token) {
    try {
      const refreshed = await refreshQboToken(conn.refresh_token);
      const updated = {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_expires_at: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase.from('qbo_connections').update(updated).eq('tenant_id', tenantId);
      return { ...conn, ...updated };
    } catch (err) {
      if (err.needsReconnect) {
        await supabase.from('qbo_connections').update({ needs_reconnect: true }).eq('tenant_id', tenantId);
      }
      throw err;
    }
  }
  return conn;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Every endpoint's catch block can call this with its own known context
// (tenant, endpoint name) plus whatever intuit_tid ended up on the error —
// gives support a real, searchable record instead of just an HTTP response
// that's gone the moment the request ends.
export async function logQboError(supabase, { tenantId, endpoint, error, statusCode }) {
  try {
    await supabase.from('qbo_error_log').insert({
      tenant_id: tenantId || null, endpoint: endpoint || null,
      error_message: String(error?.message || error), intuit_tid: error?.intuitTid || null,
      status_code: statusCode || null,
    });
  } catch (_) { /* logging must never itself break the request */ }
}

export async function qboQuery(realmId, accessToken, query, attempt = 1) {
  const url = `${qboBaseUrl()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  const intuitTid = res.headers.get('intuit_tid');
  const data = await res.json();
  if (!res.ok) {
    // Intuit's own throttle (429/ThrottleExceeded) is transient — a real
    // production user hitting this shouldn't have to manually reload.
    // Retry a couple of times with backoff before actually surfacing it.
    if (res.status === 429 && attempt < 3) {
      await sleep(attempt * 1500);
      return qboQuery(realmId, accessToken, query, attempt + 1);
    }
    // 401 here means an access token error slipped through despite the
    // proactive refresh in getValidConnection (edge case, but real) —
    // same reconnect signal, not a generic error.
    if (res.status === 401) {
      const err = new QboReconnectError(`QBO authorization error (${res.status}): ${JSON.stringify(data)}`);
      err.intuitTid = intuitTid;
      throw err;
    }
    const err = new Error(`QBO query failed (${res.status}): ${JSON.stringify(data)}`);
    err.intuitTid = intuitTid;
    throw err;
  }
  return data.QueryResponse || {};
}
