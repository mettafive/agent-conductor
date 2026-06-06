import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { StepNodeData } from "../lib/parseConductor";

type StepNode = Node<StepNodeData>;

export function StepNode({ data }: NodeProps<StepNode>) {
  const check = data.gates[0];

  if (data.isCondition) {
    return (
      <div className="w-[210px] -rotate-0">
        <Handle type="target" position={Position.Top} />
        <div className="relative rounded-xl border border-amber/40 bg-amber/[0.07] px-3.5 py-3 shadow-[0_0_0_1px_rgba(251,191,36,0.06)]">
          <div className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" className="text-amber">
              <path
                fill="currentColor"
                d="M12 2 2 12l10 10 10-10L12 2Zm0 3.8L18.2 12 12 18.2 5.8 12 12 5.8Z"
              />
            </svg>
            <span className="font-mono text-[13px] font-medium text-chalk">
              {data.stepId}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-mist">
            {data.instruction || "condition"}
          </p>
          <span className="mt-2 inline-block rounded-md border border-amber/30 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-amber">
            condition
          </span>
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  return (
    <div className="w-[230px]">
      <Handle type="target" position={Position.Top} />
      <div className="rounded-xl border border-line-2 bg-panel px-3.5 py-3 transition-colors hover:border-iris/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/15 font-mono text-[10px] text-iris">
              {data.index + 1}
            </span>
            <span className="font-mono text-[13px] font-medium text-chalk">
              {data.stepId}
            </span>
          </div>
          {data.output && (
            <span
              title={`outputs ${data.output}`}
              className="rounded-md border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan"
            >
              → {data.output}
            </span>
          )}
        </div>

        <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-mist">
          {data.instruction}
        </p>

        {data.type === "loop" && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-iris/30 bg-iris/10 px-1.5 py-0.5 font-mono text-[10px] text-iris">
              ⟳ loop{data.over ? ` over ${data.over}` : ""}
            </span>
            {data.parallel && (
              <span className="rounded-md border border-cyan/30 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan">
                ∥ parallel
              </span>
            )}
          </div>
        )}
        {check && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-mint/25 bg-mint/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              check{check.checker ? `:${check.checker}` : ""}
            </span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
