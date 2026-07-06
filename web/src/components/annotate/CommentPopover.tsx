import { useEffect, useRef, useState } from 'react';

export function CommentPopover({
  rect,
  quote,
  initialText = '',
  onSave,
  onDelete,
  onClose,
}: {
  rect: DOMRect;
  quote: string;
  initialText?: string;
  onSave: (text: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onClose]);

  const top = Math.min(rect.bottom + 6, window.innerHeight - 180);
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 300);

  function save() {
    const trimmed = text.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    onSave(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  return (
    <div
      ref={containerRef}
      className="annotate-popover"
      style={{ top, left }}
      onKeyDown={handleKeyDown}
    >
      <div className="annotate-popover-quote small muted">
        {quote.length > 160 ? quote.slice(0, 160) + '…' : quote}
      </div>
      <textarea
        ref={textareaRef}
        className="annotate-popover-textarea"
        placeholder="Leave a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="annotate-popover-actions">
        {onDelete && (
          <button type="button" className="ghost small" onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="ghost small" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary small" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
