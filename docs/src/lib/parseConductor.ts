import yaml from "js-yaml";
import type { Edge, Node } from "@xyflow/react";

export type GateCriterion =
  | { kind: "soft"; text: string }
  | { kind: "hard"; text: string; name?: string };

export interface StepNodeData {
  stepId: string;
  index: number;
  type: "step" | "condition";
  instruction: string;
  gates: GateCriterion[];
  requires: string[];
  output?: string;
  isCondition: boolean;
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
  id: string;
  instruction?: string;
  gate?: unknown[];
  type?: string;
  if_true?: string;
  if_false?: string;
  then?: string;
  requires?: string[];
  output?: string;
}

function normalizeGates(gate: unknown[] | undefined): GateCriterion[] {
  if (!Array.isArray(gate)) return [];
  return gate.map((g): GateCriterion => {
    if (typeof g === "string") return { kind: "soft", text: g };
    if (g && typeof g === "object") {
      const o = g as Record<string, unknown>;
      if (typeof o.check === "string") {
        return {
          kind: "hard",
          text: o.check,
          name: typeof o.name === "string" ? o.name : undefined,
        };
      }
    }
    return { kind: "soft", text: String(g) };
  });
}

const X_CENTER = 0;
const X_GAP = 300;
const Y_GAP = 168;

/**
 * Turn a conductor YAML string into a laid-out flow graph.
 * Layout: steps stack vertically in declared order. Condition branches fan
 * their targets into left / right lanes so if_true / if_false read clearly.
 */
export function parseConductor(src: string): ParsedConductor {
  let doc: { name?: string; description?: string; inputs?: string[]; steps?: RawStep[] };
  try {
    doc = (yaml.load(src) as typeof doc) ?? {};
  } catch (e) {
    return {
      name: "",
      description: "",
      inputs: [],
      nodes: [],
      edges: [],
      error: e instanceof Error ? e.message : "Invalid YAML",
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

  const idToIndex = new Map<string, number>();
  steps.forEach((s, i) => s?.id && idToIndex.set(s.id, i));

  // lane assignment: a branch target referenced by if_false gets pushed right,
  // if_true stays left-of-center; everything else centers.
  const lane = new Map<string, number>();
  steps.forEach((s) => {
    if (s?.type === "condition") {
      if (s.if_true) lane.set(s.if_true, -1);
      if (s.if_false) lane.set(s.if_false, 1);
    }
  });

  const nodes: Node<StepNodeData>[] = steps.map((s, i) => {
    const isCondition = s.type === "condition";
    const laneX = (lane.get(s.id) ?? 0) * X_GAP;
    return {
      id: s.id,
      position: { x: X_CENTER + laneX, y: i * Y_GAP },
      type: "step",
      data: {
        stepId: s.id,
        index: i,
        type: isCondition ? "condition" : "step",
        instruction: (s.instruction ?? "").trim(),
        gates: normalizeGates(s.gate),
        requires: Array.isArray(s.requires) ? s.requires : [],
        output: s.output,
        isCondition,
      },
    };
  });

  const edges: Edge[] = [];
  const pushEdge = (e: Edge) => edges.push(e);

  steps.forEach((s, i) => {
    if (!s?.id) return;

    if (s.type === "condition") {
      if (s.if_true && idToIndex.has(s.if_true)) {
        pushEdge({
          id: `${s.id}->${s.if_true}`,
          source: s.id,
          target: s.if_true,
          label: "true",
          type: "smoothstep",
          animated: true,
          style: { stroke: "var(--color-mint)", strokeWidth: 1.5 },
          labelStyle: { fill: "var(--color-mint)" },
        });
      }
      if (s.if_false && idToIndex.has(s.if_false)) {
        pushEdge({
          id: `${s.id}->${s.if_false}`,
          source: s.id,
          target: s.if_false,
          label: "false",
          type: "smoothstep",
          animated: true,
          style: { stroke: "var(--color-rose)", strokeWidth: 1.5 },
          labelStyle: { fill: "var(--color-rose)" },
        });
      }
      return; // conditions route only via if_true/if_false
    }

    // explicit rejoin
    if (s.then && idToIndex.has(s.then)) {
      pushEdge({
        id: `${s.id}->then->${s.then}`,
        source: s.id,
        target: s.then,
        label: "then",
        type: "smoothstep",
        style: { stroke: "var(--color-iris)", strokeWidth: 1.5 },
        labelStyle: { fill: "var(--color-iris)" },
      });
    } else {
      // fall through to the next sequential step, unless next is unreachable
      const next = steps[i + 1];
      if (next?.id) {
        pushEdge({
          id: `${s.id}->seq->${next.id}`,
          source: s.id,
          target: next.id,
          type: "smoothstep",
          style: { stroke: "var(--color-line-2)", strokeWidth: 1.5 },
        });
      }
    }

    // dependency edges (dashed)
    (s.requires ?? []).forEach((dep) => {
      if (idToIndex.has(dep) && dep !== steps[i - 1]?.id) {
        pushEdge({
          id: `${dep}~req~${s.id}`,
          source: dep,
          target: s.id,
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
