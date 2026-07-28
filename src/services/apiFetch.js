// ============================================
// Jovelin — authenticated calls to our own /api
// ============================================
// The server now refuses any /api/qbo/* request it can't attribute to a
// signed-in person. Every call from the app has to carry the Supabase
// session token, so all of them go through here instead of bare fetch().
//
// If there's no session, the request still goes out — and comes back 401.
// That's deliberate: a silent local skip would hide the real problem
// (someone signed into the app without a Supabase session) instead of
// surfacing it.
import { supabase } from './supabase.js';

export async function apiFetch(input, init = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch (e) {
    token = null;
  }

  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}

export default apiFetch;
