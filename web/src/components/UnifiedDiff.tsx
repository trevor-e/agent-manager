import { useMemo } from 'react';
import { structuredPatch } from 'diff';

type Props = {
  oldText: string;
  newText: string;
  filePath?: string;
  context?: number;
};

type Line = { kind: 'add' | 'del' | 'ctx' | 'hunk'; text: string };

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

export function UnifiedDiff({ oldText, newText, filePath, context = 3 }: Props) {
  const lines = useMemo(
    () => buildLines(oldText ?? '', newText ?? '', context),
    [oldText, newText, context]
  );

  if (lines.length === 0) {
    return <div className="diff diff-empty muted small">no changes</div>;
  }

  return (
    <div className="diff">
      {filePath && <div className="diff-header mono">{filePath}</div>}
      <pre className="diff-body mono">
        {lines.map((l, i) => (
          <div key={i} className={`diff-line diff-line-${l.kind}`}>
            <span className="diff-marker">
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : l.kind === 'hunk' ? '' : ' '}
            </span>
            <span className="diff-text">{l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

// Convenience: render an additions-only "diff" (e.g. for Write tool full content).
export function AdditionsView({ content, filePath }: { content: string; filePath?: string }) {
  const lines = (content ?? '').split('\n');
  return (
    <div className="diff">
      {filePath && <div className="diff-header mono">{filePath}</div>}
      <pre className="diff-body mono">
        {lines.map((text, i) => (
          <div key={i} className="diff-line diff-line-add">
            <span className="diff-marker">+</span>
            <span className="diff-text">{text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
