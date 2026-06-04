import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ConductorStep, HeartbeatEntry, IterationStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { subStepColumn } from "../lib/loop";
import { renderNote } from "../lib/heartbeat";
import { GateList } from "./GateList";
import { HeartbeatTimeline } from "./HeartbeatTimeline";

const ACCENT: Record<string, string> = {
  done: "border-mint/30 bg-mint/[0.04]",
  failed: "border-rose/40 bg-rose/[0.05]",
  gate: "border-amber/40 bg-amber/[0.05]",
  running: "border-cyan/40 bg-cyan/[0.05] pulse-ring",
  pending: "border-line-2 bg-panel/40",
};

function fmtDur(start?: string, end?: string): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Glyph({ col }: { col: string }) {
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

const EASE = [0.22, 1, 0.36, 1] as const;
const MOVE = {
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.85 },
  opacity: { duration: 0.2, ease: "easeOut" },
  default: { duration: 0.2, ease: EASE },
} as const;

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
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -2 }}
      transition={MOVE}
      onClick={() => hasDetail && setOpen((o) => !o)}
      className={`rounded-xl border px-3 py-2.5 ${ACCENT[col]} ${hasDetail ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Glyph col={col} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-chalk">{sub.id}</span>
        {sub.attempt > 1 && (
          <span
            title={`${sub.attempt} attempts`}
            className="shrink-0 rounded border border-amber/30 bg-amber/10 px-1 font-mono text-[9px] text-amber"
          >
            ×{sub.attempt}
          </span>
        )}
      </div>

      {/* iteration tag */}
      <div className="mt-1.5 pl-7">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan/25 bg-cyan/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-cyan">
          <span className="h-1 w-1 rounded-full bg-cyan" />
          {item}
        </span>
      </div>

      {/* gate badges + duration */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
        {soft.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-line-2 bg-ink/50 px-1.5 py-0.5 font-mono text-[10px] text-mist-2">
            <span className="h-1.5 w-1.5 rounded-full bg-iris" />
            {gateTotal > 0 ? `${passed}/${soft.length + hard.length}` : `${soft.length} soft`}
          </span>
        )}
        {hard.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md border border-mint/25 bg-mint/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-mint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            {hard.length} check
          </span>
        )}
        {dur && (
          <span className="inline-flex items-center gap-1 rounded-md border border-line-2 bg-ink/40 px-1.5 py-0.5 font-mono text-[10px] text-mist">
            {dur}
          </span>
        )}
        {finalBeat && (
          <span
            title="handed off"
            className="inline-flex items-center gap-1 rounded-md border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan"
          >
            → {finalBeat.handoff?.to ?? "handed off"}
          </span>
        )}
      </div>

      {/* latest heartbeat */}
      {latest && (
        <div
          title={latest.note}
          className="mt-2 flex items-start gap-1.5 pl-7 text-[11px] italic leading-snug text-mist"
        >
          <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-cyan" />
          <span className="line-clamp-2">
            {latest.insight && (
              <span
                className="mr-1 inline-block h-1.5 w-1.5 translate-y-px rounded-full bg-amber not-italic"
                title="carries an insight"
              />
            )}
            {renderNote(latest.note)}
          </span>
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
