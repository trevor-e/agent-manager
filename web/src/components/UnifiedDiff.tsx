import { useMemo } from 'react';
import { structuredPatch } from 'diff';
import hljs from 'highlight.js';

type Props = {
  oldText: string;
  newText: string;
  filePath?: string;
  context?: number;
};

type Line = { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string; html?: string };

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust',
  go: 'go', java: 'java', kt: 'kotlin',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  swift: 'swift', m: 'objectivec',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', vue: 'xml', svg: 'xml', xml: 'xml',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', md: 'markdown',
};

function langFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] : undefined;
}

function addHighlighting(lines: Line[], filePath?: string): Line[] {
  const lang = langFromPath(filePath);
  if (!lang || !hljs.getLanguage(lang)) return lines;
  return lines.map((l) => {
    if (l.kind === 'hunk') return l;
    try {
      const html = hljs.highlight(l.text, { language: lang, ignoreIllegals: true }).value;
      return { ...l, html };
    } catch {
      return l;
    }
  });
}

function buildLines(oldText: string, newText: string, context: number): Line[] {
  const patch = structuredPatch('a', 'b', oldText, newText, '', '', { context });
  const lines: Line[] = [];
  for (const hunk of patch.hunks) {
    lines.push({
      kind: 'hunk',
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    for (const raw of hunk.lines) {
      const marker = raw[0];
      const text = raw.slice(1);
      if (marker === '+') lines.push({ kind: 'add', text });
      else if (marker === '-') lines.push({ kind: 'del', text });
      else lines.push({ kind: 'ctx', text });
    }
  }
  return lines;
}

function DiffBody({ lines }: { lines: Line[] }) {
  return (
    <pre className="diff-body mono">
      {lines.map((l, i) => (
        <div key={i} className={`diff-line diff-line-${l.kind}`}>
          <span className="diff-marker">
            {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : l.kind === 'hunk' ? '' : ' '}
          </span>
          {l.html ? (
            <span className="diff-text" dangerouslySetInnerHTML={{ __html: l.html }} />
          ) : (
            <span className="diff-text">{l.text}</span>
          )}
        </div>
      ))}
    </pre>
  );
}

export function UnifiedDiff({ oldText, newText, filePath, context = 3 }: Props) {
  const lines = useMemo(
    () => addHighlighting(buildLines(oldText ?? '', newText ?? '', context), filePath),
    [oldText, newText, context, filePath],
  );

  if (lines.length === 0) {
    return <div className="diff diff-empty muted small">no changes</div>;
  }

  return (
    <div className="diff">
      {filePath && <div className="diff-header mono">{filePath}</div>}
      <DiffBody lines={lines} />
    </div>
  );
}

export function RawUnifiedDiff({ diff, filePath }: { diff: string; filePath?: string }) {
  const lines = useMemo(
    () => addHighlighting(parseUnifiedDiff(diff ?? ''), filePath),
    [diff, filePath],
  );

  if (lines.length === 0) {
    return <div className="diff diff-empty muted small">no textual changes</div>;
  }

  return (
    <div className="diff">
      {filePath && <div className="diff-header mono">{filePath}</div>}
      <DiffBody lines={lines} />
    </div>
  );
}

function parseUnifiedDiff(text: string): Line[] {
  const out: Line[] = [];
  let inHunk = false;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      out.push({ kind: 'hunk', text: raw });
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('\\ ')) continue;
    const m = raw[0];
    if (m === '+') out.push({ kind: 'add', text: raw.slice(1) });
    else if (m === '-') out.push({ kind: 'del', text: raw.slice(1) });
    else out.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  return out;
}

export function AdditionsView({ content, filePath }: { content: string; filePath?: string }) {
  const lines = useMemo(() => {
    const raw: Line[] = (content ?? '').split('\n').map((text) => ({ kind: 'add' as const, text }));
    return addHighlighting(raw, filePath);
  }, [content, filePath]);

  return (
    <div className="diff">
      {filePath && <div className="diff-header mono">{filePath}</div>}
      <DiffBody lines={lines} />
    </div>
  );
}
