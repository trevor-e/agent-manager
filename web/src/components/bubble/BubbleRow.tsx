import { memo, useMemo, useState } from 'react';
import { useNow } from '../../useNow';
import { detectDanger } from '../../dangerDetect';
import { api } from '../../api';
import type { SubagentSummary } from '../../types';
import { Markdown } from '../Markdown';
import { UnifiedDiff, AdditionsView } from '../UnifiedDiff';
import { eventsToBubbles } from './eventsToBubbles';
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
  return json.length > 200 ? json.slice(0, 200) + '…' : json;
}

export const BubbleRow = memo(function BubbleRow({
  bubble,
  sessionId,
  subagentsByToolUseId,
}: {
  bubble: Bubble;
  sessionId?: string;
  subagentsByToolUseId?: Map<string, SubagentSummary>;
}) {
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
  if (bubble.kind === 'tool_use') {
    return (
      <ToolBubbleRow
        bubble={bubble}
        sessionId={sessionId}
        subagent={subagentsByToolUseId?.get(bubble.toolUseId)}
      />
    );
  }
  return (
    <div className="bubble-row bubble-row-system">
      <div className="bubble bubble-system muted small">{bubble.text}</div>
    </div>
  );
});

const PREVIEW_LINES = 4;

function ToolBubbleRow({
  bubble,
  sessionId,
  subagent,
}: {
  bubble: ToolUseBubble;
  sessionId?: string;
  subagent?: SubagentSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(
    () => summarizeInput(bubble.toolName, bubble.input),
    [bubble.toolName, bubble.input]
  );
  const danger = useMemo(
    () => detectDanger(bubble.toolName, bubble.input),
    [bubble.toolName, bubble.input]
  );
  const elapsed = useToolElapsed(bubble);

  const dotClass =
    (bubble.status === 'denied' || bubble.resultIsError) ? 'cli-dot-error' :
    bubble.status === 'completed' ? 'cli-dot-success' :
    bubble.status === 'allowed' ? 'cli-dot-running' :
    'cli-dot-pending';

  const isEdit = bubble.toolName === 'Edit'
    && typeof bubble.input?.old_string === 'string'
    && typeof bubble.input?.new_string === 'string';
  const isWrite = bubble.toolName === 'Write'
    && typeof bubble.input?.content === 'string';
  const hasDiff = isEdit || isWrite;

  const resultText = bubble.result ?? '';
  const resultLines = resultText ? resultText.split('\n') : [];
  const canTruncate = !hasDiff && resultLines.length > PREVIEW_LINES;
  const displayText = !expanded && canTruncate
    ? resultLines.slice(0, PREVIEW_LINES).join('\n')
    : resultText;
  const hiddenCount = resultLines.length - PREVIEW_LINES;

  const hasOutput = bubble.result !== undefined || hasDiff;

  const [subagentOpen, setSubagentOpen] = useState(false);
  const [subagentBubbles, setSubagentBubbles] = useState<Bubble[] | null>(null);
  const [subagentLoading, setSubagentLoading] = useState(false);
  const [subagentError, setSubagentError] = useState<string | null>(null);

  async function toggleSubagent() {
    if (subagentOpen) {
      setSubagentOpen(false);
      return;
    }
    setSubagentOpen(true);
    if (subagentBubbles || !subagent || !sessionId) return;
    setSubagentLoading(true);
    setSubagentError(null);
    try {
      const { events } = await api.getSubagentEvents(sessionId, subagent.agentId);
      setSubagentBubbles(eventsToBubbles(events));
    } catch (e) {
      setSubagentError((e as Error).message);
    } finally {
      setSubagentLoading(false);
    }
  }

  return (
    <div className="bubble-row bubble-row-tool">
      <div className={`cli-tool${danger.dangerous ? ' cli-tool-dangerous' : ''}`}>
        <div className="cli-tool-header">
          <span className={`cli-dot ${dotClass}`}>●</span>
          <span className="cli-tool-label">
            <span className="cli-tool-name">{bubble.toolName}</span>
            (<span className="cli-tool-args">{summary}</span>)
          </span>
          {danger.dangerous && (
            <span className="tool-danger-badge" title={danger.reason}>danger</span>
          )}
          {elapsed && <span className="cli-elapsed">{elapsed}</span>}
        </div>

        {hasOutput && (
          <div className="cli-tool-output">
            <span className="cli-connector">└</span>
            <div className="cli-tool-body">
              {isEdit ? (
                <UnifiedDiff
                  oldText={bubble.input.old_string}
                  newText={bubble.input.new_string}
                  filePath={bubble.input.file_path}
                />
              ) : isWrite ? (
                <AdditionsView
                  content={bubble.input.content}
                  filePath={bubble.input.file_path}
                />
              ) : (
                <pre className={`cli-result${bubble.resultIsError ? ' cli-result-error' : ''}`}>
                  {displayText.length > 8000 ? displayText.slice(0, 8000) + '…' : displayText}
                </pre>
              )}
              {canTruncate && !expanded && (
                <button
                  type="button"
                  className="cli-expand"
                  onClick={() => setExpanded(true)}
                >
                  … +{hiddenCount} lines (click to expand)
                </button>
              )}
            </div>
          </div>
        )}

        {subagent && sessionId && (
          <div className="cli-tool-output">
            <span className="cli-connector">└</span>
            <div className="cli-tool-body">
              <button type="button" className="cli-expand" onClick={toggleSubagent}>
                {subagentOpen ? '▾' : '▸'} subagent transcript
                {subagent.agentType ? ` — ${subagent.agentType}` : ''}
              </button>
              {subagentOpen && (
                <div className="subagent-transcript">
                  {subagentLoading && <div className="muted small">loading…</div>}
                  {subagentError && <div className="cli-result-error small">{subagentError}</div>}
                  {subagentBubbles?.map(b => <BubbleRow key={b.id} bubble={b} />)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
