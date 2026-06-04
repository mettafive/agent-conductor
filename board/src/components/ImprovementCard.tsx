import type { BoardStep } from "../lib/types";
import type { Decision } from "./ApprovalCard";

const COL_TINT: Record<string, string> = {
  running: "border-cyan/40 text-cyan",
  gate: "border-amber/40 text-amber",
  done: "border-mint/30 text-mint",
  failed: "border-rose/40 text-rose",
  pending: "border-line-2 text-mist",
};

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
      <div className={`rounded-2xl border bg-panel/50 p-5 ${structural ? "border-amber/30" : "border-iris/25"}`}>
        <div className="flex items-center gap-3">
          <span
            className={`grid h-7 w-7 place-items-center rounded-lg ${structural ? "bg-amber/15 text-amber" : "bg-cyan/15 text-cyan"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {structural ? (
                <path d="M4 22V4m0 0 7 3 9-3v11l-9 3-7-3" />
              ) : (
                <path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />
              )}
            </svg>
          </span>
          <span className="flex-1 font-mono text-base font-medium text-chalk">
            {isRead
              ? "Read knowledge"
              : isValidate
                ? "Validate conductor"
                : structural
                  ? `Structural: ${im?.title}`
                  : im?.title}
          </span>
          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${COL_TINT[step.column] ?? COL_TINT.pending}`}
          >
            {COL_LABEL[step.column] ?? step.column}
          </span>
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
              <span className="mt-0.5 w-3 text-center font-mono text-[11px]">
                {g.passed === true ? (
                  <span className="text-mint">✓</span>
                ) : g.passed === false ? (
                  <span className="text-rose">✗</span>
                ) : (
                  <span className="text-dim">○</span>
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
