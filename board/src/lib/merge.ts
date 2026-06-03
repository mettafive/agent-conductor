import { parseConductor } from "./parse";
import type {
  BoardModel,
  BoardStep,
  Column,
  ConductorStep,
  GateCriterion,
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
    };
  });

  const total = steps.length;
  const done = steps.filter((s) => s.column === "done").length;

  return {
    workflow: (status.workflow as string) ?? parsed?.name ?? "workflow",
    description: parsed?.description ?? (status.description as string | undefined),
    startedAt: status.started_at as string | undefined,
    overallStatus: (status.status as string) ?? (total ? "idle" : "idle"),
    currentStep: status.current_step as string | undefined,
    steps,
    done,
    total,
    hasConductor,
    error: status._error as string | undefined,
  };
}
