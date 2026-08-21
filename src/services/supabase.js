// ============================================
// JUC-E V4 - Supabase Client & API
// ============================================
// Customer is a SEPARATE model. Do not merge into jobs.

import { createClient } from '@supabase/supabase-js';
// Static, not `await import()`. This was the only dynamic importer of
// calendars.js while twenty other files import it statically, so the bundler
// could never split it out and warned on every build. A dynamic import that
// cannot actually be code-split is just a slower static one.
import { TECH_CALENDAR_MAP } from '../config/calendars.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://wolhqelloeypafmmvapn.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvbGhxZWxsb2V5cGFmbW12YXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyODQxODUsImV4cCI6MjA4NDg2MDE4NX0.wQZ14FMQ03A8cBYXBMS1-pII4lKhTL7VNPl9zBCs-EM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Extract [PROJ-NNN] tag from a calendar event title
// Extract a project reference from a calendar event title.
// Accepts [P-NNN] (DB-assigned p_number), [S-NNN] (DB-assigned s_number),
// or [PROJ-NNN] (legacy manual tag). Returns the canonical "PREFIX-NNN" string.
function extractProjectRef(title) {
  const mP = (title || '').match(/\[P-(\d+)\]/i);
  if (mP) return `P-${mP[1]}`;
  const mS = (title || '').match(/\[S-(\d+)\]/i);
  if (mS) return `S-${mS[1]}`;
  const mProj = (title || '').match(/\[PROJ-(\d+)\]/i);
  return mProj ? `PROJ-${mProj[1]}` : null;
}

// ============================================
// JOB STATUSES
// ============================================

export const JOB_STATUS = {
  NEW: 'new',
  NEEDS_DETAILS: 'needs_details',
  NEEDS_PARTS: 'needs_parts',
  PENDING_DECISION: 'pending_decision',
  PENDING_MATERIALS: 'pending_materials',
  READY_TO_SCHEDULE: 'ready_to_schedule',
  RETURN_PENDING: 'return_pending',
  SCHEDULED: 'scheduled',
  COMPLETE: 'complete',
  TO_BILL: 'to_bill',
  BILLED: 'billed',
  NEEDS_ESTIMATE: 'needs_estimate',
  ESTIMATE_SENT: 'estimate_sent',
  WON: 'won',
  LOST: 'lost',
  BLOCKED: 'blocked',
  DEAD: 'dead',
  ARCHIVED: 'archived'
};

export const STATUS_INFO = {
  [JOB_STATUS.NEW]: { label: 'New', color: '#ef4444', icon: '🆕' },
  [JOB_STATUS.NEEDS_DETAILS]: { label: 'Needs Details', color: '#f97316', icon: '📝' },
  [JOB_STATUS.NEEDS_PARTS]: { label: 'Needs Parts', color: '#eab308', icon: '📦' },
  [JOB_STATUS.PENDING_DECISION]: { label: 'Pending Decision', color: '#a855f7', icon: '⏳' },
  [JOB_STATUS.PENDING_MATERIALS]: { label: 'Pending Materials', color: '#f59e0b', icon: '🚚' },
  [JOB_STATUS.READY_TO_SCHEDULE]: { label: 'Ready to Schedule', color: '#22c55e', icon: '✅' },
  [JOB_STATUS.RETURN_PENDING]: { label: 'Return Pending', color: '#ec4899', icon: '🔄' },
  [JOB_STATUS.SCHEDULED]: { label: 'Scheduled', color: '#3b82f6', icon: '📅' },
  [JOB_STATUS.COMPLETE]: { label: 'Complete', color: '#10b981', icon: '✓' },
  [JOB_STATUS.TO_BILL]: { label: 'To Bill', color: '#8b5cf6', icon: '💵' },
  [JOB_STATUS.BILLED]: { label: 'Billed', color: '#6b7280', icon: '💰' },
  [JOB_STATUS.NEEDS_ESTIMATE]: { label: 'Needs Estimate', color: '#f59e0b', icon: '📋' },
  [JOB_STATUS.ESTIMATE_SENT]: { label: 'Estimate Sent', color: '#06b6d4', icon: '📤' },
  [JOB_STATUS.WON]: { label: 'Won', color: '#22c55e', icon: '🎉' },
  [JOB_STATUS.LOST]: { label: 'Lost', color: '#6b7280', icon: '❌' },
  [JOB_STATUS.BLOCKED]: { label: 'Blocked', color: '#dc2626', icon: '🚫' },
  [JOB_STATUS.DEAD]: { label: 'Dead', color: '#374151', icon: '☠️' },
  [JOB_STATUS.ARCHIVED]: { label: 'Archived', color: '#9ca3af', icon: '📁' }
};

// ============================================
// TECHS API
// ============================================

