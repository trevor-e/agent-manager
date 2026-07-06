import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { notify } from '../notifications';
import type { Session, SessionEvent } from '../types';
import {
  type Bubble,
  type ToolUseBubble,
  type AssistantBubble,
  eventsToBubbles,
} from '../components/Bubble';
import type { QueuedBubble } from '../components/bubble/types';
import type { Approval, ResolveOpts } from '../components/composer/approvals';
import type { Attachment } from '../components/composer/attachments';

type AgentEvent =
  | { type: 'attached'; pendingApprovals: Approval[] }
  | { type: 'output'; line: string; parsed: any }
  | { type: 'approval_request'; approvalId: string; toolName: string; input: any }
  | { type: 'approval_resolved'; approvalId: string; decision: 'approve' | 'deny'; reason?: string }
  | { type: 'stderr'; line: string }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'error'; message: string };

export function useAgentStream(session: Session, initialEvents: SessionEvent[]) {
  const [bubbles, setBubbles] = useState<Bubble[]>(() => eventsToBubbles(initialEvents));
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(
    session.derived_state === 'working' || session.derived_state === 'launching'
  );

  const [queuedMessages, setQueuedMessages] = useState<QueuedBubble[]>([]);
  const queueRef = useRef<QueuedBubble[]>([]);

  const bubbleIdCounter = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef(0);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef<Map<string, string>>(new Map());

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
          streamingMessageIdRef.current = null;
          const next = queueRef.current[0];
          if (next) {
            queueRef.current = queueRef.current.slice(1);
            setQueuedMessages([...queueRef.current]);
            setBubbles(prev => [...prev, {
              kind: 'user' as const,
              id: next.id,
              text: next.text,
              ...(next.images?.length ? { images: next.images } : {}),
            }]);
          } else {
            setWorking(false);
          }
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
      case 'exit': {
        const text =
          ev.signal === 'SIGTERM' || ev.code === 143
            ? 'agent stopped (idle timeout)'
            : `agent exited (code=${ev.code ?? '?'})`;
        addBubble({ kind: 'system', text } as Bubble);
        setConnected(false);
        setWorking(false);
        streamingMessageIdRef.current = null;
        queueRef.current = [];
        setQueuedMessages([]);
        notify(`Session finished`, session.display_name ?? 'Session');
        break;
      }
      case 'error':
        addBubble({ kind: 'system', text: `agent error: ${ev.message}` } as Bubble);
        setConnected(false);
        setWorking(false);
        streamingMessageIdRef.current = null;
        queueRef.current = [];
        setQueuedMessages([]);
        notify(`Agent error`, ev.message);
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

  const sendPrompt = useCallback(async (text: string, imgs: Attachment[] = []) => {
    if (pending) return;
    if (!text.trim() && imgs.length === 0) return;
    const images = imgs.length ? imgs.map(a => ({ dataUrl: a.dataUrl })) : undefined;

    const hasActiveUserTurn = working && bubbles.some(b => b.kind === 'user');
    let queuedId: string | undefined;

    if (hasActiveUserTurn) {
      queuedId = nextLiveId();
      const queued: QueuedBubble = {
        kind: 'queued',
        id: queuedId,
        text,
        ...(images ? { images } : {}),
      };
      queueRef.current = [...queueRef.current, queued];
      setQueuedMessages([...queueRef.current]);
    } else {
      addBubble({
        kind: 'user',
        text,
        ...(images ? { images } : {}),
      } as Bubble);
      setWorking(true);
    }

    setPending(true);
    try {
      const apiImages = imgs.map(a => ({ mediaType: a.mediaType, data: a.base64 }));
      await api.sendMessage(session.id, text, apiImages);
    } catch (e) {
      addBubble({ kind: 'system', text: `error: ${(e as Error).message}` } as Bubble);
      if (hasActiveUserTurn && queuedId) {
        queueRef.current = queueRef.current.filter(q => q.id !== queuedId);
        setQueuedMessages([...queueRef.current]);
      } else {
        setWorking(false);
      }
    } finally {
      setPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, pending, working, bubbles]);

  async function resolveApproval(
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

  return {
    connected,
    bubbles,
    queuedMessages,
    approvals,
    working,
    pending,
    sendPrompt,
    resolveApproval,
    interrupt,
    enterPlanMode,
    addBubble,
    reconnectSSE,
  };
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
