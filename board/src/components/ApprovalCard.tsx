import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { BoardStep } from "../lib/types";

export type Decision = { label: string; decision: "approved" | "rejected" };

const EASE = [0.22, 1, 0.36, 1] as const;

export function ApprovalCard({
  step,
  onDecide,
}: {
  step: BoardStep;
  onDecide: (stepId: string, decisions: Decision[]) => Promise<{ ok: boolean }> | void;
}) {
  const appr = step.approvalState;
  const items = appr?.items ?? [];
  const hasItems = items.length > 0;
  const decided = !!appr?.decided;

  // checkbox state: which items are approved (default all checked)
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setChecked(Object.fromEntries(items.map((i) => [i.label, i.decision !== "rejected"])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, items.length]);
  const [busy, setBusy] = useState(false);

  const submit = async (decisions: Decision[]) => {
    if (busy) return;
    setBusy(true);
    await onDecide(step.id, decisions);
    setBusy(false);
  };

  const approveSelected = () =>
    submit(
      hasItems
        ? items.map((i) => ({
            label: i.label,
            decision: checked[i.label] ? "approved" : "rejected",
          }))
        : [{ label: step.id, decision: "approved" }],
    );
  const rejectAll = () =>
    submit(
      hasItems
        ? items.map((i) => ({ label: i.label, decision: "rejected" as const }))
        : [{ label: step.id, decision: "rejected" }],
    );

  return (
    <motion.div
      layout
      layoutId={step.id}
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -2 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="rounded-xl border border-amber/40 bg-amber/[0.06] px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-amber/15 text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
        </span>
        <span className="flex-1 truncate font-mono text-[12.5px] text-chalk">{step.id}</span>
        <span className="rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-amber">
          {decided ? "decided" : "human"}
        </span>
      </div>

      {appr?.prompt && (
        <p className="mt-2 pl-7 text-[12px] font-medium leading-snug text-chalk">{appr.prompt}</p>
      )}

      {hasItems && (
        <div className="mt-2 space-y-1 pl-7">
          {items.map((i) => {
            const dec = i.decision;
            return (
              <label
                key={i.label}
                className={`flex cursor-pointer items-center gap-2 text-[11.5px] ${
                  decided ? "cursor-default" : ""
                }`}
              >
                {decided ? (
                  <span className={dec === "approved" ? "text-mint" : "text-rose"}>
                    {dec === "approved" ? "✓" : "✗"}
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={!!checked[i.label]}
                    onChange={(e) =>
                      setChecked((c) => ({ ...c, [i.label]: e.target.checked }))
                    }
                    className="h-3 w-3 accent-mint"
                  />
                )}
                <span className={dec === "rejected" ? "text-rose/80 line-through" : "text-mist-2"}>
                  {i.label}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {!decided ? (
        <div className="mt-3 flex gap-2 pl-7">
          <button
            onClick={approveSelected}
            disabled={busy}
            className="rounded-lg bg-mint/15 px-3 py-1 text-xs font-medium text-mint transition-colors hover:bg-mint/25 disabled:opacity-40"
          >
            {hasItems ? "Approve selected" : "Approve"}
          </button>
          <button
            onClick={rejectAll}
            disabled={busy}
            className="rounded-lg border border-rose/30 px-3 py-1 text-xs text-rose transition-colors hover:bg-rose/10 disabled:opacity-40"
          >
            Reject{hasItems ? " all" : ""}
          </button>
        </div>
      ) : (
        <p className="mt-2 pl-7 font-mono text-[10px] text-mist">
          decision recorded — the agent will route accordingly
        </p>
      )}
    </motion.div>
  );
}
