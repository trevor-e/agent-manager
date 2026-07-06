// Splits a shell command onto multiple lines at top-level `&&`, `||`, `|`, and `;`
// so long chained one-liners are easier to read in the approval modal. Skips
// operators inside quotes or parens/subshells, and leaves already-multiline
// commands (heredocs, scripts) untouched.
export function formatShellCommand(cmd: string): string {
  if (!cmd || cmd.includes('\n')) return cmd;

  const lines: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let parenDepth = 0;
  let i = 0;
  const n = cmd.length;

  const pushLine = (suffix: string) => {
    lines.push(current.trimEnd() + suffix);
    current = '';
  };

  while (i < n) {
    const ch = cmd[i];

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < n) {
      current += ch + cmd[i + 1];
      i += 2;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      i++;
      continue;
    }

    if (parenDepth === 0) {
      if (cmd.startsWith('&&', i)) {
        pushLine(' &&');
        i += 2;
        while (cmd[i] === ' ') i++;
        continue;
      }
      if (cmd.startsWith('||', i)) {
        pushLine(' ||');
        i += 2;
        while (cmd[i] === ' ') i++;
        continue;
      }
      if (ch === '|' && cmd[i + 1] !== '|') {
        pushLine(' |');
        i += 1;
        while (cmd[i] === ' ') i++;
        continue;
      }
      if (ch === ';') {
        pushLine(';');
        i += 1;
        while (cmd[i] === ' ') i++;
        continue;
      }
    }

    current += ch;
    i++;
  }
  lines.push(current.trimEnd());

  if (lines.length <= 1) return cmd;
  return lines.map((l, idx) => (idx === 0 ? l : '  ' + l)).join('\n');
}
