import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Column, ConductorStep, HeartbeatEntry, IterationStep } from "../lib/types";
import { useNow } from "../lib/useNow";
import { subStepColumn } from "../lib/loop";
import { HeartbeatTimeline } from "./HeartbeatTimeline";

const ACCENT: Record<Column, string> = {
  done: "border-mint/25 bg-mint/[0.04]",
  failed: "border-rose/40 bg-rose/[0.05]",
  gate: "border-amber/40 bg-amber/[0.05]",
  running: "border-cyan/40 bg-cyan/[0.05] pulse-ring",
  pending: "border-line-2 bg-panel/40",
};

const EASE = [0.22, 1, 0.36, 1] as const;
const MOVE = {
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.85 },
  opacity: { duration: 0.2, ease: "easeOut" },
  default: { duration: 0.2, ease: EASE },
} as const;

function Glyph({ col }: { col: Column }) {
  switch (col) {
    case "done":
      return <span className="text-mint">✓</span>;
    case "failed":
      return <span className="text-rose">✕</span>;
    case "gate":
      return <span className="spin inline-block text-amber">◜</span>;
    case "running":
      return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />;
    default:
      return <span className="h-1.5 w-1.5 rounded-full border border-line-2" />;
  }
}

export function SubStepCard({
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
  const hasDetail = beats.length > 0 || soft.length + hard.length > 0;

  return (
    <motion.div
      layout
      layoutId={`${loopId}::${item}::${sub.id}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={MOVE}
      onClick={() => hasDetail && setOpen((o) => !o)}
      className={`rounded-lg border px-2 py-1.5 ${ACCENT[col]} ${hasDetail ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center font-mono text-[10px]">
          <Glyph col={col} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mist-2">{sub.id}</span>
        {sub.attempt > 1 && (
          <span className="shrink-0 rounded border border-amber/30 px-1 font-mono text-[8px] text-amber">
            ×{sub.attempt}
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {(soft.length > 0 || hard.length > 0) && (
              <div className="mt-1.5 space-y-0.5 border-t border-line/60 pt-1.5">
                {soft.map((t, i) => (
                  <div key={`s${i}`} className="flex gap-1 text-[9.5px] leading-snug text-mist">
                    <span className="text-iris">·</span>
                    <span className="flex-1">{t}</span>
                  </div>
                ))}
                {hard.map((h, i) => (
                  <div key={`h${i}`} className="flex gap-1 font-mono text-[9px] leading-snug text-mint/80">
                    <span>$</span>
                    <span className="flex-1 truncate">{h.name ?? h.text}</span>
                  </div>
                ))}
              </div>
            )}
            {beats.length > 0 && (
              <HeartbeatTimeline
                entries={beats}
                learnings={[]}
                now={now}
                running={col === "running"}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
