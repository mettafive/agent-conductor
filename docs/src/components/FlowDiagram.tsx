import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import { parseConductor } from "../lib/parseConductor";
import { StepNode } from "./StepNode";

const nodeTypes: NodeTypes = { step: StepNode };

interface Props {
  yaml: string;
  className?: string;
}

export function FlowDiagram({ yaml, className }: Props) {
  const parsed = useMemo(() => parseConductor(yaml), [yaml]);

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      {parsed.error && parsed.nodes.length === 0 ? (
        <div className="grid h-full place-items-center p-8 text-center">
          <div>
            <p className="font-mono text-sm text-rose">{parsed.error}</p>
            <p className="mt-2 text-xs text-mist">
              Fix the YAML and the graph will redraw.
            </p>
          </div>
        </div>
      ) : (
        <ReactFlow
          key={parsed.nodes.length}
          nodes={parsed.nodes}
          edges={parsed.edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ type: "smoothstep" }}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="var(--color-line)"
          />
          <Controls
            showInteractive={false}
            className="!border-line !bg-panel [&_button]:!border-line [&_button]:!bg-panel [&_button]:!fill-mist [&_button:hover]:!bg-panel-2"
          />
        </ReactFlow>
      )}
    </div>
  );
}
