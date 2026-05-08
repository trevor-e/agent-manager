import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../config.ts';

export type ModelPricing = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheCreationCostPerToken: number;
  cacheCreationCostPerTokenAbove1hr: number;
};

const SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_PATH = resolve(dirname(config.dbPath), 'litellm-prices.json');
const TTL_MS = 24 * 60 * 60 * 1000;

type RawEntry = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  litellm_provider?: string;
};
type RawJson = Record<string, RawEntry>;

let raw: RawJson | null = null;
let loadPromise: Promise<RawJson> | null = null;

async function readDiskCache(): Promise<{ json: RawJson; mtimeMs: number } | null> {
  try {
    const [st, content] = await Promise.all([stat(CACHE_PATH), readFile(CACHE_PATH, 'utf8')]);
    return { json: JSON.parse(content), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

async function fetchAndCache(): Promise<RawJson | null> {
  try {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) return null;
    const text = await res.text();
    const json = JSON.parse(text);
    await mkdir(dirname(CACHE_PATH), { recursive: true });
    await writeFile(CACHE_PATH, text, 'utf8');
    return json;
  } catch {
    return null;
  }
}

async function load(): Promise<RawJson> {
  const disk = await readDiskCache();
  if (disk && Date.now() - disk.mtimeMs < TTL_MS) return disk.json;

  const fetched = await fetchAndCache();
  if (fetched) return fetched;

  // Fetch failed — fall back to whatever's on disk, even if stale.
  if (disk) return disk.json;
  return {};
}

function ensureLoaded(): Promise<RawJson> {
  if (raw) return Promise.resolve(raw);
  if (!loadPromise) {
    loadPromise = load().then((j) => {
      raw = j;
      return j;
    });
  }
  return loadPromise;
}

// Strip provider prefixes (us., bedrock/, vertex_ai/, etc.) and try a few
// variants so we land on the canonical entry.
function lookupKey(json: RawJson, model: string): RawEntry | null {
  if (json[model]) return json[model];
  const stripped = model.replace(/^[a-z]+\//, '').replace(/^[a-z]{2,3}\./, '');
  if (json[stripped]) return json[stripped];
  return null;
}

export async function getModelPricing(model: string): Promise<ModelPricing | null> {
  const json = await ensureLoaded();
  const entry = lookupKey(json, model);
  if (!entry || typeof entry.input_cost_per_token !== 'number') return null;
  return {
    inputCostPerToken: entry.input_cost_per_token,
    outputCostPerToken: entry.output_cost_per_token ?? 0,
    cacheReadCostPerToken: entry.cache_read_input_token_cost ?? 0,
    cacheCreationCostPerToken: entry.cache_creation_input_token_cost ?? 0,
    cacheCreationCostPerTokenAbove1hr:
      entry.cache_creation_input_token_cost_above_1hr ??
      entry.cache_creation_input_token_cost ??
      0,
  };
}
