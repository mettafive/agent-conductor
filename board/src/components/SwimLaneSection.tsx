import { Fragment } from "react";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { BoardStep, Column as Col } from "../lib/types";
import { iterationColumn, subStepColumn } from "../lib/loop";
import { SubStepCard } from "./SubStepCard";

const MAIN: Col[] = ["pending", "running", "gate", "done"];

const META: Record<Col, { label: string; dot: string; text: string }> = {
  pending: { label: "Pending", dot: "bg-line-2", text: "text-mist" },
  running: { label: "Running", dot: "bg-cyan", text: "text-cyan" },
  gate: { label: "Gate Check", dot: "bg-amber", text: "text-amber" },
  done: { label: "Done", dot: "bg-mint", text: "text-mint" },
  failed: { label: "Failed", dot: "bg-rose", text: "text-rose" },
};

const LANE_DOT: Record<Col, string> = {
  done: "bg-mint",
  failed: "bg-rose",
  gate: "bg-amber",
  running: "bg-cyan animate-pulse",
  pending: "bg-line-2",
};

function LoopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" className="text-iris">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function SwimLaneSection({ loopStep }: { loopStep: BoardStep }) {
  const loop = loopStep.loop;
  const iterations = loop?.iterations ?? [];
  const defById = new Map((loopStep.subSteps ?? []).map((d) => [d.id, d]));
  const anyFailed = iterations.some((it) => it.steps.some((s) => s.status === "failed"));
  const cols: Col[] = anyFailed ? [...MAIN, "failed"] : MAIN;
  const gridCols = anyFailed
    ? "grid-cols-[116px_repeat(5,minmax(0,1fr))]"
    : "grid-cols-[116px_repeat(4,minmax(0,1fr))]";

  return (
    <div className="rounded-2xl border border-iris/20 bg-ink-2/30">
      {/* section header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2.5">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/10">
          <LoopIcon />
        </span>
        <span className="font-mono text-[12.5px] font-medium text-chalk">{loopStep.id}</span>
        <span className="font-mono text-[11px] text-mist">
          {loop?.completed ?? 0}/{loop?.total ?? iterations.length} iterations
        </span>
        {loopStep.over && (
          <span className="rounded border border-line-2 bg-ink/40 px-1.5 py-0.5 font-mono text-[10px] text-mist">
            over {loopStep.over}
          </span>
        )}
        {loopStep.parallel && (
          <span
            title="iterations run in parallel"
            className="rounded border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan"
          >
            ∥ parallel
          </span>
        )}
        {loop?.currentItem && (
          <span className="ml-auto font-mono text-[11px] text-cyan">▶ {loop.currentItem}</span>
        )}
      </div>

      {iterations.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-5 font-mono text-[11px] text-line-2">
          <LoopIcon />
          Awaiting iteration list{loopStep.over ? ` (loop over ${loopStep.over})` : ""}
        </div>
      ) : (
        <LayoutGroup>
          <div className="overflow-x-auto">
            <div className={`grid ${gridCols} gap-x-2 gap-y-0 p-3 min-w-[720px]`}>
              {/* column header row */}
              <div className="px-1 pb-2 font-mono text-[9px] uppercase tracking-wide text-line-2">
                iteration
              </div>
              {cols.map((c) => (
                <div key={c} className="flex items-center gap-1.5 px-1 pb-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${META[c].dot}`} />
                  <span className={`font-mono text-[9px] uppercase tracking-wide ${META[c].text}`}>
                    {META[c].label}
                  </span>
                </div>
              ))}

              {/* one lane (row) per iteration */}
              {iterations.map((it, i) => {
                const laneCol = iterationColumn(it);
                const beats = loopStep.heartbeat.filter((h) => h.iteration === it.item);
                const edge = i > 0 ? "border-t border-line/30" : "";
                return (
                  <Fragment key={it.item}>
                    <div className={`flex items-center gap-1.5 px-1 py-2 ${edge}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LANE_DOT[laneCol]}`} />
                      <span className="min-w-0 truncate font-mono text-[11px] text-mist-2">
                        {it.item}
                      </span>
                    </div>
                    {cols.map((c) => {
                      const inCol = it.steps.filter((s) => subStepColumn(s) === c);
                      return (
                        <div key={c} className={`min-w-0 space-y-1.5 px-1 py-2 ${edge}`}>
                          <AnimatePresence mode="popLayout" initial={false}>
                            {inCol.map((s) => (
                              <SubStepCard
                                key={s.id}
                                loopId={loopStep.id}
                                item={it.item}
                                sub={s}
                                def={defById.get(s.id)}
                                beats={beats}
                              />
                            ))}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
