import type { BoardModel } from "../lib/types";

const DOT: Record<string, string> = {
  done: "bg-mint",
  failed: "bg-rose",
  gate: "bg-amber",
  running: "bg-cyan",
  pending: "bg-dim",
};

/** Shown when a run is complete — every step with its result, at a glance. */
export function SummaryView({ model }: { model: BoardModel }) {
  const failed = model.overallStatus === "failed";
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="text-center">
        <div className={`text-2xl ${failed ? "text-rose" : "text-mint"}`}>{failed ? "✗" : "✓"}</div>
        <h2 className={`mt-1 text-xl font-semibold ${failed ? "text-rose" : "text-mint"}`}>
          {model.workflow} — {failed ? "failed" : "complete"}
        </h2>
        <p className="mt-1 font-mono text-xs text-mist">
          {model.unitsDone}/{model.unitsTotal} units
        </p>
      </div>

      <div className="mt-6 space-y-1.5">
        {model.steps
          .filter((s) => s.phase === "workflow")
          .map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-panel/40 px-3 py-2"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.column] ?? "bg-dim"}`} />
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
