import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '../api';
import { notify } from '../notifications';
import type { RepoSummary, Session, SessionEvent } from '../types';
import {
  type Bubble,
  type ToolUseBubble,
  type AssistantBubble,
  BubbleRow,
  eventsToBubbles,
} from './Bubble';
import { ApprovalModal, type Approval, type ResolveOpts } from './composer/approvals';
import {
  type Attachment,
  processAttachmentFiles,
} from './composer/attachments';
import { RepoSelect } from './RepoSelect';

type AgentEvent =
  | { type: 'attached'; pendingApprovals: Approval[] }
  | { type: 'output'; line: string; parsed: any }
  | { type: 'approval_request'; approvalId: string; toolName: string; input: any }
  | { type: 'approval_resolved'; approvalId: string; decision: 'approve' | 'deny'; reason?: string }
  | { type: 'stderr'; line: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export function Composer({
  session,
  initialEvents,
  repos = [],
}: {
  session: Session;
  initialEvents: SessionEvent[];
  repos?: RepoSummary[];
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>(() => eventsToBubbles(initialEvents));
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(
    session.derived_state === 'working' || session.derived_state === 'launching'
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [addDirOpen, setAddDirOpen] = useState(false);
  const [addDirValue, setAddDirValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bubbleIdCounter = useRef(0);
  const attachmentIdCounter = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef(0);
  // Tracks the currently streaming assistant message id and its accumulated text,
  // so content_block_delta events can incrementally grow the bubble.
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef<Map<string, string>>(new Map());

  const showCoexistWarning = session.is_running;

  function nextLiveId(): string {
    return `L${++bubbleIdCounter.current}`;
  }

  function addBubble(b: Omit<Bubble, 'id'>): string {
    const id = nextLiveId();
    setBubbles(prev => [...prev, { ...(b as Bubble), id }]);
    return id;
  }

  function addToolUseIfNew(toolUse: Omit<ToolUseBubble, 'id'>) {
    setBubbles(prev => {
      if (prev.some(b => b.kind === 'tool_use' && b.toolUseId === toolUse.toolUseId)) {
        return prev;
      }
      return [...prev, { ...toolUse, id: nextLiveId() }];
    });
  }

  function setAssistantText(messageId: string, text: string) {
    setBubbles(prev => {
      const idx = prev.findIndex(b => b.kind === 'assistant' && b.messageId === messageId);
      if (idx === -1) {
        return [
          ...prev,
          { kind: 'assistant', id: nextLiveId(), messageId, text },
        ];
      }
      const cur = prev[idx] as AssistantBubble;
      if (text.length <= cur.text.length) return prev;
      const next = [...prev];
      next[idx] = { ...cur, text };
      return next;
    });
  }

  function attachToolResult(toolUseId: string, result: string, isError: boolean) {
    setBubbles(prev => {
      const idx = prev.findIndex(b => b.kind === 'tool_use' && b.toolUseId === toolUseId);
      if (idx === -1) return prev;
      const cur = prev[idx] as ToolUseBubble;
      const next = [...prev];
      next[idx] = {
        ...cur,
        result,
        resultIsError: isError,
        status: 'completed',
        endedAt: cur.endedAt ?? Date.now(),
      };
      return next;
    });
    // Tool finished — claude is about to think about the next step.
    setWorking(true);
  }

  function reconnectSSE() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    reconnectRef.current++;
    const url = `/api/sessions/${session.id}/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = e => {
      let ev: AgentEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      handleEvent(ev);
    };
  }

  useEffect(() => {
    reconnectSSE();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  function handleEvent(ev: AgentEvent) {
    switch (ev.type) {
      case 'attached':
        setApprovals(ev.pendingApprovals ?? []);
        break;
      case 'output': {
        const p = ev.parsed;
        if (!p || typeof p !== 'object') return;
        if (p.type === 'result') {
          setWorking(false);
          streamingMessageIdRef.current = null;
          return;
        }
        if (p.type === 'stream_event' && p.event && typeof p.event === 'object') {
          handleStreamEvent(p.event);
          setWorking(true);
          return;
        }
        if (p.type === 'assistant' || p.type === 'message') {
          const msg = p.message;
          if (!msg || typeof msg !== 'object') return;
          const messageId: string = msg.id ?? `m_${Math.random()}`;
          const content = msg.content;
          if (typeof content === 'string') {
            setAssistantText(messageId, content);
          } else if (Array.isArray(content)) {
            const fullText = content
              .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
              .map((c: any) => c.text)
              .join('');
            if (fullText) setAssistantText(messageId, fullText);
            for (const c of content) {
              if (c && c.type === 'tool_use') {
                addToolUseIfNew({
                  kind: 'tool_use',
                  toolUseId: c.id,
                  toolName: c.name,
                  input: c.input,
                  status: 'pending',
                  startedAt: Date.now(),
                });
              }
            }
          }
        } else if (p.type === 'user' && p.message?.content) {
          const content = p.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && c.type === 'tool_result' && c.tool_use_id) {
                const text = extractToolResultText(c.content);
                attachToolResult(c.tool_use_id, text, !!c.is_error);
              }
            }
          }
        }
        break;
      }
      case 'approval_request':
        setApprovals(prev => [...prev, { approvalId: ev.approvalId, toolName: ev.toolName, input: ev.input }]);
        notify(`Approval needed`, `${session.display_name ?? 'Session'}: ${ev.toolName}`);
        break;
      case 'approval_resolved': {
        setApprovals(prev => prev.filter(a => a.approvalId !== ev.approvalId));
        setBubbles(prev => {
          const idx = [...prev].reverse().findIndex(b => b.kind === 'tool_use' && b.status === 'pending');
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          const cur = prev[realIdx] as ToolUseBubble;
          const next = [...prev];
          next[realIdx] = {
            ...cur,
            status: ev.decision === 'approve' ? 'allowed' : 'denied',
            endedAt: ev.decision === 'deny' ? Date.now() : cur.endedAt,
          };
          return next;
        });
        break;
      }
      case 'stderr':
        if (ev.line) addBubble({ kind: 'system', text: `[stderr] ${ev.line}` } as Bubble);
        break;
      case 'exit':
        addBubble({ kind: 'system', text: `agent exited (code=${ev.code ?? '?'})` } as Bubble);
        setConnected(false);
        setWorking(false);
        streamingMessageIdRef.current = null;
        notify(`Session finished`, session.display_name ?? 'Session');
        break;
    }
  }

  function handleStreamEvent(e: any) {
    const t = e.type;
    if (t === 'message_start') {
      const id = e.message?.id;
      if (typeof id === 'string') {
        streamingMessageIdRef.current = id;
        streamingTextRef.current.set(id, '');
      }
      return;
    }
    if (t === 'content_block_start') {
      const cb = e.content_block;
      if (cb?.type === 'tool_use' && typeof cb.id === 'string' && typeof cb.name === 'string') {
        addToolUseIfNew({
          kind: 'tool_use',
          toolUseId: cb.id,
          toolName: cb.name,
          input: cb.input ?? {},
          status: 'pending',
          startedAt: Date.now(),
        });
      }
      return;
    }
    if (t === 'content_block_delta') {
      const d = e.delta;
      const msgId = streamingMessageIdRef.current;
      if (d?.type === 'text_delta' && msgId && typeof d.text === 'string') {
        const next = (streamingTextRef.current.get(msgId) ?? '') + d.text;
        streamingTextRef.current.set(msgId, next);
        setAssistantText(msgId, next);
      }
      return;
    }
    if (t === 'message_stop') {
      streamingMessageIdRef.current = null;
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bubbles, approvals, working]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [session.id]);

  useEffect(() => {
    const pending = approvals[0];
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveApprovalAction(pending.approvalId, 'deny');
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [approvals]);

  async function sendPrompt(text: string, imgs: Attachment[] = []) {
    if (pending) return;
    if (!text.trim() && imgs.length === 0) return;
    setPending(true);
    setWorking(true);
    addBubble({
      kind: 'user',
      text,
      ...(imgs.length ? { images: imgs.map(a => ({ dataUrl: a.dataUrl })) } : {}),
    } as Bubble);
    try {
      const apiImages = imgs.map(a => ({ mediaType: a.mediaType, data: a.base64 }));
      await api.sendMessage(session.id, text, apiImages);
    } catch (e) {
      addBubble({ kind: 'system', text: `error: ${(e as Error).message}` } as Bubble);
      setWorking(false);
    } finally {
      setPending(false);
    }
  }

  async function send() {
    if (pending) return;
    if (!draft.trim() && attachments.length === 0) return;
    const text = draft;
    const imgs = attachments;
    setDraft('');
    setAttachments([]);
    setAttachError(null);
    await sendPrompt(text, imgs);
  }

  async function addFiles(files: File[]) {
    const { accepted, error } = await processAttachmentFiles(files);
    if (accepted.length) {
      setAttachments(prev => [
        ...prev,
        ...accepted.map(a => ({ ...a, id: `A${++attachmentIdCounter.current}` })),
      ]);
    }
    setAttachError(error);
  }

  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) void addFiles(files);
  }

  function handleDragOver(e: DragEvent) {
    if (Array.from(e.dataTransfer.items).some(i => i.kind === 'file')) {
      e.preventDefault();
      setDragOver(true);
    }
  }

  function handleDragLeave(e: DragEvent) {
    if (e.currentTarget === e.target) setDragOver(false);
  }

  async function resolveApprovalAction(
    approvalId: string,
    decision: 'approve' | 'deny',
    opts: ResolveOpts = {}
  ) {
    try {
      await api.resolveApproval(session.id, approvalId, decision, {
        reason: opts.reason,
        updatedInput: opts.updatedInput,
      });
      if (decision === 'approve' && opts.nextPermissionMode) {
        try {
          await api.setPermissionMode(session.id, opts.nextPermissionMode);
        } catch (e) {
          addBubble({
            kind: 'system',
            text: `failed to switch permission mode: ${(e as Error).message}`,
          } as Bubble);
        }
      }
    } catch (e) {
      setApprovals(prev => prev.filter(a => a.approvalId !== approvalId));
      addBubble({
        kind: 'system',
        text: `approval was no longer valid (${(e as Error).message}); the agent likely restarted`,
      } as Bubble);
    } finally {
      if (approvals.length <= 1) {
        textareaRef.current?.focus();
      }
    }
  }

  async function interrupt() {
    try {
      await api.interrupt(session.id);
    } catch {
      // best effort
    }
  }

  async function enterPlanMode() {
    try {
      await api.setPermissionMode(session.id, 'plan');
      addBubble({ kind: 'system', text: 'switched to plan mode — claude will research and present a plan' } as Bubble);
    } catch (e) {
      addBubble({ kind: 'system', text: `couldn't switch to plan mode: ${(e as Error).message}` } as Bubble);
    }
  }

  async function addDirectory(path: string) {
    if (!path.trim()) return;
    setAddDirOpen(false);
    setAddDirValue('');
    addBubble({ kind: 'system', text: `adding ${path} to context — agent will restart…` } as Bubble);
    try {
      const resp = await api.addDir(session.id, path.trim());
      if (resp.restarted) {
        setTimeout(() => reconnectSSE(), 1000);
      }
    } catch (e) {
      addBubble({ kind: 'system', text: `failed to add directory: ${(e as Error).message}` } as Bubble);
    }
  }

  return (
    <div
      className={'composer' + (dragOver ? ' composer-dragover' : '')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="composer-header">
        <h3 className="muted small">
          Conversation {connected ? <span className="dot dot-on" title="connected" /> : <span className="dot dot-off" title="disconnected" />}
        </h3>
        {showCoexistWarning && (
          <span
            className="warning-chip"
            title="Another claude is running in this repo. Chatting in two places at once can interleave session history."
          >
            ⚠ another claude active in repo
          </span>
        )}
      </div>

      <div className="bubbles" ref={scrollRef}>
        {bubbles.length === 0 && (
          <div className="muted small pad">No messages yet — say something to wake up the agent.</div>
        )}
        {bubbles.map(b => <BubbleRow key={b.id} bubble={b} />)}
        {working && shouldShowThinking(bubbles) && <ThinkingBubble />}
      </div>

      <div className="composer-quick-actions">
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => sendPrompt('review the diff of your changes for any bugs, issues, or things I should know about')}
          title="Send: review the diff of your changes"
        >
          Review changes
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => sendPrompt('commit and push the changes')}
          title="Send: commit and push the changes"
        >
          Commit &amp; push
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => sendPrompt('create a draft pull request for these changes')}
          title="Send: create a draft pull request"
        >
          Create PR
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => sendPrompt("how's it going?")}
          title="Send: how's it going?"
        >
          Nudge
        </button>
        <button
          className="quick-action"
          onClick={enterPlanMode}
          title="Switch the live agent into plan mode (read-only research, then a plan you approve)"
        >
          Plan mode
        </button>
      </div>

      {(attachments.length > 0 || attachError) && (
        <div className="composer-attachments">
          {attachments.map(a => (
            <div key={a.id} className="attachment-chip" title={a.name}>
              <img src={a.dataUrl} alt="" className="attachment-thumb" />
              <button
                type="button"
                className="attachment-remove"
                aria-label={`remove ${a.name}`}
                onClick={() => removeAttachment(a.id)}
              >
                ×
              </button>
            </div>
          ))}
          {attachError && <span className="attachment-error small">{attachError}</span>}
        </div>
      )}

      <div className="composer-input">
        <textarea
          ref={textareaRef}
          rows={3}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
          placeholder="message claude…  (⌘+Enter to send, drop images to attach)"
        />
        <div className="composer-input-actions">
          <button className="ghost" onClick={interrupt} title="Stop the current generation (chat keeps going)">
            Interrupt
          </button>
          <button
            className="primary"
            disabled={pending || (!draft.trim() && attachments.length === 0)}
            onClick={send}
          >
            {pending ? 'sending…' : 'Send'}
          </button>
        </div>
      </div>

      {approvals[0] && (
        <ApprovalModal
          key={approvals[0].approvalId}
          approval={approvals[0]}
          onResolve={(decision, opts) => resolveApprovalAction(approvals[0].approvalId, decision, opts)}
        />
      )}
    </div>
  );
}

function shouldShowThinking(bubbles: Bubble[]): boolean {
  if (bubbles.length === 0) return false;
  const last = bubbles[bubbles.length - 1];
  if (last.kind === 'assistant') return false;
  if (last.kind === 'tool_use' && (last.status === 'pending' || last.status === 'allowed')) {
    return false;
  }
  return true;
}

function ThinkingBubble() {
  return (
    <div className="bubble-row bubble-row-assistant">
      <div className="bubble bubble-assistant bubble-thinking">
        <span className="thinking-dots" aria-label="thinking">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
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
