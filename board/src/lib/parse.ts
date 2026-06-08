import type { ConductorStep, KnowledgeEntry, KnowledgeStatus, Scope } from "./types";

interface RawStep {
  id?: string;
  title?: string;
  instruction?: string;
  type?: string;
  requires?: number[];
  output?: string;
  over?: string;
  as?: string;
  parallel?: boolean | "auto";
  steps?: RawStep[];
}

const firstLineOf = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";

function toStep(s: RawStep, index: number): ConductorStep {
  const instruction = (s.instruction ?? "").trim();
  const isLoop = s.type === "loop";
  const title = (s.title ?? `Card ${index + 1}`).trim();
  return {
    id: String(index),
    title,
    index,
    instruction,
    firstLine: firstLineOf(instruction),
    isCondition: false,
    output: s.output,
    requires: Array.isArray(s.requires) ? s.requires : [],
    isLoop,
    over: s.over,
    as: s.as,
    parallel: s.parallel === "auto" ? "auto" : s.parallel === true,
    subSteps:
      isLoop && Array.isArray(s.steps)
        ? s.steps.filter((x) => x).map((x, i) => toStep(x, i))
        : undefined,
  };
}

const KNOWLEDGE_STATUS: KnowledgeStatus[] = ["emerging", "proven", "applied", "open"];
const SCOPES: Scope[] = ["this-conductor", "upstream", "template", "tooling", "corpus"];

/** Parse the conductor's `knowledge:` section — objects, or bare strings. */
export function parseKnowledge(raw: unknown): KnowledgeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeEntry[] = [];
  for (const k of raw) {
    if (typeof k === "string") {
      out.push({ title: k, status: "applied", scope: "this-conductor", observed: 1 });
    } else if (k && typeof k === "object") {
      const o = k as Record<string, unknown>;
      if (typeof o.title !== "string") continue;
      out.push({
        id: typeof o.id === "string" ? o.id : undefined,
        title: o.title,
        status: KNOWLEDGE_STATUS.includes(o.status as KnowledgeStatus)
          ? (o.status as KnowledgeStatus)
          : "emerging",
        scope: SCOPES.includes(o.scope as Scope) ? (o.scope as Scope) : "this-conductor",
        observed: typeof o.observed === "number" ? o.observed : 1,
        step: typeof o.step === "string" ? o.step : typeof o.source_card === "string" ? o.source_card : undefined,
        source: typeof o.source === "string" ? o.source : undefined,
        source_run: typeof o.source_run === "string" ? o.source_run : undefined,
        source_card:
          typeof o.source_card === "string" || typeof o.source_card === "number" ? o.source_card : undefined,
        source_card_title: typeof o.source_card_title === "string" ? o.source_card_title : undefined,
        tag: typeof o.tag === "string" ? o.tag : undefined,
        detail: typeof o.detail === "string" ? o.detail : undefined,
        type: typeof o.type === "string" ? o.type : undefined,
        current: typeof o.current === "string" ? o.current : undefined,
        proposed: typeof o.proposed === "string" ? o.proposed : undefined,
        run_applied: typeof o.run_applied === "string" ? o.run_applied : undefined,
        note: typeof o.note === "string" ? o.note : typeof o.detail === "string" ? o.detail : undefined,
      });
    }
  }
  return out;
}

export interface ParsedConductor {
  name?: string;
  description?: string;
  knowledge: KnowledgeEntry[];
  steps: ConductorStep[];
  maxAttempts: number;
  /** Phase 0 self-improvement pass enabled? Default false in v3. */
  autoImprove: boolean;
}

/** Parse a conductor JSON string into ordered step structure. */
export function parseConductor(src: string | null): ParsedConductor | null {
  if (!src) return null;
  let doc: {
    name?: string;
    description?: string;
    knowledge?: unknown;
    steps?: RawStep[];
    max_attempts?: unknown;
    auto_improve?: boolean;
  };
  try {
    doc = (JSON.parse(src) as typeof doc) ?? {};
  } catch {
    return null;
  }
  const rawSteps = Array.isArray(doc.steps) ? doc.steps : [];
  const steps = rawSteps.filter((s) => s).map((s, i) => toStep(s, i));
  return {
    name: doc.name,
    description: doc.description,
    knowledge: parseKnowledge(doc.knowledge),
    steps,
    maxAttempts:
      typeof doc.max_attempts === "number" && Number.isInteger(doc.max_attempts) && doc.max_attempts > 0
        ? doc.max_attempts
        : 5,
    autoImprove: doc.auto_improve === true,
  };
}
