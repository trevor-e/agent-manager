const DANGEROUS_BASH_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(-\w*[rf])\b/, 'recursive/force delete'],
  [/\bgit\s+push\s+.*--force\b/, 'force push'],
  [/\bgit\s+push\s+-f\b/, 'force push'],
  [/\bgit\s+reset\s+--hard\b/, 'hard reset'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'force clean'],
  [/\bgit\s+checkout\s+\.\s*$/, 'discard all changes'],
  [/\bgit\s+branch\s+-D\b/, 'force delete branch'],
  [/\bDROP\s+(TABLE|DATABASE)\b/i, 'drop table/database'],
  [/\bDELETE\s+FROM\b/i, 'delete rows'],
  [/\bTRUNCATE\b/i, 'truncate table'],
  [/\bchmod\s+777\b/, 'world-writable permissions'],
  [/\bcurl\b.*\|\s*(ba)?sh\b/, 'pipe to shell'],
  [/\bwget\b.*\|\s*(ba)?sh\b/, 'pipe to shell'],
  [/>\s*\/dev\//, 'write to device'],
  [/\bmkfs\b/, 'format filesystem'],
  [/\bdd\s+/, 'raw disk write'],
  [/--no-verify\b/, 'skip verification hooks'],
];

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.env($|\.)/,
  /credentials/i,
  /id_rsa/,
  /id_ed25519/,
  /\.pem$/,
  /\/etc\//,
  /\.ssh\//,
  /\.aws\//,
  /secrets?\./i,
];

export type DangerResult = { dangerous: boolean; reason: string };

export function detectDanger(toolName: string, input: unknown): DangerResult {
  if (!input || typeof input !== 'object') return { dangerous: false, reason: '' };
  const inp = input as Record<string, unknown>;

  if (toolName === 'Bash' && typeof inp.command === 'string') {
    for (const [pattern, reason] of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(inp.command)) {
        return { dangerous: true, reason };
      }
    }
  }

  const filePath =
    typeof inp.file_path === 'string' ? inp.file_path :
    typeof inp.path === 'string' ? inp.path : null;

  if (filePath && (toolName === 'Edit' || toolName === 'Write')) {
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(filePath)) {
        return { dangerous: true, reason: `writing to sensitive path` };
      }
    }
  }

  return { dangerous: false, reason: '' };
}
