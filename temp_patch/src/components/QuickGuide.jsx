// ============================================
// Overwatch - QuickGuide (Visual Walkthrough)
// ============================================
// Product tour with illustrated UI mockups.
// Minimal text, visual callouts pointing at stuff.

import { useState } from 'react';
import { TECH_COLORS } from '../config/calendars.js';

// Callout bubble with arrow
function Callout({ text, top, left, right, bottom, color = '#00c8e8', arrow = 'down' }) {
  const pos = {};
  if (top !== undefined) pos.top = top;
  if (left !== undefined) pos.left = left;
  if (right !== undefined) pos.right = right;
  if (bottom !== undefined) pos.bottom = bottom;
  const arrows = {
    down: { bottom: '-6px', left: '50%', transform: 'translateX(-50%)', borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${color}` },
    up: { top: '-6px', left: '50%', transform: 'translateX(-50%)', borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: `6px solid ${color}` },
    left: { left: '-6px', top: '50%', transform: 'translateY(-50%)', borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: `6px solid ${color}` },
    right: { right: '-6px', top: '50%', transform: 'translateY(-50%)', borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: `6px solid ${color}` },
  };
  return (
    <div style={{ position: 'absolute', ...pos, zIndex: 5, background: color, color: '#000', padding: '4px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: '700', whiteSpace: 'nowrap', boxShadow: `0 0 12px ${color}50` }}>
      {text}
      <div style={{ position: 'absolute', ...arrows[arrow], width: 0, height: 0 }} />
    </div>
  );
}

// Mini phone frame
function Phone({ children }) {
  return (
    <div style={{ background: '#0f1729', borderRadius: '16px', border: '2px solid #1e293b', overflow: 'hidden', width: '100%', maxWidth: '260px', margin: '0 auto' }}>
      {children}
    </div>
  );
}

function MockHeader({ callout }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #1e293b', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        <span style={{ fontSize: '12px' }}>🛡️</span>
        <span style={{ color: '#00c8e8', fontSize: '10px', fontWeight: '700' }}>Overwatch</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', position: 'relative' }}>
        <span style={{ color: '#94a3b8', fontSize: '9px' }}>Sara</span>
        <span style={{ border: '1px solid #334155', borderRadius: '3px', color: '#00c8e8', padding: '1px 4px', fontSize: '9px', fontWeight: '700' }}>?</span>
        <span style={{ border: '1px solid #334155', borderRadius: '3px', color: '#94a3b8', padding: '1px 5px', fontSize: '8px' }}>Out</span>
        {callout && <Callout text={callout} top="-20px" right="0" color="#f59e0b" arrow="down" />}
      </div>
    </div>
  );
}

function Nav({ active = 'calendar', restricted }) {
  const tabs = [
    { id: 'calendar', icon: '📅', label: 'Cal' },
    { id: 'tasks', icon: '📋', label: 'Tasks' },
    { id: 'office', icon: restricted ? '🚫' : '🏢', label: 'Office' },
    { id: 'dashboard', icon: restricted ? '🚫' : '📊', label: 'Stats' },
  ];
  return (
    <div style={{ display: 'flex', justifyContent: 'space-around', padding: '5px 0', borderTop: '1px solid #1e293b' }}>
      {tabs.map(t => (
        <div key={t.id} style={{ textAlign: 'center', opacity: t.id === active ? 1 : 0.4 }}>
          <div style={{ fontSize: '14px' }}>{t.icon}</div>
          <div style={{ fontSize: '7px', color: t.id === active ? '#00c8e8' : '#64748b' }}>{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function MiniCard({ name, status, sColor, age, glow }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: '6px', padding: '6px 8px', marginBottom: '4px', borderLeft: `3px solid ${sColor}`, border: glow ? `1.5px solid #00c8e8` : undefined, borderLeftWidth: '3px', borderLeftColor: sColor }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: '#e2e8f0', fontSize: '9px', fontWeight: '600' }}>{name}</span>
        {age != null && <span style={{ color: age > 4 ? '#ef4444' : '#22c55e', fontSize: '8px', fontWeight: '700' }}>{age}d</span>}
      </div>
      <div style={{ display: 'flex', gap: '3px', marginTop: '2px' }}>
        <span style={{ background: `${sColor}20`, color: sColor, padding: '1px 4px', borderRadius: '3px', fontSize: '7px' }}>{status}</span>
      </div>
    </div>
  );
}

// ============ PAGES ============
const PAGES = [
  // 1 — Welcome
  {
    title: 'Welcome to Overwatch',
    render: () => (
      <div style={{ textAlign: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: '52px', marginBottom: '8px' }}>🛡️</div>
        <div style={{ color: '#00c8e8', fontSize: '26px', fontWeight: '800' }}>Overwatch</div>
        <div style={{ color: '#475569', fontSize: '12px', marginBottom: '20px' }}>DRH Security Operations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left', padding: '0 20px' }}>
          {[
            ['📅', 'Calendar', 'your schedule'],
            ['🔧', 'Work Today', 'today\'s jobs'],
            ['📋', 'Board', 'job pipeline'],
            ['📊', 'Dashboard', 'the numbers'],
            ['💬', 'HelpBot', 'ask anything'],
          ].map(([icon, label, sub], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px', width: '24px', textAlign: 'center' }}>{icon}</span>
              <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{label}</span>
              <span style={{ color: '#64748b', fontSize: '11px' }}>— {sub}</span>
            </div>
          ))}
        </div>
      </div>
    )
  },

  // 2 — Calendar
  {
    title: 'Calendar',
    render: () => (
      <div style={{ position: 'relative' }}>
        <Phone>
          <MockHeader />
          <div style={{ padding: '6px 8px' }}>
            <div style={{ textAlign: 'center', color: '#e2e8f0', fontSize: '10px', fontWeight: '600', marginBottom: '6px' }}>Tue, Feb 11</div>
            <div style={{ position: 'relative' }}>
              <div style={{ background: `${TECH_COLORS.Austin}15`, borderLeft: `3px solid ${TECH_COLORS.Austin}`, borderRadius: '5px', padding: '5px 7px', marginBottom: '3px' }}>
                <div style={{ color: '#e2e8f0', fontSize: '9px', fontWeight: '600' }}>9:00 — Johnson Residence</div>
                <div style={{ color: '#64748b', fontSize: '7px' }}>Fire panel inspection · Austin</div>
              </div>
              <Callout text="Tap → opens job" top="-2px" right="-4px" color="#22c55e" arrow="left" />
            </div>
            <div style={{ background: `${TECH_COLORS.JR}15`, borderLeft: `3px solid ${TECH_COLORS.JR}`, borderRadius: '5px', padding: '5px 7px', marginBottom: '3px' }}>
              <div style={{ color: '#e2e8f0', fontSize: '9px', fontWeight: '600' }}>11:30 — Tooth Zone</div>
              <div style={{ color: '#64748b', fontSize: '7px' }}>Camera install · JR</div>
            </div>
            <div style={{ background: `${TECH_COLORS.Shana}15`, borderLeft: `3px solid ${TECH_COLORS.Shana}`, borderRadius: '5px', padding: '5px 7px', marginBottom: '6px' }}>
              <div style={{ color: '#e2e8f0', fontSize: '9px', fontWeight: '600' }}>2:00 — Eisenhower LLC</div>
              <div style={{ color: '#64748b', fontSize: '7px' }}>Access control · Shana</div>
            </div>
            <div style={{ background: '#1e293b', borderRadius: '6px', padding: '5px 7px', border: '1px dashed #f59e0b30' }}>
              <span style={{ color: '#f59e0b', fontSize: '8px' }}>⚠️ No match?</span>
              <span style={{ color: '#64748b', fontSize: '8px' }}> → Create Job or Open Calendar</span>
            </div>
          </div>
          <Nav active="calendar" />
        </Phone>
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '11px', marginTop: '8px' }}>Events link directly to job forms</div>
      </div>
    )
  },

  // 3 — Tasks + PIN
  {
    title: 'Tasks',
    render: () => (
      <div style={{ position: 'relative' }}>
        <Phone>
          <MockHeader />
          <div style={{ padding: '6px 8px' }}>
            <div style={{ position: 'relative', marginBottom: '6px' }}>
              <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid #334155' }}>
                <div style={{ flex: 1, padding: '4px', textAlign: 'center', background: '#1e293b', color: '#94a3b8', fontSize: '8px' }}>📅 Cal</div>
                <div style={{ flex: 1, padding: '4px', textAlign: 'center', background: '#00c8e815', color: '#00c8e8', fontSize: '8px', fontWeight: '700', borderBottom: '2px solid #00c8e8' }}>📋 Tasks</div>
              </div>
              <Callout text="PIN required" top="-16px" left="50%" color="#f59e0b" arrow="down" />
            </div>
            <MiniCard name="Johnson Residence" status="Scheduled" sColor="#3b82f6" age={1} glow />
            <MiniCard name="Tooth Zone" status="Scheduled" sColor="#3b82f6" age={0} />
            <MiniCard name="Ray, Steve" status="Needs Parts" sColor="#eab308" age={4} />
            <MiniCard name="Lee, Robert" status="Ready" sColor="#22c55e" age={2} />
          </div>
          <Nav active="tasks" />
        </Phone>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '10px' }}>
          <div style={{ background: '#1e293b', borderRadius: '8px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#22c55e', fontSize: '10px' }}>👑</span>
            <span style={{ color: '#94a3b8', fontSize: '9px' }}>Sara: no PIN</span>
          </div>
          <div style={{ background: '#1e293b', borderRadius: '8px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#f59e0b', fontSize: '10px' }}>🔒</span>
            <span style={{ color: '#94a3b8', fontSize: '9px' }}>Techs: PIN to enter</span>
          </div>
        </div>
      </div>
    )
  },

  // 4 — Completing a job
  {
    title: 'Finishing a Job',
    render: () => (
      <div style={{ position: 'relative' }}>
        <Phone>
          <div style={{ padding: '5px 8px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#94a3b8', fontSize: '9px' }}>← Back</span>
            <span style={{ color: '#475569', fontSize: '8px' }}>DRH-0847</span>
          </div>
          <div style={{ padding: '8px' }}>
            <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: '700', marginBottom: '2px' }}>Johnson Residence</div>
            <div style={{ display: 'flex', gap: '3px', marginBottom: '8px' }}>
              <span style={{ background: '#dc2626', color: '#fff', padding: '1px 5px', borderRadius: '3px', fontSize: '7px', fontWeight: '700' }}>🔧 SERVICE</span>
              <span style={{ background: '#3b82f620', color: '#3b82f6', padding: '1px 5px', borderRadius: '3px', fontSize: '7px' }}>Scheduled</span>
            </div>
            <div style={{ position: 'relative', background: '#0c2d1e', border: '1.5px solid #22c55e40', borderRadius: '8px', padding: '8px' }}>
              <Callout text="Pick one" top="-16px" right="8px" color="#22c55e" arrow="down" />
              <div style={{ color: '#22c55e', fontSize: '9px', fontWeight: '700', marginBottom: '6px' }}>✅ HOW'D IT GO?</div>
              {[
                ['✅ All Fixed', '#22c55e', '→ To Bill'],
                ['🔄 Return Needed', '#f59e0b', '→ schedule again'],
                ['💰 Sales Opp', '#eab308', '→ estimate pipeline'],
                ['🚫 No Charge', '#6b7280', '→ skip billing'],
              ].map(([label, color, dest], i) => (
                <div key={i} style={{ background: `${color}10`, border: `1px solid ${color}40`, borderRadius: '5px', padding: '5px 7px', marginBottom: '3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color, fontSize: '9px', fontWeight: '700' }}>{label}</span>
                  <span style={{ color: '#475569', fontSize: '7px' }}>{dest}</span>
                </div>
              ))}
            </div>
          </div>
        </Phone>
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '11px', marginTop: '8px' }}>
          Opens time entry → one submit does everything
        </div>
      </div>
    )
  },

  // 5 — Time capture modal
  {
    title: 'Time Entry',
    render: () => (
      <div style={{ position: 'relative' }}>
        <Phone>
          <div style={{ background: 'rgba(0,0,0,0.85)', padding: '14px 8px' }}>
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', borderTop: '3px solid #22c55e' }}>
              <div style={{ color: '#e2e8f0', fontSize: '11px', fontWeight: '700' }}>✅ All Fixed</div>
              <div style={{ color: '#64748b', fontSize: '9px', marginBottom: '10px' }}>Johnson Residence</div>
              <div style={{ position: 'relative' }}>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '8px', marginBottom: '2px' }}>🕐 Arrived</div>
                  <div style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: '5px', padding: '6px', color: '#e2e8f0', fontSize: '11px' }}>9:15 AM</div>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '8px', marginBottom: '2px' }}>🕐 Departed</div>
                  <div style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: '5px', padding: '6px', color: '#e2e8f0', fontSize: '11px' }}>10:45 AM</div>
                </div>
                <Callout text="Auto-fills now" bottom="60px" right="-6px" color="#00c8e8" arrow="left" />
                <div style={{ textAlign: 'center', color: '#00c8e8', fontSize: '11px', fontWeight: '700', marginBottom: '8px' }}>⏱️ 1.5 hours</div>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ color: '#94a3b8', fontSize: '8px', marginBottom: '2px' }}>📝 Notes</div>
                  <div style={{ background: '#0f1729', border: '1px solid #334155', borderRadius: '5px', padding: '6px', color: '#94a3b8', fontSize: '9px', minHeight: '24px' }}>Replaced panel battery...</div>
                </div>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <div style={{ flex: 1, background: '#334155', borderRadius: '5px', padding: '6px', textAlign: 'center', color: '#94a3b8', fontSize: '9px' }}>Cancel</div>
                  <div style={{ flex: 2, background: '#22c55e', borderRadius: '5px', padding: '6px', textAlign: 'center', color: '#000', fontSize: '10px', fontWeight: '700' }}>Submit ✓</div>
                </div>
              </div>
            </div>
          </div>
        </Phone>
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: '11px', marginTop: '8px' }}>
          Time + notes + status change — one tap
        </div>
      </div>
    )
  },

  // 6 — The flow
  {
    title: 'How a Job Moves',
    render: () => (
      <div style={{ padding: '0 4px' }}>
        {[
          ['🆕', 'NEW', '#ef4444', 'call comes in'],
          null,
          ['✅', 'READY', '#22c55e', 'has all info'],
          null,
          ['📅', 'SCHEDULED', '#3b82f6', 'on the calendar'],
          null,
          ['🔧', 'COMPLETE', '#10b981', 'tech picks outcome ↓'],
        ].map((item, i) => {
          if (!item) return <div key={i} style={{ textAlign: 'center', color: '#334155', fontSize: '12px', lineHeight: '1.2' }}>↓</div>;
          const [icon, label, color, note] = item;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: `${color}08`, border: `1px solid ${color}25`, borderRadius: '6px', padding: '5px 8px', marginBottom: '1px' }}>
              <span style={{ fontSize: '13px' }}>{icon}</span>
              <span style={{ color, fontSize: '11px', fontWeight: '700', flex: 1 }}>{label}</span>
              <span style={{ color: '#475569', fontSize: '9px' }}>{note}</span>
            </div>
          );
        })}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', marginTop: '3px' }}>
          {[
            ['✅', 'All Fixed', '#22c55e', 'TO BILL'],
            ['🔄', 'Return', '#f59e0b', 'RETURN'],
            ['💰', 'Estimate', '#eab308', 'PIPELINE'],
            ['🚫', 'No Charge', '#6b7280', 'BILLED'],
          ].map(([icon, label, color, dest], i) => (
            <div key={i} style={{ background: `${color}08`, border: `1px solid ${color}25`, borderRadius: '5px', padding: '4px 6px', textAlign: 'center' }}>
              <span style={{ fontSize: '12px' }}>{icon}</span>
              <div style={{ color, fontSize: '8px', fontWeight: '700' }}>{label}</div>
              <div style={{ color: '#475569', fontSize: '7px' }}>→ {dest}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', color: '#334155', fontSize: '12px', marginTop: '2px' }}>↓</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#6b728008', border: '1px solid #6b728025', borderRadius: '6px', padding: '5px 8px' }}>
          <span style={{ fontSize: '13px' }}>📁</span>
          <span style={{ color: '#6b7280', fontSize: '11px', fontWeight: '700', flex: 1 }}>ARCHIVED</span>
          <span style={{ color: '#475569', fontSize: '9px' }}>🔒 operator only</span>
        </div>
      </div>
    )
  },

  // 7 — Office board
  {
    title: 'Office Board',
    render: () => (
      <div style={{ position: 'relative' }}>
        <Phone>
          <MockHeader />
          <div style={{ padding: '6px 8px' }}>
            <div style={{ display: 'flex', gap: '3px', marginBottom: '4px', position: 'relative' }}>
              {[
                ['New', 35, '#ef4444', true],
                ['Waiting', 4, '#f59e0b'],
                ['Sched', 32, '#3b82f6'],
                ['To Bill', 3, '#8b5cf6'],
              ].map(([label, count, color, active], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '2px', background: active ? `${color}15` : '#1e293b', border: `1px solid ${active ? color : '#334155'}`, borderRadius: '10px', padding: '2px 6px' }}>
                  <span style={{ color: active ? color : '#94a3b8', fontSize: '8px', fontWeight: '600' }}>{label}</span>
                  <span style={{ background: color, color: '#fff', borderRadius: '6px', padding: '0 3px', fontSize: '7px', fontWeight: '700' }}>{count}</span>
                </div>
              ))}
              <Callout text="Filter by status" top="-16px" left="4px" color="#00c8e8" arrow="down" />
            </div>
            <div style={{ display: 'flex', gap: '3px', marginBottom: '6px', position: 'relative' }}>
              {[
                { name: 'All', color: '#00c8e8', active: true },
                { name: 'Austin', color: TECH_COLORS.Austin },
                { name: 'JR', color: TECH_COLORS.JR },
                { name: 'Shana', color: TECH_COLORS.Shana },
              ].map((t, i) => (
                <div key={i} style={{ background: t.active ? `${t.color}15` : '#1e293b', borderRadius: '10px', padding: '2px 6px', border: `1px solid ${t.active ? t.color : '#334155'}` }}>
                  <span style={{ color: t.active ? t.color : t.color, fontSize: '8px', fontWeight: '600' }}>{t.name}</span>
                </div>
              ))}
              <Callout text="Filter by tech" top="-16px" right="4px" color="#00c8e8" arrow="down" />
            </div>
            <MiniCard name="Grease Monkey" status="New" sColor="#ef4444" age={3} />
            <MiniCard name="Ray, Steve" status="New" sColor="#ef4444" age={5} />
            <MiniCard name="Lee, Robert" status="Ready" sColor="#22c55e" age={2} />
          </div>
          <Nav active="office" />
        </Phone>
      </div>
    )
  },

  // 8 — Who gets what
  {
    title: 'Who Gets What',
    render: () => (
      <div style={{ padding: '0 2px' }}>
        {[
          { icon: '👑', role: 'Owner', who: 'JR', color: TECH_COLORS.JR, tags: ['Everything', 'Dashboard', 'P&L', 'Scheduler'], pin: null },
          { icon: '📋', role: 'Operator', who: 'Sara / info@', color: '#00c8e8', tags: ['Everything', 'Board', 'Billing', 'Schedule'], pin: null },
          { icon: '🔧', role: 'Tech', who: 'Austin', color: TECH_COLORS.Austin, tags: ['Calendar', 'Work Today', 'Own jobs'], pin: null },
        ].map((r, i) => (
          <div key={i} style={{ background: '#1e293b', borderRadius: '8px', padding: '8px 10px', marginBottom: '6px', borderLeft: `3px solid ${r.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '14px' }}>{r.icon}</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: '700' }}>{r.role}</span>
              </div>
              <span style={{ color: '#64748b', fontSize: '9px' }}>{r.who}</span>
            </div>
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {r.tags.map((t, j) => (
                <span key={j} style={{ background: `${r.color}12`, color: r.color, padding: '1px 5px', borderRadius: '3px', fontSize: '8px', fontWeight: '600' }}>{t}</span>
              ))}
              {r.pin && <span style={{ color: '#475569', fontSize: '8px', marginLeft: '2px' }}>🔑 {r.pin}</span>}
            </div>
          </div>
        ))}
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '10px', textAlign: 'center', marginTop: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Tap <span style={{ color: '#00c8e8', fontWeight: '700' }}>?</span> anytime to reopen this</div>
          <div style={{ color: '#64748b', fontSize: '10px', marginTop: '3px' }}>💬 HelpBot has wellness resources too</div>
        </div>
      </div>
    )
  },
];

export default function QuickGuide({ onClose }) {
  const [page, setPage] = useState(0);
  const current = PAGES[page];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 500,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '16px', overflowY: 'auto'
    }}>
      <div style={{
        background: '#0f1729', borderRadius: '20px', padding: '18px 14px',
        width: '100%', maxWidth: '340px', position: 'relative', border: '1px solid #1e293b'
      }}>
        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: '10px', right: '12px', background: 'none', border: 'none', color: '#475569', fontSize: '16px', cursor: 'pointer', zIndex: 10 }}>✕</button>

        {/* Title */}
        <div style={{ color: '#334155', fontSize: '9px', letterSpacing: '0.5px' }}>{page + 1} / {PAGES.length}</div>
        <h2 style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '800', margin: '2px 0 12px 0' }}>{current.title}</h2>

        {/* Content */}
        <div style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {current.render()}
        </div>

        {/* Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', margin: '12px 0 10px' }}>
          {PAGES.map((_, i) => (
            <button key={i} onClick={() => setPage(i)} style={{
              width: i === page ? '16px' : '6px', height: '6px', borderRadius: '3px', border: 'none', cursor: 'pointer',
              background: i === page ? '#00c8e8' : '#334155', transition: 'all 0.2s'
            }} />
          ))}
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
            style={{ flex: 1, background: '#1e293b', color: page === 0 ? '#334155' : '#e2e8f0', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '12px', cursor: page === 0 ? 'default' : 'pointer' }}>←</button>
          {page < PAGES.length - 1 ? (
            <button onClick={() => setPage(page + 1)}
              style={{ flex: 2, background: '#00c8e8', color: '#000', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Next</button>
          ) : (
            <button onClick={onClose}
              style={{ flex: 2, background: '#22c55e', color: '#000', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Let's Go ✓</button>
          )}
        </div>
      </div>
    </div>
  );
}
