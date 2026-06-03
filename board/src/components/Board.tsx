import { LayoutGroup } from "framer-motion";
import type { BoardModel, Column as Col } from "../lib/types";
import { Column } from "./Column";
import type { Decision } from "./ApprovalCard";

const MAIN: Col[] = ["pending", "running", "gate", "done"];

export function Board({
  model,
  onOpenLoop,
  onApprove,
}: {
  model: BoardModel;
  onOpenLoop?: (id: string) => void;
  onApprove?: (stepId: string, decisions: Decision[]) => Promise<{ ok: boolean }> | void;
}) {
  const byCol = (c: Col) => model.steps.filter((s) => s.column === c);
  const failed = byCol("failed");

  return (
    <LayoutGroup>
      <div className="mx-auto max-w-[1400px] px-5 py-6">
        <div
          className={`grid items-start gap-3 ${
            failed.length > 0
              ? "lg:grid-cols-[repeat(4,minmax(0,1fr))_0.85fr]"
              : "lg:grid-cols-4"
          } sm:grid-cols-2`}
        >
          {MAIN.map((c) => (
            <Column key={c} col={c} steps={byCol(c)} onOpenLoop={onOpenLoop} onApprove={onApprove} />
          ))}
          {failed.length > 0 && (
            <Column col="failed" steps={failed} side onOpenLoop={onOpenLoop} onApprove={onApprove} />
          )}
        </div>
      </div>
    </LayoutGroup>
  );
}
