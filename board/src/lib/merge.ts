import { parseConductor } from "./parse";
import type {
  BoardModel,
  BoardStep,
  Column,
  ConductorStep,
  GateCriterion,
  LoopState,
  Snapshot,
} from "./types";

interface RawStepStatus {
  status?: string;
  gate?: string;
  attempt?: number;
  branch_taken?: string;
  output?: unknown;
  gate_detail?: Array<{
    criterion?: string;
    kind?: string;
    passed?: boolean;
    exit_code?: number;
  }>;
  // loops
  type?: string;
  total?: number;
  completed?: number;
  current_item?: string;
  iterations?: Record<string, Record<string, RawStepStatus>>;
  // heartbeats
  heartbeat?: Array<{
    at?: string;
    note?: string;
    iteration?: string;
    insight?: { type?: string; seed?: string; step?: string; confidence?: string };
    finalBeat?: boolean;
    handoff?: { to?: string; to_iteration?: string; context?: string; produced?: string };
  }>;
  learnings?: string[];
}

function buildHeartbeat(st: RawStepStatus) {
  return Array.isArray(st.heartbeat)
    ? st.heartbeat
        .filter((h) => h && typeof h.at === "string" && typeof h.note === "string")
        .map((h) => ({
          at: h.at as string,
          note: h.note as string,
          iteration: h.iteration,
          insight:
            h.insight && typeof h.insight.type === "string"
              ? {
                  type: h.insight.type,
                  seed: h.insight.seed ?? "",
                  step: h.insight.step,
                  confidence: h.insight.confidence,
                }
              : undefined,
          finalBeat: h.finalBeat === true,
          handoff:
            h.handoff && typeof h.handoff === "object"
              ? {
                  to: h.handoff.to,
                  to_iteration: h.handoff.to_iteration,
                  context: h.handoff.context,
                  produced: h.handoff.produced,
                }
              : undefined,
        }))
    : [];
}

function buildLoop(step: ConductorStep, st: RawStepStatus): LoopState | undefined {
  if (!step.isLoop) return undefined;
  const subDefs = step.subSteps ?? [];
  const raw = st.iterations ?? {};
  const items = Object.keys(raw);

  const iterations = items.map((item) => {
    const itStatus = raw[item] ?? {};
    const ids = subDefs.length ? subDefs.map((s) => s.id) : Object.keys(itStatus);
    const steps = ids.map((id) => {
      const ss = itStatus[id] ?? {};
      return {
        id,
        status: ss.status ?? "pending",
        gate: ss.gate ?? "pending",
        attempt: ss.attempt ?? 1,
      };
    });
    return {
      item,
      steps,
      done: steps.length > 0 && steps.every((s) => s.status === "done"),
      failed: steps.some((s) => s.status === "failed"),
    };
  });

  return {
    total: typeof st.total === "number" ? st.total : items.length,
    completed:
      typeof st.completed === "number"
        ? st.completed
        : iterations.filter((i) => i.done).length,
    currentItem: st.current_item,
    iterations,
  };
}

function columnFor(rawStatus: string, gate: string): Column {
  if (rawStatus === "failed" || gate === "failed") return "failed";
  if (rawStatus === "done") return "done";
  if (gate === "checking") return "gate";
  if (rawStatus === "running") return "running";
  return "pending";
}

/** Attach per-criterion pass/fail from gate_detail when the agent recorded it. */
function buildCriteria(step: ConductorStep, detail: RawStepStatus["gate_detail"]): GateCriterion[] {
  const out: GateCriterion[] = [];
  const findDetail = (text: string) =>
    detail?.find((d) => d.criterion === text || d.criterion === text.trim());

  for (const text of step.soft) {
    const d = findDetail(text);
    out.push({ kind: "soft", text, passed: d ? !!d.passed : null });
  }
  for (const h of step.hard) {
    const d = findDetail(h.text) ?? (h.name ? findDetail(h.name) : undefined);
    out.push({
      kind: "hard",
      text: h.text,
      name: h.name,
      passed: d ? !!d.passed : null,
      exitCode: d?.exit_code,
    });
  }
  return out;
}

/** Build a step list from status alone, when no conductor file is present. */
function stepsFromStatusOnly(statusSteps: Record<string, RawStepStatus>): ConductorStep[] {
  return Object.keys(statusSteps).map((id, index) => ({
    id,
    index,
    instruction: "",
    firstLine: "",
    isCondition: !!statusSteps[id]?.branch_taken,
    requires: [],
    soft: [],
    hard: [],
    isLoop: statusSteps[id]?.type === "loop",
  }));
}

export function buildModel(snap: Snapshot): BoardModel {
  const status = snap.status ?? {};
  const statusSteps = (status.steps as Record<string, RawStepStatus>) ?? {};
  const parsed = parseConductor(snap.conductorYaml);
  const hasConductor = !!parsed && parsed.steps.length > 0;

  const structure: ConductorStep[] = hasConductor
    ? parsed!.steps
    : stepsFromStatusOnly(statusSteps);

  const steps: BoardStep[] = structure.map((s) => {
    const st = statusSteps[s.id] ?? {};
    const rawStatus = st.status ?? "pending";
    const gateState = st.gate ?? "pending";
    return {
      ...s,
      column: columnFor(rawStatus, gateState),
      rawStatus,
      gateState,
      attempt: st.attempt ?? 1,
      branchTaken: st.branch_taken,
      output_value: st.output,
      criteria: buildCriteria(s, st.gate_detail),
      loop: buildLoop(s, st),
      heartbeat: buildHeartbeat(st),
      learnings: Array.isArray(st.learnings)
        ? st.learnings.filter((x): x is string => typeof x === "string")
        : [],
    };
  });

  const total = steps.length;
  const done = steps.filter((s) => s.column === "done").length;
  const lastBeatAt = steps
    .flatMap((s) => s.heartbeat.map((h) => h.at))
    .sort()
    .at(-1);
  const insightCount = steps.reduce(
    (n, s) => n + s.heartbeat.filter((h) => h.insight).length,
    0,
  );
  const suggestions = Array.isArray(status.suggestions)
    ? (status.suggestions as BoardModel["suggestions"])
    : [];

  return {
    workflow: (status.workflow as string) ?? parsed?.name ?? "workflow",
    description: parsed?.description ?? (status.description as string | undefined),
    goal: (status.goal as string | undefined) ?? parsed?.description,
    currentStepGoal: status.current_step_goal as string | undefined,
    lastBeatAt,
    insightCount,
    suggestions,
    runId: status.run_id as string | undefined,
    startedAt: status.started_at as string | undefined,
    endedAt: status.completed_at as string | undefined,
    overallStatus: (status.status as string) ?? (total ? "idle" : "idle"),
    currentStep: status.current_step as string | undefined,
    steps,
    done,
    total,
    hasConductor,
    error: status._error as string | undefined,
  };
}
