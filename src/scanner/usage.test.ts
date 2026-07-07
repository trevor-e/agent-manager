import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeUsage } from './usage.ts';

vi.mock('./pricing.ts', () => ({
  getModelPricing: vi.fn(async (model: string) => {
    if (model === 'claude-cheap') {
      return {
        inputCostPerToken: 1,
        outputCostPerToken: 2,
        cacheReadCostPerToken: 0.1,
        cacheCreationCostPerToken: 0.5,
        cacheCreationCostPerTokenAbove1hr: 1,
      };
    }
    return null;
  }),
  getModelContextWindow: vi.fn(async (model: string) => (model === 'claude-cheap' ? 200_000 : null)),
}));

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

function assistantLine(opts: {
  id?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}) {
  return {
    type: 'assistant',
    message: {
      id: opts.id,
      model: opts.model ?? 'claude-cheap',
      usage: {
        input_tokens: opts.input_tokens ?? 0,
        output_tokens: opts.output_tokens ?? 0,
        cache_read_input_tokens: opts.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: opts.cache_creation_input_tokens ?? 0,
        ...(opts.cache_creation ? { cache_creation: opts.cache_creation } : {}),
      },
    },
  };
}

async function writeJsonl(lines: unknown[]): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'usage-test-'));
  const path = join(dir, 'session.jsonl');
  await writeFile(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return path;
}

describe('computeUsage', () => {
  it('sums input/output/cache tokens across turns', async () => {
    const path = await writeJsonl([
      assistantLine({ id: 'a', input_tokens: 10, output_tokens: 5 }),
      assistantLine({ id: 'b', input_tokens: 20, output_tokens: 8 }),
    ]);
    const totals = await computeUsage(path);
    expect(totals?.inputTokens).toBe(30);
    expect(totals?.outputTokens).toBe(13);
    expect(totals?.totalTokens).toBe(43);
  });

  it('dedupes repeated assistant messages by id, keeping only the last usage block', async () => {
    const path = await writeJsonl([
      assistantLine({ id: 'a', input_tokens: 10, output_tokens: 5 }),
      assistantLine({ id: 'a', input_tokens: 10, output_tokens: 9 }), // streamed update, same id
    ]);
    const totals = await computeUsage(path);
    // Only the last usage block for id "a" should count, not both.
    expect(totals?.inputTokens).toBe(10);
    expect(totals?.outputTokens).toBe(9);
  });

  it('sums anonymous (id-less) messages independently instead of deduping them', async () => {
    const path = await writeJsonl([
      assistantLine({ input_tokens: 10, output_tokens: 5 }),
      assistantLine({ input_tokens: 10, output_tokens: 5 }),
    ]);
    const totals = await computeUsage(path);
    expect(totals?.inputTokens).toBe(20);
    expect(totals?.outputTokens).toBe(10);
  });

  it('ignores the synthetic model and non-assistant lines', async () => {
    const path = await writeJsonl([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      assistantLine({ id: 'a', model: '<synthetic>', input_tokens: 999 }),
      assistantLine({ id: 'b', input_tokens: 10, output_tokens: 5 }),
    ]);
    const totals = await computeUsage(path);
    expect(totals?.inputTokens).toBe(10);
  });

  it('computes cost using flat cache_creation_input_tokens when no cache_creation breakdown is present', async () => {
    const path = await writeJsonl([assistantLine({ id: 'a', cache_creation_input_tokens: 100 })]);
    const totals = await computeUsage(path);
    // pricing: cacheCreationCostPerToken = 0.5 per token
    expect(totals?.costUSD).toBeCloseTo(50);
  });

  it('prefers the cache_creation 1h/5m breakdown over the flat remainder when present', async () => {
    const path = await writeJsonl([
      assistantLine({
        id: 'a',
        cache_creation_input_tokens: 100,
        cache_creation: { ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 20 },
      }),
    ]);
    const totals = await computeUsage(path);
    // 10 * cacheCreationCostPerTokenAbove1hr(1) + 20 * cacheCreationCostPerToken(0.5) = 10 + 10 = 20
    // The flat 100 cache_creation_input_tokens is NOT also charged once a breakdown exists.
    expect(totals?.costUSD).toBeCloseTo(20);
  });

  it('leaves cost at 0 for a model with no known pricing', async () => {
    const path = await writeJsonl([assistantLine({ id: 'a', model: 'unknown-model', input_tokens: 100 })]);
    const totals = await computeUsage(path);
    expect(totals?.costUSD).toBe(0);
    expect(totals?.inputTokens).toBe(100);
  });

  it('reports contextTokens/contextWindow from the chronologically last usage block', async () => {
    const path = await writeJsonl([
      assistantLine({ id: 'a', input_tokens: 100, cache_read_input_tokens: 50 }),
      assistantLine({ id: 'b', input_tokens: 5, cache_read_input_tokens: 1 }),
    ]);
    const totals = await computeUsage(path);
    expect(totals?.contextTokens).toBe(6);
    expect(totals?.contextWindow).toBe(200_000);
  });

  it('returns null for a nonexistent file', async () => {
    const totals = await computeUsage('/nonexistent/path/session.jsonl');
    expect(totals).toBeNull();
  });

  it('skips unparsable lines without throwing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'usage-test-'));
    const path = join(dir, 'session.jsonl');
    await writeFile(path, 'not json\n' + JSON.stringify(assistantLine({ id: 'a', input_tokens: 7 })) + '\n', 'utf8');
    const totals = await computeUsage(path);
    expect(totals?.inputTokens).toBe(7);
  });
});
