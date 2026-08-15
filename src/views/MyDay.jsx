// ============================================
// MyDay — the first screen.
// ============================================
// The visit prompt first, then the same task stack that /tasks renders. This
// file used to carry its own copy of the task card, which meant every change
// to how a task looks had to be made twice and the two drifted immediately.
// One card, one place.
// ============================================

import DidYouGo from '../components/DidYouGo.jsx';
import TaskStack from './TaskStack.jsx';

export default function MyDay({ userEmail, userName, accessToken, onNavigate, isOperator = false }) {
  return (
    <div style={{ background: '#07111f', minHeight: '100vh', color: '#edf4ff', paddingBottom: 70 }}>
      <div style={{ padding: '18px 16px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.3 }}>
          {userName ? `Morning, ${userName}` : 'Your day'}
        </div>
      </div>

      {/* Hours that never became a time entry are the only thing on this
          screen actively losing money. They go first. */}
      <div style={{ padding: '16px 16px 0' }}>
        <DidYouGo userEmail={userEmail} userName={userName} />
      </div>

      <div style={{ padding: '6px 16px 0' }}>
        <TaskStack userEmail={userEmail} userName={userName}
          onNavigate={onNavigate} isOperator={isOperator} embedded />
      </div>

      <div style={{ padding: '4px 16px 0' }}>
        <button onClick={() => onNavigate?.('/board')}
          style={{ width: '100%', marginTop: 10, padding: '13px 0', borderRadius: 12,
                   background: 'transparent', border: 'none', color: '#8ea0b8',
                   fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Open the board
        </button>
      </div>
    </div>
  );
}
