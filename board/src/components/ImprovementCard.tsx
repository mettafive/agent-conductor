import type { BoardStep } from "../lib/types";
import type { Decision } from "./ApprovalCard";
import { Icon } from "./Icon";
import { Led } from "./Led";

const COL_LABEL: Record<string, string> = {
  running: "Applying",
  gate: "Gate Check",
  done: "Done",
  failed: "Failed",
  pending: "Pending",
};

/** Default gate checklist shown for an auto-apply improvement card. */
function defaultGates(structural: boolean): string[] {
  return structural
    ? ["Structural change — human approval", "conductor still validates"]
    : ["conductor.yaml modified", "validation passes", "change is ≤ 1 sentence"];
}

/**
 * A Phase 0 self-improvement card (§10.2). Shows the before/after diff for a
 * proven this-conductor insight. Text changes auto-apply; structural changes
 * (add/remove/reorder step) render an Approve / Skip control instead.
 */
export function ImprovementCard({
  step,
  onApprove,
}: {
  step: BoardStep;
  onApprove?: (stepId: string, decisions: Decision[]) => Promise<{ ok: boolean }> | void;
}) {
  const im = step.improve;
  const isValidate = im?.kind === "validate";
  const isRead = im?.kind === "read-knowledge";
  const structural = im?.structural === true;
  const decided = step.approvalState?.decided || step.column === "done";

  const defaults = isRead
    ? ["knowledge read and categorized"]
    : isValidate
      ? ["conductor-board validate passes"]
      : defaultGates(structural);
  const gates =
    step.criteria.length > 0
      ? step.criteria.map((c) => ({ text: c.kind === "hard" && c.name ? c.name : c.text, passed: c.passed }))
      : defaults.map((t) => ({ text: t, passed: null as boolean | null }));

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex items-center gap-2.5">
          <Led state={step.column} />
          <span className="flex-1 text-[15px] font-medium text-chalk">
            {isRead
              ? "Read knowledge"
              : isValidate
                ? "Validate conductor"
                : structural
                  ? `Structural: ${im?.title}`
                  : im?.title}
          </span>
          <span className="text-[12px] text-dim">{COL_LABEL[step.column] ?? step.column}</span>
        </div>

        {!isValidate && !isRead && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {im?.step && (
              <span className="rounded-md border border-iris/30 bg-iris/10 px-2 py-0.5 font-mono text-[10px] text-iris">
                step: {im.step}
              </span>
            )}
            {im?.observed != null && (
              <span className="rounded-md border border-line-2 bg-ink/40 px-2 py-0.5 font-mono text-[10px] text-mist">
                observed {im.observed} run{im.observed === 1 ? "" : "s"}
              </span>
            )}
            {im?.scope && (
              <span className="rounded-md border border-line-2 bg-ink/40 px-2 py-0.5 font-mono text-[10px] text-mist">
                {im.scope}
              </span>
            )}
            {structural && (
              <span className="rounded-md border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[10px] text-amber">
                needs approval
              </span>
            )}
          </div>
        )}

        {/* before / after diff */}
        {(im?.current || im?.proposed) && (
          <div className="mt-4 space-y-1.5 rounded-lg border border-line bg-ink/40 p-3 font-mono text-[11.5px] leading-snug">
            {im?.current && (
              <p className="text-rose/80">
                <span className="select-none text-line-2">− </span>
                {im.current}
              </p>
            )}
            {im?.proposed && (
              <p className="text-mint/90">
                <span className="select-none text-line-2">+ </span>
                {im.proposed}
              </p>
            )}
          </div>
        )}

        {im?.note && <p className="mt-3 text-sm leading-relaxed text-mist-2">{im.note}</p>}

        {/* gate checklist */}
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-mist">gate</div>
          {gates.map((g, i) => (
            <div key={i} className="flex items-start gap-2 py-1">
              <span className="mt-0.5 flex w-3 justify-center">
                {g.passed === true ? (
                  <span className="text-mint">
                    <Icon name="check" size={13} />
                  </span>
                ) : g.passed === false ? (
                  <span className="text-rose">
                    <Icon name="cross" size={13} />
                  </span>
                ) : (
                  <Led state="pending" />
                )}
              </span>
              <span className="flex-1 font-mono text-[11.5px] leading-snug text-mist-2">{g.text}</span>
            </div>
          ))}
        </div>

        {/* structural changes wait for a human */}
        {structural && !decided && onApprove && (
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => onApprove(step.id, [{ label: im?.title ?? step.id, decision: "approved" }])}
              className="rounded-lg border border-mint/40 bg-mint/10 px-3 py-1.5 font-mono text-[11px] text-mint transition-colors hover:bg-mint/15"
            >
              Approve
            </button>
            <button
              onClick={() => onApprove(step.id, [{ label: im?.title ?? step.id, decision: "rejected" }])}
              className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] text-mist transition-colors hover:text-chalk"
            >
              Skip this run
            </button>
          </div>
        )}
        {structural && decided && step.approvalState && (
          <div className="mt-4 font-mono text-[11px] text-mist">
            decision recorded — the agent will{" "}
            {step.approvalState.items.some((i) => i.decision === "rejected") ? "skip it" : "apply it"}.
          </div>
        )}
      </div>
    </div>
  );
}
