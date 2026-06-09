import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { HeartbeatEntry, IterationStep, DeveloperNote } from "../lib/types";
import { useNow } from "../lib/useNow";
import { subStepColumn } from "../lib/loop";
import { renderNote } from "../lib/heartbeat";
import { fmtDur } from "../lib/format";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";
import { Led } from "./Led";

// Movement between columns eases in and out (accelerate, then settle) — subtle
// but alive. The fade in/out stays quick so cards don't linger.
const MOVE = {
  layout: { duration: 0.42, ease: [0.45, 0, 0.55, 1] },
  default: { duration: 0.2, ease: "easeOut" },
} as const;

/**
 * A full-size card for one loop sub-step within an iteration. Shows the
 * iteration name, checker badges, the latest heartbeat, a finalBeat handoff
 * marker, attempt count and duration. Click to expand the checker results and the
 * full heartbeat timeline.
 */
export function IterationCard({
  loopId,
  item,
  sub,
  beats,
  workflow,
  notes,
}: {
  loopId: string;
  item: string;
  sub: IterationStep;
  beats: HeartbeatEntry[];
  workflow?: string;
  notes?: DeveloperNote[];
}) {
  const now = useNow(5000);
  const col = subStepColumn(sub);
  // prefer beats tagged to this exact sub-step; fall back to the iteration's
  const subBeats = beats.filter((b) => b.sub === sub.id);
  const shown = subBeats.length > 0 ? subBeats : beats;
  const latest = shown.at(-1);
  const finalBeat = shown.find((b) => b.finalBeat);
  const passed = sub.criteria.filter((c) => c.passed === true).length;
  const gateTotal = sub.criteria.length;
  const dur = fmtDur(sub.started_at, sub.completed_at);
  const hasDetail = shown.length > 0 || gateTotal > 0;
  // the live (running) iteration opens by default — following = see its beats, no extra click.
  const [open, setOpen] = useState(() => col === "running" && hasDetail);

  // pulse the card once when a fresh heartbeat lands inside it
  const [pulse, setPulse] = useState(false);
  const prevAt = useRef<string | undefined>(undefined);
  const seeded = useRef(false);
  useEffect(() => {
    const at = latest?.at;
    if (!seeded.current) {
      seeded.current = true;
      prevAt.current = at;
      return;
    }
    if (at && at !== prevAt.current) {
      prevAt.current = at;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 760);
      return () => clearTimeout(t);
    }
  }, [latest?.at]);

  return (
    <motion.div
      layout
      layoutId={`${loopId}::${item}::${sub.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={MOVE}
      onClick={() => hasDetail && setOpen((o) => !o)}
      className={`rounded-md border-b border-line px-2.5 py-2.5 transition-colors duration-200 ${
        hasDetail ? "cursor-pointer hover:bg-panel-2/50" : ""
      } ${pulse ? (open ? "beat-flash-faint" : "beat-flash") : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <Led state={col} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-chalk">{sub.title}</span>
        {sub.attempt > 1 && (
          <span title={`${sub.attempt} attempts`} className="shrink-0 text-[11px] text-dim">
            attempt {sub.attempt}
          </span>
        )}
      </div>

      {/* iteration tag + duration — dim, no badges */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[18px] text-[11px] text-dim">
        <span className="text-mist">{item}</span>
        {gateTotal > 0 && (
          <span className="tabular-nums">
            {passed}/{gateTotal} checks
          </span>
        )}
        {dur && <span className="tabular-nums">{dur}</span>}
        {finalBeat && <span title="handed off">→ {finalBeat.handoff?.to ?? "handed off"}</span>}
      </div>

      {/* latest heartbeat */}
      {latest && (
        <div
          title={latest.note}
          className="mt-2 flex items-start gap-2 pl-[18px] text-[12px] leading-snug text-mist"
        >
          {latest.insight && (
            <span
              className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-amber"
              title="Carries an insight"
            />
          )}
          <span className="whitespace-pre-wrap break-words">{renderNote(latest.note)}</span>
        </div>
      )}

      {/* expanded: checker results + heartbeat timeline */}
      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="pl-7">
              <GateList criteria={sub.criteria} settled={col === "done"} />
            </div>
            {shown.length > 0 && (
              <HeartbeatTimeline
                entries={shown}
                learnings={[]}
                now={now}
                running={col === "running"}
                notes={notes}
                workflow={workflow}
                step={loopId}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
