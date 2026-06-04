import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BoardStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { renderNote } from "../lib/heartbeat";
import { resolveActiveUnit, clockSince } from "../lib/view";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";
import { Icon } from "./Icon";

/**
 * The one card the main area shows while auto-following. Step name on top, the
 * latest heartbeat note as the body, an elapsed timer in the corner. It doesn't
 * fill the screen — it sits centred and breathes. Click to expand gates, the
 * handoff and the heartbeat timeline inline.
 */
export function ActiveCard({ step }: { step: BoardStep }) {
  const [open, setOpen] = useState(false);
  const now = useNow(1000);
  const u = resolveActiveUnit(step);
  const latest = u.beats.at(-1);
  const finalBeat = u.beats.find((b) => b.finalBeat);
  const hasDetail = u.beats.length > 0 || u.criteria.length > 0 || !!finalBeat?.handoff;
  const timer = u.running ? clockSince(u.startedAt, now) : clockSince(u.startedAt, now, u.completedAt);

  const body = latest ? (
    renderNote(latest.note)
  ) : step.firstLine ? (
    step.firstLine
  ) : (
    <span className="text-dim">Working…</span>
  );

  return (
    <div className="mx-auto flex h-full max-w-2xl items-center px-8">
      <motion.div
        layout
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={`w-full rounded-lg border border-line bg-panel p-6 ${
          hasDetail ? "cursor-pointer transition-colors hover:border-line-2" : ""
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-chalk">{u.title}</span>
          {step.attempt > 1 && (
            <span className="text-[12px] text-dim" title={`${step.attempt} attempts`}>
              · attempt {step.attempt}
            </span>
          )}
          {hasDetail && (
            <span className="ml-auto text-dim">
              <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
            </span>
          )}
        </div>

        <p className="mt-4 text-[14px] leading-relaxed text-mist">{body}</p>

        {timer && (
          <div className="mt-5 text-right text-[12px] tabular-nums text-dim">{timer}</div>
        )}

        <AnimatePresence initial={false}>
          {open && hasDetail && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <GateList criteria={u.criteria} settled={!u.running} />

              {finalBeat?.handoff && (
                <div className="mt-3 rounded-lg border border-line bg-ink/40 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-dim">handoff</div>
                  {finalBeat.handoff.to && (
                    <p className="mt-1 font-mono text-[12px] text-mist-2">to {finalBeat.handoff.to}</p>
                  )}
                  {finalBeat.handoff.context && (
                    <p className="mt-0.5 text-[12px] leading-snug text-mist">{finalBeat.handoff.context}</p>
                  )}
                  {finalBeat.handoff.produced && (
                    <p className="mt-0.5 font-mono text-[11px] text-dim">
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
                  cardOverviews={step.cardOverviews}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
