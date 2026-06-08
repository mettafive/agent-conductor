import type { Edge, Node } from "@xyflow/react";

export interface CheckCriterion {
  text: string;
  name?: string;
  checker?: "instruction";
}

export interface StepNodeData {
  stepId: string;
  index: number;
  type: "step" | "loop";
  instruction: string;
  checks: CheckCriterion[];
  requires: string[];
  output?: string;
  over?: string;
  parallel?: boolean;
  [key: string]: unknown;
}

export interface ParsedConductor {
  name: string;
  description: string;
  inputs: string[];
  nodes: Node<StepNodeData>[];
  edges: Edge[];
  error?: string;
}

interface RawStep {
  id?: string;
  title?: string;
  instruction?: string;
  type?: string;
  requires?: number[];
  output?: string;
  over?: string;
  parallel?: boolean;
}

function instructionCheck(s: RawStep): CheckCriterion[] {
  const text = (s.instruction ?? "").trim();
  if (!text) return [];
  return [
    {
      text,
      name: s.title,
      checker: "instruction",
    },
  ];
}

const X_CENTER = 0;
const Y_GAP = 168;

/**
 * Turn a workflow JSON string into a laid-out flow graph.
 * Layout: steps stack vertically in declared order. Requires edges show
 * dependencies; loops are highlighted as repeated checked sub-sequences.
 */
export function parseConductor(src: string): ParsedConductor {
  let doc: { name?: string; description?: string; inputs?: string[]; steps?: RawStep[] };
  try {
    doc = (JSON.parse(src) as typeof doc) ?? {};
  } catch (e) {
    return {
      name: "",
      description: "",
      inputs: [],
      nodes: [],
      edges: [],
      error: e instanceof Error ? e.message : "Invalid JSON",
    };
  }

  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  if (steps.length === 0) {
    return {
      name: doc.name ?? "",
      description: doc.description ?? "",
      inputs: doc.inputs ?? [],
      nodes: [],
      edges: [],
      error: steps.length === 0 ? "No steps found." : undefined,
    };
  }

  const stepKey = (_s: RawStep, i: number) => String(i);
  const targetKey = (target: number | undefined) =>
    typeof target === "number" && target >= 0 && target < steps.length ? String(target) : null;

  const nodes: Node<StepNodeData>[] = steps.map((s, i) => {
    const kind = s.type === "loop" ? "loop" : "step";
    const key = stepKey(s, i);
    return {
      id: key,
      position: { x: X_CENTER, y: i * Y_GAP },
      type: "step",
      data: {
        stepId: key,
        index: i,
        type: kind,
        instruction: (s.instruction ?? "").trim(),
        checks: instructionCheck(s),
        requires: Array.isArray(s.requires) ? s.requires.map(String) : [],
        output: s.output,
        over: s.over,
        parallel: s.parallel === true,
      },
    };
  });

  const edges: Edge[] = [];
  const pushEdge = (e: Edge) => edges.push(e);

  steps.forEach((s, i) => {
    const key = stepKey(s, i);

    const next = steps[i + 1];
    if (next) {
      const nextKey = stepKey(next, i + 1);
      pushEdge({
        id: `${key}->seq->${nextKey}`,
        source: key,
        target: nextKey,
        type: "smoothstep",
        style: { stroke: "var(--color-line-2)", strokeWidth: 1.5 },
      });
    }

    // dependency edges (dashed)
    (s.requires ?? []).forEach((dep) => {
      const depKey = targetKey(dep);
      if (depKey && depKey !== String(i - 1)) {
        pushEdge({
          id: `${depKey}~req~${key}`,
          source: depKey,
          target: key,
          type: "smoothstep",
          style: {
            stroke: "var(--color-line-2)",
            strokeWidth: 1,
            strokeDasharray: "4 4",
            opacity: 0.6,
          },
        });
      }
    });
  });

  return {
    name: doc.name ?? "",
    description: doc.description ?? "",
    inputs: doc.inputs ?? [],
    nodes,
    edges,
  };
}
