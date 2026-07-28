// ============================================
// Jovelin — Error boundary
// ============================================
// Without this, any uncaught error during render unmounts the whole React
// tree and leaves an empty page — a blank dark screen with no indication
// of what happened, no way to recover short of clearing storage, and
// nothing to report. That's exactly what happened once already.
//
// Now a crash shows what broke, and offers the two things that actually
// get someone moving again: reload, or clear the local session and start
// clean.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[jovelin] render crash:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const detail = [
      this.state.error?.message || String(this.state.error),
      this.state.info?.componentStack || '',
    ].filter(Boolean).join('\n\n');

    return (
      <div style={{ minHeight: '100vh', background: '#0f1729', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#1e293b', borderRadius: 14, padding: 28, maxWidth: 640, width: '100%' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Something broke while loading</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
            This is a bug, not something you did. The details below say what went wrong — copy them if you're reporting it.
          </div>

          <pre style={{
            background: '#0f1729', border: '1px solid #334155', borderRadius: 8, padding: 12,
            color: '#f87171', fontSize: 11, lineHeight: 1.5, maxHeight: 240, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 16px',
          }}>{detail}</pre>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => window.location.reload()}
              style={{ background: '#0D4F5C', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>
              Reload
            </button>
            <button onClick={() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} window.location.href = '/'; }}
              style={{ background: 'none', color: '#94a3b8', border: '1px solid #334155', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}>
              Sign out and start clean
            </button>
          </div>
        </div>
      </div>
    );
  }
}
