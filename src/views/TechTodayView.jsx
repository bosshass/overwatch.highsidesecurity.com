// ============================================
// Overwatch V3 - TechTodayView
// ============================================
// SOURCE OF TRUTH: Google Calendar
// GCal events on DRH Tech 1 / JR Appointments = jobs
// Supabase = customer details, history, clock logs
// If GCal and Supabase conflict → GCal wins
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { customersApi, jobsApi, supabase } from '../services/supabase.js';
import { CALENDARS, TECH_CALENDAR_MAP } from '../config/calendars.js';
import usePullToRefresh from '../utils/usePullToRefresh.jsx';

// ============================================
// CONSTANTS
// ============================================

const JOB_KEYWORDS = [
  /AUSTIN\s*[—\-]/i,
  /DRH-\d+/i,
  /\[COMPLETE/i,
  /\[SERVICE\]/i,
  /\[SCHEDULED\]/i,
  /\[CONFIRM/i,
  /\[RETURN/i,
  /\[TRIAGE/i,
  /\[QUEUE/i,
  /\bInstall\b/i,
  /\bTroubleshoot/i,
  /\bService\s*Call/i,
  /\bReturn\s*Visit/i,
  /\bInspect/i,
  /CONFIRM/i,
  /TRIAGE/i,
  /URGENT/i,
  /PARTS PENDING/i,
  /MUST BE DONE/i,
  /NEEDS CLARIFICATION/i,
  /PENDING DECISION/i,
];

const NON_JOB_KEYWORDS = [
  /^JR OFF/i,
  /^JR \*\*\*/i,
  /Southwest Airlines/i,
  /DRH Payroll/i,
  /ISC West/i,
  /ESTIMATES NEEDED/i,
  /^\s*busy\s*$/i,
  /JR unavailable/i,
  /JR OFF/i,
  /^\s*OFF\s*$/i,
];

// ============================================
// HELPERS
// ============================================

function isJobEvent(summary = '') {
  for (const p of NON_JOB_KEYWORDS) {
    if (p.test(summary)) return false;
  }
  for (const p of JOB_KEYWORDS) {
    if (p.test(summary)) return true;
  }
  return false;
}

function parseEventDescription(desc = '') {
  const unescape = (s) => s
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\/g, '');

  const raw = unescape(desc);

  const get = (key) => {
    const match = raw.match(new RegExp(`${key}:\\s*(.+?)(?:\\n|$)`, 'i'));
    return match ? match[1].trim() : null;
  };

  // Extract structured fields
  const customer = get('CUSTOMER');
  const phone = get('PHONE');
  const address = get('ADDRESS') || get('Property Address');
  const issue = get('ISSUE');

  // Extract DRH job number from anywhere in the text
  const drhMatch = raw.match(/DRH-(\d+)/i);
  const drhNumber = drhMatch ? `DRH-${drhMatch[1]}` : null;

  // Extract notes block (after "--- NOTES ---" or "NOTES:")
  const notesMatch = raw.match(/---\s*NOTES\s*---\s*([\s\S]*?)(?:📱|$)/i);
  const notes = notesMatch ? notesMatch[1].trim() : null;

  // Extract JUC-E deep link
  const linkMatch = raw.match(/https:\/\/[^\s]+(?:juc-e|overwatch)[^\s]*/i);
  const deepLink = linkMatch ? linkMatch[0] : null;

  return { customer, phone, address, issue, drhNumber, notes, deepLink, raw };
}

function parseEventStatus(summary = '') {
  if (/\[COMPLETE/i.test(summary)) return 'complete';
  if (/\[BILLED\]/i.test(summary)) return 'billed';
  if (/\[TO BILL\]/i.test(summary)) return 'to_bill';
  if (/\[IGNORE\]/i.test(summary)) return 'ignore';
  if (/\[CONFIRM/i.test(summary)) return 'confirmed';
  if (/TRIAGE/i.test(summary)) return 'triage';
  if (/URGENT/i.test(summary)) return 'urgent';
  if (/PARTS PENDING/i.test(summary)) return 'parts_pending';
  if (/PENDING DECISION/i.test(summary)) return 'pending';
  if (/RETURN/i.test(summary)) return 'return';
  if (/NEEDS CLARIFICATION/i.test(summary)) return 'needs_clarification';
  return 'scheduled';
}

function parseJobType(summary = '') {
  if (/Install/i.test(summary)) return 'install';
  if (/Service|SVC/i.test(summary)) return 'service';
  if (/Inspect/i.test(summary)) return 'inspect';
  if (/Sales/i.test(summary)) return 'sales';
  if (/Estimate/i.test(summary)) return 'estimate';
  if (/Return/i.test(summary)) return 'return';
  if (/Troubleshoot/i.test(summary)) return 'service';
  return 'service';
}

function getStatusStyle(status) {
  const map = {
    complete:          { label: '✓ Complete',        color: '#10b981', bg: '#10b98115' },
    billed:            { label: '💰 Billed',          color: '#6b7280', bg: '#6b728015' },
    to_bill:           { label: '💵 To Bill',         color: '#8b5cf6', bg: '#8b5cf615' },
    confirmed:         { label: '✅ Confirmed',       color: '#22c55e', bg: '#22c55e15' },
    triage:            { label: '⚠️ Triage',          color: '#ef4444', bg: '#ef444415' },
    urgent:            { label: '🔴 Urgent',          color: '#ef4444', bg: '#ef444415' },
    parts_pending:     { label: '📦 Parts Pending',   color: '#f59e0b', bg: '#f59e0b15' },
    pending:           { label: '⏳ Pending',         color: '#a855f7', bg: '#a855f715' },
    return:            { label: '🔄 Return',          color: '#ec4899', bg: '#ec489915' },
    needs_clarification: { label: '❓ Needs Clarity', color: '#f97316', bg: '#f9731615' },
    scheduled:         { label: '📅 Scheduled',      color: '#3b82f6', bg: '#3b82f615' },
    ignore:            { label: '—',                  color: '#475569', bg: '#47556915' },
  };
  return map[status] || map.scheduled;
}

function getJobTypeStyle(type) {
  const map = {
    install:  { label: 'INSTALL',  color: '#14b8a6' },
    service:  { label: 'SERVICE',  color: '#3b82f6' },
    inspect:  { label: 'INSPECT',  color: '#a855f7' },
    sales:    { label: 'SALES',    color: '#f59e0b' },
    estimate: { label: 'ESTIMATE', color: '#06b6d4' },
    return:   { label: 'RETURN',   color: '#ec4899' },
  };
  return map[type] || map.service;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const diff = (new Date(endIso) - new Date(startIso)) / 60000;
  const h = Math.floor(diff / 60);
  const m = Math.round(diff % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function cleanSummary(summary = '') {
  // Remove status tags and tech prefixes for display
  return summary
    .replace(/\[(COMPLETE|BILLED|TO BILL|IGNORE|SCHEDULED|CONFIRM[A-Z]*|RETURN[A-Z\s]*|TRIAGE|SERVICE|QUEUE)[^\]]*\]/gi, '')
    .replace(/AUSTIN\s*[—\-]\s*/i, '')
    .replace(/MUST BE DONE\s*[🟣🔴⚠️]*\s*/i, '')
    .replace(/NEEDS CLARIFICATION[^—]*/i, '')
    .replace(/CONFIRMED\s+by\s+\w+\s*/i, '')
    .replace(/⚠️|🟣|🔴|❓|✅/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ============================================
// GCAL API
// ============================================

async function fetchTodayJobsFromGCal(accessToken, userEmail) {
  const calendarId = TECH_CALENDAR_MAP[userEmail?.toLowerCase()];
  if (!calendarId) return [];

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', start.toISOString());
  url.searchParams.set('timeMax', end.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '50');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) throw new Error(`GCal API error: ${res.status}`);
  const data = await res.json();

  return (data.items || [])
    .filter(e => isJobEvent(e.summary || ''))
    .map(e => {
      const parsed = parseEventDescription(e.description || '');
      const status = parseEventStatus(e.summary || '');
      const jobType = parseJobType(e.summary || '');
      return {
        gcalId: e.id,
        calendarId,
        summary: e.summary || '',
        displayTitle: cleanSummary(e.summary || ''),
        startTime: e.start?.dateTime || e.start?.date,
        endTime: e.end?.dateTime || e.end?.date,
        location: e.location || parsed.address || '',
        status,
        jobType,
        ...parsed,
        // GCal is source of truth — these override Supabase
        gcalCustomer: parsed.customer,
        gcalPhone: parsed.phone,
        gcalAddress: parsed.address || e.location || '',
        gcalIssue: parsed.issue,
        gcalNotes: parsed.notes,
        gcalDrhNumber: parsed.drhNumber,
      };
    });
}

async function updateGCalEventDescription(accessToken, calendarId, eventId, newDescription) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: newDescription }),
    }
  );
  if (!res.ok) throw new Error(`GCal update error: ${res.status}`);
  return res.json();
}

async function updateGCalEventSummary(accessToken, calendarId, eventId, newSummary) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ summary: newSummary }),
    }
  );
  if (!res.ok) throw new Error(`GCal update error: ${res.status}`);
  return res.json();
}

