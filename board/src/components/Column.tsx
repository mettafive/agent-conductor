import { AnimatePresence } from "framer-motion";
import type { BoardStep, Column as Col } from "../lib/types";
import { StepCard } from "./StepCard";

const META: Record<Col, { label: string; dot: string; text: string }> = {
  pending: { label: "Pending", dot: "bg-line-2", text: "text-mist" },
  running: { label: "Running", dot: "bg-cyan", text: "text-cyan" },
  gate: { label: "Gate Check", dot: "bg-amber", text: "text-amber" },
  done: { label: "Done", dot: "bg-mint", text: "text-mint" },
  failed: { label: "Failed", dot: "bg-rose", text: "text-rose" },
};

export function Column({
  col,
  steps,
  side,
}: {
  col: Col;
  steps: BoardStep[];
  side?: boolean;
}) {
  const m = META[col];
  return (
    <div
      className={`flex min-w-0 flex-col rounded-2xl border bg-ink-2/40 ${
        side ? "border-rose/15" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2.5">
        <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
        <span className={`font-mono text-[11px] uppercase tracking-wide ${m.text}`}>
          {m.label}
        </span>
        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-md bg-panel px-1 font-mono text-[10px] text-mist">
          {steps.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {steps.map((s) => (
            <StepCard key={s.id} step={s} />
          ))}
        </AnimatePresence>
        {steps.length === 0 && (
          <div className="grid flex-1 place-items-center py-6">
            <span className="font-mono text-[10px] text-line-2">empty</span>
          </div>
        )}
      </div>
    </div>
  );
}
