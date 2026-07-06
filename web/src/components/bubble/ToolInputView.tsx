import { UnifiedDiff, AdditionsView } from '../UnifiedDiff';
import { formatShellCommand } from '../../shellFormat';

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
