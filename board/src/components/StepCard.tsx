import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BoardStep, GateCriterion } from "../lib/types";

function ForkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" className="text-amber">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M6 4v6a4 4 0 0 0 4 4h0M6 4v16M6 10a4 4 0 0 1 4-4h0m8 0-3-3m3 3-3 3m3-3h-4"
      />
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
      <span
        className={`rounded border px-1 py-px font-mono text-[9px] ${
          c.kind === "hard"
            ? "border-mint/25 text-mint"
            : "border-line-2 text-mist"
        }`}
      >
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

const ACCENT: Record<string, string> = {
  done: "border-mint/25",
  failed: "border-rose/40",
  gate: "border-amber/40",
  running: "border-cyan/40 pulse-ring",
  pending: "border-line-2",
};

const SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;

export function StepCard({ step }: { step: BoardStep }) {
  const [open, setOpen] = useState(false);
  const hasCriteria = step.criteria.length > 0;
  const dim = step.column === "pending" ? "opacity-70" : "";

  return (
    <motion.div
      layout
      layoutId={step.id}
      initial={{ opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={SPRING}
      onClick={() => hasCriteria && setOpen((o) => !o)}
      className={`rounded-xl border bg-panel px-3 py-2.5 ${ACCENT[step.column]} ${dim} ${
        hasCriteria ? "cursor-pointer" : ""
      } ${step.column === "done" ? "opacity-85" : ""}`}
    >
      <div className="flex items-center gap-2">
        {step.isCondition ? (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-amber/10">
            <ForkIcon />
          </span>
        ) : (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/15 font-mono text-[10px] text-iris">
            {step.index + 1}
          </span>
        )}
        <span className="flex-1 truncate font-mono text-[12.5px] text-chalk">
          {step.id}
        </span>
        {step.attempt > 1 && (
          <span
            title={`${step.attempt} attempts`}
            className="rounded border border-amber/30 bg-amber/10 px-1 font-mono text-[9px] text-amber"
          >
            ×{step.attempt}
          </span>
        )}
        <StatusGlyph step={step} />
      </div>

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

      <AnimatePresence initial={false}>
        {open && hasCriteria && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 border-t border-line pt-2 pl-7">
              {step.criteria.map((c, i) => (
                <CriterionRow key={i} c={c} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
