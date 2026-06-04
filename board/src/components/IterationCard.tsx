import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ConductorStep, HeartbeatEntry, IterationStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { subStepColumn } from "../lib/loop";
import { renderNote } from "../lib/heartbeat";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";
import { Led } from "./Led";

function fmtDur(start?: string, end?: string): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const MOVE = { duration: 0.2, ease: "easeOut" } as const;

/**
 * A full-size card for one loop sub-step within an iteration. Shows the
 * iteration name, gate badges, the latest heartbeat, a finalBeat handoff
 * marker, attempt count and duration. Click to expand the gate results and the
 * full heartbeat timeline.
 */
export function IterationCard({
  loopId,
  item,
  sub,
  def,
  beats,
}: {
  loopId: string;
  item: string;
  sub: IterationStep;
  def?: ConductorStep;
  beats: HeartbeatEntry[];
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(5000);
  const col = subStepColumn(sub);
  const soft = def?.soft ?? [];
  const hard = def?.hard ?? [];
  // prefer beats tagged to this exact sub-step; fall back to the iteration's
  const subBeats = beats.filter((b) => b.sub === sub.id);
  const shown = subBeats.length > 0 ? subBeats : beats;
  const latest = shown.at(-1);
  const finalBeat = shown.find((b) => b.finalBeat);
  const passed = sub.criteria.filter((c) => c.passed === true).length;
  const gateTotal = sub.criteria.length;
  const dur = fmtDur(sub.started_at, sub.completed_at);
  const hasDetail = shown.length > 0 || soft.length + hard.length > 0 || gateTotal > 0;

  return (
    <motion.div
      layout
      layoutId={`${loopId}::${item}::${sub.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={MOVE}
      onClick={() => hasDetail && setOpen((o) => !o)}
      className={`rounded-lg border px-3 py-2.5 ${col === "running" ? "border-line-2" : "border-line"} bg-panel ${hasDetail ? "cursor-pointer transition-colors hover:border-line-2" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <Led state={col} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-chalk">{sub.id}</span>
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
            {passed}/{gateTotal} gates
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
              title="carries an insight"
            />
          )}
          <span className="line-clamp-2">{renderNote(latest.note)}</span>
        </div>
      )}

      {/* expanded: gate results + heartbeat timeline */}
      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            {sub.criteria.length > 0 ? (
              <div className="pl-7">
                <GateList criteria={sub.criteria} />
              </div>
            ) : (
              (soft.length > 0 || hard.length > 0) && (
                <div className="mt-2.5 space-y-0.5 border-t border-line pt-2 pl-7">
                  {soft.map((t, i) => (
                    <div key={`s${i}`} className="flex gap-1.5 text-[11px] leading-snug text-mist">
                      <span className="text-cyan">·</span>
                      <span className="flex-1">{t}</span>
                    </div>
                  ))}
                  {hard.map((h, i) => (
                    <div key={`h${i}`} className="flex gap-1.5 font-mono text-[10px] leading-snug text-mint/80">
                      <span>$</span>
                      <span className="flex-1">{h.name ?? h.text}</span>
                    </div>
                  ))}
                </div>
              )
            )}
            {shown.length > 0 && (
              <HeartbeatTimeline entries={shown} learnings={[]} now={now} running={col === "running"} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
