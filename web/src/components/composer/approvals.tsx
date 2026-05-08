import { useMemo, useState } from 'react';
import { detectDanger } from '../../dangerDetect';
import type { PermissionMode } from '../../types';
import { ToolInputView } from '../Bubble';
import { Markdown } from '../Markdown';

export type Approval = { approvalId: string; toolName: string; input: any };

export type ResolveOpts = {
  reason?: string;
  updatedInput?: unknown;
  nextPermissionMode?: PermissionMode;
};

export type ResolveFn = (decision: 'approve' | 'deny', opts?: ResolveOpts) => void;

export function ApprovalModal({
  approval,
  onResolve,
}: {
  approval: Approval;
  onResolve: ResolveFn;
}) {
  if (approval.toolName === 'AskUserQuestion') {
    return <AskUserQuestionModal approval={approval} onResolve={onResolve} />;
  }
  if (approval.toolName === 'ExitPlanMode') {
    return <ExitPlanModeModal approval={approval} onResolve={onResolve} />;
  }
  const danger = useMemo(
    () => detectDanger(approval.toolName, approval.input),
    [approval.toolName, approval.input]
  );
  return (
    <div className="modal-bg">
      <div className="modal modal-approval">
        <h3>Approve tool use?</h3>
        {danger.dangerous && (
          <div className="approval-danger-banner">
            Potentially dangerous: {danger.reason}
          </div>
        )}
        <p className="muted small">claude wants to call: <code>{approval.toolName}</code></p>
        <div className="approval-input">
          <ToolInputView input={approval.input} toolName={approval.toolName} />
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={() => onResolve('deny')}>Deny</button>
          <button className={danger.dangerous ? '' : 'primary'} autoFocus={!danger.dangerous} onClick={() => onResolve('approve')}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function ExitPlanModeModal({
  approval,
  onResolve,
}: {
  approval: Approval;
  onResolve: ResolveFn;
}) {
  const plan = (approval.input?.plan as string | undefined) ?? '';
  const accept = (mode: PermissionMode) => onResolve('approve', { nextPermissionMode: mode });
  return (
    <div className="modal-bg">
      <div className="modal modal-approval modal-plan">
        <h3>Plan ready — accept it?</h3>
        <p className="muted small">
          claude finished planning. Pick a mode to drop into when you accept.
        </p>
        <div className="plan-body">
          {plan ? <Markdown>{plan}</Markdown> : <em className="muted">(empty plan)</em>}
        </div>
        <div className="modal-actions plan-actions">
          <button className="ghost" onClick={() => onResolve('deny', { reason: 'keep planning' })}>
            Keep planning
          </button>
          <button onClick={() => accept('default')} title="Accept the plan and ask before each tool">
            Accept → default
          </button>
          <button onClick={() => accept('acceptEdits')} title="Accept the plan and auto-approve edits (still ask for shell etc.)">
            Accept → accept edits
          </button>
          <button className="primary" autoFocus onClick={() => accept('bypassPermissions')} title="Accept the plan and auto-approve everything">
            Accept → bypass
          </button>
        </div>
      </div>
    </div>
  );
}

type AskUserQuestionInput = {
  questions?: Array<{
    question: string;
    header?: string;
    multiSelect?: boolean;
    options?: Array<{ label: string; description?: string }>;
  }>;
};

function AskUserQuestionModal({
  approval,
  onResolve,
}: {
  approval: Approval;
  onResolve: ResolveFn;
}) {
  const input = (approval.input ?? {}) as AskUserQuestionInput;
  const questions = input.questions ?? [];
  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of questions) init[q.question] = [];
    return init;
  });

  function toggle(q: { question: string; multiSelect?: boolean }, label: string) {
    setSelections(prev => {
      const cur = prev[q.question] ?? [];
      if (q.multiSelect) {
        return {
          ...prev,
          [q.question]: cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label],
        };
      }
      return { ...prev, [q.question]: [label] };
    });
  }

  function submit() {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.question] = (selections[q.question] ?? []).join(', ');
    }
    onResolve('approve', { updatedInput: { ...input, answers } });
  }

  const allAnswered = questions.every(q => (selections[q.question] ?? []).length > 0);

  return (
    <div className="modal-bg">
      <div className="modal modal-question">
        <h3>claude is asking you something</h3>
        {questions.map((q, qi) => (
          <div key={qi} className="question-block">
            {q.header && <div className="question-header">{q.header}</div>}
            <div className="question-prompt">{q.question}</div>
            <div className="question-options">
              {(q.options ?? []).map((opt, oi) => {
                const selected = (selections[q.question] ?? []).includes(opt.label);
                return (
                  <button
                    key={oi}
                    type="button"
                    className={'question-option ' + (selected ? 'question-option-selected' : '')}
                    onClick={() => toggle(q, opt.label)}
                  >
                    <div className="question-option-label">{opt.label}</div>
                    {opt.description && (
                      <div className="question-option-desc muted small">{opt.description}</div>
                    )}
                  </button>
                );
              })}
            </div>
            {q.multiSelect && (
              <div className="muted small">multi-select — choose any</div>
            )}
          </div>
        ))}
        <div className="modal-actions">
          <button className="ghost" onClick={() => onResolve('deny')}>Skip</button>
          <button className="primary" disabled={!allAnswered} onClick={submit}>
            Submit answers
          </button>
        </div>
      </div>
    </div>
  );
}
