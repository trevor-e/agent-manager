import { useMemo, useState } from 'react';
import { useNow } from '../useNow';
import { Markdown } from './Markdown';
import { UnifiedDiff, AdditionsView } from './UnifiedDiff';

export type AssistantBubble = { kind: 'assistant'; id: string; messageId: string; text: string };
export type UserImage = { dataUrl: string };
export type UserBubble = { kind: 'user'; id: string; text: string; images?: UserImage[] };
export type ToolUseBubble = {
  kind: 'tool_use';
  id: string;
  toolUseId: string;
  toolName: string;
  input: any;
  status: 'pending' | 'allowed' | 'denied' | 'completed';
  result?: string;
  resultIsError?: boolean;
  startedAt?: number;
  endedAt?: number;
};
export type SystemBubble = { kind: 'system'; id: string; text: string };

export type Bubble = AssistantBubble | UserBubble | ToolUseBubble | SystemBubble;

const META_TYPES = new Set([
  'permission-mode',
  'pr-link',
  'system',
  'ai-title',
  'agent-name',
  'custom-title',
  'file-history-snapshot',
  'last-prompt',
]);

// Convert raw stream-json events (from .jsonl history) into bubbles.
// Coalesces tool_use and matching tool_result into a single ToolUseBubble.
export function eventsToBubbles(events: any[]): Bubble[] {
  const bubbles: Bubble[] = [];
  const toolByUseId = new Map<string, ToolUseBubble>();
  let counter = 0;
  const nextId = () => String(++counter);

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const t = ev.type as string | undefined;
    if (!t || META_TYPES.has(t)) continue;

    const eventTs = parseEventTs(ev.timestamp);
    const msg = ev.message;
    if (t === 'user' && msg && typeof msg === 'object') {
      const content = msg.content;
      if (typeof content === 'string') {
        const cleaned = cleanUserPrompt(content);
        if (cleaned) bubbles.push({ kind: 'user', id: nextId(), text: cleaned });
      } else if (Array.isArray(content)) {
        const text: string[] = [];
        const images: UserImage[] = [];
        for (const c of content) {
          if (!c) continue;
          if (c.type === 'text' && typeof c.text === 'string') text.push(c.text);
          else if (c.type === 'image' && c.source?.type === 'base64' && c.source.data) {
            images.push({
              dataUrl: `data:${c.source.media_type ?? 'image/png'};base64,${c.source.data}`,
            });
          } else if (c.type === 'tool_result' && c.tool_use_id) {
            const resultText = extractToolResultText(c.content);
            const tool = toolByUseId.get(c.tool_use_id);
            if (tool) {
              tool.result = resultText;
              tool.resultIsError = !!c.is_error;
              tool.status = 'completed';
              if (eventTs !== null) tool.endedAt = eventTs;
            }
          }
        }
        const cleaned = cleanUserPrompt(text.join(''));
        if (cleaned || images.length) {
          bubbles.push({
            kind: 'user',
            id: nextId(),
            text: cleaned,
            ...(images.length ? { images } : {}),
          });
        }
      }
      continue;
    }

    if ((t === 'assistant' || t === 'message') && msg && typeof msg === 'object') {
      const content = msg.content;
      if (typeof content === 'string') {
        if (content.trim())
          bubbles.push({
            kind: 'assistant',
            id: nextId(),
            messageId: msg.id ?? nextId(),
            text: content,
          });
      } else if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const c of content) {
          if (!c) continue;
          if (c.type === 'text' && typeof c.text === 'string') textParts.push(c.text);
          else if (c.type === 'tool_use') {
            const bub: ToolUseBubble = {
              kind: 'tool_use',
              id: nextId(),
              toolUseId: c.id,
              toolName: c.name,
              input: c.input,
              status: 'allowed',
              startedAt: eventTs ?? undefined,
            };
            // First push any accumulated text as an assistant bubble before the tool.
            if (textParts.length) {
              const text = textParts.join('').trim();
              if (text)
                bubbles.push({
                  kind: 'assistant',
                  id: nextId(),
                  messageId: msg.id ?? nextId(),
                  text,
                });
              textParts.length = 0;
            }
            bubbles.push(bub);
            toolByUseId.set(c.id, bub);
          }
        }
        if (textParts.length) {
          const text = textParts.join('').trim();
          if (text)
            bubbles.push({
              kind: 'assistant',
              id: nextId(),
              messageId: msg.id ?? nextId(),
              text,
            });
        }
      }
      continue;
    }
  }

  return bubbles;
}

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

function parseEventTs(ts: unknown): number | null {
  if (typeof ts !== 'string') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function cleanUserPrompt(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  if (s.startsWith('<local-command-caveat>')) {
    const close = s.indexOf('</local-command-caveat>');
    if (close >= 0) s = s.slice(close + '</local-command-caveat>'.length).trim();
  }
  s = s.replace(/<command-message>[\s\S]*?<\/command-message>/g, '');
  s = s.replace(/<command-args>[\s\S]*?<\/command-args>/g, '');
  const cmd = s.match(/^<command-name>([^<]+)<\/command-name>/);
  if (cmd) s = `(${cmd[1].trim()})`;
  return s.replace(/\s+/g, ' ').trim();
}

function extractToolResultText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (!c) return '';
        if (typeof c === 'string') return c;
        if (c.type === 'text' && typeof c.text === 'string') return c.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
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
  const badge = statusBadge(bubble);
  const klass =
    'bubble-tool ' +
    (bubble.status === 'denied' || bubble.resultIsError ? 'bubble-tool-error' : '');
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

function prettyJson(v: unknown): string {
  try {
    const json = JSON.stringify(v, null, 2);
    return json.length > 4000 ? json.slice(0, 4000) + '…' : json;
  } catch {
    return String(v);
  }
}

// Renders tool input as a list of label/value pairs.
// String values render literally (newlines preserved). Non-strings get JSON.
// For Edit/Write tools, the diff/content is rendered with a unified-diff view.
export function ToolInputView({ input, toolName }: { input: any; toolName?: string }) {
  if (input === null || input === undefined) {
    return <pre className="tool-pre muted">(no input)</pre>;
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return <pre className="tool-pre">{prettyJson(input)}</pre>;
  }

  if (toolName === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return (
      <div className="tool-fields">
        <UnifiedDiff
          oldText={input.old_string}
          newText={input.new_string}
          filePath={typeof input.file_path === 'string' ? input.file_path : undefined}
        />
        {input.replace_all && <div className="muted small">replace_all: true</div>}
      </div>
    );
  }

  if (toolName === 'Write' && typeof input.content === 'string') {
    return (
      <div className="tool-fields">
        <AdditionsView
          content={input.content}
          filePath={typeof input.file_path === 'string' ? input.file_path : undefined}
        />
      </div>
    );
  }

  const entries = Object.entries(input);
  if (entries.length === 0) {
    return <pre className="tool-pre muted">(empty)</pre>;
  }
  return (
    <div className="tool-fields">
      {entries.map(([k, v]) => (
        <div key={k} className="tool-field">
          <div className="tool-field-label">{k}</div>
          {typeof v === 'string' ? (
            <pre className="tool-field-value">{truncate(v, 4000)}</pre>
          ) : (
            <pre className="tool-field-value">{prettyJson(v)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
