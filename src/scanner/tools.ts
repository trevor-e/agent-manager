import { stat, readFile } from 'node:fs/promises';

export type ToolUsageCounts = Record<string, number>;

type CacheEntry = { mtimeMs: number; size: number; counts: ToolUsageCounts };
const cache = new Map<string, CacheEntry>();

export async function computeToolUsage(path: string): Promise<ToolUsageCounts | null> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return null;
  }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.counts;
  }

  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return null;
  }

  const counts: ToolUsageCounts = {};

  for (const line of content.split('\n')) {
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object' || o.type !== 'assistant') continue;
    const msg = o.message;
    if (!msg || typeof msg !== 'object') continue;
    const contentArr = msg.content;
    if (!Array.isArray(contentArr)) continue;
    for (const block of contentArr) {
      if (block && block.type === 'tool_use' && typeof block.name === 'string') {
        counts[block.name] = (counts[block.name] || 0) + 1;
      }
    }
  }

  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, counts });
  return counts;
}
