// Built-in workflow playbooks.
//
// These are prompt templates injected as the opening message of a session.
// They are adapted from RepoPrompt's workflow catalog, but retargeted to
// Claude Code's native primitives: the `Task` tool (read-only explore /
// scoped engineer sub-agents) plus the built-in file, grep, and git tools.
// There is no MCP context_builder / oracle here — "curate context and reason
// over it" becomes "spawn an explore Task that reports the relevant files,
// then reason inline".
//
// Each template uses the literal token `$ARGUMENTS`, which the renderer
// replaces with the user-supplied task text at launch time.
//
// Bump BUILTIN_WORKFLOW_VERSION whenever any body below changes so the seeder
// overwrites the stored copy. User-authored (non-builtin) workflows are never
// touched by the seeder.

export const BUILTIN_WORKFLOW_VERSION = 2;

export type BuiltinWorkflow = {
  id: string;
  label: string;
  description: string;
  body: string;
};

const SHARED_DECOMPOSITION = `When you break work into items, give each one: a goal, a "done when" check, the key files, dependencies on other items, and a rough size. Keep items independently verifiable.`;

const PLAN = `Produce an implementation plan for the following. Do NOT implement anything —
this workflow ends at a written plan.

$ARGUMENTS

PHASE 1 — Orient (cheap)
- 1-2 quick tool calls to understand how this relates to the codebase. If it is
  ambiguous, ask the user one or two sharp clarifying questions before going wide.

PHASE 2 — Fan out exploration (parallel)
- Use the Task tool to spawn read-only sub-agents that map: the existing seams
  and patterns this work must fit into, any prior art already in the repo, and
  (if relevant) external docs or library constraints. Each returns a summary
  with file:line references.

PHASE 3 — Draft the plan
- Create docs/plans/<topic>-<YYYY-MM-DD>.md. Decompose the work into items.
  ${SHARED_DECOMPOSITION}
- For each item note the approach, the files it touches, and the risks.

PHASE 4 — Critique and polish
- Spawn one Task sub-agent to critique the draft as a skeptical reviewer (one
  page max: gaps, ordering problems, missed edge cases). Fold in what holds up.
- Finish with explicit acceptance criteria and an ordered task list. Hand the
  plan path back to the user; do not start editing code.

Anti-patterns:
- Sliding into implementation. Stop at the plan.
- A plan with no "done when" criteria or no ordering.`;

const REVIEW = `Review code changes for the following scope:

$ARGUMENTS

STEP 1 — Establish scope
- Determine exactly what to review and confirm with the user if ambiguous:
  uncommitted changes (default), staged only, the last N commits, a branch vs
  its base, or an explicit commit range.

STEP 2 — Survey the diff
- Use git (status / log / diff) to see the full set of changes in scope. Note
  the changed files and the intent behind the change.

STEP 3 — Deep review
- For anything non-trivial, read the changed code in its surrounding context —
  not just the diff hunks. Spawn read-only explore Task sub-agents for wide or
  cross-cutting checks (callers of a changed function, similar patterns
  elsewhere, test coverage) so your own context stays focused.
- Look for: correctness bugs, missing error handling / silent failures, security
  issues, broken invariants, and missing tests. Verify claims against the code.

STEP 4 — Report (concise; 15 bullets max)
- Summary: 1-2 sentences on what the change does and overall assessment.
- Must-fix (max 5): [file:line] problem + suggested fix.
- Suggestions (max 5): [file:line] improvement.
- Questions (optional, max 3).

Anti-patterns:
- Reviewing only the diff text without the surrounding code.
- Vague feedback with no file:line anchor.
- Padding the report — stay within the caps.`;

export const BUILTIN_WORKFLOWS: BuiltinWorkflow[] = [
  {
    id: 'plan',
    label: 'Plan',
    description: 'Produce a written implementation plan (no code) ending at docs/plans/.',
    body: PLAN,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Code review across a git scope, with a concise capped report.',
    body: REVIEW,
  },
];