// ============================================
// SUPABASE HELPERS
// ============================================

async function lookupCustomer(gcalCustomer, gcalPhone, drhNumber) {
  if (!gcalCustomer && !gcalPhone && !drhNumber) return null;
  try {
    // Try DRH number first
    if (drhNumber) {
      const num = drhNumber.replace('DRH-', '');
      const { data } = await supabase.from('jobs').select('*, customer:customers(*)').eq('job_number', num).maybeSingle();
      if (data?.customer) return data.customer;
    }
    // Try customer name
    if (gcalCustomer) {
      const { data } = await supabase.from('customers').select('*').ilike('name', `%${gcalCustomer.split(/[,\/]/)[0].trim()}%`).limit(1).maybeSingle();
      if (data) return data;
    }
    // Try phone
    if (gcalPhone) {
      const cleaned = gcalPhone.replace(/\D/g, '');
      const { data } = await supabase.from('customers').select('*').ilike('phone', `%${cleaned.slice(-7)}%`).limit(1).maybeSingle();
      if (data) return data;
    }
  } catch (e) {
    console.warn('Customer lookup failed:', e);
  }
  return null;
}

async function getCustomerHistory(customerId) {
  if (!customerId) return [];
  try {
    const { data } = await supabase
      .from('jobs')
      .select('id, job_number, customer_name, status, job_type, created_at, completed_at, description')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(10);
    return data || [];
  } catch (e) {
    return [];
  }
}

