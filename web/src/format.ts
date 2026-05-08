import type { UsageTotals } from './types';

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

export function usageTooltip(u: UsageTotals): string {
  return [
    `input: ${u.inputTokens.toLocaleString()}`,
    `output: ${u.outputTokens.toLocaleString()}`,
    `cache read: ${u.cacheReadTokens.toLocaleString()}`,
    `cache write: ${u.cacheCreationTokens.toLocaleString()}`,
    `total: ${u.totalTokens.toLocaleString()}`,
    `est. cost: $${u.costUSD.toFixed(4)}`,
  ].join('\n');
}
