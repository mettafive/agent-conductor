import type { BoardStep, DeveloperNote } from "../lib/types";
import { useNow } from "../lib/useNow";
import { fmtDur } from "../lib/format";
import { renderNote } from "../lib/heartbeat";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";
import { Led } from "./Led";

const COL_LABEL: Record<string, string> = {
  running: "Running",
  gate: "Checking",
  done: "Done",
  failed: "Failed",
  pending: "Pending",
};

/** The active non-loop step, shown large and centred in the main area. */
export function StepDetail({
  step,
  workflow,
  notes,
}: {
  step: BoardStep;
  workflow?: string;
  notes?: DeveloperNote[];
}) {
  const now = useNow(1000);

  const finalBeat = step.heartbeat.find((h) => h.finalBeat);
  const latest = step.heartbeat.at(-1);
  const dur = fmtDur(step.started_at, step.completed_at);
  const running = step.column === "running";
  const hasMeta = !!step.output || step.requires.length > 0 || !!step.branchTaken;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="rounded-lg border border-line bg-panel p-5">
        {/* header — what + status */}
        <div className="flex items-center gap-2.5">
          <Led state={step.column} />
          <span className="flex-1 text-[15px] font-medium text-chalk">{step.id}</span>
          <span className="text-[12px] text-dim">{COL_LABEL[step.column] ?? step.column}</span>
          {dur && <span className="text-[12px] tabular-nums text-dim">{dur}</span>}
          {step.attempt > 1 && <span className="text-[11px] text-dim">attempt {step.attempt}</span>}
        </div>

        {/* HERO — the agent's latest reasoning: "what it's doing / what it did". This is the
            point of the board, so it leads. The instruction is demoted to a muted purpose line. */}
        {latest ? (
          <>
            <p className="mt-3 text-[14px] leading-relaxed text-chalk">{renderNote(latest.note)}</p>
            {step.firstLine && (
              <p className="mt-1.5 text-[12px] leading-snug text-dim">{step.firstLine}</p>
            )}
          </>
        ) : step.firstLine ? (
          <p className="mt-3 text-[14px] leading-relaxed text-mist">{step.firstLine}</p>
        ) : null}

        {/* the story — the full heartbeat narration, ABOVE the gate proof */}
        {(step.heartbeat.length > 0 || step.learnings.length > 0) && (
          <HeartbeatTimeline entries={step.heartbeat} learnings={step.learnings} now={now} running={running} cardOverviews={step.cardOverviews} notes={notes} workflow={workflow} step={step.id} />
        )}

        {/* the proof — gate results */}
        <GateList criteria={step.criteria} settled={step.column === "done"} />

        {/* handoff to the next step */}
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

        {/* author-facing DAG metadata — de-emphasised, not competing with the story */}
        {hasMeta && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 pt-2.5 font-mono text-[9.5px] text-dim">
            {step.requires.length > 0 && <span>runs after {step.requires.join(", ")}</span>}
            {step.output && <span>outputs {step.output}</span>}
            {step.branchTaken && <span>branch → {step.branchTaken}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