export const techsApi = {
  async getAll() {
    const { data, error } = await supabase.from('techs').select('*').eq('is_active', true).order('display_order');
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase.from('techs').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async getByEmail(email) {
    const normalized = email.toLowerCase();
    const { data, error } = await supabase.from('techs').select('*').eq('email', normalized).maybeSingle();
    if (error) throw error;
    if (data) return data;

    const { data: calMatch, error: calErr } = await supabase.from('techs').select('*').eq('calendar_id', normalized).maybeSingle();
    if (calErr) throw calErr;
    if (calMatch) return calMatch;

    const myCalId = TECH_CALENDAR_MAP[normalized];
    if (myCalId) {
      const altEmails = Object.entries(TECH_CALENDAR_MAP)
        .filter(([e, cal]) => cal === myCalId && e !== normalized)
        .map(([e]) => e);
      for (const altEmail of altEmails) {
        const { data: altMatch } = await supabase.from('techs').select('*').eq('email', altEmail).maybeSingle();
        if (altMatch) return altMatch;
      }
    }
    return null;
  },

  async getByCalendarId(calendarId) {
    const { data, error } = await supabase.from('techs').select('*').eq('calendar_id', calendarId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('techs').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
};

// ============================================
// CUSTOMERS API — SEPARATE MODEL
// ============================================

export const customersApi = {
  async getAll() {
    const { data, error } = await supabase.from('customers').select('*').is('merged_into', null).order('name');
    if (error) throw error;
    return data || [];
  },

  async search(query) {
    if (!query || !query.trim()) return [];
    // PostgREST .or() uses commas as separators, parens as grouping, and
    // also chokes on  *  (  )  characters in ilike patterns.
    // Sanitize the query and pick the longest meaningful word to search on.
    const cleaned = String(query)
      .replace(/[,()*]/g, ' ')      // strip PostgREST-special chars
      .replace(/\s+/g, ' ')          // collapse whitespace
      .trim();
    if (!cleaned) return [];
    // Split into words, drop short ones, search the longest fragment.
    // (Picking the longest word usually gets the most distinctive token —
    // e.g. "Estimates Needed- Huang Rupert Greeley Crops" → "Estimates")
    const words = cleaned.split(' ').filter(w => w.length >= 3);
    const term = (words.sort((a, b) => b.length - a.length)[0] || cleaned).slice(0, 60);
    // Also strip any % chars from term (would break the ilike pattern)
    const safe = term.replace(/[%]/g, '');
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .is('merged_into', null)
      .or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,address.ilike.%${safe}%,cms_account_id.ilike.%${safe}%`)
      .order('name')
      .limit(50);
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase.from('customers').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async create(customer) {
    const { data, error } = await supabase.from('customers').insert([customer]).select().single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('customers').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async getJobs(customerId) {
    const { data, error } = await supabase.from('jobs').select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getJobCounts() {
    const { data, error } = await supabase.from('jobs').select('customer_id');
    if (error) throw error;
    const counts = {};
    (data || []).forEach(j => { if (j.customer_id) counts[j.customer_id] = (counts[j.customer_id] || 0) + 1; });
    return counts;
  },

  async getAllNotes(customerId) {
    // Get all job_history notes across all of this customer's jobs.
    //
    // THIS SELECTED `job_number`, WHICH DOES NOT EXIST ON THE TABLE. PostgREST
    // 400s the whole query on an unknown column, the error was destructured
    // away, `jobs` came back undefined, and the guard below returned [] — so
    // the customer view showed NO NOTES FOR ANYBODY, always, and looked like a
    // customer who had simply never been written about.
    //
    // `p_number` is the column that actually holds a code. It is frozen (kept,
    // never written again — see DECISIONS.md), but reading it is fine and it
    // is what GlobalSearch already maps onto `job_number` for display.
    const { data: jobs, error: jobsErr } = await supabase
      .from('jobs').select('id, p_number, customer_name').eq('customer_id', customerId);
    if (jobsErr) { console.error('getAllNotes: job lookup failed', jobsErr); return []; }
    if (!jobs || jobs.length === 0) return [];
    const jobIds = jobs.map(j => j.id);
    const jobMap = {};
    jobs.forEach(j => { jobMap[j.id] = j; });
    const { data: notes, error } = await supabase
      .from('job_history')
      .select('*')
      .in('job_id', jobIds)
      .not('notes', 'is', null)
      .order('changed_at', { ascending: false });
    if (error) throw error;
    return (notes || []).map(n => ({ ...n, job_number: jobMap[n.job_id]?.p_number }));
  },

  async addNote(customerId, note, userEmail) {
    // Add a note to the customer's most recent job, or create a general note
    const { data: jobs } = await supabase.from('jobs').select('id').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1);
    if (jobs && jobs.length > 0) {
      const { data, error } = await supabase.from('job_history').insert([{
        job_id: jobs[0].id,
        notes: note,
        changed_by: userEmail,
        changed_at: new Date().toISOString()
      }]).select().single();
      if (error) throw error;
      return data;
    }
  }
};

// ============================================
// JOBS API
// ============================================

export const jobsApi = {
  async getByStatus(statuses) {
    const statusArray = Array.isArray(statuses) ? statuses : [statuses];
    const { data, error } = await supabase.from('jobs').select('*').in('status', statusArray).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    // Was: select(`*, assignments:job_assignments(*, tech:techs(*))`) — that
    // embed requires a foreign key between jobs and job_assignments that does
    // not exist in the schema, so this call has always 400'd with
    // "Could not find a relationship between 'jobs' and 'job_assignments'."
    // Every caller that needs assignments already fetches them separately via
    // assignmentsApi.getForJob(id) (JobDetail does exactly this), so the
    // embed was both broken and redundant.
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getByJobNumber(jobNumber) {
    const { data, error } = await supabase.from('jobs').select('*').eq('job_number', jobNumber).maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(job, createdBy) {
    // Strip null, undefined, and empty string values — only send fields that have data
    const cleaned = {};
    for (const [k, v] of Object.entries(job)) {
      if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
    }
    cleaned.created_by = createdBy;
    cleaned.updated_by = createdBy;
    const { data, error } = await supabase
      .from('jobs')
      .insert([cleaned])
      .select()
      .single();
    if (error) throw error;
    await this.logHistory(data.id, null, job.status || JOB_STATUS.NEW, createdBy, 'Job created');
    return data;
  },

  // THIS WILL WRITE ANY COLUMN, INCLUDING `status`, AND USED TO RECORD NOTHING.
  // That is the structural hole behind "something is moving cards behind the
  // disposition's back": a card could change lanes from anywhere in the app
  // with no history row, so a legitimate move and a mystery move looked
  // identical on the card — which is to say, both looked like a mystery.
  //
  // changeStatus() stays the front door: it carries the side effects (completed_at,
  // invoiced_at, the scheduling task, clearing a hold) that a bare column write
  // does not. But a status arriving through here can no longer pass unrecorded.
  // The extra read costs one round trip and ONLY happens when a status is
  // actually present, so the ordinary field save is untouched.
  async update(id, updates, updatedBy, historyNote = null) {
    const cleaned = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleaned[k] = v; // allow null for clearing fields, but not undefined
    }
    cleaned.updated_by = updatedBy;

    let before = null;
    if (cleaned.status !== undefined) {
      const { data: prev } = await supabase.from('jobs').select('status').eq('id', id).single();
      before = prev?.status ?? null;
    }

    const { data, error } = await supabase.from('jobs').update(cleaned).eq('id', id).select().single();
    if (error) throw error;

    if (cleaned.status !== undefined && cleaned.status !== before) {
      // Say plainly that this did not come through the front door. When one of
      // these turns up in a card's history, the note is the lead: it means a
      // direct column write moved the card and the changeStatus side effects
      // did NOT run.
      await this.logHistory(id, before, cleaned.status, updatedBy || 'unknown',
        historyNote || 'Status set by a direct field update (not the status flow)');
    }
    return data;
  },

  // archiveReason is the KEY from config/archiveReasons.js ('warranty',
  // 'goodwill', 'sales_call'...), never a sentence. isRealCost() classifies a
  // key; it cannot classify prose. Prose is what made 44 existing rows
  // impossible to put on either side of the profitability ledger.
  async changeStatus(id, newStatus, changedBy, notes = null, archiveReason = null) {
    // THE SILENT-NO-OP GUARD.
    // supabase-js serializes the update with JSON.stringify, which DROPS keys
    // whose value is undefined. So changeStatus(id, undefined) sent a PATCH
    // with no `status` at all: Postgres happily updated nothing, no error was
    // raised, the toast said the move worked, and a history row was written
    // with a null destination. Every Sent / Won / Lost click died here.
    // A move with no destination is a programming error — throw.
    if (!newStatus) throw new Error('changeStatus called with no status — the move button is missing its target.');

    const { data: current } = await supabase.from('jobs').select('status, job_type').eq('id', id).single();
    const oldStatus = current?.status;

    const updates = { status: newStatus, updated_by: changedBy };

    // ── PROMOTING A NOTE INTO A JOB ──────────────────────────────────────
    // "Make it a job" carried target:'ready_to_schedule' — a STATUS — and
    // nothing ever wrote job_type. So the row moved lanes and stayed a note:
    // movesFor() re-checks job_type on every render, so the card came back as
    // a note card still offering "Make it a job", forever. Jeff Goodell read
    // "Ready to Schedule" and was still type note.
    //
    // The note lane offers exactly two destinations — make it a job, or done.
    // So any move off a note that is not a close IS the promotion, and this is
    // the one place every caller already funnels through.
    const NOTEY = ['note', 'task'];
    const CLOSERS = ['archived', 'dead', 'lost', 'billed'];
    if (NOTEY.includes(current?.job_type) && !CLOSERS.includes(newStatus)) {
      // 'service' is the neutral work type. Residential vs project is a
      // judgement the person scoping it makes on the card — guessing here
      // would quietly mistype every promoted note.
      updates.job_type = 'service';
    }
    if (archiveReason) updates.return_reason = archiveReason;
    // A hold is a pencil mark, and ANY deliberate status move supersedes it.
    // Nothing cleared this before, so a job that was held and then moved on
    // kept its tentative_date forever and stayed pinned in the Tentative
    // column. services/schedule.js is the only thing allowed to SET it.
    updates.tentative_date = null;
    updates.tentative_event_id = null;
    // TWO OF THESE WROTE COLUMNS THAT DO NOT EXIST ON `jobs`:
    //   scheduled_at — never existed here. Scheduling state is scheduled_date
    //                  plus scheduled_event_id, written by services/schedule.js.
    //   billed_at    — the column is invoiced_at. billed_at exists on
    //                  time_entries, not on jobs, and the two got conflated.
    // Postgres rejects the whole UPDATE on an unknown column, so EVERY attempt
    // to move a job to billed threw — including Billing's write-through, where
    // the throw was swallowed by a try/catch marked "non-fatal on purpose".
    // That is the second reason no job ever left To Bill.
    if (newStatus === JOB_STATUS.COMPLETE) updates.completed_at = new Date().toISOString();
    if (newStatus === JOB_STATUS.TO_BILL) updates.completed_at = updates.completed_at || new Date().toISOString();
    if (newStatus === JOB_STATUS.BILLED) updates.invoiced_at = new Date().toISOString();
    if (notes) updates.completion_notes = notes;

    const { data, error } = await supabase.from('jobs').update(updates).eq('id', id).select().single();
    if (error) throw error;
    await this.logHistory(id, oldStatus, newStatus, changedBy, notes);

    // ── SCHEDULING IS SOMEBODY'S JOB ─────────────────────────────────────
    // Work landing in Ready to Schedule or Return Pending used to just sit in
    // a board column waiting to be noticed. Rick Ferreri sat in Ready for
    // seven weeks. A column is not an owner.
    //
    // Reaching either status now hands Shana a task. Whether it is a first
    // visit or a return does not matter — both mean somebody has to put it on
    // a calendar, and that somebody is her.
    //
    // IDEMPOTENT: bouncing a job in and out of Ready must not stack up five
    // identical tasks, so an existing OPEN scheduling task for this job is
    // left alone.
    const SCHEDULER = 'shanaparks@drhsecurityservices.com';
    if (['ready_to_schedule', 'return_pending'].includes(newStatus)
        && !['ready_to_schedule', 'return_pending'].includes(oldStatus)) {
      try {
        const { data: existing } = await supabase.from('notes')
          .select('id').eq('job_id', id).eq('assigned_to', SCHEDULER)
          .eq('status', 'open').limit(1);
        if (!existing?.length) {
          const kind = newStatus === 'return_pending' ? 'Return visit' : 'Ready to schedule';
          await supabase.from('notes').insert({
            body: `${kind}: ${data?.customer_name || 'job'}${data?.issue ? ` — ${String(data.issue).replace(/\s+/g, ' ').slice(0, 120)}` : ''}`,
            job_id: id,
            customer_id: data?.customer_id || null,
            author_email: changedBy,
            assigned_to: SCHEDULER,
            assigned_by: changedBy,
            lane: 'todo',
            status: 'open',
          });
        }
      } catch (e) {
        // Never unwind a status move because the task write failed.
        console.warn('scheduling task not created (non-fatal):', e.message);
      }
    }

    return data;
  },

  async logHistory(jobId, fromStatus, toStatus, changedBy, notes = null) {
    try {
      await supabase.from('job_history').insert([{ job_id: jobId, from_status: fromStatus, to_status: toStatus, changed_by: changedBy, notes }]);
    } catch (e) { console.warn('History log failed:', e); }
  },

  async search(query) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .or(`customer_name.ilike.%${query}%,issue.ilike.%${query}%,customer_address.ilike.%${query}%,customer_phone.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  },

  // ── JOB LINKING (Return trips, multi-visit jobs) ──────────────────────────
  
  async createLinkedJob(parentJobId, newJobData, createdBy) {
    // Get parent job details
    const parent = await this.getById(parentJobId);
    if (!parent) throw new Error('Parent job not found');
    
    // Generate next job number
    const { data: lastJob } = await supabase
      .from('jobs')
      .select('job_number')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    const lastNum = lastJob?.job_number ? parseInt(lastJob.job_number.replace('DRH-', '')) : 5000;
    const newJobNumber = `DRH-${lastNum + 1}`;
    
    // Create linked job inheriting customer info
    const linkedJob = {
      job_number: newJobNumber,
      customer_name: parent.customer_name,
      customer_phone: parent.customer_phone,
      customer_address: parent.customer_address,
      customer_id: parent.customer_id,
      parent_job_id: parentJobId,
      job_type: newJobData.job_type || 'return_trip',
      issue: newJobData.issue || `Return visit for ${parent.job_number}`,
      priority: newJobData.priority || parent.priority,
      status: JOB_STATUS.RETURN_PENDING,
      ...newJobData
    };
    
    return this.create(linkedJob, createdBy);
  },

  async getLinkedJobs(jobId) {
    // Get all jobs linked to this parent
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('parent_job_id', jobId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getJobWithFamily(jobId) {
    // Get the job, its parent (if any), and all siblings/children
    const job = await this.getById(jobId);
    if (!job) return null;
    
    let parent = null;
    let siblings = [];
    let children = [];
    
    if (job.parent_job_id) {
      // This is a child job - get parent and siblings
      parent = await this.getById(job.parent_job_id);
      const { data: sibs } = await supabase
        .from('jobs')
        .select('*')
        .eq('parent_job_id', job.parent_job_id)
        .neq('id', jobId)
        .order('created_at', { ascending: true });
      siblings = sibs || [];
    }
    
    // Get children regardless
    children = await this.getLinkedJobs(jobId);
    
    return { job, parent, siblings, children };
  },

  async getTotalJobValue(jobId) {
    // Sum estimate/invoice amounts across parent + all linked jobs
    const family = await this.getJobWithFamily(jobId);
    if (!family) return 0;
    
    let total = parseFloat(family.job.estimate_amount || 0) + parseFloat(family.job.invoiced_amount || 0);

    if (family.parent) {
      total += parseFloat(family.parent.estimate_amount || 0) + parseFloat(family.parent.invoiced_amount || 0);
    }

    for (const child of family.children) {
      total += parseFloat(child.estimate_amount || 0) + parseFloat(child.invoiced_amount || 0);
    }

    for (const sib of family.siblings) {
      total += parseFloat(sib.estimate_amount || 0) + parseFloat(sib.invoiced_amount || 0);
    }
    
    return total;
  }
};

// ============================================
// ASSIGNMENTS API
// ============================================

export const assignmentsApi = {
  async getTechSchedule(techId, startDate, endDate) {
    const { data, error } = await supabase
      .from('job_assignments')
      .select(`*, job:jobs(*), tech:techs(*)`)
      .eq('tech_id', techId)
      .gte('scheduled_for', startDate)
      .lte('scheduled_for', endDate)
      .order('scheduled_for');
    if (error) throw error;
    return (data || []).map(a => ({ ...a.job, ...a, assignment_id: a.id, job_id: a.job_id }));
  },

  async getTechScheduleByEmail(email, startDate, endDate) {
    const tech = await techsApi.getByEmail(email);
    if (!tech) return [];
    return this.getTechSchedule(tech.id, startDate, endDate);
  },

  async create(assignment, createdBy) {
    // A job can span days. This used to delete EVERY incomplete assignment for
    // the job+tech before inserting, which meant booking day 2 silently erased
    // day 1 — day_number never once exceeded 1 in 284 rows because the code
    // would not allow it. A three-day install had to be entered as three
    // separate jobs, and that is where the duplicate cards came from.
    //
    // The row that genuinely collides is the same tech, same job, same DAY.
    // Replace that one; leave the other days alone.
    if (assignment.job_id && assignment.tech_id) {
      let q = supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', assignment.job_id)
        .eq('tech_id', assignment.tech_id)
        .or('is_complete.is.null,is_complete.eq.false');

      if (assignment.day_number != null) {
        q = q.eq('day_number', assignment.day_number);
      } else if (assignment.scheduled_for) {
        const d = new Date(assignment.scheduled_for);
        const from = new Date(d); from.setHours(0, 0, 0, 0);
        const to   = new Date(d); to.setHours(23, 59, 59, 999);
        q = q.gte('scheduled_for', from.toISOString()).lte('scheduled_for', to.toISOString());
      }
      await q;
    }

    // Number the day if the caller didn't: next in sequence for this job.
    if (assignment.job_id && assignment.day_number == null) {
      const { data: existing } = await supabase
        .from('job_assignments')
        .select('day_number')
        .eq('job_id', assignment.job_id)
        .order('day_number', { ascending: false })
        .limit(1);
      assignment.day_number = (existing?.[0]?.day_number || 0) + 1;
    }
    const { data, error } = await supabase
      .from('job_assignments')
      .insert([{ ...assignment, created_by: createdBy }])
      .select(`*, tech:techs(*)`)
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('job_assignments').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async markComplete(id, timeIn, timeOut, notes = null, manualHours = null, officeNotified = null) {
    const actualHours = manualHours ? parseFloat(manualHours)
      : (timeOut && timeIn ? (new Date(timeOut) - new Date(timeIn)) / (1000 * 60 * 60) : null);
    const updates = { time_in: timeIn, time_out: timeOut, actual_hours: actualHours, is_complete: true, completion_notes: notes };
    // Store office notification status if provided (overrun tracking)
    if (officeNotified !== null) {
      updates.office_notified = officeNotified;
    }
    const { data, error } = await supabase
      .from('job_assignments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('job_assignments').delete().eq('id', id);
    if (error) throw error;
  },

  async getByCalendarEventId(eventId) {
    const { data, error } = await supabase
      .from('job_assignments')
      .select(`*, job:jobs(*), tech:techs(*)`)
      .eq('calendar_event_id', eventId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getForJob(jobId) {
    const { data, error } = await supabase
      .from('job_assignments')
      .select(`*, tech:techs(name, color)`)
      .eq('job_id', jobId)
      .order('scheduled_for', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getAllSchedule(startDate, endDate) {
    const { data, error } = await supabase
      .from('job_assignments')
      .select(`*, job:jobs(*), tech:techs(*)`)
      .gte('scheduled_for', startDate)
      .lte('scheduled_for', endDate)
      .order('scheduled_for');
    if (error) throw error;
    return (data || []).map(a => ({ ...a.job, ...a, assignment_id: a.id, job_id: a.job_id, tech_name: a.tech?.name }));
  }
};

// ============================================
// NOTES API
// ============================================

export const notesApi = {
  async getAllForJob(jobId) {
    const notes = [];
    const { data: history, error: hErr } = await supabase
      .from('job_history').select('*').eq('job_id', jobId).not('notes', 'is', null).order('changed_at', { ascending: false });
    if (!hErr && history) {
      history.forEach(h => {
        if (h.notes?.trim()) {
          notes.push({ id: h.id, source: 'history', text: h.notes, created_at: h.changed_at, created_by: h.changed_by, from_status: h.from_status, to_status: h.to_status, editable: true });
        }
      });
    }
    const { data: job, error: jErr } = await supabase.from('jobs').select('completion_notes, updated_by, updated_at, calendar_event_id, scheduled_event_id').eq('id', jobId).single();
    if (!jErr && job?.completion_notes?.trim()) {
      notes.push({ id: `job-completion-${jobId}`, source: 'completion', text: job.completion_notes, created_at: job.updated_at, created_by: job.updated_by, from_status: null, to_status: null, editable: true });
    }

    // ── FIELD NOTES from time_entries ────────────────────────────────
    // This source was MISSING. getAllForJob read job_history + completion_notes
    // only, so the note a tech actually types when closing out a visit — which
    // lives in time_entries.notes — never appeared in NotesPanel, the client
    // record, CustomerAudit, or the board. It showed on the Calendar and
    // nowhere else, because CalendarTechDay was the only screen querying
    // time_entries directly.
    //
    // Every consumer of this function gets them now: NotesPanel (job detail),
    // BoardView (merge carry-over), CustomerAudit, calendarSync. One fix, five
    // screens, because they all come through here.
    //
    // Matched on job_id OR either calendar event column — the same three-key
    // rule as visitsOwed.js. Jeanneret is why: its calendar_event_id and
    // scheduled_event_id are different values, so a single-key match drops it.
    try {
      const eventIds = [job?.calendar_event_id, job?.scheduled_event_id].filter(Boolean);
      const or = [`job_id.eq.${jobId}`];
      if (eventIds.length) or.push(`calendar_event_id.in.(${eventIds.join(',')})`);
      const { data: visits } = await supabase
        .from('time_entries')
        .select('id, notes, event_start, created_at, tech_name, tech_email, disposition, total_minutes, archived')
        .or(or.join(','));
      (visits || []).forEach(v => {
        if (!v.notes?.trim() || v.archived) return;
        const hrs = v.total_minutes ? ` · ${(v.total_minutes / 60).toFixed(2)}h` : '';
        notes.push({
          id: `time-entry-${v.id}`,
          source: 'field',
          text: v.notes,
          created_at: v.event_start || v.created_at,
          created_by: v.tech_name || v.tech_email || 'Tech',
          from_status: null,
          // Surface the disposition + hours so the field note reads as what it
          // is — a closed-out visit — rather than an anonymous comment.
          to_status: v.disposition ? `${v.disposition}${hrs}` : null,
          // NOT editable here. time_entries is the source of truth for field
          // work; editing it from a notes panel would put a second write path
          // on the one table that finally has only one.
          editable: false,
        });
      });
    } catch (e) {
      console.warn('field notes lookup failed:', e?.message || e);
    }
    notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return notes;
  },

  async addNote(jobId, noteText, createdBy) {
    const { data: job } = await supabase.from('jobs').select('status').eq('id', jobId).single();
    const { data, error } = await supabase
      .from('job_history')
      .insert([{ job_id: jobId, from_status: job?.status || null, to_status: job?.status || null, changed_by: createdBy, notes: noteText }])
      .select().single();
    if (error) throw error;
    await supabase.from('jobs').update({ updated_by: createdBy }).eq('id', jobId);
    return data;
  },

  async editHistoryNote(historyId, newText) {
    const { data, error } = await supabase.from('job_history').update({ notes: newText }).eq('id', historyId).select().single();
    if (error) throw error;
    return data;
  },

  async editCompletionNotes(jobId, newText, updatedBy) {
    const { data, error } = await supabase.from('jobs').update({ completion_notes: newText, updated_by: updatedBy }).eq('id', jobId).select().single();
    if (error) throw error;
    return data;
  }
};

// ============================================
// FEEDBACK API (HelpBot)
// ============================================

export const feedbackApi = {
  async create({ type, message, userEmail, currentView, metadata }) {
    const { data, error } = await supabase
      .from('feedback')
      .insert([{ type, message, user_email: userEmail, current_view: currentView, metadata: metadata || {}, created_at: new Date().toISOString() }])
      .select().single();
    if (error) { console.warn('Feedback save failed:', error.message); return null; }
    return data;
  },
  async getAll() {
    const { data, error } = await supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  }
};

// ============================================
// QUERY HELPERS
// ============================================

export const queries = {
  async getATCQueue() {
    return jobsApi.getByStatus([JOB_STATUS.NEW, JOB_STATUS.NEEDS_DETAILS, JOB_STATUS.NEEDS_PARTS, JOB_STATUS.PENDING_DECISION, JOB_STATUS.PENDING_MATERIALS]);
  },
  async getFlightDeckQueue() {
    return jobsApi.getByStatus([JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.RETURN_PENDING]);
  },
  async getBillingQueue() {
    return jobsApi.getByStatus([JOB_STATUS.TO_BILL, JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT, JOB_STATUS.WON]);
  },
  async getActiveJobs() {
    return jobsApi.getByStatus([JOB_STATUS.SCHEDULED]);
  },
  async getAllOpenJobs() {
    return jobsApi.getByStatus([
      JOB_STATUS.NEW, JOB_STATUS.NEEDS_DETAILS, JOB_STATUS.NEEDS_PARTS, JOB_STATUS.PENDING_DECISION, JOB_STATUS.PENDING_MATERIALS,
      JOB_STATUS.READY_TO_SCHEDULE, JOB_STATUS.RETURN_PENDING, JOB_STATUS.SCHEDULED, JOB_STATUS.COMPLETE,
      JOB_STATUS.TO_BILL, JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT, JOB_STATUS.WON
    ]);
  },
  async getAllOpenJobsWithTech() {
    const jobs = await this.getAllOpenJobs();
    // Fetch all non-complete assignments
    const { data: assignments } = await supabase
      .from('job_assignments')
      .select('job_id, tech_id, tech:techs(id, name, color), scheduled_for')
      .eq('is_complete', false)
      .order('scheduled_for', { ascending: false });
    // Map latest assignment per job
    const assignMap = {};
    (assignments || []).forEach(a => {
      if (!assignMap[a.job_id]) assignMap[a.job_id] = a;
    });

    // Hydrate missing phone/address from customers table
    const needsCustomerData = jobs.filter(j => j.customer_id && (!j.customer_phone || !j.customer_address));
    if (needsCustomerData.length > 0) {
      const customerIds = [...new Set(needsCustomerData.map(j => j.customer_id))];
      const { data: customers } = await supabase.from('customers').select('id, phone, address').in('id', customerIds);
      const custMap = {};
      (customers || []).forEach(c => { custMap[c.id] = c; });
      jobs.forEach(j => {
        if (j.customer_id && custMap[j.customer_id]) {
          if (!j.customer_phone && custMap[j.customer_id].phone) j.customer_phone = custMap[j.customer_id].phone;
          if (!j.customer_address && custMap[j.customer_id].address) j.customer_address = custMap[j.customer_id].address;
        }
      });
    }

    return jobs.map(j => ({
      ...j,
      _tech_id: assignMap[j.id]?.tech_id || null,
      _tech_name: assignMap[j.id]?.tech?.name || null,
      _tech_color: assignMap[j.id]?.tech?.color || null,
      _scheduled_for: assignMap[j.id]?.scheduled_for || null,
    }));
  },
  async getDashboardStats() {
    const allOpen = await this.getAllOpenJobs();
    const billing = await this.getBillingQueue();
    return {
      totalOpen: allOpen.length,
      needsAction: allOpen.filter(j => j.status === JOB_STATUS.NEW).length,
      scheduled: allOpen.filter(j => j.status === JOB_STATUS.SCHEDULED).length,
      toBill: billing.filter(j => j.status === JOB_STATUS.TO_BILL).length,
      estimatesPending: billing.filter(j => j.status === JOB_STATUS.ESTIMATE_SENT).length,
      pipelineValue: billing.filter(j => [JOB_STATUS.NEEDS_ESTIMATE, JOB_STATUS.ESTIMATE_SENT].includes(j.status)).reduce((sum, j) => sum + (parseFloat(j.estimate_amount) || 0), 0),
      waitingOnParts: allOpen.filter(j => j.status === JOB_STATUS.NEEDS_PARTS).length,
      returnsPending: allOpen.filter(j => j.status === JOB_STATUS.RETURN_PENDING).length,
      allJobs: allOpen,
      billingJobs: billing
    };
  }
};

// ============================================
// TIME ENTRIES API
// ============================================
// Every tech "finish" action writes one row. This feeds:
//   - Billing queue: disposition='bill_it' AND billed=false
//   - Project queue: disposition='in_progress'
//   - Customer history: ORDER BY created_at DESC WHERE customer_id=x

// ============================================
// CANONICAL DISPOSITION VOCABULARY
// ============================================
// The app writes exactly four real states. Everything else — legacy calendar
// tags, tech free-text, the "17k synonyms" pile (return / return trip /
// return required, bill it / to bill / complete, billed / invoiced) — collapses
// HERE, in one place, so no screen ever has to guess again.
//
//   bill_it      → ready to invoice
//   return       → needs a return visit
//   in_progress  → multi-day work, stays open
//   estimate     → sales handoff
//   skip         → terminal / already handled / ignore
//   triage       → unknown, needs human eyes
//   blocked      → went out, could not do the work; the TRIP bills
export const DISPOSITIONS = ['bill_it', 'return', 'in_progress', 'estimate', 'blocked'];

export function normalizeDisposition(raw) {
  if (!raw) return 'triage';
  const t = String(raw).toUpperCase().replace(/[[\]]/g, ' ').trim();
  // Order matters: 'billed/invoiced' (skip) must beat 'bill' (bill_it).
  if (/\b(BILLED|INVOICED?|IGNORED?|SKIP|SCHEDULED|ARCHIVED?)\b/.test(t)) return 'skip';
  // Before RETURN and before BILL: a wasted trip often carries both words in
  // the same title ("no access - return"), and what happened is that nobody
  // got in. That fact outranks what has to happen next.
  if (/\b(NO ?ACCESS|NOBODY (?:HOME|THERE)|NO ?ONE (?:HOME|THERE)|LOCKED ?OUT|TURNED ?AWAY|COULD ?N'?T ?(?:GET ?IN|DO)|BLOCKED)\b/.test(t)) return 'blocked';
  if (/\bRETURN\b/.test(t)) return 'return';                       // return · return trip · return needed · return required
  if (/\b(ESTIMATE|SALES|QUOTE|BID)\b/.test(t)) return 'estimate';
  if (/\b(IN ?PROGRESS|ONGOING|MULTI[- ]?DAY)\b/.test(t)) return 'in_progress';
  if (/\b(BILL ?IT|TO ?BILL|BILL|COMPLETED?|DONE|INSTALL(?:ATION)?|NO ?CHARGE|NC)\b/.test(t)) return 'bill_it';
  return 'triage';
}

export const timeEntriesApi = {
  // Create a time entry from a finish action
  async create(entry) {
    const payload = {
      customer_id: entry.customer_id || null,
      customer_name_raw: entry.customer_name_raw || null,
      calendar_event_id: entry.calendar_event_id,
      calendar_id: entry.calendar_id,
      event_title: entry.event_title || null,
      event_start: entry.event_start || null,
      tech_email: entry.tech_email || null,
      tech_name: entry.tech_name || null,
      time_in: entry.time_in || null,
      time_out: entry.time_out || null,
      total_minutes: entry.total_minutes || 0,
      entry_method: entry.entry_method || 'manual',
      disposition: entry.disposition,
      notes: entry.notes || null,
      materials: entry.materials || null,
      // PHOTOS WERE BEING DROPPED HERE. This payload is an explicit whitelist,
      // and `photos` was never on it — the finish sheet uploaded to Storage,
      // handed the URLs over, and create() silently discarded them. The column
      // default is '{}', so every row read as an empty array and the files sat
      // in the bucket with nothing pointing at them.
      photos: entry.photos && entry.photos.length ? entry.photos : null,
      // JOB_ID WAS BEING DROPPED HERE, exactly like photos above. This payload
      // is an explicit whitelist and `job_id` was never on it, so every caller
      // that passed one had it silently discarded at the API boundary. That is
      // why 161 of 259 unarchived entries (62%) have a null job_id — not
      // because the link was unknown, but because create() threw it away.
      //
      // Downstream, that missing link is what forced "have we logged this
      // visit?" to be answered three different ways in three different files,
      // including a customer_id + calendar-day heuristic that silently
      // suppressed second visits to the same customer on one day.
      job_id: entry.job_id || null,
      project_ref: entry.project_ref || extractProjectRef(entry.event_title) || null,
    };
    const { data, error } = await supabase.from('time_entries').insert([payload]).select().single();
    if (error) throw error;
    return data;
  },

  // Recent entries for a customer (for "prior visits" display)
  async getForCustomer(customerId, limit = 5) {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  // Entries for a specific calendar event (usually 1, but supports multi-day projects)
  async getForEvent(calendarEventId) {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('calendar_event_id', calendarEventId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // "Needs to Bill" queue — drives Billing view
  async getBillingQueue() {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*, customers(name, phone, address, drh_id)')
      // A blocked visit is chargeable — see utils/billing.js. Leaving it out
      // meant a tech could mark "couldn't do it" and the trip would never
      // reach anyone who invoices.
      .in('disposition', ['bill_it', 'blocked'])
      .eq('billed', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  // Project queue — drives the (future) project view
  async getProjectQueue() {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*, customers(name, phone, address, drh_id)')
      .eq('disposition', 'in_progress')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Mark billed
  async markBilled(id, invoiceRef) {
    const { data, error } = await supabase
      .from('time_entries')
      .update({ billed: true, billed_at: new Date().toISOString(), invoice_ref: invoiceRef || null })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('time_entries').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
};

// ============================================
// RETURN CARDS API
// ============================================
// Created when tech flags "Return Needed". Feeds the Scheduler view.

export const returnCardsApi = {
  async create(card) {
    const payload = {
      customer_id: card.customer_id || null,
      customer_name_raw: card.customer_name_raw || null,
      original_event_id: card.original_event_id,
      original_calendar_id: card.original_calendar_id,
      original_event_title: card.original_event_title || null,
      original_location: card.original_location || null,
      flagged_by_email: card.flagged_by_email || null,
      flagged_by_name: card.flagged_by_name || null,
      reason: card.reason || null,
      time_entry_id: card.time_entry_id || null,
      status: 'pending_schedule',
    };
    const { data, error } = await supabase.from('return_cards').insert([payload]).select().single();
    if (error) throw error;
    return data;
  },

  // Pending returns — drives Scheduler's returns tab
  async getPending() {
    const { data, error } = await supabase
      .from('return_cards')
      .select('*, customers(name, phone, address, drh_id)')
      .eq('status', 'pending_schedule')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async markScheduled(id, newEventId, newCalendarId, scheduledAt) {
    const { data, error } = await supabase
      .from('return_cards')
      .update({
        status: 'scheduled',
        new_event_id: newEventId,
        new_calendar_id: newCalendarId,
        scheduled_at: scheduledAt || new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async cancel(id) {
    const { data, error } = await supabase
      .from('return_cards')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ============================================
// CUSTOMERS — LOOSE CREATE
// ============================================
// Extend the existing customersApi with a name-only create path.
// Phone, address, email, cms_account_id all optional.

// THE DUPLICATE FACTORY, CLOSED.
// This inserted unconditionally: type a name, get a row. Nine of the twenty-
// three duplicate customers merged on 2026-08-06 came from right here, all
// created in the preceding three weeks — ECK490, JEA489, LAI492, PAV494,
// PER488, WAT495, HUA493, HUA192, MIK278. Every one had the same fingerprint:
// cms_account_id = '', no CS number, no jobs, no hours. Somebody linking a job
// typed a customer who already existed, and V9 happily made a second one.
//
// Now it looks first. An exact normalized-name hit returns the existing
// customer outright. A fuzzy hit is REPORTED, not auto-merged — "Sainati" vs
// "Santini" is a real pair of different people, so silently binding to the
// wrong customer would be worse than the duplicate. The caller decides.
//
// Pass { force: true } to insert anyway once the person has seen the warning.
customersApi.createLoose = async function(partial, opts = {}) {
  if (!partial?.name || !partial.name.trim()) {
    throw new Error('Customer name is required');
  }
  const wanted = partial.name.trim();

  if (!opts.force) {
    // Only live rows — a merged-away duplicate must never be handed back as
    // if it were the customer.
    const { data: existing } = await supabase
      .from('customers')
      .select('id, name, short_code, address, phone, cs_number')
      .is('merged_into', null)
      .limit(1000);

    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(wanted);

    const exact = (existing || []).find(c => norm(c.name) === target);
    if (exact) return exact;                       // same customer, already here

    // SAME PHONE OR SAME STREET IS THE SAME CUSTOMER.
    // The name check alone let Rick Ferreri exist THREE times — "Rick Ferreri",
    // "FERRERI, RICK" and "Sales Rick Ferrari" share no normalised name, so
    // nothing matched. All three carried 3021 Morab Ct. Five duplicate pairs
    // found on 2026-08-16 were all caught by phone or street, none by name.
    const digits = s => (s || '').replace(/\D/g, '').slice(-10);
    const street = s => (s || '').split(',')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

    const wantPhone = digits(partial.phone);
    if (wantPhone.length === 10) {
      const byPhone = (existing || []).find(c => digits(c.phone) === wantPhone);
      if (byPhone) return byPhone;
    }

    const wantStreet = street(partial.address);
    if (wantStreet.length > 6) {
      const byStreet = (existing || []).find(c => street(c.address) === wantStreet);
      if (byStreet) return byStreet;
    }

    // Deliberately NOT importing utils/fuzzyMatch.js: that module imports THIS
    // one, and a circular import can leave the function undefined at init.
    // Token overlap is enough for the case that actually bites — a name typed
    // slightly differently from one already on file.
    const tokens = s => new Set(
      (s || '').toLowerCase().split(/[^a-z0-9]+/)
        .filter(t => t.length > 2 && !['llc','inc','llp','the','and','corp'].includes(t))
    );
    const want = tokens(wanted);
    const overlaps = (name) => {
      const other = tokens(name);
      if (!want.size || !other.size) return false;
      let hit = 0;
      for (const t of want) if (other.has(t)) hit++;
      return hit / Math.min(want.size, other.size) >= 0.6;
    };

    const near = (existing || []).filter(c => overlaps(c.name)).slice(0, 5);
    if (near.length) {
      const err = new Error(
        `"${wanted}" looks like it may already exist: ` +
        near.map(c => `${c.short_code} ${c.name}`).join(', ')
      );
      err.code = 'POSSIBLE_DUPLICATE';
      err.candidates = near;                       // caller can offer "use this one"
      throw err;
    }
  }

  const payload = {
    name: wanted,
    phone: partial.phone?.trim() || null,
    address: partial.address?.trim() || null,
    email: partial.email?.trim() || null,
    // '' not null was the tell that marked every shell row. Store null.
    cms_account_id: partial.cms_account_id?.trim() || null,
    is_active: true,
  };
  const { data, error } = await supabase.from('customers').insert([payload]).select().single();
  if (error) throw error;
  return data;
};

// ============================================
// JOB LINKING API
// ============================================
// Operators use this to associate return cards (and their time entries)
// with a P- or S- numbered job. Techs never interact with this directly.

export const jobLinkingApi = {

  // Search jobs that have a P- or S-number, by customer name or number.
  // Returns jobs with their identifier so operators can pick the right one.
  async search(query) {
    const q = (query || '').trim();
    let req = supabase
      .from('jobs')
      .select('id, customer_name, customer_address, p_number, s_number, status, job_type, issue, created_at')
      .or('p_number.not.is.null,s_number.not.is.null')
      .order('created_at', { ascending: false })
      .limit(30);

    if (q) {
      const safe = q.replace(/[%*()]/g, '');
      req = supabase
        .from('jobs')
        .select('id, customer_name, customer_address, p_number, s_number, status, job_type, issue, created_at')
        .or(`p_number.not.is.null,s_number.not.is.null`)
        .or(`customer_name.ilike.%${safe}%,p_number.ilike.%${safe}%,s_number.ilike.%${safe}%,issue.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(30);
    }

    const { data, error } = await req;
    if (error) throw error;
    return data || [];
  },

  // Link a return card to a job. The DB trigger propagates job_id to
  // the associated time_entry automatically.
  async linkReturnCard(returnCardId, jobId) {
    const { data, error } = await supabase
      .from('return_cards')
      .update({ job_id: jobId })
      .eq('id', returnCardId)
      .select('id, job_id')
      .single();
    if (error) throw error;
    return data;
  },

  // Remove a job link from a return card.
  async unlinkReturnCard(returnCardId) {
    const { data, error } = await supabase
      .from('return_cards')
      .update({ job_id: null })
      .eq('id', returnCardId)
      .select('id')
      .single();
    if (error) throw error;
    return data;
  },

  // Assign an S-number to a job (called when board detects a tech calendar event).
  async assignSNumber(jobId) {
    const { data, error } = await supabase.rpc('assign_s_number', { target_job_id: jobId });
    if (error) throw error;
    return data; // returns the s_number string
  },

  // Create a new job and assign the next P-number via the DB trigger.
  // INSERT with status 'new', then UPDATE to 'estimate_sent' so the trigger fires.
  async createProjectJob(customerName) {
    const { data: job, error: insertErr } = await supabase
      .from('jobs')
      .insert([{ customer_name: customerName, status: 'new', job_type: 'project' }])
      .select()
      .single();
    if (insertErr) throw insertErr;

    const { data: updated, error: updateErr } = await supabase
      .from('jobs')
      .update({ status: 'estimate_sent' })
      .eq('id', job.id)
      .select('id, customer_name, p_number, s_number, status, job_type')
      .single();
    if (updateErr) throw updateErr;
    return updated; // p_number is now set by trigger
  },

  // Mark all return cards in a group as 'quick_note' — removes them from the board queue.
  async markAsQuickNote(cardIds) {
    const { error } = await supabase
      .from('return_cards')
      .update({ status: 'quick_note' })
      .in('id', cardIds);
    if (error) throw error;
  },

  // Get pending return cards (with job link if set). Excludes quick_note.
  async getPendingReturnCards() {
    const { data, error } = await supabase
      .from('return_cards')
      .select('*, job:jobs(id, customer_name, p_number, s_number, status, job_type)')
      .in('status', ['pending_schedule'])
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },
};


// ============================================
// REALTIME
// ============================================

export const subscriptions = {
  onJobsChange(callback) {
    return supabase.channel('jobs-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, callback).subscribe();
  },
  unsubscribe(subscription) { supabase.removeChannel(subscription); }
};

export default supabase;
