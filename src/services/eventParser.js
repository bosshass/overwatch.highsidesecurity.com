// ============================================
// OVERWATCH V3 - Event Parser
// ============================================
// THE most important file. This is the contract.
// Reads any event format (V2, rogue, V3) → structured object.
// Writes V3 format → event title + description.
//
// V3 EVENT FORMAT:
//   Title:  [TAG] Customer Name
//   Title:  [TAG #1247] Customer Name
//   Desc:   Structured key:value block + notes + deep link
//
// This file is the ONLY place that knows about event format.
// Everything else works with parsed objects.

// ============================================
// VALID TAGS (title prefixes)
// ============================================

export const TAGS = {
  SERVICE:   'SERVICE',
  COMPLETE:  'COMPLETE',
  BILLED:    'BILLED',
  RETURN:    'RETURN',
  ESTIMATE:  'ESTIMATE',
  NC:        'NC',
  DEAD:      'DEAD',
  PERSONAL:  'PERSONAL',
  IGNORE:    'IGNORE',
  SOLD:      'SOLD',
  LOST:      'LOST',
};

// Tags that mean "active work"
export const ACTIVE_TAGS = [TAGS.SERVICE, TAGS.RETURN, TAGS.ESTIMATE];

// Tags that mean "done, needs billing"
export const BILLING_TAGS = [TAGS.COMPLETE];

// Tags that mean "fully done"
export const CLOSED_TAGS = [TAGS.BILLED, TAGS.NC, TAGS.DEAD, TAGS.SOLD, TAGS.LOST];

// Tags to skip in operator views
export const SKIP_TAGS = [TAGS.PERSONAL, TAGS.IGNORE];

// ============================================
// PARSE: Event → Structured Object
// ============================================

