import type { BoardStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { HeartbeatTimeline } from "./HeartbeatTimeline";
import { ApprovalCard, type Decision } from "./ApprovalCard";

const COL_TINT: Record<string, string> = {
  running: "border-cyan/40 text-cyan",
  gate: "border-amber/40 text-amber",
  done: "border-mint/30 text-mint",
  failed: "border-rose/40 text-rose",
  pending: "border-line-2 text-mist",
};

const COL_LABEL: Record<string, string> = {
  running: "Running",
  gate: "Gate Check",
  done: "Done",
  failed: "Failed",
  pending: "Pending",
};

function fmtDur(start?: string, end?: string): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The active non-loop step, shown large and centred in the main area. */
export function StepDetail({
  step,
  onApprove,
}: {
  step: BoardStep;
  onApprove?: (stepId: string, decisions: Decision[]) => Promise<{ ok: boolean }> | void;
}) {
  const now = useNow(1000);

  if (step.isApproval && step.approvalState) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <ApprovalCard step={step} onDecide={onApprove ?? (() => {})} />
      </div>
    );
  }

  const finalBeat = step.heartbeat.find((h) => h.finalBeat);
  const dur = fmtDur(step.started_at, step.completed_at);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="rounded-2xl border border-line bg-panel/50 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-iris/15 font-mono text-xs text-iris">
            {step.index + 1}
          </span>
          <span className="flex-1 font-mono text-base font-medium text-chalk">{step.id}</span>
          {dur && <span className="font-mono text-[11px] text-mist">{dur}</span>}
          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${COL_TINT[step.column] ?? COL_TINT.pending}`}
          >
            {COL_LABEL[step.column] ?? step.column}
          </span>
          {step.attempt > 1 && (
            <span className="rounded border border-amber/30 bg-amber/10 px-1.5 font-mono text-[10px] text-amber">
              ×{step.attempt}
            </span>
          )}
        </div>

        {step.firstLine && (
          <p className="mt-3 text-sm leading-relaxed text-mist-2">{step.firstLine}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {step.output && (
            <span className="rounded-md border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] text-cyan">
              → {step.output}
            </span>
          )}
          {step.requires.length > 0 && (
            <span className="rounded-md border border-line-2 bg-ink/40 px-2 py-0.5 font-mono text-[10px] text-mist">
              requires {step.requires.join(", ")}
            </span>
          )}
          {step.branchTaken && (
            <span className="rounded-md border border-amber/30 bg-amber/10 px-2 py-0.5 font-mono text-[10px] text-amber">
              → {step.branchTaken}
            </span>
          )}
        </div>

        {step.criteria.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-mist">gate</div>
            {step.criteria.map((c, i) => (
              <div key={i} className="flex items-start gap-2 py-1">
                <span className="mt-0.5 w-3 text-center font-mono text-[11px]">
                  {c.passed === true ? (
                    <span className="text-mint">✓</span>
                  ) : c.passed === false ? (
                    <span className="text-rose">✕</span>
                  ) : (
                    <span className="text-line-2">○</span>
                  )}
                </span>
                <span
                  className={`rounded border px-1 py-px font-mono text-[9px] ${c.kind === "hard" ? "border-mint/25 text-mint" : "border-line-2 text-mist"}`}
                >
                  {c.kind}
                </span>
                {c.verified ? (
                  <span title="verified by the gate-runner" className="text-[10px] text-mint">🔒</span>
                ) : (
                  c.passed === true && (
                    <span title="attested by the agent" className="text-[10px] text-amber/80">✋</span>
                  )
                )}
                <span className="flex-1 font-mono text-[11.5px] leading-snug text-mist-2">
                  {c.kind === "hard" && c.name ? c.name : c.text}
                  {c.kind === "hard" && typeof c.exitCode === "number" && (
                    <span className="ml-1 text-mist">exit {c.exitCode}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {finalBeat?.handoff && (
          <div className="mt-3 rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wide text-cyan">·→ handoff</div>
            {finalBeat.handoff.to && (
              <p className="mt-1 font-mono text-[11px] text-chalk">to {finalBeat.handoff.to}</p>
            )}
            {finalBeat.handoff.context && (
              <p className="mt-0.5 text-[11.5px] leading-snug text-mist-2">{finalBeat.handoff.context}</p>
            )}
            {finalBeat.handoff.produced && (
              <p className="mt-0.5 font-mono text-[10.5px] text-mist">produced: {finalBeat.handoff.produced}</p>
            )}
          </div>
        )}

        {(step.heartbeat.length > 0 || step.learnings.length > 0) && (
          <HeartbeatTimeline
            entries={step.heartbeat}
            learnings={step.learnings}
            now={now}
            running={step.column === "running"}
          />
        )}
      </div>
    </div>
  );
}
