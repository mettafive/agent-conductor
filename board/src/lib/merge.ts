import { parseConductor } from "./parse";
import type {
  ApprovalItem,
  ApprovalState,
  BoardModel,
  BoardStep,
  Column,
  ConductorStep,
  GateCriterion,
  ImproveMeta,
  LoopState,
  Scope,
  Snapshot,
} from "./types";

interface RawStepStatus {
  status?: string;
  gate?: string;
  attempt?: number;
  branch_taken?: string;
  output?: unknown;
  started_at?: string;
  completed_at?: string;
  // Phase 0 self-improvement card metadata (on _improve::* / _validate steps)
  improve?: {
    step?: string;
    title?: string;
    current?: string;
    proposed?: string;
    note?: string;
    observed?: number;
    scope?: string;
    structural?: boolean;
    kind?: string;
  };
  gate_detail?: Array<{
    criterion?: string;
    kind?: string;
    passed?: boolean;
    exit_code?: number;
    verified?: boolean;
  }>;
  // loops
  type?: string;
  total?: number;
  completed?: number;
  current_item?: string;
  iterations?: Record<string, Record<string, RawStepStatus>>;
  // approval
  approval?: {
    prompt?: string;
    items?: Array<{ label?: string; decision?: string | null }>;
  };
  // heartbeats
  heartbeat?: Array<{
    at?: string;
    note?: string;
    iteration?: string;
    sub?: string;
    insight?: { type?: string; seed?: string; step?: string; scope?: string; confidence?: string };
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
          sub: h.sub,
          insight:
            h.insight && typeof h.insight.type === "string"
              ? {
                  type: h.insight.type,
                  seed: h.insight.seed ?? "",
                  step: h.insight.step,
                  scope: h.insight.scope as import("./types").Scope | undefined,
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

/** Collect heartbeats written on a loop's sub-steps (iterations[item][sub]). */
function collectSubBeats(st: RawStepStatus) {
  const out: ReturnType<typeof buildHeartbeat> = [];
  const iters = st.iterations ?? {};
  for (const item of Object.keys(iters)) {
    const sub = iters[item] ?? {};
    for (const subId of Object.keys(sub)) {
      for (const h of buildHeartbeat(sub[subId])) {
        out.push({ ...h, iteration: h.iteration ?? item, sub: h.sub ?? subId });
      }
    }
  }
  return out;
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
      const def = subDefs.find((d) => d.id === id);
      return {
        id,
        status: ss.status ?? "pending",
        gate: ss.gate ?? "pending",
        attempt: ss.attempt ?? 1,
        started_at: ss.started_at,
        completed_at: ss.completed_at,
        criteria: def ? buildCriteria(def, ss.gate_detail) : [],
      };
    });
    return {
      item,
      steps,
      done: steps.length > 0 && steps.every((s) => s.status === "done"),
      failed: steps.some((s) => s.status === "failed"),
    };
  });

  // Prefer a declared positive total (frontloaded scope), else the number of
  // iterations actually materialized — never report 0/N when items exist.
  const declaredTotal = typeof st.total === "number" && st.total > 0 ? st.total : 0;
  return {
    total: Math.max(declaredTotal, items.length),
    completed:
      typeof st.completed === "number"
        ? st.completed
        : iterations.filter((i) => i.done).length,
    currentItem: st.current_item,
    iterations,
  };
}

function buildApproval(step: ConductorStep, st: RawStepStatus): ApprovalState | undefined {
  if (!step.isApproval) return undefined;
  const fromStatus = st.approval?.items;
  let items: ApprovalItem[];
  if (Array.isArray(fromStatus) && fromStatus.length > 0) {
    items = fromStatus.map((i) => ({
      label: String(i?.label ?? ""),
      decision: i?.decision === "approved" || i?.decision === "rejected" ? i.decision : null,
    }));
  } else {
    // materialize from the conductor's item templates (no decisions yet)
    items = (step.approval?.items ?? []).map((t) => ({ label: t, decision: null }));
  }
  const decided = items.length > 0 && items.every((i) => i.decision !== null);
  return { prompt: st.approval?.prompt ?? step.approval?.prompt, items, decided };
}

function columnFor(rawStatus: string, gate: string): Column {
  if (rawStatus === "failed" || gate === "failed") return "failed";
  if (rawStatus === "done") return "done";
  if (rawStatus === "awaiting_approval" || gate === "checking") return "gate";
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
      verified: d?.verified === true,
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
    isApproval:
      !!statusSteps[id]?.approval || statusSteps[id]?.status === "awaiting_approval",
  }));
}

/** Is this a Phase 0 self-improvement step id? (_improve::… or _validate) */
function isImproveId(id: string): boolean {
  return id.startsWith("_improve::") || id === "_validate" || id === "_improve";
}

