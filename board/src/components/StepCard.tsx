import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BoardStep, GateCriterion, HeartbeatEntry, LoopIteration } from "../lib/types";
import { useNow } from "../lib/useNow";
import { renderNote, secondsSince } from "../lib/heartbeat";
import { HeartbeatTimeline } from "./HeartbeatTimeline";

function ForkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="text-amber">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 4v6a4 4 0 0 0 4 4h0M6 4v16M6 10a4 4 0 0 1 4-4h0m8 0-3-3m3 3-3 3m3-3h-4" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="text-iris">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function StatusGlyph({ step }: { step: BoardStep }) {
  switch (step.column) {
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

function CriterionRow({ c }: { c: GateCriterion }) {
  const mark =
    c.passed === true ? (
      <span className="text-mint">✓</span>
    ) : c.passed === false ? (
      <span className="text-rose">✕</span>
    ) : (
      <span className="text-line-2">○</span>
    );
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5 w-3 shrink-0 text-center font-mono text-[11px]">{mark}</span>
      <span className={`rounded border px-1 py-px font-mono text-[9px] ${c.kind === "hard" ? "border-mint/25 text-mint" : "border-line-2 text-mist"}`}>
        {c.kind}
      </span>
      <span className="flex-1 font-mono text-[11px] leading-snug text-mist-2">
        {c.kind === "hard" && c.name ? c.name : c.text}
        {c.kind === "hard" && typeof c.exitCode === "number" && (
          <span className="ml-1 text-mist">exit {c.exitCode}</span>
        )}
      </span>
    </div>
  );
}

const SUB_DOT: Record<string, string> = {
  done: "bg-mint",
  failed: "bg-rose",
  running: "bg-cyan animate-pulse",
  checking: "bg-amber",
  pending: "bg-line-2",
};

