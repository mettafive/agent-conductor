import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BoardStep, Column, LoopIteration } from "../lib/types";
import { useNow } from "../lib/useNow";
import { renderNote, secondsSince } from "../lib/heartbeat";
import { iterationColumn } from "../lib/loop";
import { HeartbeatTimeline } from "./HeartbeatTimeline";

const SUB_DOT: Record<string, string> = {
  done: "bg-mint",
  failed: "bg-rose",
  running: "bg-cyan animate-pulse",
  checking: "bg-amber",
  pending: "bg-line-2",
};

const ACCENT: Record<Column, string> = {
  done: "border-mint/25",
  failed: "border-rose/40",
  gate: "border-amber/40",
  running: "border-cyan/40 pulse-ring",
  pending: "border-line-2",
};

const EASE = [0.22, 1, 0.36, 1] as const;
const MOVE = {
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.85 },
  opacity: { duration: 0.2, ease: "easeOut" },
  scale: { duration: 0.22, ease: EASE },
  default: { duration: 0.2, ease: EASE },
} as const;

function Glyph({ col }: { col: Column }) {
  switch (col) {
    case "done":
      return (
        <span className="check-pop grid h-5 w-5 place-items-center rounded-full bg-mint/15 text-mint">
          <svg width="11" height="11" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L20 6" />
          </svg>
        </span>
      );
    case "failed":
      return (
        <span className="grid h-5 w-5 place-items-center rounded-full bg-rose/15 text-rose">
          <svg width="11" height="11" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
          </svg>
        </span>
      );
    case "gate":
      return (
        <span className="grid h-5 w-5 place-items-center rounded-full bg-amber/15 text-amber">
          <svg className="spin" width="12" height="12" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        </span>
      );
    case "running":
      return (
        <span className="grid h-5 w-5 place-items-center">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan" />
        </span>
      );
    default:
      return (
        <span className="grid h-5 w-5 place-items-center">
          <span className="h-2.5 w-2.5 rounded-full border border-line-2" />
        </span>
      );
  }
}

export function IterationCard({
  loopStep,
  it,
  index,
}: {
  loopStep: BoardStep;
  it: LoopIteration;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(5000);
  const col = iterationColumn(it);
  const beats = loopStep.heartbeat.filter((h) => h.iteration === it.item);
  const latest = beats.at(-1);
  const running = col === "running";
  const stalled = running && latest != null && (secondsSince(latest.at, now) ?? 0) > 90;
  const retried = it.steps.find((s) => s.attempt > 1);
  const expandable = beats.length > 0 || it.steps.length > 0;
  const dim = col === "pending" ? "opacity-70" : "";

  return (
    <motion.div
      layout
      layoutId={`${loopStep.id}::${it.item}`}
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -2 }}
      transition={MOVE}
      onClick={() => expandable && setOpen((o) => !o)}
      className={`rounded-xl border bg-panel px-3 py-2.5 ${ACCENT[col]} ${dim} ${
        expandable ? "cursor-pointer" : ""
      } ${col === "done" ? "opacity-85" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/15 font-mono text-[10px] text-iris">
          {index + 1}
        </span>
        <span className="flex-1 truncate font-mono text-[12.5px] text-chalk">{it.item}</span>
        {stalled && (
          <span
            title="No heartbeat for 90s — agent may be stalled"
            className="h-2 w-2 animate-pulse rounded-full bg-amber"
          />
        )}
        {retried && (
          <span
            title={`${retried.attempt} attempts`}
            className="rounded border border-amber/30 bg-amber/10 px-1 font-mono text-[9px] text-amber"
          >
            ×{retried.attempt}
          </span>
        )}
        <Glyph col={col} />
      </div>

      {/* sub-step status chips */}
      {it.steps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-7">
          {it.steps.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded border border-line-2 px-1.5 py-0.5 font-mono text-[9px] text-mist"
            >
              <span
                className={`h-1 w-1 rounded-full ${
                  SUB_DOT[s.gate === "checking" ? "checking" : s.status] ?? "bg-line-2"
                }`}
              />
              {s.id}
            </span>
          ))}
        </div>
      )}

      {/* collapsed latest beat */}
      {latest && (
        <div
          title={latest.note}
          className="mt-2 flex items-start gap-1.5 pl-7 text-[11px] italic leading-snug text-mist"
        >
          <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-cyan" />
          <span className="truncate">
            {latest.insight && <span className="mr-0.5 not-italic">💡</span>}
            {renderNote(latest.note)}
          </span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && beats.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <HeartbeatTimeline entries={beats} learnings={[]} now={now} running={running} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
