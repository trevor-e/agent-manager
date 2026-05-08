import { useEffect, useState } from 'react';
import { api } from './api';
import { KeysModal } from './components/KeysModal';
import { requestNotificationPermission } from './notifications';
import { ListPage } from './pages/List';
import { DetailPage } from './pages/Detail';
import { LinearPage } from './pages/Linear';

function getRoute(): { name: 'list' } | { name: 'detail'; id: string } | { name: 'linear' } {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/linear') return { name: 'linear' };
  const m = path.match(/^\/sessions\/(.+)$/);
  if (m) return { name: 'detail', id: m[1] };
  return { name: 'list' };
}

export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [route, setRoute] = useState(getRoute);
  const [linearConfigured, setLinearConfigured] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    const onChange = () => setRoute(getRoute());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  useEffect(() => {
    api.linearStatus().then(r => setLinearConfigured(r.configured)).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => {
      requestNotificationPermission();
      document.removeEventListener('click', handler);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a
          href="/"
          className="brand"
          onClick={e => {
            e.preventDefault();
            navigate('/');
          }}
        >
          claude-manager
        </a>
        {linearConfigured && (
          <a
            href="/linear"
            className={'topbar-link' + (route.name === 'linear' ? ' topbar-link-active' : '')}
            onClick={e => {
              e.preventDefault();
              navigate('/linear');
            }}
          >
            Linear
          </a>
        )}
        <div className="grow" />
        <span className="muted">{route.name === 'detail' ? `session ${route.id.slice(0, 8)}` : ''}</span>
        <button className="ghost" onClick={() => setKeysOpen(true)}>Keys</button>
      </header>
      <main>
        {route.name === 'list' ? <ListPage /> : route.name === 'linear' ? <LinearPage /> : <DetailPage id={route.id} />}
      </main>
      {keysOpen && (
        <KeysModal
          onClose={() => setKeysOpen(false)}
          onSaved={() => {
            setKeysOpen(false);
            api.linearStatus().then(r => setLinearConfigured(r.configured)).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
