import type { FastifyInstance } from 'fastify';
import { getMeta, setMeta } from '../../db.ts';
import { config } from '../../config.ts';

const KNOWN_KEYS = ['linear_api_key'] as const;

function mask(val: string): string {
  if (val.length <= 8) return '****';
  return val.slice(0, 4) + '...' + val.slice(-4);
}

export function registerKeyRoutes(app: FastifyInstance) {
  app.get('/api/keys', async () => {
    const linear = config.linearApiKey || getMeta('linear_api_key') || '';
    return {
      keys: {
        linear_api_key: {
          set: !!linear,
          source: config.linearApiKey ? 'env' : linear ? 'db' : null,
          masked: linear ? mask(linear) : null,
        },
      },
    };
  });

  app.put<{ Body: { linear_api_key?: string | null } }>('/api/keys', async (req) => {
    const body = req.body ?? {};
    if ('linear_api_key' in body) {
      setMeta('linear_api_key', body.linear_api_key || null);
    }
    return { ok: true };
  });
}
