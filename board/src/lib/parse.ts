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
  const steps: ConductorStep[] = rawSteps
    .filter((s) => s && s.id)
    .map((s, index) => {
      const instruction = (s.instruction ?? "").trim();
      const { soft, hard } = splitGates(s.gate);
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
      };
    });
  return { name: doc.name, description: doc.description, steps };
}