/** Build BoardSteps for the auto-injected Phase 0 improvement cards. */
function buildImproveSteps(statusSteps: Record<string, RawStepStatus>): BoardStep[] {
  const ids = Object.keys(statusSteps).filter(isImproveId);
  return ids.map((id, index) => {
    const st = statusSteps[id] ?? {};
    const im = st.improve ?? {};
    const isValidate = id === "_validate";
    const title = im.title ?? (isValidate ? "Validate conductor" : id.replace("_improve::", ""));
    const rawStatus = st.status ?? "pending";
    const gateState = st.gate ?? "pending";
    const improve: ImproveMeta = {
      step: im.step,
      title,
      current: im.current,
      proposed: im.proposed,
      note: im.note,
      observed: im.observed,
      scope: im.scope as Scope | undefined,
      structural: im.structural === true,
      kind: im.kind ?? (isValidate ? "validate" : "instruction"),
    };
    return {
      id,
      index,
      instruction: "",
      firstLine: title,
      isCondition: false,
      requires: [],
      soft: [],
      hard: [],
      isLoop: false,
      isApproval: false,
      column: columnFor(rawStatus, gateState),
      rawStatus,
      gateState,
      attempt: st.attempt ?? 1,
      started_at: st.started_at,
      completed_at: st.completed_at,
      improve,
      phase: "improve",
      branchTaken: undefined,
      output_value: undefined,
      criteria: buildCriteria({ id, soft: [], hard: [] } as unknown as ConductorStep, st.gate_detail),
      loop: undefined,
      approvalState: undefined,
      heartbeat: buildHeartbeat(st),
      learnings: [],
    } as BoardStep;
  });
}

export function buildModel(snap: Snapshot): BoardModel {
  const status = snap.status ?? {};
  const statusSteps = (status.steps as Record<string, RawStepStatus>) ?? {};
  const parsed = parseConductor(snap.conductorYaml);
  const hasConductor = !!parsed && parsed.steps.length > 0;

  const structure: ConductorStep[] = hasConductor
    ? parsed!.steps
    : stepsFromStatusOnly(statusSteps).filter((s) => !isImproveId(s.id));

  const improveSteps = buildImproveSteps(statusSteps);

  const workflowSteps: BoardStep[] = structure.map((s) => {
    const st = statusSteps[s.id] ?? {};
    const rawStatus = st.status ?? "pending";
    const gateState = st.gate ?? "pending";
    const wfStep: BoardStep = {
      ...s,
      column: columnFor(rawStatus, gateState),
      rawStatus,
      gateState,
      attempt: st.attempt ?? 1,
      started_at: st.started_at,
      completed_at: st.completed_at,
      phase: "workflow",
      branchTaken: st.branch_taken,
      output_value: st.output,
      criteria: buildCriteria(s, st.gate_detail),
      loop: buildLoop(s, st),
      approvalState: buildApproval(s, st),
      // include loop sub-step beats so the stall/freeball check + cards see them
      heartbeat: [...buildHeartbeat(st), ...collectSubBeats(st)].sort((a, b) =>
        a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
      ),
      learnings: Array.isArray(st.learnings)
        ? st.learnings.filter((x): x is string => typeof x === "string")
        : [],
    };
    return wfStep;
  });

  // The Phase 0 improvement cards lead, then the real workflow steps.
  const steps: BoardStep[] = [...improveSteps, ...workflowSteps];

  // Progress counts the WORKFLOW only — Phase 0 is a pre-flight, not the work.
  const total = workflowSteps.length;
  const done = workflowSteps.filter((s) => s.column === "done").length;

  // Weighted progress: a loop contributes one unit per sub-step per iteration,
  // so a 5-page × 4-sub-step loop reads as 20 units instead of one stuck step.
  let unitsTotal = 0;
  let unitsDone = 0;
  for (const s of workflowSteps) {
    if (s.isLoop && s.loop) {
      const iters = s.loop.iterations;
      const subCount = s.subSteps?.length || iters[0]?.steps.length || 1;
      const totalIters = s.loop.total || iters.length || 0;
      unitsTotal += totalIters * subCount;
      unitsDone += iters.reduce(
        (n, it) => n + it.steps.filter((ss) => ss.status === "done").length,
        0,
      );
    } else {
      unitsTotal += 1;
      if (s.column === "done") unitsDone += 1;
    }
  }
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
    knowledge: parsed?.knowledge ?? [],
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
    unitsDone,
    unitsTotal,
    hasConductor,
    demo: (status as { _demo?: boolean })._demo === true,
    error: status._error as string | undefined,
  };
}
