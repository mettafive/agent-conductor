import type { BoardStep, Column as Col, LoopIteration } from "../lib/types";
import { iterationColumn, subStepColumn } from "../lib/loop";
import { renderNote } from "../lib/heartbeat";

const DOT: Record<Col, string> = {
  done: "bg-mint",
  failed: "bg-rose",
  gate: "bg-amber",
  running: "bg-cyan animate-pulse",
  pending: "bg-line-2",
};

const SUB_DOT: Record<Col, string> = {
  done: "bg-mint",
  failed: "bg-rose",
  gate: "bg-amber",
  running: "bg-cyan animate-pulse",
  pending: "bg-line-2/70",
};

function LoopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" className="text-iris">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function IterationTile({
  it,
  beats,
  onOpen,
}: {
  it: LoopIteration;
  beats: string | undefined;
  onOpen: () => void;
}) {
  const col = iterationColumn(it);
  const done = it.steps.filter((s) => s.status === "done").length;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-xl border border-line bg-panel/50 px-3.5 py-3 text-left transition-colors hover:border-line-2 hover:bg-panel"
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[col]}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-chalk">{it.item}</span>
        <span className="shrink-0 font-mono text-[10px] text-mist">
          {done}/{it.steps.length}
        </span>
      </div>

      {/* sub-step progress dots */}
      <div className="flex flex-wrap items-center gap-1.5">
        {it.steps.map((s, i) => (
          <span
            key={i}
            title={`${s.id} — ${subStepColumn(s)}`}
            className="inline-flex items-center gap-1 rounded border border-line-2/60 px-1.5 py-0.5 font-mono text-[9px] text-mist"
          >
            <span className={`h-1 w-1 rounded-full ${SUB_DOT[subStepColumn(s)]}`} />
            {s.id}
          </span>
        ))}
      </div>

      {beats && (
        <p className="line-clamp-1 text-[11px] italic leading-snug text-mist">{renderNote(beats)}</p>
      )}

      <span className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-cyan opacity-0 transition-opacity group-hover:opacity-100">
        open kanban
        <svg width="10" height="10" viewBox="0 0 24 24">
          <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

/** All of a loop's iterations at a glance — click one to open its full kanban. */
export function LoopOverview({
  loopStep,
  onOpenIteration,
}: {
  loopStep: BoardStep;
  onOpenIteration: (item: string) => void;
}) {
  const loop = loopStep.loop;
  const iterations = loop?.iterations ?? [];

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-iris/10">
          <LoopIcon />
        </span>
        <h2 className="font-mono text-lg font-medium text-chalk">{loopStep.id}</h2>
        <span className="font-mono text-[12px] text-mist">
          {loop?.completed ?? 0}/{loop?.total ?? iterations.length} iterations
        </span>
        {loopStep.over && (
          <span className="rounded border border-line-2 bg-ink/40 px-1.5 py-0.5 font-mono text-[10px] text-mist">
            over {loopStep.over}
          </span>
        )}
        {loopStep.parallel && (
          <span
            title={loopStep.parallel === "auto" ? "agent decides at runtime" : "iterations run in parallel"}
            className="rounded border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan"
          >
            ∥ {loopStep.parallel === "auto" ? "parallel: auto" : "parallel"}
          </span>
        )}
        {loop?.currentItem && (
          <span className="ml-auto font-mono text-[11px] text-cyan">▶ {loop.currentItem}</span>
        )}
      </div>

      {iterations.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-iris/20 bg-ink-2/30 px-4 py-6 font-mono text-[12px] text-line-2">
          <LoopIcon />
          Awaiting iteration list{loopStep.over ? ` (loop over ${loopStep.over})` : ""}. The agent
          should scope and frontload every iteration before starting work.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {iterations.map((it) => {
            const latest = loopStep.heartbeat
              .filter((h) => h.iteration === it.item)
              .at(-1)?.note;
            return (
              <IterationTile
                key={it.item}
                it={it}
                beats={latest}
                onOpen={() => onOpenIteration(it.item)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
