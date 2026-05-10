import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '../api';
import type { RepoSummary, Session, SessionEvent } from '../types';
import { type Bubble, type ToolUseBubble, BubbleRow } from './Bubble';
import { ApprovalModal, type ResolveOpts } from './composer/approvals';
import { type Attachment, processAttachmentFiles } from './composer/attachments';
import { QuickActions } from './composer/QuickActions';
import { useAgentStream } from '../hooks/useAgentStream';

export function Composer({
  session,
  initialEvents,
  repos = [],
}: {
  session: Session;
  initialEvents: SessionEvent[];
  repos?: RepoSummary[];
}) {
  const agent = useAgentStream(session, initialEvents);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentIdCounter = useRef(0);

  const showCoexistWarning = session.is_running;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agent.bubbles, agent.approvals, agent.working]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [session.id]);

  useEffect(() => {
    const pending = agent.approvals[0];
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        agent.resolveApproval(pending.approvalId, 'deny');
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [agent.approvals]);

  async function send() {
    if (agent.pending) return;
    if (!draft.trim() && attachments.length === 0) return;
    const text = draft;
    const imgs = attachments;
    setDraft('');
    setAttachments([]);
    setAttachError(null);
    await agent.sendPrompt(text, imgs);
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

  async function handleResolve(decision: 'approve' | 'deny', opts: ResolveOpts = {}) {
    const approval = agent.approvals[0];
    if (!approval) return;
    await agent.resolveApproval(approval.approvalId, decision, opts);
    if (agent.approvals.length <= 1) {
      textareaRef.current?.focus();
    }
  }

  async function addDirectory(path: string) {
    if (!path.trim()) return;
    agent.addBubble({ kind: 'system', text: `adding ${path} to context — agent will restart…` } as Bubble);
    try {
      const resp = await api.addDir(session.id, path.trim());
      if (resp.restarted) {
        setTimeout(() => agent.reconnectSSE(), 1000);
      }
    } catch (e) {
      agent.addBubble({ kind: 'system', text: `failed to add directory: ${(e as Error).message}` } as Bubble);
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
          Conversation {agent.connected ? <span className="dot dot-on" title="connected" /> : <span className="dot dot-off" title="disconnected" />}
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
        {agent.bubbles.length === 0 && (
          <div className="muted small pad">No messages yet — say something to wake up the agent.</div>
        )}
        {agent.bubbles.map(b => <BubbleRow key={b.id} bubble={b} />)}
        {agent.working && shouldShowThinking(agent.bubbles) && <ThinkingBubble />}
      </div>

      <QuickActions
        pending={agent.pending}
        session={session}
        repos={repos}
        onSendPrompt={agent.sendPrompt}
        onEnterPlanMode={agent.enterPlanMode}
        onAddDirectory={addDirectory}
      />

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
          <button className="ghost" onClick={agent.interrupt} title="Stop the current generation (chat keeps going)">
            Interrupt
          </button>
          <button
            className="primary"
            disabled={agent.pending || (!draft.trim() && attachments.length === 0)}
            onClick={send}
          >
            {agent.pending ? 'sending…' : 'Send'}
          </button>
        </div>
      </div>

      {agent.approvals[0] && (
        <ApprovalModal
          key={agent.approvals[0].approvalId}
          approval={agent.approvals[0]}
          onResolve={handleResolve}
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
