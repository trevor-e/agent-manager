import { stat, readFile } from 'node:fs/promises';
import { getModelPricing, getModelContextWindow } from './pricing.ts';
import type { UsageTotals } from '../shared/types.ts';

export type { UsageTotals } from '../shared/types.ts';

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
  // Tracks the most recently seen assistant usage block (in file/chronological
  // order) — that's the current context size, as opposed to the cumulative
  // totals below which sum every turn.
  let last: { model: string; usage: Record<string, unknown> } | null = null;

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
    last = { model, usage };
  }

  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUSD: 0,
  };

  const pricingByModel = new Map<string, Awaited<ReturnType<typeof getModelPricing>>>();

  for (const { model, usage } of [...byId.values(), ...anonymous]) {
    const input = numField(usage, 'input_tokens');
    const output = numField(usage, 'output_tokens');
    const cr = numField(usage, 'cache_read_input_tokens');
    const cc = numField(usage, 'cache_creation_input_tokens');
    const cacheBlock = (usage as any).cache_creation;
    const cc1h =
      cacheBlock && typeof cacheBlock === 'object'
        ? numField(cacheBlock, 'ephemeral_1h_input_tokens')
        : 0;
    const cc5m =
      cacheBlock && typeof cacheBlock === 'object'
        ? numField(cacheBlock, 'ephemeral_5m_input_tokens')
        : 0;

    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += cr;
    totals.cacheCreationTokens += cc;

    if (!pricingByModel.has(model)) {
      pricingByModel.set(model, await getModelPricing(model));
    }
    const p = pricingByModel.get(model);
    if (p) {
      // Prefer the breakdown from cache_creation when present; fall back to the
      // flat cache_creation_input_tokens at the 5m rate if it isn't.
      const breakdownTotal = cc1h + cc5m;
      const ccFlatRemainder = breakdownTotal > 0 ? 0 : cc;
      totals.costUSD +=
        input * p.inputCostPerToken +
        output * p.outputCostPerToken +
        cr * p.cacheReadCostPerToken +
        cc1h * p.cacheCreationCostPerTokenAbove1hr +
        cc5m * p.cacheCreationCostPerToken +
        ccFlatRemainder * p.cacheCreationCostPerToken;
    }
  }
  totals.totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;

  if (last) {
    totals.contextTokens =
      numField(last.usage, 'input_tokens') +
      numField(last.usage, 'cache_read_input_tokens') +
      numField(last.usage, 'cache_creation_input_tokens');
    const window = await getModelContextWindow(last.model);
    if (window) totals.contextWindow = window;
  }

  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, totals });
  return totals;
}

function numField(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
