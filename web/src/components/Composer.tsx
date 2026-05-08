import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '../api';
import type { PermissionMode, Session, SessionEvent } from '../types';
import {
  type Bubble,
  type ToolUseBubble,
  type AssistantBubble,
  BubbleRow,
  ToolInputView,
  eventsToBubbles,
} from './Bubble';
import { Markdown } from './Markdown';

type AgentEvent =
  | { type: 'attached'; pendingApprovals: Approval[] }
  | { type: 'output'; line: string; parsed: any }
  | { type: 'approval_request'; approvalId: string; toolName: string; input: any }
  | { type: 'approval_resolved'; approvalId: string; decision: 'approve' | 'deny'; reason?: string }
  | { type: 'stderr'; line: string }
  | { type: 'exit'; code: number | null; signal: string | null };

type Approval = { approvalId: string; toolName: string; input: any };

type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  base64: string;
  dataUrl: string;
};

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function Composer({
  session,
  initialEvents,
}: {
  session: Session;
  initialEvents: SessionEvent[];
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>(() => eventsToBubbles(initialEvents));
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bubbleIdCounter = useRef(0);
  const attachmentIdCounter = useRef(0);
  const esRef = useRef<EventSource | null>(null);

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
  }

  useEffect(() => {
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
    return () => {
      es.close();
      esRef.current = null;
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
        break;
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bubbles, approvals]);

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
    const accepted: Attachment[] = [];
    let errored: string | null = null;
    for (const f of files) {
      if (!SUPPORTED_IMAGE_TYPES.has(f.type)) {
        errored = `unsupported file type: ${f.type || f.name}`;
        continue;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        errored = `${f.name} is too large (max ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB)`;
        continue;
      }
      try {
        const { base64, dataUrl } = await fileToBase64(f);
        accepted.push({
          id: `A${++attachmentIdCounter.current}`,
          name: f.name || 'image',
          mediaType: f.type,
          base64,
          dataUrl,
        });
      } catch (e) {
        errored = `failed to read ${f.name}`;
      }
    }
    if (accepted.length) setAttachments(prev => [...prev, ...accepted]);
    setAttachError(errored);
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
    opts: { reason?: string; updatedInput?: unknown; nextPermissionMode?: PermissionMode } = {}
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
      textareaRef.current?.focus();
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
      </div>

      <div className="composer-quick-actions">
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => sendPrompt('commit the changes')}
          title="Send: commit the changes"
        >
          Commit changes
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

function fileToBase64(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      resolve({ base64, dataUrl });
    };
    reader.readAsDataURL(file);
  });
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

function ApprovalModal({
  approval,
  onResolve,
}: {
  approval: Approval;
  onResolve: (
    decision: 'approve' | 'deny',
    opts?: { reason?: string; updatedInput?: unknown; nextPermissionMode?: PermissionMode }
  ) => void;
}) {
  if (approval.toolName === 'AskUserQuestion') {
    return <AskUserQuestionModal approval={approval} onResolve={onResolve} />;
  }
  if (approval.toolName === 'ExitPlanMode') {
    return <ExitPlanModeModal approval={approval} onResolve={onResolve} />;
  }
  return (
    <div className="modal-bg">
      <div className="modal modal-approval">
        <h3>Approve tool use?</h3>
        <p className="muted small">claude wants to call: <code>{approval.toolName}</code></p>
        <div className="approval-input">
          <ToolInputView input={approval.input} toolName={approval.toolName} />
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={() => onResolve('deny')}>Deny</button>
          <button className="primary" autoFocus onClick={() => onResolve('approve')}>Approve</button>
        </div>
      </div>
    </div>
  );
}

function ExitPlanModeModal({
  approval,
  onResolve,
}: {
  approval: Approval;
  onResolve: (
    decision: 'approve' | 'deny',
    opts?: { reason?: string; updatedInput?: unknown; nextPermissionMode?: PermissionMode }
  ) => void;
}) {
  const plan = (approval.input?.plan as string | undefined) ?? '';
  const accept = (mode: PermissionMode) => onResolve('approve', { nextPermissionMode: mode });
  return (
    <div className="modal-bg">
      <div className="modal modal-approval modal-plan">
        <h3>Plan ready — accept it?</h3>
        <p className="muted small">
          claude finished planning. Pick a mode to drop into when you accept.
        </p>
        <div className="plan-body">
          {plan ? <Markdown>{plan}</Markdown> : <em className="muted">(empty plan)</em>}
        </div>
        <div className="modal-actions plan-actions">
          <button className="ghost" onClick={() => onResolve('deny', { reason: 'keep planning' })}>
            Keep planning
          </button>
          <button onClick={() => accept('default')} title="Accept the plan and ask before each tool">
            Accept → default
          </button>
          <button onClick={() => accept('acceptEdits')} title="Accept the plan and auto-approve edits (still ask for shell etc.)">
            Accept → accept edits
          </button>
          <button className="primary" autoFocus onClick={() => accept('bypassPermissions')} title="Accept the plan and auto-approve everything">
            Accept → bypass
          </button>
        </div>
      </div>
    </div>
  );
}

type AskUserQuestionInput = {
  questions?: Array<{
    question: string;
    header?: string;
    multiSelect?: boolean;
    options?: Array<{ label: string; description?: string }>;
  }>;
};

function AskUserQuestionModal({
  approval,
  onResolve,
}: {
  approval: Approval;
  onResolve: (
    decision: 'approve' | 'deny',
    opts?: { reason?: string; updatedInput?: unknown }
  ) => void;
}) {
  const input = (approval.input ?? {}) as AskUserQuestionInput;
  const questions = input.questions ?? [];
  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of questions) init[q.question] = [];
    return init;
  });

  function toggle(q: { question: string; multiSelect?: boolean }, label: string) {
    setSelections(prev => {
      const cur = prev[q.question] ?? [];
      if (q.multiSelect) {
        return {
          ...prev,
          [q.question]: cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label],
        };
      }
      return { ...prev, [q.question]: [label] };
    });
  }

  function submit() {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.question] = (selections[q.question] ?? []).join(', ');
    }
    onResolve('approve', { updatedInput: { ...input, answers } });
  }

  const allAnswered = questions.every(q => (selections[q.question] ?? []).length > 0);

  return (
    <div className="modal-bg">
      <div className="modal modal-question">
        <h3>claude is asking you something</h3>
        {questions.map((q, qi) => (
          <div key={qi} className="question-block">
            {q.header && <div className="question-header">{q.header}</div>}
            <div className="question-prompt">{q.question}</div>
            <div className="question-options">
              {(q.options ?? []).map((opt, oi) => {
                const selected = (selections[q.question] ?? []).includes(opt.label);
                return (
                  <button
                    key={oi}
                    type="button"
                    className={'question-option ' + (selected ? 'question-option-selected' : '')}
                    onClick={() => toggle(q, opt.label)}
                  >
                    <div className="question-option-label">{opt.label}</div>
                    {opt.description && (
                      <div className="question-option-desc muted small">{opt.description}</div>
                    )}
                  </button>
                );
              })}
            </div>
            {q.multiSelect && (
              <div className="muted small">multi-select — choose any</div>
            )}
          </div>
        ))}
        <div className="modal-actions">
          <button className="ghost" onClick={() => onResolve('deny')}>Skip</button>
          <button className="primary" disabled={!allAnswered} onClick={submit}>
            Submit answers
          </button>
        </div>
      </div>
    </div>
  );
}