/** One iteration of a loop — name, status dot, latest-beat summary, click to expand. */
function IterationRow({
  it,
  beats,
}: {
  it: LoopIteration;
  beats: HeartbeatEntry[];
}) {
  const [open, setOpen] = useState(false);
  const running = it.steps.some((s) => s.status === "running");
  const dot = it.failed ? "bg-rose" : it.done ? "bg-mint" : running ? "bg-cyan animate-pulse" : "bg-line-2";
  const latest = beats.at(-1);
  const summary = latest
    ? renderNote(latest.note)
    : it.done
      ? "done"
      : running
        ? "running"
        : "pending";
  const retried = it.steps.find((s) => s.attempt > 1);

  return (
    <div className="border-b border-line/40 last:border-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 py-1.5 text-left"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="shrink-0 font-mono text-[11px] text-mist-2">{it.item}</span>
        {retried && (
          <span className="shrink-0 rounded border border-amber/30 px-1 font-mono text-[9px] text-amber">
            ×{retried.attempt}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] italic text-mist">{summary}</span>
      </button>

      {open && (
        <div className="pb-2 pl-3.5">
          <div className="flex flex-wrap gap-1.5">
            {it.steps.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded border border-line-2 px-1.5 py-0.5 font-mono text-[9px] text-mist"
              >
                <span className={`h-1 w-1 rounded-full ${SUB_DOT[s.gate === "checking" ? "checking" : s.status] ?? "bg-line-2"}`} />
                {s.id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ACCENT: Record<string, string> = {
  done: "border-mint/25",
  failed: "border-rose/40",
  gate: "border-amber/40",
  running: "border-cyan/40 pulse-ring",
  pending: "border-line-2",
};

// Position (layout) moves ride a soft spring; the crossfade is a quick eased
// tween so a card sliding between columns reads crisply, not muddily. Tuned for
// a calm, premium glide rather than a springy bounce.
const EASE = [0.22, 1, 0.36, 1] as const; // easeOutQuint-ish
const MOVE = {
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.85 },
  opacity: { duration: 0.2, ease: "easeOut" },
  scale: { duration: 0.22, ease: EASE },
  default: { duration: 0.2, ease: EASE },
} as const;

export function StepCard({
  step,
  onOpenLoop,
}: {
  step: BoardStep;
  onOpenLoop?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(5000);
  const loop = step.isLoop ? step.loop : undefined;
  const latest = step.heartbeat.at(-1);
  const stalled =
    step.column === "running" && latest != null && (secondsSince(latest.at, now) ?? 0) > 90;
  const hasBeats = step.heartbeat.length > 0 || step.learnings.length > 0;
  const hasDetail = loop ? loop.iterations.length > 0 : step.criteria.length > 0;
  const expandable = hasDetail || hasBeats;
  const dim = step.column === "pending" ? "opacity-70" : "";
  const pct = loop && loop.total ? Math.round((loop.completed / loop.total) * 100) : 0;

  return (
    <motion.div
      layout
      layoutId={step.id}
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -2 }}
      transition={MOVE}
      onClick={() => {
        if (loop && onOpenLoop) return onOpenLoop(step.id); // drill into the child board
        if (expandable) setOpen((o) => !o);
      }}
      className={`rounded-xl border bg-panel px-3 py-2.5 ${ACCENT[step.column]} ${dim} ${
        expandable || (loop && onOpenLoop) ? "cursor-pointer" : ""
      } ${step.column === "done" ? "opacity-85" : ""}`}
    >
      <div className="flex items-center gap-2">
        {step.isCondition ? (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-amber/10">
            <ForkIcon />
          </span>
        ) : loop ? (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/10">
            <LoopIcon />
          </span>
        ) : (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/15 font-mono text-[10px] text-iris">
            {step.index + 1}
          </span>
        )}
        <span className="flex-1 truncate font-mono text-[12.5px] text-chalk">{step.id}</span>
        {stalled && (
          <span
            title="No heartbeat for 90s — agent may be stalled"
            className="h-2 w-2 animate-pulse rounded-full bg-amber"
          />
        )}
        {!loop && step.attempt > 1 && (
          <span
            title={`${step.attempt} attempts`}
            className="rounded border border-amber/30 bg-amber/10 px-1 font-mono text-[9px] text-amber"
          >
            ×{step.attempt}
          </span>
        )}
        <StatusGlyph step={step} />
      </div>

      {/* ---- collapsed body ---- */}
      {loop ? (
        <div className="mt-2 pl-7">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-mist-2">
              {loop.completed}/{loop.total} iterations
            </span>
            {loop.currentItem && step.column === "running" && (
              <span className="max-w-[130px] truncate font-mono text-[10px] text-cyan">
                {loop.currentItem}
              </span>
            )}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-iris to-cyan transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-iris/25 bg-iris/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-iris">
              loop
            </span>
            {step.over && (
              <span className="rounded-md border border-line-2 bg-ink/40 px-1.5 py-0.5 font-mono text-[10px] text-mist">
                over {step.over}
              </span>
            )}
            {onOpenLoop ? (
              <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-cyan">
                Open loop board
                <svg width="10" height="10" viewBox="0 0 24 24">
                  <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            ) : (
              expandable && (
                <span className="font-mono text-[10px] text-line-2">
                  {open ? "▾ hide" : "▸ iterations"}
                </span>
              )
            )}
          </div>
        </div>
      ) : (
        <>
          {step.firstLine && (
            <p className="mt-1.5 line-clamp-2 pl-7 text-[11.5px] leading-snug text-mist">
              {step.firstLine}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
            {step.soft.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-line-2 bg-ink/50 px-1.5 py-0.5 font-mono text-[10px] text-mist-2">
                <span className="h-1.5 w-1.5 rounded-full bg-iris" />
                {step.soft.length} soft
              </span>
            )}
            {step.hard.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-mint/25 bg-mint/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-mint">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                {step.hard.length} check
              </span>
            )}
            {step.isCondition && step.branchTaken && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-amber">
                → {step.branchTaken}
              </span>
            )}
            {step.output && (
              <span className="rounded-md border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan">
                → {step.output}
              </span>
            )}
            {step.requires.length > 0 && (
              <span
                title={`requires ${step.requires.join(", ")}`}
                className="inline-flex items-center gap-1 rounded-md border border-line-2 bg-ink/40 px-1.5 py-0.5 font-mono text-[10px] text-mist"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" className="text-line-2">
                  <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M9 6 4 12l5 6M15 6l5 6-5 6" />
                </svg>
                {step.requires.join(", ")}
              </span>
            )}
          </div>
        </>
      )}

      {/* ---- collapsed latest heartbeat ---- */}
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

      {/* ---- expanded detail ---- */}
      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            {hasBeats && (
              <HeartbeatTimeline
                entries={step.heartbeat}
                learnings={step.learnings}
                now={now}
                running={step.column === "running"}
                loop={loop}
              />
            )}

            {loop && loop.iterations.length > 0 && (
              <div className="mt-2.5 border-t border-line pt-1 pl-7">
                {loop.iterations.map((it) => (
                  <IterationRow
                    key={it.item}
                    it={it}
                    beats={step.heartbeat.filter((h) => h.iteration === it.item)}
                  />
                ))}
              </div>
            )}

            {!loop && step.criteria.length > 0 && (
              <div className="mt-2.5 border-t border-line pt-2 pl-7">
                {step.criteria.map((c, i) => (
                  <CriterionRow key={i} c={c} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
