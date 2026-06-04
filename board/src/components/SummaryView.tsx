import type { BoardModel } from "../lib/types";
import { Icon } from "./Icon";
import { Led } from "./Led";

/** Shown when a run is complete — every step with its result, at a glance. */
export function SummaryView({ model }: { model: BoardModel }) {
  const failed = model.overallStatus === "failed";
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex flex-col items-center text-center">
        <span className={failed ? "text-rose" : "text-mint"}>
          <Icon name={failed ? "cross" : "check"} size={28} />
        </span>
        <h2 className="mt-2 text-xl font-medium text-chalk">
          {model.workflow} — {failed ? "failed" : "complete"}
        </h2>
        <p className="mt-1 text-[13px] text-mist">
          {model.unitsDone}/{model.unitsTotal} units
        </p>
      </div>

      <div className="mt-6 space-y-1.5">
        {model.steps
          .filter((s) => s.phase === "workflow")
          .map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2"
            >
              <Led state={s.column} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-chalk">{s.id}</span>
              {s.isLoop && s.loop && (
                <span className="shrink-0 font-mono text-[10px] text-cyan">
                  {s.loop.completed}/{s.loop.total}
                </span>
              )}
              {s.criteria.length > 0 && (
                <span className="shrink-0 font-mono text-[10px] text-mist">
                  {s.criteria.filter((c) => c.passed === true).length}/{s.criteria.length} gates
                </span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
