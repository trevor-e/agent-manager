import { useCallback, useMemo, useRef, useState } from 'react';
import { Markdown, type BlockRenderer } from '../Markdown';
import type { MermaidNodeClick } from '../markdown/Mermaid';
import { CommentPopover } from './CommentPopover';
import { compileAnnotations } from './compileAnnotations';
import type { Annotation } from './types';

type PendingComment = {
  id: string;
  quote: string;
  rect: DOMRect;
  initialText: string;
  isNew: boolean;
};

export function AnnotatableMarkdown({
  text,
  onSend,
}: {
  text: string;
  onSend: (compiled: string) => void;
}) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pending, setPending] = useState<PendingComment | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const commentedIds = useMemo(() => new Set(annotations.map((a) => a.id)), [annotations]);

  const wrapBlock: BlockRenderer = useCallback(
    ({ Tag, tagProps, children, blockId, text: blockText }) => {
      const isCommented = commentedIds.has(blockId);
      const { className, ...rest } = tagProps;
      return (
        <Tag
          {...rest}
          className={[className, 'annotate-block', isCommented ? 'annotate-block-commented' : '']
            .filter(Boolean)
            .join(' ')}
          data-annotate-block={blockId}
          data-annotate-quote={blockText}
        >
          {children}
          <button
            type="button"
            className="annotate-plus"
            data-annotate-plus="true"
            aria-label={isCommented ? 'Edit comment' : 'Add comment'}
          >
            {isCommented ? '💬' : '+'}
          </button>
        </Tag>
      );
    },
    [commentedIds]
  );

  function handleContainerClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const plusBtn = target.closest('[data-annotate-plus]') as HTMLElement | null;
    if (!plusBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const blockEl = plusBtn.closest('[data-annotate-block]') as HTMLElement | null;
    if (!blockEl) return;
    const blockId = blockEl.getAttribute('data-annotate-block')!;
    const quote = blockEl.getAttribute('data-annotate-quote') || blockEl.textContent || '';
    const existing = annotations.find((a) => a.id === blockId);
    setPending({
      id: blockId,
      quote,
      rect: blockEl.getBoundingClientRect(),
      initialText: existing?.comment ?? '',
      isNew: !existing,
    });
  }

  function handleMermaidNodeClick(info: MermaidNodeClick) {
    const existing = annotations.find((a) => a.quote === info.quote);
    setPending({
      id: existing?.id ?? crypto.randomUUID(),
      quote: info.quote,
      rect: info.rect,
      initialText: existing?.comment ?? '',
      isNew: !existing,
    });
  }

  function savePending(comment: string) {
    if (!pending) return;
    const current = pending;
    setAnnotations((prev) => [...prev.filter((a) => a.id !== current.id), { id: current.id, quote: current.quote, comment }]);
    setPending(null);
  }

  function deletePending() {
    if (!pending) return;
    const current = pending;
    setAnnotations((prev) => prev.filter((a) => a.id !== current.id));
    setPending(null);
  }

  function sendFeedback() {
    onSend(compileAnnotations(annotations));
    setAnnotations([]);
  }

  return (
    <div className="annotate-root" ref={containerRef} onClick={handleContainerClick}>
      <Markdown onMermaidNodeClick={handleMermaidNodeClick} blockWrap={wrapBlock}>
        {text}
      </Markdown>
      {annotations.length > 0 && (
        <div className="annotate-feedback-bar">
          <span className="small muted">
            {annotations.length} comment{annotations.length === 1 ? '' : 's'}
          </span>
          <button type="button" className="ghost small" onClick={() => setAnnotations([])}>
            Clear
          </button>
          <button type="button" className="primary small" onClick={sendFeedback}>
            Send feedback
          </button>
        </div>
      )}
      {pending && (
        <CommentPopover
          rect={pending.rect}
          quote={pending.quote}
          initialText={pending.initialText}
          onSave={savePending}
          onDelete={pending.isNew ? undefined : deletePending}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
