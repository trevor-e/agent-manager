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

export const BUILTIN_WORKFLOW_VERSION = 1;

export type BuiltinWorkflow = {
  id: string;
  label: string;
  description: string;
  body: string;
};

const SHARED_DECOMPOSITION = `When you break work into items, give each one: a goal, a "done when" check, the key files, dependencies on other items, and a rough size. Keep items independently verifiable.`;

const INVESTIGATE = `You are investigating the following, in this codebase:

$ARGUMENTS

You orchestrate and delegate the heavy reading. Stay lean; push wide reads and
external lookups into sub-agents. Do not stop until the evidence chain is solid.

PHASE 1 — Triage (cheap)
- Spend 1-2 quick tool calls locating the relevant area. Do NOT deep-read yet.
- Open a findings file at docs/investigations/<topic>-<YYYY-MM-DD>.md and record
  the question, your initial hypotheses, and what would confirm or kill each one.

PHASE 2 — Fan out read-only probes (parallel)
- Use the Task tool to spawn read-only sub-agents for anything that would flood
  your own context: git archaeology (blame / log / diff on the suspect code),
  wide grep sweeps for a symbol or pattern, reading large files, and any
  external/web lookups for library behavior or error strings.
- Each probe returns a tight summary with file:line evidence — not raw dumps.

PHASE 3 — Deep investigation
- Spawn one Task sub-agent as lead investigator for the main line of inquiry. It
  reads the implementation, runs git, follows the call graph, and writes its
  line-referenced findings into the report file.

PHASE 4 — Synthesize
- Reason over the gathered evidence yourself. Resolve or discard each hypothesis.
- Finish the report with: root cause, the evidence chain (file:line for each
  link), and concrete recommendations. State your confidence and any gaps.

Anti-patterns:
- Reading the whole repo yourself instead of delegating probes.
- Concluding before the evidence chain is complete.
- Dumping raw tool output into the report instead of summarizing with citations.`;

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

const BUILD = `Research, then implement, the following:

$ARGUMENTS

PHASE 1 — Quick scan
- Understand how the task relates to the codebase with a few targeted tool calls.
  Don't boil the ocean.

PHASE 2 — Gather context
- If the relevant code is non-trivial to find, spawn a read-only explore Task
  sub-agent to report the files and symbols you'll need to touch, with file:line
  references. Use its report to focus.

PHASE 3 — Confirm the approach
- Form a concrete plan: the files to change and the shape of each change.
  ${SHARED_DECOMPOSITION}
- If a real gap remains (an unresolved design decision), resolve it now —
  reason it through, or ask the user. Don't proceed on a guess.

PHASE 4 — Implement
- Make the changes directly with the editing tools. Keep changes targeted and
  minimal — no unrequested refactors. Follow the surrounding code's conventions.

PHASE 5 — Verify
- Run the relevant build/tests/linters for the area you changed. Report what you
  ran and the result. Fix what you broke, then summarize the change.

Anti-patterns:
- Implementing before the approach is clear.
- Unrequested refactors or scope creep.
- Claiming done without actually running the checks.`;

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
    id: 'investigate',
    label: 'Investigate',
    description: 'Evidence-gathering research: triage, delegate probes, synthesize a root-cause report.',
    body: INVESTIGATE,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Produce a written implementation plan (no code) ending at docs/plans/.',
    body: PLAN,
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Research then implement a change directly, then verify.',
    body: BUILD,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Code review across a git scope, with a concise capped report.',
    body: REVIEW,
  },
];
