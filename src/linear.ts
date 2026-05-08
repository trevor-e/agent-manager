import { config } from './config.ts';
import { getMeta } from './db.ts';
import { log } from './log.ts';

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  url: string;
  state: { id: string; name: string; type: string };
  assignee: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
};

export type LinearProject = {
  id: string;
  name: string;
  issueCount: number;
};

const ENDPOINT = 'https://api.linear.app/graphql';
const CACHE_TTL_MS = 60_000;

type CacheEntry<T> = { data: T; expiry: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.expiry > Date.now()) return Promise.resolve(entry.data);
  return fn().then(data => {
    cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
    return data;
  });
}

function getApiKey(): string {
  return config.linearApiKey || getMeta('linear_api_key') || '';
}

export function isConfigured(): boolean {
  return !!getApiKey();
}

async function linearQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Linear API key not configured');
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Linear API ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL: ${json.errors[0].message}`);
  }
  return json.data!;
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  url
  state { id name type }
  assignee { id name }
  project { id name }
  labels { nodes { id name } }
`;

function normalizeIssue(raw: any): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? null,
    priority: raw.priority ?? 0,
    url: raw.url,
    state: raw.state ?? { id: '', name: 'Unknown', type: 'unstarted' },
    assignee: raw.assignee ?? null,
    project: raw.project ?? null,
    labels: raw.labels?.nodes ?? [],
  };
}

export async function listMyIssues(opts: { projectId?: string; stateType?: string } = {}): Promise<LinearIssue[]> {
  const cacheKey = `issues:${opts.projectId ?? ''}:${opts.stateType ?? ''}`;
  return cached(cacheKey, async () => {
    const filters: string[] = [];
    if (opts.projectId) filters.push(`project: { id: { eq: "${opts.projectId}" } }`);
    if (opts.stateType) filters.push(`state: { type: { eq: "${opts.stateType}" } }`);
    const filterArg = filters.length ? `(filter: { ${filters.join(', ')} })` : '';

    const data = await linearQuery<{ viewer: { assignedIssues: { nodes: any[] } } }>(`
      query {
        viewer {
          assignedIssues${filterArg} {
            nodes { ${ISSUE_FIELDS} }
          }
        }
      }
    `);
    return data.viewer.assignedIssues.nodes.map(normalizeIssue);
  });
}

export async function listProjects(): Promise<LinearProject[]> {
  return cached('projects', async () => {
    const data = await linearQuery<{ projects: { nodes: any[] } }>(`
      query {
        projects(first: 100) {
          nodes {
            id
            name
            issues { nodes { id } }
          }
        }
      }
    `);
    return data.projects.nodes.map((p: any) => ({
      id: p.id,
      name: p.name,
      issueCount: p.issues?.nodes?.length ?? 0,
    }));
  });
}

export async function getIssue(idOrIdentifier: string): Promise<LinearIssue> {
  const isUuid = idOrIdentifier.includes('-') && idOrIdentifier.length > 10;
  const query = isUuid
    ? `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`
    : `query($id: String!) { issueVcsBranchSearch(branchName: $id) { ${ISSUE_FIELDS} } }`;

  try {
    const data = await linearQuery<{ issue?: any; issueVcsBranchSearch?: any }>(
      `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
      { id: idOrIdentifier }
    );
    if (data.issue) return normalizeIssue(data.issue);
  } catch {
    // Fall through to identifier search
  }

  const searchData = await linearQuery<{ issues: { nodes: any[] } }>(`
    query($q: String!) {
      issues(filter: { identifier: { eq: $q } }, first: 1) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `, { q: idOrIdentifier });

  if (!searchData.issues.nodes.length) {
    throw new Error(`Linear issue not found: ${idOrIdentifier}`);
  }
  return normalizeIssue(searchData.issues.nodes[0]);
}
