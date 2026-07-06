import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import type { SubagentSummary } from '../shared/types.ts';

// Subagent transcripts don't live next to the parent .jsonl — the CLI writes
// them under <sessionId>/subagents/agent-<agentId>.jsonl (plus a sibling
// .meta.json with the toolUseId that links it back to the parent's Agent
// tool_use block). The main jsonl scanner never looks in there.
const AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/;

function subagentsDir(jsonlPath: string): string {
  return join(dirname(jsonlPath), basename(jsonlPath, '.jsonl'), 'subagents');
}

export async function listSubagentSummaries(jsonlPath: string): Promise<SubagentSummary[]> {
  const dir = subagentsDir(jsonlPath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: SubagentSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    const agentId = basename(entry, '.meta.json').replace(/^agent-/, '');
    if (!AGENT_ID_RE.test(agentId)) continue;
    try {
      const raw = await readFile(join(dir, entry), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      summaries.push({
        agentId,
        toolUseId: typeof parsed.toolUseId === 'string' ? parsed.toolUseId : null,
        agentType: typeof parsed.agentType === 'string' ? parsed.agentType : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
      });
    } catch {
      continue;
    }
  }
  return summaries;
}

export async function readSubagentEvents(jsonlPath: string, agentId: string): Promise<unknown[] | null> {
  if (!AGENT_ID_RE.test(agentId)) return null;
  const path = join(subagentsDir(jsonlPath), `agent-${agentId}.jsonl`);
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const events: unknown[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore corrupt lines
    }
  }
  return events;
}