const TAG_REGEX = /^\[([A-Z\s]+?)(?:\s*#(\d+))?\]\s*(.*)$/;
const V2_JOB_REGEX = /^J-\d{8}-\d{3}\s*/;
const JUCE_MARKER = '⚡ Managed by JUC-E';
const OW_MARKER = '🔗 OPEN IN OVERWATCH:';
const FIELD_REGEX = /^(CUSTOMER|PHONE|ADDRESS|ISSUE|GATE|PANEL|JOB)\s*:\s*(.+)$/im;

export function parseEvent(event) {
  const summary = event.summary || event._raw?.summary || '(No title)';
  const description = event.description || event._raw?.description || '';

  const parsed = {
    // Identity
    id: event.id,
    calendarId: event.calendarId,
    calendarName: event.calendarName || '',
    calendarColor: event.calendarColor || null,

    // Time
    start: event.start,
    end: event.end,
    allDay: event.allDay || false,

    // Tag & status
    tag: null,
    jobNumber: null,
    customerName: '',

    // Fields (from description or title)
    phone: '',
    address: event.location || '',
    issue: '',
    gateCode: '',
    panelPassword: '',

    // Notes
    notes: [],
    latestNote: '',

    // Deep link
    deepLink: '',

    // Classification
    format: 'unknown',  // 'v3' | 'v2' | 'rogue'
    isTagged: false,
    isJuce: false,       // Has JUC-E/Overwatch marker in description
    hasRequiredFields: false,
    missingFields: [],

    // Raw
    rawSummary: summary,
    rawDescription: description,
    _raw: event._raw || null,
  };

  // ---- Parse title ----
  const tagMatch = summary.match(TAG_REGEX);
  if (tagMatch) {
    parsed.tag = tagMatch[1].trim();
    parsed.jobNumber = tagMatch[2] ? parseInt(tagMatch[2]) : null;
    parsed.customerName = tagMatch[3].trim();
    parsed.isTagged = true;
    parsed.format = 'v3';
  } else if (V2_JOB_REGEX.test(summary)) {
    // V2 format: J-20260115-001 Customer Name
    const cleaned = summary.replace(V2_JOB_REGEX, '').trim();
    parsed.customerName = cleaned || summary;
    parsed.format = 'v2';
  } else {
    // Rogue — no tag, no V2 prefix
    parsed.customerName = summary.trim();
    parsed.format = 'rogue';
  }

  // ---- Parse description ----
  parsed.isJuce = description.includes(JUCE_MARKER) || description.includes(OW_MARKER) || description.includes('Managed by JUC-E');

  // Extract structured fields
  const lines = description.split('\n');
  const noteLines = [];
  let inNotes = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Deep link
    if (trimmed.startsWith('🔗 OPEN IN OVERWATCH:') || trimmed.startsWith('OPEN IN JUC-E:') || trimmed.startsWith('OPEN IN OVERWATCH:')) {
      const url = trimmed.split(':').slice(1).join(':').trim();
      parsed.deepLink = url;
      continue;
    }

    // Skip markers
    if (trimmed === JUCE_MARKER || trimmed === '---' || trimmed === '') {
      if (trimmed === '---') inNotes = true;
      continue;
    }

    // Structured fields
    if (!inNotes) {
      const fieldMatch = trimmed.match(/^(?:📍|📞|🚪|🔐)?\s*(CUSTOMER|PHONE|ADDRESS|ISSUE|GATE|PANEL|JOB)\s*[:：]\s*(.+)$/i);
      if (fieldMatch) {
        const key = fieldMatch[1].toUpperCase();
        const val = fieldMatch[2].trim();
        if (key === 'CUSTOMER' && !parsed.customerName) parsed.customerName = val;
        if (key === 'PHONE') parsed.phone = val;
        if (key === 'ADDRESS') parsed.address = val;
        if (key === 'ISSUE') parsed.issue = val;
        if (key === 'GATE') parsed.gateCode = val;
        if (key === 'PANEL') parsed.panelPassword = val;
        if (key === 'JOB' && !parsed.jobNumber) {
          const num = val.replace(/[^0-9]/g, '');
          if (num) parsed.jobNumber = parseInt(num);
        }
        continue;
      }

      // V2 format: "📍 123 Main St" without label
      if (trimmed.startsWith('📍')) { parsed.address = parsed.address || trimmed.replace('📍', '').trim(); continue; }
      if (trimmed.startsWith('📞')) { parsed.phone = parsed.phone || trimmed.replace('📞', '').trim(); continue; }
      if (trimmed.startsWith('🚪')) { parsed.gateCode = parsed.gateCode || trimmed.replace('🚪 Gate:', '').replace('🚪', '').trim(); continue; }
      if (trimmed.startsWith('🔐')) { parsed.panelPassword = parsed.panelPassword || trimmed.replace('🔐 Panel:', '').replace('🔐', '').trim(); continue; }
      if (trimmed.startsWith('Issue:')) { parsed.issue = parsed.issue || trimmed.replace('Issue:', '').trim(); continue; }
      if (trimmed.startsWith('JOB #')) {
        const num = trimmed.replace(/[^0-9]/g, '');
        if (num && !parsed.jobNumber) parsed.jobNumber = parseInt(num);
        continue;
      }
    }

    // Notes section
    if (inNotes && trimmed && !trimmed.startsWith('--- Latest Note')) {
      noteLines.push(trimmed);
    }
  }

  // Also check for V2 "--- Latest Note ---" format
  const noteIdx = description.indexOf('--- Latest Note ---');
  if (noteIdx !== -1) {
    const noteText = description.substring(noteIdx + 19).replace(JUCE_MARKER, '').trim();
    if (noteText && noteLines.length === 0) {
      noteLines.push(noteText);
    }
  }

  parsed.notes = noteLines;
  parsed.latestNote = noteLines[noteLines.length - 1] || '';

  // Use event location if no address parsed from description
  if (!parsed.address && event.location) {
    parsed.address = event.location;
  }

  // ---- Required fields check ----
  const missing = [];
  if (!parsed.customerName) missing.push('customer');
  if (!parsed.phone) missing.push('phone');
  if (!parsed.address) missing.push('address');
  if (!parsed.issue) missing.push('issue');
  parsed.missingFields = missing;
  parsed.hasRequiredFields = missing.length === 0;

  // If v2 format had JUC-E marker, upgrade classification
  if (parsed.format === 'rogue' && parsed.isJuce) {
    parsed.format = 'v2';
  }

  return parsed;
}

// ============================================
// FORMAT: Structured Object → V3 Event
// ============================================

export function formatTitle(parsed, tag) {
  const useTag = tag || parsed.tag || TAGS.SERVICE;
  const jobPart = parsed.jobNumber ? ` #${parsed.jobNumber}` : '';
  const name = parsed.customerName || 'Unknown';
  return `[${useTag}${jobPart}] ${name}`;
}

export function formatDescription(parsed, appUrl = 'https://overwatch.highsidesecurity.com') {
  const lines = [];

  if (parsed.customerName) lines.push(`CUSTOMER: ${parsed.customerName}`);
  if (parsed.phone)        lines.push(`PHONE: ${parsed.phone}`);
  if (parsed.address)      lines.push(`ADDRESS: ${parsed.address}`);
  if (parsed.issue)        lines.push(`ISSUE: ${parsed.issue}`);
  if (parsed.gateCode)     lines.push(`GATE: ${parsed.gateCode}`);
  if (parsed.panelPassword) lines.push(`PANEL: ${parsed.panelPassword}`);

  if (parsed.notes.length > 0) {
    lines.push('');
    lines.push('--- NOTES ---');
    for (const note of parsed.notes) {
      lines.push(note);
    }
  }

  lines.push('');
  if (parsed.id) {
    lines.push(`🔗 OPEN IN OVERWATCH: ${appUrl}/job/${parsed.id}`);
  }
  lines.push('⚡ Managed by OVERWATCH');

  return lines.join('\n');
}

// ============================================
// CLASSIFY: Bulk classification for migration
// ============================================

export function classifyEvents(events) {
  const results = {
    v3: [],         // Already tagged V3 format
    v2: [],         // V2 format (has JUC-E markers but no tags)
    rogue: [],      // No tags, no markers — JR phone entries, personal events
    personal: [],   // Tagged [PERSONAL] or [IGNORE]
    cancelled: [],  // Empty/cancelled
    total: events.length,
  };

  for (const event of events) {
    const parsed = parseEvent(event);

    if (!parsed.customerName && !parsed.rawSummary.trim()) {
      results.cancelled.push(parsed);
      continue;
    }

    if (parsed.format === 'v3') {
      if (SKIP_TAGS.includes(parsed.tag)) {
        results.personal.push(parsed);
      } else {
        results.v3.push(parsed);
      }
    } else if (parsed.format === 'v2') {
      results.v2.push(parsed);
    } else {
      results.rogue.push(parsed);
    }
  }

  return results;
}

// ============================================
// MIGRATION: Generate V3 title/desc for an event
// ============================================

export function generateV3Rewrite(parsed, options = {}) {
  const tag = options.tag || parsed.tag || TAGS.SERVICE;
  const jobNumber = options.jobNumber || parsed.jobNumber;

  const rewrite = {
    ...parsed,
    tag,
    jobNumber,
  };

  return {
    summary: formatTitle(rewrite, tag),
    description: formatDescription(rewrite, options.appUrl),
    // What changed
    changes: {
      titleChanged: rewrite.rawSummary !== formatTitle(rewrite, tag),
      descChanged: true, // Always rewrite description for consistency
      tagAdded: !parsed.isTagged,
      jobNumberAdded: !parsed.jobNumber && !!jobNumber,
    },
  };
}

// ============================================
// DISPLAY HELPERS
// ============================================

export function getTagColor(tag) {
  const colors = {
    [TAGS.SERVICE]:  '#4a90d9',  // blue
    [TAGS.COMPLETE]: '#4caf50',  // green
    [TAGS.BILLED]:   '#616161',  // gray
    [TAGS.RETURN]:   '#cc5500',  // orange
    [TAGS.ESTIMATE]: '#f6bf26',  // gold
    [TAGS.NC]:       '#8e8e8e',  // gray
    [TAGS.DEAD]:     '#555555',  // dark gray
    [TAGS.PERSONAL]: '#6633cc',  // purple
    [TAGS.IGNORE]:   '#444444',  // dark
    [TAGS.SOLD]:     '#0b8043',  // dark green
    [TAGS.LOST]:     '#cc1111',  // red
  };
  return colors[tag] || '#5a7a9a';
}

export function getFormatLabel(format) {
  const labels = {
    v3: 'V3 Tagged',
    v2: 'V2 Legacy',
    rogue: 'Rogue',
    unknown: 'Unknown',
  };
  return labels[format] || format;
}

export function getFormatColor(format) {
  const colors = {
    v3: '#4caf50',
    v2: '#4a90d9',
    rogue: '#cc1111',
    unknown: '#5a7a9a',
  };
  return colors[format] || '#5a7a9a';
}
