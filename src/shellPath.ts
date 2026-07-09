import { execFile } from 'node:child_process';
import { log } from './log.ts';

// GUI-launched processes on macOS get launchd's minimal PATH, not the login
// shell's. If this server is ever started outside a terminal (LaunchAgent,
// login item), agents it spawns would fail to find git/gh/node. Resolve the
// login shell's PATH once at startup and use it for agent spawns.

const MARKER = '__CM_SHELL_PATH__';

let resolved: string | null = null;

export function shellPath(): string {
  return resolved ?? process.env.PATH ?? '';
}

export async function resolveShellPath(): Promise<void> {
  const shell = process.env.SHELL ?? '/bin/zsh';
  try {
    const stdout = await new Promise<string>((res, rej) => {
      // Markers isolate $PATH from anything rc files print to stdout.
      execFile(
        shell,
        ['-ilc', `printf '%s' '${MARKER}' "$PATH" '${MARKER}'`],
        { timeout: 5000 },
        (err, out) => (err ? rej(err) : res(String(out)))
      );
    });
    const match = stdout.match(new RegExp(`${MARKER}(.*?)${MARKER}`, 's'));
    if (match?.[1]) {
      resolved = match[1];
      log('info', 'shell-path', 'resolved login shell PATH', { shell });
    } else {
      log('warn', 'shell-path', 'no PATH in login shell output, using process PATH', { shell });
    }
  } catch (err) {
    log('warn', 'shell-path', 'failed to resolve login shell PATH, using process PATH', {
      shell,
      message: (err as Error).message,
    });
  }
}
