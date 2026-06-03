import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { BoardStep, Column as Col } from "../lib/types";
import { subStepColumn } from "../lib/loop";
import { IterationCard } from "./IterationCard";

const MAIN: Col[] = ["pending", "running", "gate", "done"];

const META: Record<Col, { label: string; dot: string; text: string }> = {
  pending: { label: "Pending", dot: "bg-line-2", text: "text-mist" },
  running: { label: "Running", dot: "bg-cyan", text: "text-cyan" },
  gate: { label: "Gate Check", dot: "bg-amber", text: "text-amber" },
  done: { label: "Done", dot: "bg-mint", text: "text-mint" },
  failed: { label: "Failed", dot: "bg-rose", text: "text-rose" },
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
        <span className="grid h-6 w-6 place-items-center rounded-md bg-iris/10 font-mono text-[11px] text-iris">⟳</span>
        <h2 className="font-mono text-lg font-medium text-chalk">{item}</h2>
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
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${META[c].dot}`} />
                  <span className={`font-mono text-[10px] uppercase tracking-wide ${META[c].text}`}>
                    {META[c].label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-line-2">{inCol.length}</span>
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
