import { useEffect, useState } from 'react';
import { api } from '../api';

type McpServer = { name: string; url: string; status: 'connected' | 'needs_auth' | 'failed' };

export function McpStatus() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  function load() {
    setLoading(true);
    api.getMcp().then(r => {
      setServers(r.servers);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const needsAuth = servers?.filter(s => s.status === 'needs_auth').length ?? 0;
  const connected = servers?.filter(s => s.status === 'connected').length ?? 0;

  const statusIcon = (s: McpServer['status']) =>
    s === 'connected' ? '●' : s === 'needs_auth' ? '○' : '✕';

  const statusClass = (s: McpServer['status']) =>
    s === 'connected' ? 'mcp-connected' : s === 'needs_auth' ? 'mcp-needs-auth' : 'mcp-failed';

  return (
    <>
      <button className="ghost" onClick={() => servers && setOpen(true)} title="MCP server status">
        MCP
        {loading && <span className="mcp-badge muted"> …</span>}
        {!loading && needsAuth > 0 && <span className="mcp-badge mcp-needs-auth"> {needsAuth}</span>}
        {!loading && connected > 0 && <span className="mcp-badge mcp-connected"> {connected}</span>}
      </button>

      {open && servers && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal mcp-modal" onClick={e => e.stopPropagation()}>
            <div className="mcp-modal-header">
              <h3>MCP Servers</h3>
              <button
                className="ghost"
                onClick={load}
                disabled={loading}
              >
                {loading ? 'Checking…' : 'Refresh'}
              </button>
            </div>
            <div className="mcp-list">
              {servers.map(s => (
                <div key={s.name} className={`mcp-server ${statusClass(s.status)}`}>
                  <span className="mcp-icon">{statusIcon(s.status)}</span>
                  <span className="mcp-name">{s.name}</span>
                  <span className="mcp-url">{s.url}</span>
                  <span className="grow" />
                  {s.status === 'connected' && (
                    <span className="mcp-status-label mcp-connected">Connected</span>
                  )}
                  {s.status === 'needs_auth' && (
                    <span className="mcp-status-label mcp-needs-auth">Needs auth</span>
                  )}
                  {s.status === 'failed' && (
                    <span className="mcp-status-label mcp-failed">Failed</span>
                  )}
                </div>
              ))}
            </div>
            {needsAuth > 0 && (
              <p className="mcp-hint">
                To authenticate, run <code>/mcp</code> in a terminal Claude session and select the server to connect.
              </p>
            )}
            <div className="modal-actions">
              <button className="ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
