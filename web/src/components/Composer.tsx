import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Session, SessionEvent } from '../types';
import {
  type Bubble,
  type ToolUseBubble,
  type AssistantBubble,
  BubbleRow,
  ToolInputView,
  eventsToBubbles,
} from './Bubble';

type AgentEvent =
  | { type: 'attached'; pendingApprovals: Approval[] }
  | { type: 'output'; line: string; parsed: any }
  | { type: 'approval_request'; approvalId: string; toolName: string; input: any }
  | { type: 'approval_resolved'; approvalId: string; decision: 'approve' | 'deny'; reason?: string }
  | { type: 'stderr'; line: string }
  | { type: 'exit'; code: number | null; signal: string | null };

type Approval = { approvalId: string; toolName: string; input: any };

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bubbleIdCounter = useRef(0);
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

  async function sendPrompt(text: string) {
    if (pending || !text.trim()) return;
    setPending(true);
    addBubble({ kind: 'user', text } as Bubble);
    try {
      await api.sendMessage(session.id, text);
    } catch (e) {
      addBubble({ kind: 'system', text: `error: ${(e as Error).message}` } as Bubble);
    } finally {
      setPending(false);
    }
  }

  async function send() {
    if (!draft.trim() || pending) return;
    const text = draft;
    setDraft('');
    await sendPrompt(text);
  }

  async function resolveApprovalAction(
    approvalId: string,
    decision: 'approve' | 'deny',
    opts: { reason?: string; updatedInput?: unknown } = {}
  ) {
    try {
      await api.resolveApproval(session.id, approvalId, decision, opts);
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

  return (
    <div className="composer">
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
          className="ghost quick-action"
          disabled={pending}
          onClick={() => sendPrompt('commit the changes')}
          title="Send: commit the changes"
        >
          Commit changes
        </button>
      </div>

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
          placeholder="message claude…  (⌘+Enter to send)"
        />
        <div className="composer-input-actions">
          <button className="ghost" onClick={interrupt} title="Stop the current generation (chat keeps going)">
            Interrupt
          </button>
          <button className="primary" disabled={pending || !draft.trim()} onClick={send}>
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
    opts?: { reason?: string; updatedInput?: unknown }
  ) => void;
}) {
  if (approval.toolName === 'AskUserQuestion') {
    return <AskUserQuestionModal approval={approval} onResolve={onResolve} />;
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
