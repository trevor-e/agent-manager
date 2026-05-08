import { stat, readFile } from 'node:fs/promises';

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUSD: number;
};

// USD per million tokens. Approximate Anthropic public list prices.
const PRICE_PER_M: Record<
  'opus' | 'sonnet' | 'haiku',
  { input: number; output: number; cacheRead: number; cacheCreation: number }
> = {
  opus:   { input: 15,   output: 75,  cacheRead: 1.5,  cacheCreation: 18.75 },
  sonnet: { input: 3,    output: 15,  cacheRead: 0.3,  cacheCreation: 3.75 },
  haiku:  { input: 1,    output: 5,   cacheRead: 0.1,  cacheCreation: 1.25 },
};

function priceFor(model: string) {
  if (model.includes('opus')) return PRICE_PER_M.opus;
  if (model.includes('sonnet')) return PRICE_PER_M.sonnet;
  if (model.includes('haiku')) return PRICE_PER_M.haiku;
  return null;
}

type CacheEntry = { mtimeMs: number; size: number; totals: UsageTotals };
const cache = new Map<string, CacheEntry>();

export async function computeUsage(path: string): Promise<UsageTotals | null> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return null;
  }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.totals;
  }

  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return null;
  }

  // Streaming writes can emit the same assistant message multiple times. Dedupe
  // by message.id, keeping the last usage block (which has the final totals).
  const byId = new Map<string, { model: string; usage: Record<string, unknown> }>();
  const anonymous: Array<{ model: string; usage: Record<string, unknown> }> = [];

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
    const model: string = typeof msg.model === 'string' ? msg.model : '';
    if (!model || model === '<synthetic>') continue;
    const usage = msg.usage;
    if (!usage || typeof usage !== 'object') continue;
    if (typeof msg.id === 'string' && msg.id) {
      byId.set(msg.id, { model, usage });
    } else {
      anonymous.push({ model, usage });
    }
  }

  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUSD: 0,
  };

  for (const { model, usage } of [...byId.values(), ...anonymous]) {
    const input = numField(usage, 'input_tokens');
    const output = numField(usage, 'output_tokens');
    const cr = numField(usage, 'cache_read_input_tokens');
    const cc = numField(usage, 'cache_creation_input_tokens');
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += cr;
    totals.cacheCreationTokens += cc;
    const p = priceFor(model);
    if (p) {
      totals.costUSD +=
        (input * p.input + output * p.output + cr * p.cacheRead + cc * p.cacheCreation) /
        1_000_000;
    }
  }
  totals.totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;

  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, totals });
  return totals;
}

function numField(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
