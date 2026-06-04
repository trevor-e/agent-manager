// Seed/upgrade the built-in workflows on boot.
//
// A built-in is (re)written only when it is missing or when the stored copy is
// an older version than the code. User-authored workflows (builtin = 0) and
// user edits to a built-in are preserved until the built-in version bumps.

import { getWorkflow, upsertWorkflow } from '../db.ts';
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
}
