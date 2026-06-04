// Render a workflow template into the concrete text injected at session start.
// Currently the only placeholder is `$ARGUMENTS`, replaced with the user's
// task description.

export function renderWorkflow(body: string, args: string | null | undefined): string {
  const task = (args ?? '').trim() || '(No task was provided — ask the user what they want before proceeding.)';
  return body.split('$ARGUMENTS').join(task);
}
