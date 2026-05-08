import type { Bubble, ToolUseBubble, UserImage } from './types';

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
