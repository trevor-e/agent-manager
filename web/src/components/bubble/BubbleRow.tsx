import { useMemo, useState } from 'react';
import { useNow } from '../../useNow';
import { detectDanger } from '../../dangerDetect';
import { Markdown } from '../Markdown';
import { ToolInputView } from './ToolInputView';
import type { Bubble, ToolUseBubble } from './types';

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m${sec.toString().padStart(2, '0')}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${(min % 60).toString().padStart(2, '0')}m`;
}

function useToolElapsed(bubble: ToolUseBubble): string | null {
  const now = useNow();
  if (bubble.startedAt === undefined) return null;
  const end = bubble.endedAt ?? now;
  return formatElapsed(end - bubble.startedAt);
}

function summarizeInput(toolName: string, input: any): string {
  if (!input || typeof input !== 'object') return JSON.stringify(input ?? null);
  if (toolName === 'Bash' && typeof input.command === 'string') return input.command;
  if (toolName === 'TodoWrite' && Array.isArray(input.todos))
    return `${input.todos.length} todo${input.todos.length === 1 ? '' : 's'}`;
  if (toolName === 'AskUserQuestion' && Array.isArray(input.questions))
    return input.questions.map((q: any) => q.question).filter(Boolean).join(' · ');
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.pattern === 'string') return input.pattern;
  if (typeof input.url === 'string') return input.url;
  if (typeof input.description === 'string') return input.description;
  const json = JSON.stringify(input);
  return json.length > 120 ? json.slice(0, 120) + '…' : json;
}

function statusBadge(b: ToolUseBubble): string {
  if (b.status === 'denied') return '✕';
  if (b.status === 'completed') return b.resultIsError ? '✕' : '✓';
  if (b.status === 'allowed') return '·';
  return '…';
}

export function BubbleRow({ bubble }: { bubble: Bubble }) {
  if (bubble.kind === 'user') {
    return (
      <div className="bubble-row bubble-row-user">
        <div className="bubble bubble-user">
          {bubble.images?.length ? (
            <div className="bubble-user-images">
              {bubble.images.map((img, i) => (
                <img key={i} src={img.dataUrl} alt="" className="bubble-user-image" />
              ))}
            </div>
          ) : null}
          {bubble.text && <div className="bubble-user-text">{bubble.text}</div>}
        </div>
      </div>
    );
  }
  if (bubble.kind === 'assistant') {
    return (
      <div className="bubble-row bubble-row-assistant">
        <div className="bubble bubble-assistant">
          {bubble.text ? <Markdown>{bubble.text}</Markdown> : <span className="muted">…</span>}
        </div>
      </div>
    );
  }
  if (bubble.kind === 'tool_use') return <ToolBubbleRow bubble={bubble} />;
  return (
    <div className="bubble-row bubble-row-system">
      <div className="bubble bubble-system muted small">{bubble.text}</div>
    </div>
  );
}

function ToolBubbleRow({ bubble }: { bubble: ToolUseBubble }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(
    () => summarizeInput(bubble.toolName, bubble.input),
    [bubble.toolName, bubble.input]
  );
  const danger = useMemo(
    () => detectDanger(bubble.toolName, bubble.input),
    [bubble.toolName, bubble.input]
  );
  const badge = statusBadge(bubble);
  const klass =
    'bubble-tool ' +
    (bubble.status === 'denied' || bubble.resultIsError ? 'bubble-tool-error' : '') +
    (danger.dangerous ? ' bubble-tool-dangerous' : '');
  const elapsed = useToolElapsed(bubble);
  return (
    <div className="bubble-row bubble-row-tool">
      <button
        type="button"
        className={'bubble ' + klass}
        onClick={() => setOpen(o => !o)}
        title={open ? 'collapse' : 'expand'}
      >
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
        <span className="tool-status">{badge}</span>
        <span className="tool-name">{bubble.toolName}</span>
        {danger.dangerous && <span className="tool-danger-badge" title={danger.reason}>danger</span>}
        <span className="tool-summary mono">{summary}</span>
        {elapsed && <span className="tool-elapsed mono">{elapsed}</span>}
      </button>
      {open && (
        <div className="tool-details mono small">
          <div className="tool-section-label">input</div>
          <ToolInputView input={bubble.input} toolName={bubble.toolName} />
          {bubble.result !== undefined && (
            <>
              <div className="tool-section-label">{bubble.resultIsError ? 'error' : 'result'}</div>
              {bubble.resultIsError ? (
                <pre className="tool-pre tool-pre-error">
                  {bubble.result.length > 8000 ? bubble.result.slice(0, 8000) + '…' : bubble.result}
                </pre>
              ) : (
                <div className="tool-result-md">
                  <Markdown>
                    {bubble.result.length > 8000 ? bubble.result.slice(0, 8000) + '…' : bubble.result}
                  </Markdown>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
