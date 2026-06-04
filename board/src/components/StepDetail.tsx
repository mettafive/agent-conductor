import type { BoardStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { fmtDur } from "../lib/format";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";
import { ApprovalCard, type Decision } from "./ApprovalCard";
import { Led } from "./Led";

const COL_LABEL: Record<string, string> = {
  running: "Running",
  gate: "Gate Check",
  done: "Done",
  failed: "Failed",
  pending: "Pending",
};

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
      <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex items-center gap-2.5">
          <Led state={step.column} />
          <span className="flex-1 text-[15px] font-medium text-chalk">{step.id}</span>
          <span className="text-[12px] text-dim">{COL_LABEL[step.column] ?? step.column}</span>
          {dur && <span className="text-[12px] tabular-nums text-dim">{dur}</span>}
          {step.attempt > 1 && (
            <span className="text-[11px] text-dim">attempt {step.attempt}</span>
          )}
        </div>

        {step.firstLine && (
          <p className="mt-3 text-[14px] leading-relaxed text-mist">{step.firstLine}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {step.output && (
            <span className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-mist">
              → {step.output}
            </span>
          )}
          {step.requires.length > 0 && (
            <span className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-mist">
              requires {step.requires.join(", ")}
            </span>
          )}
          {step.branchTaken && (
            <span className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-mist">
              → {step.branchTaken}
            </span>
          )}
        </div>

        <GateList criteria={step.criteria} settled={step.column === "done"} />

        {finalBeat?.handoff && (
          <div className="mt-3 rounded-lg border border-line bg-ink/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-dim">handoff</div>
            {finalBeat.handoff.to && (
              <p className="mt-1 font-mono text-[11px] text-mist-2">to {finalBeat.handoff.to}</p>
            )}
            {finalBeat.handoff.context && (
              <p className="mt-0.5 text-[11.5px] leading-snug text-mist">{finalBeat.handoff.context}</p>
            )}
            {finalBeat.handoff.produced && (
              <p className="mt-0.5 font-mono text-[10.5px] text-dim">produced: {finalBeat.handoff.produced}</p>
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
