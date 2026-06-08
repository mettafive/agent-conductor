import type { BoardStep, LoopIteration } from "../lib/types";
import { iterationColumn, subStepColumn } from "../lib/loop";
import { renderNote } from "../lib/heartbeat";
import { Led } from "./Led";
import { Icon } from "./Icon";

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
      className="group flex flex-col gap-2 rounded-lg border border-line bg-panel px-3.5 py-3 text-left transition-colors hover:border-line-2"
    >
      <div className="flex items-center gap-2.5">
        <Led state={col} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-chalk">{it.item}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-dim">
          {done}/{it.steps.length}
        </span>
      </div>

      {/* sub-step progress dots */}
      <div className="flex flex-wrap items-center gap-1.5">
        {it.steps.map((s, i) => (
          <span
            key={i}
            title={`${s.title} — ${subStepColumn(s)}`}
            className="inline-flex items-center gap-1.5 rounded border border-line px-1.5 py-0.5 text-[10px] text-mist"
          >
            <Led state={subStepColumn(s)} />
            {s.title}
          </span>
        ))}
      </div>

      {beats && (
        <p className="whitespace-pre-wrap break-words text-[11px] leading-snug text-mist">{renderNote(beats)}</p>
      )}

      <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-mist opacity-0 transition-opacity group-hover:opacity-100">
        open kanban
        <Icon name="chevronRight" size={11} />
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
        <span className="grid h-7 w-7 place-items-center rounded-md bg-panel-2 text-mist">
          <Icon name="loop" size={15} />
        </span>
        <h2 className="text-lg font-medium text-chalk">{loopStep.title}</h2>
        <span className="text-[12px] text-mist">
          {loop?.completed ?? 0}/{loop?.total ?? iterations.length} iterations
        </span>
        {loopStep.over && (
          <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mist">
            over {loopStep.over}
          </span>
        )}
        {loopStep.parallel && (
          <span
            title={loopStep.parallel === "auto" ? "agent decides at runtime" : "iterations run in parallel"}
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mist"
          >
            ∥ {loopStep.parallel === "auto" ? "parallel: auto" : "parallel"}
          </span>
        )}
        {loop?.currentItem && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-mist">
            <Led state="running" /> {loop.currentItem}
          </span>
        )}
      </div>

      {iterations.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-6 text-[12px] text-mist">
          <Icon name="loop" size={14} />
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
