import { useEffect, useRef, useState } from 'react';
import type { RepoSummary } from '../types';

export function RepoSelect({
  repos,
  value,
  onChange,
  autoFocus,
  placeholder = '/Users/.../some-repo',
}: {
  repos: RepoSummary[];
  value: string;
  onChange: (path: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const lq = query.toLowerCase();
  const filtered = query
    ? repos.filter(
        r =>
          r.project_path.toLowerCase().includes(lq) ||
          r.repo_name.toLowerCase().includes(lq)
      )
    : repos;

  function select(path: string) {
    onChange(path);
    setQuery('');
    setOpen(false);
    setFocusIdx(-1);
  }

  function handleInputChange(v: string) {
    setQuery(v);
    onChange(v);
    if (!open) setOpen(true);
    setFocusIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setFocusIdx(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setQuery('');
        setOpen(true);
        setFocusIdx(0);
        return;
      }
      setFocusIdx(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && open && focusIdx >= 0 && focusIdx < filtered.length) {
      e.preventDefault();
      select(filtered[focusIdx].project_path);
      return;
    }
  }

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocusIdx(-1);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (focusIdx >= 0 && listRef.current) {
      const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIdx]);

  return (
    <div className="repo-select" ref={wrapRef}>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={open ? query : value}
        onChange={e => handleInputChange(e.target.value)}
        onClick={() => { if (!open) { setQuery(''); setOpen(true); } }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="repo-select-dropdown" ref={listRef}>
          {filtered.map((r, i) => (
            <li
              key={r.project_path}
              className={
                'repo-select-option' +
                (r.project_path === value ? ' repo-select-option-current' : '') +
                (i === focusIdx ? ' repo-select-option-focused' : '')
              }
              onMouseDown={e => {
                e.preventDefault();
                select(r.project_path);
              }}
              onMouseEnter={() => setFocusIdx(i)}
            >
              <span className="repo-select-name">{r.repo_name}</span>
              <span className="repo-select-path">{r.project_path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
