import { useEffect, useState } from 'react';
import { ListPage } from './pages/List';
import { DetailPage } from './pages/Detail';

function getRoute(): { name: 'list' } | { name: 'detail'; id: string } {
  const path = window.location.pathname.replace(/\/+$/, '');
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
  useEffect(() => {
    const onChange = () => setRoute(getRoute());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
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
        <div className="grow" />
        <span className="muted">{route.name === 'detail' ? `session ${route.id.slice(0, 8)}` : ''}</span>
      </header>
      <main>
        {route.name === 'list' ? <ListPage /> : <DetailPage id={route.id} />}
      </main>
    </div>
  );
}
