import { LayoutGroup } from "framer-motion";
import type { BoardModel, BoardStep, Column as Col } from "../lib/types";
import { Column } from "./Column";
import { SwimLaneSection } from "./SwimLaneSection";
import type { Decision } from "./ApprovalCard";

const MAIN: Col[] = ["pending", "running", "gate", "done"];

type ApproveFn = (stepId: string, decisions: Decision[]) => Promise<{ ok: boolean }> | void;

/** The classic 4-column board for a run of non-loop steps. */
function StepGrid({ steps, onApprove }: { steps: BoardStep[]; onApprove?: ApproveFn }) {
  const byCol = (c: Col) => steps.filter((s) => s.column === c);
  const failed = byCol("failed");
  return (
    <LayoutGroup>
      <div
        className={`grid items-start gap-3 ${
          failed.length > 0
            ? "lg:grid-cols-[repeat(4,minmax(0,1fr))_0.85fr]"
            : "lg:grid-cols-4"
        } sm:grid-cols-2`}
      >
        {MAIN.map((c) => (
          <Column key={c} col={c} steps={byCol(c)} onApprove={onApprove} />
        ))}
        {failed.length > 0 && <Column col="failed" steps={failed} side onApprove={onApprove} />}
      </div>
    </LayoutGroup>
  );
}

export function Board({
  model,
  onApprove,
}: {
  model: BoardModel;
  onApprove?: ApproveFn;
}) {
  // Walk steps in order: runs of non-loop steps become a 4-column grid; each
  // loop becomes a full-width swim-lane section, interleaved in document order.
  const segments: ({ kind: "grid"; steps: BoardStep[] } | { kind: "loop"; step: BoardStep })[] = [];
  let buf: BoardStep[] = [];
  for (const s of model.steps) {
    if (s.isLoop) {
      if (buf.length) {
        segments.push({ kind: "grid", steps: buf });
        buf = [];
      }
      segments.push({ kind: "loop", step: s });
    } else {
      buf.push(s);
    }
  }
  if (buf.length) segments.push({ kind: "grid", steps: buf });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-5 py-6">
      {segments.map((seg, i) =>
        seg.kind === "grid" ? (
          <StepGrid key={`grid-${i}`} steps={seg.steps} onApprove={onApprove} />
        ) : (
          <SwimLaneSection key={seg.step.id} loopStep={seg.step} />
        ),
      )}
    </div>
  );
}
