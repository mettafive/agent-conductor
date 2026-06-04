import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BoardStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { renderNote } from "../lib/heartbeat";
import { resolveActiveUnit } from "../lib/view";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";

/**
 * The one prominent card the main area shows while auto-following (Part 1.2).
 * Step name on top, the latest heartbeat note as the large body — the thing you
 * actually read at a glance. Click to expand gates, the handoff and the full
 * heartbeat timeline. No badges, icons or progress bars on the default view.
 */
export function ActiveCard({ step }: { step: BoardStep }) {
  const [open, setOpen] = useState(false);
  const now = useNow(1000);
  const u = resolveActiveUnit(step);
  const latest = u.beats.at(-1);
  const finalBeat = u.beats.find((b) => b.finalBeat);
  const hasDetail = u.beats.length > 0 || u.criteria.length > 0 || !!finalBeat?.handoff;

  const body = latest ? (
    renderNote(latest.note)
  ) : step.firstLine ? (
    step.firstLine
  ) : (
    <span className="text-mist">Working…</span>
  );

  return (
    <div className="mx-auto flex h-full max-w-3xl items-center px-6">
      <motion.div
        layout
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={`w-full rounded-2xl border border-line bg-panel/40 px-7 py-7 ${
          hasDetail ? "cursor-pointer transition-colors hover:border-line-2" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-mist">{u.title}</span>
          {step.attempt > 1 && (
            <span
              title={`${step.attempt} attempts`}
              className="rounded border border-amber/30 bg-amber/10 px-1.5 font-mono text-[10px] text-amber"
            >
              ×{step.attempt}
            </span>
          )}
          {hasDetail && (
            <span className="ml-auto font-mono text-[10px] text-dim">{open ? "collapse" : "expand"}</span>
          )}
        </div>

        <p className="mt-4 text-[1.05rem] leading-relaxed text-chalk">{body}</p>

        <AnimatePresence initial={false}>
          {open && hasDetail && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <GateList criteria={u.criteria} />

              {finalBeat?.handoff && (
                <div className="mt-3 rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-2">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-cyan">handoff</div>
                  {finalBeat.handoff.to && (
                    <p className="mt-1 font-mono text-[11px] text-chalk">to {finalBeat.handoff.to}</p>
                  )}
                  {finalBeat.handoff.context && (
                    <p className="mt-0.5 text-[11.5px] leading-snug text-mist-2">
                      {finalBeat.handoff.context}
                    </p>
                  )}
                  {finalBeat.handoff.produced && (
                    <p className="mt-0.5 font-mono text-[10.5px] text-mist">
                      produced: {finalBeat.handoff.produced}
                    </p>
                  )}
                </div>
              )}

              {u.beats.length > 0 && (
                <HeartbeatTimeline
                  entries={u.beats}
                  learnings={step.learnings}
                  now={now}
                  running={u.running}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
