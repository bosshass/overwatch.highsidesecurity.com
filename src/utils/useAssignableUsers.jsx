// ============================================
// Jovelin — who can be assigned work in this tenant
// ============================================
// One source for the assignee list so the Board and the Time screen can't
// offer different people. Built from user_roles for the current tenant,
// with revoked accounts excluded — assigning work to someone whose access
// was removed produces a task nobody will ever see.
//
// Cross-tenant people (super admins and staff) are deliberately NOT in the
// pool. They work across clients rather than carrying a client's day-to-day
// job list, and putting them in every tenant's dropdown would make the
// common case — assigning to one of this client's own people — harder.
import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';

export function useAssignableUsers(tenantId) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (!tenantId) { setUsers([]); return; }
    let cancelled = false;
    supabase.from('user_roles')
      .select('email, role')
      .eq('tenant_id', tenantId)
      .is('revoked_at', null)
      .order('email')
      .then(({ data }) => {
        if (cancelled) return;
        setUsers((data || []).map(u => ({
          email: u.email,
          // The part before @ is what people actually call each other, and
          // full addresses make a dropdown unreadable.
          label: u.email.split('@')[0],
          role: u.role,
        })));
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  return users;
}

// Shared control so both screens present assignment identically.
export function AssigneeSelect({ users, value, onChange, style = {}, allowUnassigned = true }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value || null)} style={style}>
      {allowUnassigned && <option value="">— Unassigned —</option>}
      {users.map(u => (
        <option key={u.email} value={u.email}>
          {u.label}{u.role === 'tenant_admin' ? ' (admin)' : ''}
        </option>
      ))}
    </select>
  );
}
