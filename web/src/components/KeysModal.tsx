import { useEffect, useState } from 'react';
import { api } from '../api';

type KeyInfo = { set: boolean; source: string | null; masked: string | null };

export function KeysModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [keys, setKeys] = useState<Record<string, KeyInfo> | null>(null);
  const [linearKey, setLinearKey] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getKeys().then(r => setKeys(r.keys)).catch(e => setErr((e as Error).message));
  }, []);

  const info = keys?.linear_api_key;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    try {
      await api.setKeys({ linear_api_key: linearKey.trim() || null });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save} style={{ width: 480 }}>
        <h3>API Keys</h3>

        <label>
          Linear API Key
          {info?.source === 'env' && <span className="muted"> (set via env var)</span>}
          {info?.set && info.source !== 'env' && <span className="muted"> (saved)</span>}
        </label>
        <input
          type="password"
          value={linearKey}
          onChange={e => setLinearKey(e.target.value)}
          placeholder={info?.masked ?? 'lin_api_...'}
          autoFocus
        />
        {info?.source === 'env' && (
          <span className="muted small">Env var CM_LINEAR_API_KEY is set. A value saved here will only be used if the env var is removed.</span>
        )}

        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