async function logClockEvent(userEmail, gcalId, type, notes) {
  try {
    await supabase.from('clock_events').insert([{
      user_email: userEmail,
      gcal_event_id: gcalId,
      event_type: type, // 'clock_in' | 'clock_out'
      notes,
      logged_at: new Date().toISOString(),
    }]);
  } catch (e) {
    // Table may not exist yet — fail silently
    console.warn('Clock log failed (table may not exist):', e);
  }
}

// ============================================
// COMPONENTS
// ============================================

function ElapsedTimer({ startIso }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(startIso)) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startIso]);
  return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#22c55e', fontWeight: '700' }}>{elapsed}</span>;
}

function ClockModal({ job, mode, onClose, onSave }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(notes);
      onClose();
    } catch (e) {
      alert('Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '28px 24px 40px', width: '100%', maxWidth: '480px' }}>
        <div style={{ fontSize: '26px', fontWeight: '800', color: '#e2e8f0', marginBottom: '4px' }}>
          {mode === 'in' ? '🟢 Clock In' : '🔴 Clock Out'}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '6px' }}>{job.displayTitle}</div>
        <div style={{ color: '#00c8e8', fontSize: '15px', fontWeight: '700', marginBottom: '20px' }}>{timeStr}</div>

        <textarea
          autoFocus
          placeholder={mode === 'in' ? 'Arrival notes (optional)...' : 'Completion notes, parts used, follow-up needed...'}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{
            width: '100%', background: '#0f1729', border: '2px solid #334155',
            borderRadius: '12px', color: '#e2e8f0', padding: '14px', fontSize: '15px',
            resize: 'none', minHeight: '100px', outline: 'none', boxSizing: 'border-box',
            fontFamily: 'inherit'
          }}
        />

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={{ flex: 1, background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '15px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, background: mode === 'in' ? '#22c55e' : '#ef4444', color: '#fff',
            border: 'none', borderRadius: '12px', padding: '16px', fontSize: '16px',
            fontWeight: '800', cursor: 'pointer', opacity: saving ? 0.6 : 1
          }}>
            {saving ? 'Saving...' : mode === 'in' ? '▶ Start Job' : '■ Done — Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesModal({ job, onClose, onSave }) {
  const [notes, setNotes] = useState(job.gcalNotes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(notes);
      onClose();
    } catch (e) {
      alert('Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '28px 24px 40px', width: '100%', maxWidth: '480px' }}>
        <div style={{ fontSize: '22px', fontWeight: '800', color: '#e2e8f0', marginBottom: '4px' }}>📝 Field Notes</div>
        <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>{job.displayTitle}</div>
        <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '8px' }}>Saved to Google Calendar event</div>

        <textarea
          autoFocus
          placeholder="What did you find? What did you do? Parts used? Follow-up needed?"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{
            width: '100%', background: '#0f1729', border: '2px solid #334155',
            borderRadius: '12px', color: '#e2e8f0', padding: '14px', fontSize: '15px',
            resize: 'none', minHeight: '140px', outline: 'none', boxSizing: 'border-box',
            fontFamily: 'inherit'
          }}
        />

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={{ flex: 1, background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '12px', padding: '16px', fontSize: '15px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, background: '#00c8e8', color: '#000',
            border: 'none', borderRadius: '12px', padding: '16px', fontSize: '16px',
            fontWeight: '800', cursor: 'pointer', opacity: saving ? 0.6 : 1
          }}>
            {saving ? 'Saving...' : '💾 Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ customer, history, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 700, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1e293b', padding: '20px 16px 16px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#e2e8f0' }}>📋 Job History</div>
          <div style={{ color: '#94a3b8', fontSize: '13px' }}>{customer?.name || 'Customer'}</div>
        </div>
        <button onClick={onClose} style={{ background: '#334155', border: 'none', color: '#94a3b8', borderRadius: '8px', padding: '8px 14px', fontSize: '14px', cursor: 'pointer' }}>✕ Close</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {history.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0' }}>No previous jobs found in Supabase</div>
        ) : (
          history.map((job, i) => (
            <div key={i} style={{ background: '#0f1729', borderRadius: '12px', padding: '14px', marginBottom: '10px', borderLeft: `3px solid ${job.status === 'complete' || job.status === 'billed' ? '#10b981' : '#3b82f6'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#00c8e8', fontSize: '12px', fontWeight: '700' }}>{job.job_number ? `DRH-${job.job_number}` : '—'}</span>
                <span style={{ color: '#64748b', fontSize: '11px' }}>{job.created_at ? new Date(job.created_at).toLocaleDateString() : ''}</span>
              </div>
              <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>{job.customer_name || job.description || 'Job'}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', background: '#1e293b', borderRadius: '4px', padding: '2px 6px' }}>{job.job_type || 'service'}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8', background: '#1e293b', borderRadius: '4px', padding: '2px 6px' }}>{job.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function JobCard({ job, userEmail, accessToken, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [clockModal, setClockModal] = useState(null); // 'in' | 'out'
  const [showNotes, setShowNotes] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [clockedInAt, setClockedInAt] = useState(() => {
    return localStorage.getItem(`clock_in_${job.gcalId}`) || null;
  });
  const [clockedOut, setClockedOut] = useState(() => {
    return !!localStorage.getItem(`clock_out_${job.gcalId}`);
  });

  const statusStyle = getStatusStyle(job.status);
  const typeStyle = getJobTypeStyle(job.jobType);
  const isActive = !!clockedInAt && !clockedOut;
  const isDone = clockedOut;

  const loadCustomer = async () => {
    if (customer || loadingCustomer) return;
    setLoadingCustomer(true);
    try {
      const c = await lookupCustomer(job.gcalCustomer, job.gcalPhone, job.gcalDrhNumber);
      setCustomer(c);
    } finally {
      setLoadingCustomer(false);
    }
  };

  const handleExpand = () => {
    setExpanded(v => !v);
    if (!expanded) loadCustomer();
  };

  const handleHistory = async () => {
    await loadCustomer();
    if (customer) {
      const h = await getCustomerHistory(customer.id);
      setHistory(h);
    }
    setShowHistory(true);
  };

  const handleClockIn = async (notes) => {
    const now = new Date().toISOString();
    localStorage.setItem(`clock_in_${job.gcalId}`, now);
    setClockedInAt(now);

    // Log to Supabase
    await logClockEvent(userEmail, job.gcalId, 'clock_in', notes);

    // Update GCal description
    try {
      const newDesc = appendToDescription(job.raw, `\n\n--- CLOCK IN ---\n${new Date(now).toLocaleString()}\n${notes ? `Notes: ${notes}` : ''}`);
      await updateGCalEventDescription(accessToken, job.calendarId, job.gcalId, newDesc);
    } catch (e) {
      console.warn('GCal clock-in update failed:', e);
    }
  };

  const handleClockOut = async (notes) => {
    const now = new Date().toISOString();
    localStorage.setItem(`clock_out_${job.gcalId}`, now);
    setClockedOut(true);

    // Log to Supabase
    await logClockEvent(userEmail, job.gcalId, 'clock_out', notes);

    // Update GCal description + mark [COMPLETE] in summary
    try {
      const newDesc = appendToDescription(job.raw, `\n\n--- CLOCK OUT ---\n${new Date(now).toLocaleString()}\n${notes ? `Notes: ${notes}` : ''}`);
      await updateGCalEventDescription(accessToken, job.calendarId, job.gcalId, newDesc);

      // Add [COMPLETE] to summary if not already there
      if (!/\[COMPLETE/i.test(job.summary)) {
        const newSummary = `[COMPLETE] ${job.summary}`;
        await updateGCalEventSummary(accessToken, job.calendarId, job.gcalId, newSummary);
      }
    } catch (e) {
      console.warn('GCal clock-out update failed:', e);
    }

    onRefresh();
  };

  const handleSaveNotes = async (notes) => {
    const newDesc = replaceNotesInDescription(job.raw, notes);
    await updateGCalEventDescription(accessToken, job.calendarId, job.gcalId, newDesc);
    onRefresh();
  };

  const handleMarkBilled = async () => {
    if (!window.confirm('Mark this job as BILLED in Google Calendar?')) return;
    try {
      let newSummary = job.summary;
      if (!/\[BILLED\]/i.test(newSummary)) {
        newSummary = `[BILLED] ${newSummary.replace(/\[COMPLETE[^\]]*\]/gi, '').trim()}`;
      }
      await updateGCalEventSummary(accessToken, job.calendarId, job.gcalId, newSummary);
      onRefresh();
    } catch (e) {
      alert('Failed to update GCal — try again');
    }
  };

  const phone = job.gcalPhone || customer?.phone || '';
  const address = job.gcalAddress || customer?.address || '';

  return (
    <>
      <div style={{
        background: isActive ? '#0f2a1a' : isDone ? '#0f1a2a' : '#1e293b',
        borderRadius: '16px',
        marginBottom: '12px',
        border: `2px solid ${isActive ? '#22c55e' : isDone ? '#3b82f6' : '#334155'}`,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}>
        {/* Header row */}
        <div
          onClick={handleExpand}
          style={{ padding: '16px 16px 12px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Time + type */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                {job.startTime && (
                  <span style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '700' }}>
                    {formatTime(job.startTime)}
                    {job.endTime && ` – ${formatTime(job.endTime)}`}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: typeStyle.color, background: `${typeStyle.color}20`, borderRadius: '4px', padding: '2px 6px', fontWeight: '700' }}>
                  {typeStyle.label}
                </span>
                {job.gcalDrhNumber && (
                  <span style={{ fontSize: '11px', color: '#64748b', background: '#0f1729', borderRadius: '4px', padding: '2px 6px' }}>
                    {job.gcalDrhNumber}
                  </span>
                )}
              </div>

              {/* Title */}
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#e2e8f0', lineHeight: '1.3', marginBottom: '4px' }}>
                {job.displayTitle}
              </div>

              {/* Status */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: statusStyle.color, background: statusStyle.bg, borderRadius: '6px', padding: '2px 8px' }}>
                {statusStyle.label}
              </div>
            </div>

            {/* Active timer */}
            {isActive && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>ON SITE</div>
                <ElapsedTimer startIso={clockedInAt} />
              </div>
            )}
          </div>
        </div>

        {/* Quick action buttons — always visible */}
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px' }}>
          {!isActive && !isDone && (
            <button
              onClick={() => setClockModal('in')}
              style={{ flex: 2, background: '#22c55e', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '800', cursor: 'pointer' }}
            >
              ▶ Start
            </button>
          )}
          {isActive && (
            <button
              onClick={() => setClockModal('out')}
              style={{ flex: 2, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '800', cursor: 'pointer' }}
            >
              ■ Done
            </button>
          )}
          {isDone && job.status !== 'billed' && (
            <button
              onClick={handleMarkBilled}
              style={{ flex: 2, background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: '800', cursor: 'pointer' }}
            >
              💵 Mark Billed
            </button>
          )}
          {isDone && job.status === 'billed' && (
            <div style={{ flex: 2, background: '#1e293b', color: '#6b7280', borderRadius: '12px', padding: '14px', fontSize: '14px', textAlign: 'center' }}>
              💰 Billed
            </div>
          )}

          {phone && (
            <a href={`tel:${phone.replace(/\D/g, '')}`} style={{ flex: 1, background: '#0f1729', color: '#00c8e8', border: '2px solid #334155', borderRadius: '12px', padding: '14px', fontSize: '20px', textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              📞
            </a>
          )}
          {address && (
            <a href={`https://maps.apple.com/?q=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, background: '#0f1729', color: '#00c8e8', border: '2px solid #334155', borderRadius: '12px', padding: '14px', fontSize: '20px', textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              🗺️
            </a>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div style={{ borderTop: '1px solid #334155', padding: '16px' }}>
            {/* Customer info */}
            {(job.gcalCustomer || customer) && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</div>
                <div style={{ color: '#e2e8f0', fontSize: '15px', fontWeight: '700' }}>{customer?.name || job.gcalCustomer}</div>
                {phone && <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '2px' }}>{phone}</div>}
                {address && <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '2px' }}>{address}</div>}
              </div>
            )}

            {/* Issue */}
            {job.gcalIssue && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Issue</div>
                <div style={{ color: '#e2e8f0', fontSize: '14px', lineHeight: '1.5' }}>{job.gcalIssue}</div>
              </div>
            )}

            {/* Notes from GCal */}
            {job.gcalNotes && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Field Notes</div>
                <div style={{ color: '#e2e8f0', fontSize: '14px', lineHeight: '1.5', background: '#0f1729', borderRadius: '8px', padding: '10px' }}>
                  {job.gcalNotes}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowNotes(true)}
                style={{ flex: 1, minWidth: '120px', background: '#0f1729', color: '#00c8e8', border: '2px solid #334155', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                📝 Notes
              </button>
              <button
                onClick={handleHistory}
                style={{ flex: 1, minWidth: '120px', background: '#0f1729', color: '#94a3b8', border: '2px solid #334155', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                📋 History
              </button>
            </div>

            {/* Clock times */}
            {clockedInAt && (
              <div style={{ marginTop: '12px', padding: '10px', background: '#0f1729', borderRadius: '8px' }}>
                <div style={{ color: '#22c55e', fontSize: '12px' }}>▶ Clocked in: {new Date(clockedInAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                {clockedOut && (
                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '2px' }}>
                    ■ Clocked out: {new Date(localStorage.getItem(`clock_out_${job.gcalId}`)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {clockModal && (
        <ClockModal
          job={job}
          mode={clockModal}
          onClose={() => setClockModal(null)}
          onSave={clockModal === 'in' ? handleClockIn : handleClockOut}
        />
      )}
      {showNotes && (
        <NotesModal
          job={job}
          onClose={() => setShowNotes(false)}
          onSave={handleSaveNotes}
        />
      )}
      {showHistory && (
        <HistoryModal
          customer={customer}
          history={history}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
}

// ============================================
// DESCRIPTION HELPERS
// ============================================

function appendToDescription(rawDesc, appendText) {
  return (rawDesc || '') + appendText;
}

function replaceNotesInDescription(rawDesc, newNotes) {
  const raw = rawDesc || '';
  const notesMarker = '--- NOTES ---';
  const idx = raw.indexOf(notesMarker);
  if (idx === -1) {
    return raw + `\n\n${notesMarker}\n${newNotes}`;
  }
  // Replace everything after the marker until the next section or end
  const before = raw.substring(0, idx + notesMarker.length);
  const after = raw.substring(idx + notesMarker.length);
  // Find next section marker
  const nextSection = after.search(/\n--- [A-Z]+ ---/);
  const tail = nextSection === -1 ? '' : after.substring(nextSection);
  return `${before}\n${newNotes}${tail}`;
}

// ============================================
// MAIN VIEW
// ============================================

export default function TechTodayView({ accessToken, userEmail, userName }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeTab, setActiveTab] = useState('today');

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const loadJobs = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const events = await fetchTodayJobsFromGCal(accessToken, userEmail);
      setJobs(events);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('GCal fetch error:', e);
      setError('Could not load jobs from Google Calendar. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, userEmail]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  usePullToRefresh(loadJobs);

  const completedJobs = jobs.filter(j => j.status === 'complete' || j.status === 'billed' || !!localStorage.getItem(`clock_out_${j.gcalId}`));
  const activeJobs = jobs.filter(j => !completedJobs.includes(j));

  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ minHeight: '100vh', background: '#0f1729', color: '#e2e8f0', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '2px' }}>{dateStr}</div>
        <div style={{ fontSize: '22px', fontWeight: '800', color: '#e2e8f0', marginBottom: '8px' }}>
          {greeting}, {userName}!
        </div>

        {/* Progress bar */}
        {jobs.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>{completedJobs.length} of {jobs.length} jobs done</span>
              {lastRefresh && <span style={{ fontSize: '11px', color: '#475569' }}>↻ {lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
            <div style={{ height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${jobs.length ? (completedJobs.length / jobs.length) * 100 : 0}%`, background: '#22c55e', borderRadius: '2px', transition: 'width 0.4s' }} />
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
        {[
          { key: 'today', label: `Today (${jobs.length})` },
          { key: 'done', label: `Done (${completedJobs.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1, padding: '14px', background: 'none', border: 'none',
              color: activeTab === tab.key ? '#00c8e8' : '#64748b',
              fontWeight: activeTab === tab.key ? '700' : '400',
              fontSize: '14px', cursor: 'pointer',
              borderBottom: activeTab === tab.key ? '2px solid #00c8e8' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📅</div>
            <div style={{ color: '#64748b', fontSize: '14px' }}>Loading from Google Calendar...</div>
          </div>
        )}

        {error && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', textAlign: 'center', border: '2px solid #ef4444' }}>
            <div style={{ color: '#ef4444', fontSize: '14px', marginBottom: '12px' }}>{error}</div>
            <button onClick={loadJobs} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && activeTab === 'today' && (
          <>
            {activeJobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛡️</div>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#e2e8f0', marginBottom: '8px' }}>No jobs scheduled for today.</div>
                <div style={{ color: '#64748b', fontSize: '14px' }}>Check in with the office if you're expecting work.</div>
              </div>
            ) : (
              activeJobs.map(job => (
                <JobCard
                  key={job.gcalId}
                  job={job}
                  userEmail={userEmail}
                  accessToken={accessToken}
                  onRefresh={loadJobs}
                />
              ))
            )}
          </>
        )}

        {!loading && !error && activeTab === 'done' && (
          <>
            {completedJobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569' }}>No completed jobs yet today</div>
            ) : (
              completedJobs.map(job => (
                <JobCard
                  key={job.gcalId}
                  job={job}
                  userEmail={userEmail}
                  accessToken={accessToken}
                  onRefresh={loadJobs}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Refresh FAB */}
      <button
        onClick={loadJobs}
        style={{
          position: 'fixed', bottom: '80px', right: '16px',
          background: '#1e293b', border: '2px solid #334155',
          color: '#00c8e8', borderRadius: '50%', width: '48px', height: '48px',
          fontSize: '18px', cursor: 'pointer', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ↻
      </button>
    </div>
  );
}
