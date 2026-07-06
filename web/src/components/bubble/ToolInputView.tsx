import { useState } from 'react';
import { UnifiedDiff, AdditionsView } from '../UnifiedDiff';
import { Markdown } from '../Markdown';
import { formatShellCommand } from '../../shellFormat';

const MARKDOWN_EXT = /\.(md|mdx|markdown)$/i;

function isMarkdownPath(filePath?: string): boolean {
  return !!filePath && MARKDOWN_EXT.test(filePath);
}

function DiffModeTabs({
  mode,
  onChange,
  labels = ['Diff', 'Preview'],
}: {
  mode: 'raw' | 'preview';
  onChange: (mode: 'raw' | 'preview') => void;
  labels?: [string, string];
}) {
  return (
    <div className="diff-mode-tabs">
      <button type="button" className={'tab' + (mode === 'raw' ? ' tab-on' : '')} onClick={() => onChange('raw')}>
        {labels[0]}
      </button>
      <button type="button" className={'tab' + (mode === 'preview' ? ' tab-on' : '')} onClick={() => onChange('preview')}>
        {labels[1]}
      </button>
    </div>
  );
}

function MarkdownEditView({ oldText, newText, filePath }: { oldText: string; newText: string; filePath?: string }) {
  const [mode, setMode] = useState<'raw' | 'preview'>('preview');
  return (
    <div>
      <div className="diff-mode-row">
        <DiffModeTabs mode={mode} onChange={setMode} />
      </div>
      {mode === 'raw' ? (
        <UnifiedDiff oldText={oldText} newText={newText} filePath={filePath} />
      ) : (
        <div className="diff">
          {filePath && <div className="diff-header mono">{filePath}</div>}
          <div className="md-preview-pair">
            <div className="md-preview-block">
              <div className="md-preview-label muted small">− before</div>
              <Markdown>{oldText}</Markdown>
            </div>
            <div className="md-preview-block">
              <div className="md-preview-label muted small">+ after</div>
              <Markdown>{newText}</Markdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MarkdownWriteView({ content, filePath }: { content: string; filePath?: string }) {
  const [mode, setMode] = useState<'raw' | 'preview'>('preview');
  return (
    <div>
      <div className="diff-mode-row">
        <DiffModeTabs mode={mode} onChange={setMode} labels={['Raw', 'Preview']} />
      </div>
      {mode === 'raw' ? (
        <AdditionsView content={content} filePath={filePath} />
      ) : (
        <div className="diff">
          {filePath && <div className="diff-header mono">{filePath}</div>}
          <div className="md-preview-block md-preview-full">
            <Markdown>{content}</Markdown>
          </div>
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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
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
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
    return (
      <div className="tool-fields">
        {isMarkdownPath(filePath) ? (
          <MarkdownEditView oldText={input.old_string} newText={input.new_string} filePath={filePath} />
        ) : (
          <UnifiedDiff oldText={input.old_string} newText={input.new_string} filePath={filePath} />
        )}
        {input.replace_all && <div className="muted small">replace_all: true</div>}
      </div>
    );
  }

  if (toolName === 'Write' && typeof input.content === 'string') {
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
    return (
      <div className="tool-fields">
        {isMarkdownPath(filePath) ? (
          <MarkdownWriteView content={input.content} filePath={filePath} />
        ) : (
          <AdditionsView content={input.content} filePath={filePath} />
        )}
      </div>
    );
  }

  if (toolName === 'Bash' && typeof input.command === 'string') {
    const { command, ...rest } = input;
    const entries = Object.entries(rest);
    return (
      <div className="tool-fields">
        <div className="tool-field">
          <div className="tool-field-label">command</div>
          <pre className="tool-field-value bash-command">{formatShellCommand(command)}</pre>
        </div>
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
