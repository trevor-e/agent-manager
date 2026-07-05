// Seed/upgrade the built-in workflows on boot.
//
// A built-in is (re)written only when it is missing or when the stored copy is
// an older version than the code. User-authored workflows (builtin = 0) and
// user edits to a built-in are preserved until the built-in version bumps.

import { getWorkflow, upsertWorkflow, listWorkflows, deleteWorkflow } from '../db.ts';
import { log } from '../log.ts';
import { BUILTIN_WORKFLOWS, BUILTIN_WORKFLOW_VERSION } from './builtins.ts';

export function seedBuiltinWorkflows() {
  let written = 0;
  for (const wf of BUILTIN_WORKFLOWS) {
    const existing = getWorkflow(wf.id);
    if (existing && existing.version >= BUILTIN_WORKFLOW_VERSION) continue;
    upsertWorkflow({
      id: wf.id,
      label: wf.label,
      description: wf.description,
      body: wf.body,
      builtin: true,
      version: BUILTIN_WORKFLOW_VERSION,
    });
    written++;
  }
  if (written > 0) {
    log('info', 'workflows', `seeded ${written} built-in workflow(s)`, {
      version: BUILTIN_WORKFLOW_VERSION,
    });
  }

  // Drop built-ins that were removed from the catalog (e.g. retired workflows).
  // User-authored (builtin = 0) workflows are never touched here.
  const currentIds = new Set(BUILTIN_WORKFLOWS.map(wf => wf.id));
  let removed = 0;
  for (const row of listWorkflows()) {
    if (row.builtin === 1 && !currentIds.has(row.id)) {
      deleteWorkflow(row.id);
      removed++;
    }
  }
  if (removed > 0) {
    log('info', 'workflows', `removed ${removed} retired built-in workflow(s)`);
  }
}
