import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { BoardStep, Column as Col } from "../lib/types";
import { subStepColumn } from "../lib/loop";
import { IterationCard } from "./IterationCard";
import { Led } from "./Led";
import { Icon } from "./Icon";

const MAIN: Col[] = ["pending", "running", "gate", "done"];

const LABEL: Record<Col, string> = {
  pending: "Pending",
  running: "Running",
  gate: "Gate Check",
  done: "Done",
  failed: "Failed",
};

/** One iteration of a loop, shown as a full kanban with spacious cards. */
export function IterationKanban({
  loopStep,
  item,
  onBack,
}: {
  loopStep: BoardStep;
  item: string;
  onBack?: () => void;
}) {
  const iter = loopStep.loop?.iterations.find((it) => it.item === item);
  const defById = new Map((loopStep.subSteps ?? []).map((d) => [d.id, d]));
  const beats = loopStep.heartbeat.filter((h) => h.iteration === item);

  if (!iter) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-6">
        <div className="grid h-40 place-items-center font-mono text-xs text-line-2">
          iteration “{item}” not found
        </div>
      </div>
    );
  }

  const anyFailed = iter.steps.some((s) => s.status === "failed");
  const cols: Col[] = anyFailed ? [...MAIN, "failed"] : MAIN;
  const gridCols = anyFailed ? "lg:grid-cols-5" : "lg:grid-cols-4";

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="mb-4 flex items-center gap-2.5">
        {onBack && (
          <button
            onClick={onBack}
            title="Back to the loop overview"
            className="grid h-6 w-6 place-items-center rounded-md border border-line text-mist transition-colors hover:border-line-2 hover:text-chalk"
          >
            <svg width="12" height="12" viewBox="0 0 24 24">
              <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M11 17 6 12l5-5M6 12h12" />
            </svg>
          </button>
        )}
        <span className="grid h-6 w-6 place-items-center rounded-md bg-panel-2 text-mist">
          <Icon name="loop" size={14} />
        </span>
        <h2 className="text-lg font-medium text-chalk">{item}</h2>
        <span className="font-mono text-[11px] text-mist">
          {loopStep.id} · iteration
        </span>
      </div>

      <LayoutGroup>
        <div className={`grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 ${gridCols}`}>
          {cols.map((c) => {
            const inCol = iter.steps.filter((s) => subStepColumn(s) === c);
            return (
              <div key={c} className="min-w-0">
                <div className="mb-2 flex items-center gap-2 px-0.5">
                  <Led state={c} />
                  <span className="text-[11px] text-mist">{LABEL[c]}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-dim">{inCol.length}</span>
                </div>
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {inCol.map((s) => (
                      <IterationCard
                        key={s.id}
                        loopId={loopStep.id}
                        item={item}
                        sub={s}
                        def={defById.get(s.id)}
                        beats={beats}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
}
