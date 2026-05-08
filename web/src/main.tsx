import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

function postLog(body: { level: string; msg: string; stack?: string; url?: string }) {
  try {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort
  }
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    postLog({
      level: 'error',
      msg: `react: ${error.message}`,
      stack: `${error.stack ?? ''}\n--componentStack--\n${info.componentStack ?? ''}`,
      url: location.href,
    });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2>Render error</h2>
          <p>{this.state.error.message}</p>
          <pre style={{ fontSize: 12, opacity: 0.7 }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
          {' '}
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener('error', e => {
  postLog({
    level: 'error',
    msg: e.message || 'window.error',
    stack: e.error?.stack,
    url: location.href,
  });
});
window.addEventListener('unhandledrejection', e => {
  const reason = e.reason;
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  postLog({ level: 'error', msg: `unhandledrejection: ${msg}`, stack, url: location.href });
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
