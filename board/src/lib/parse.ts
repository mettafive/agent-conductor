import yaml from "js-yaml";
import type { ConductorStep, HardGate } from "./types";

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
  over?: string;
  as?: string;
  parallel?: boolean;
  steps?: RawStep[];
  approval?: {
    prompt?: string;
    items?: string[];
    actions?: { approve?: string; reject?: string };
  };
}

function splitGates(gate: unknown[] | undefined): { soft: string[]; hard: HardGate[] } {
  const soft: string[] = [];
  const hard: HardGate[] = [];
  if (!Array.isArray(gate)) return { soft, hard };
  for (const g of gate) {
    if (typeof g === "string") {
      soft.push(g);
    } else if (g && typeof g === "object") {
      const o = g as Record<string, unknown>;
      if (typeof o.check === "string") {
        hard.push({ text: o.check, name: typeof o.name === "string" ? o.name : undefined });
      } else {
        soft.push(String(g));
      }
    }
  }
  return { soft, hard };
}

const firstLineOf = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";

function toStep(s: RawStep, index: number): ConductorStep {
  const instruction = (s.instruction ?? "").trim();
  const { soft, hard } = splitGates(s.gate);
  const isLoop = s.type === "loop";
  const isApproval = s.type === "approval";
  return {
    id: s.id,
    index,
    instruction,
    firstLine: firstLineOf(instruction),
    isCondition: s.type === "condition",
    ifTrue: s.if_true,
    ifFalse: s.if_false,
    then: s.then,
    output: s.output,
    requires: Array.isArray(s.requires) ? s.requires : [],
    soft,
    hard,
    isLoop,
    over: s.over,
    as: s.as,
    parallel: s.parallel === true,
    subSteps:
      isLoop && Array.isArray(s.steps)
        ? s.steps.filter((x) => x && x.id).map((x, i) => toStep(x, i))
        : undefined,
    isApproval,
    approval: isApproval
      ? {
          prompt: s.approval?.prompt,
          items: Array.isArray(s.approval?.items) ? s.approval!.items : undefined,
          approve: s.approval?.actions?.approve,
          reject: s.approval?.actions?.reject,
        }
      : undefined,
  };
}

export interface ParsedConductor {
  name?: string;
  description?: string;
  steps: ConductorStep[];
}

/** Parse a conductor YAML string into ordered step structure. */
export function parseConductor(src: string | null): ParsedConductor | null {
  if (!src) return null;
  let doc: { name?: string; description?: string; steps?: RawStep[] };
  try {
    doc = (yaml.load(src) as typeof doc) ?? {};
  } catch {
    return null;
  }
  const rawSteps = Array.isArray(doc.steps) ? doc.steps : [];
  const steps = rawSteps.filter((s) => s && s.id).map((s, i) => toStep(s, i));
  return { name: doc.name, description: doc.description, steps };
}
