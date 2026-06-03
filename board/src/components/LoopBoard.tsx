import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { BoardStep, Column as Col } from "../lib/types";
import { iterationColumn } from "../lib/loop";
import { IterationCard } from "./IterationCard";

const MAIN: Col[] = ["pending", "running", "gate", "done"];

const META: Record<Col, { label: string; dot: string; text: string }> = {
  pending: { label: "Pending", dot: "bg-line-2", text: "text-mist" },
  running: { label: "Running", dot: "bg-cyan", text: "text-cyan" },
  gate: { label: "Gate Check", dot: "bg-amber", text: "text-amber" },
  done: { label: "Done", dot: "bg-mint", text: "text-mint" },
  failed: { label: "Failed", dot: "bg-rose", text: "text-rose" },
};

export function LoopBoard({
  loopStep,
  workflow,
  onBack,
}: {
  loopStep: BoardStep;
  workflow: string;
  onBack: () => void;
}) {
  const loop = loopStep.loop;
  const iterations = loop?.iterations ?? [];
  const cardsFor = (c: Col) =>
    iterations
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => iterationColumn(it) === c);
  const failed = cardsFor("failed");

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      {/* breadcrumb + back */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-line bg-panel/60 px-2.5 py-1 font-mono text-[11px] text-mist transition-colors hover:border-line-2 hover:text-chalk"
        >
          <svg width="11" height="11" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M11 17 6 12l5-5M6 12h12" />
          </svg>
          Back
        </button>
        <span className="flex items-center gap-1.5 font-mono text-xs">
          <span className="text-mist">{workflow}</span>
          <span className="text-line-2">›</span>
          <span className="flex items-center gap-1.5 text-chalk">
            <svg width="13" height="13" viewBox="0 0 24 24" className="text-iris">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3" />
            </svg>
            {loopStep.id}
          </span>
        </span>
        <span className="font-mono text-[11px] text-mist">
          {loop?.completed ?? 0}/{loop?.total ?? iterations.length} iterations
          {loopStep.over && <span className="ml-1.5 text-line-2">over {loopStep.over}</span>}
        </span>
      </div>

      <LayoutGroup>
        <div
          className={`grid items-start gap-3 ${
            failed.length > 0
              ? "lg:grid-cols-[repeat(4,minmax(0,1fr))_0.85fr]"
              : "lg:grid-cols-4"
          } sm:grid-cols-2`}
        >
          {MAIN.map((c) => {
            const cards = cardsFor(c);
            const m = META[c];
            const compact = cards.length >= 6;
            return (
              <div key={c} className="flex min-h-0 flex-col rounded-2xl border border-line bg-ink-2/40">
                <div className="flex shrink-0 items-center gap-2 rounded-t-2xl border-b border-line/70 bg-ink-2/60 px-3.5 py-2.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                  <span className={`font-mono text-[11px] uppercase tracking-wide ${m.text}`}>
                    {m.label}
                  </span>
                  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-md bg-panel px-1 font-mono text-[10px] text-mist">
                    {cards.length}
                  </span>
                </div>
                <div className="relative min-h-0 flex-1">
                  <div className="board-scroll max-h-[calc(100vh-220px)] overflow-y-auto scroll-smooth p-2.5">
                    <div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"}`}>
                      <AnimatePresence mode="popLayout" initial={false}>
                        {cards.map(({ it, index }) => (
                          <IterationCard key={it.item} loopStep={loopStep} it={it} index={index} />
                        ))}
                      </AnimatePresence>
                    </div>
                    {cards.length === 0 && (
                      <div className="grid place-items-center py-6">
                        <span className="font-mono text-[10px] text-line-2">empty</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {failed.length > 0 && (
            <div className="flex min-h-0 flex-col rounded-2xl border border-rose/15 bg-ink-2/40">
              <div className="flex shrink-0 items-center gap-2 rounded-t-2xl border-b border-line/70 bg-ink-2/60 px-3.5 py-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-rose" />
                <span className="font-mono text-[11px] uppercase tracking-wide text-rose">Failed</span>
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-md bg-panel px-1 font-mono text-[10px] text-mist">
                  {failed.length}
                </span>
              </div>
              <div className="board-scroll max-h-[calc(100vh-220px)] overflow-y-auto p-2.5">
                <div className="flex flex-col gap-2">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {failed.map(({ it, index }) => (
                      <IterationCard key={it.item} loopStep={loopStep} it={it} index={index} />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
        </div>
      </LayoutGroup>
    </div>
  );
}
