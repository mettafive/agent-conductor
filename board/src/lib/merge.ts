import { parseConductor, parseKnowledge } from "./parse";
import type {
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
  /** parallel-agent overviews of activity cards, keyed by card id (the opener beat's `at`) */
  cardOverviews?: Record<string, string>;
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
    passed?: boolean;
    exit_code?: number;
    checker?: string;
    evidence?: string;
    summary?: string;
    made_summary?: string;
    checked_summary?: string;
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
    sub?: string;
    insight?: { type?: string; seed?: string; step?: string; scope?: string; confidence?: string };
    finalBeat?: boolean;
    system?: boolean;
    tone?: "feedback";
    card?: boolean;
    handoff?: { to?: string; to_iteration?: string; context?: string; produced?: string };
  }>;
  learnings?: string[];
  artifact?: string;
  receipt?: string;
  artifacts?: string[];
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
          system: h.system === true,
          tone: h.tone === "feedback" ? ("feedback" as const) : undefined,
          card: h.card === true,
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
        title: def?.title ?? id,
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
  // `completed` is derived from the iteration done-flags, which are computed against
  // the conductor's FULL sub-step roster (subDefs) — the authoritative count. We do
  // NOT trust st.completed when sub-step defs are known: the writer denormalizes
  // st.completed from only the materialized cells, so a partial iteration (one
  // sub-step done, the rest not yet written) is miscounted as complete. Fall back to
  // st.completed only when there's no conductor to define the roster.
  const derivedCompleted = iterations.filter((i) => i.done).length;
  return {
    total: Math.max(declaredTotal, items.length),
    completed:
      subDefs.length > 0
        ? derivedCompleted
        : typeof st.completed === "number"
          ? st.completed
          : derivedCompleted,
    currentItem: st.current_item,
    iterations,
  };
}

function columnFor(rawStatus: string, gate: string): Column {
  if (rawStatus === "failed" || gate === "failed") return "failed";
  if (rawStatus === "done") return "done";
  // "passed" = the checker accepted; the card is finalizing (gate-result has
  // landed, `complete` is about to flip status→done). Keep it in Checking until
  // it lands in Done — without this it briefly reverts to Running (status is
  // still "running" between the gate-result and complete writes), a visible
  // checking → running → done flicker on every card.
  if (gate === "checking" || gate === "passed") return "checking";
  if (rawStatus === "running") return "running";
  return "pending";
}

/** Attach checker pass/fail from gate_detail when the independent checker recorded it. */
function buildCriteria(step: ConductorStep, detail: RawStepStatus["gate_detail"]): GateCriterion[] {
  const text = step.instruction || step.title || step.id;
  const d = detail?.find((x) => x.criterion === text) ?? detail?.[0];
  return [{
    text,
    name: step.title,
    passed: d ? !!d.passed : null,
    checker: "instruction",
    evidence: d?.evidence,
    summary: d?.summary,
    made_summary: d?.made_summary,
    checked_summary: d?.checked_summary,
  }];
}

/** Is this a Phase 0 self-improvement step id? (_improve::… or legacy _validate) */
function isImproveId(id: string): boolean {
  return id.startsWith("_improve::") || id === "_validate" || id === "_improve";
}

/** A short, human label for a Phase 0 card kind. */
function improveTitleFor(id: string, kind: string | undefined, fallback?: string): string {
  if (fallback) return fallback;
  if (kind === "validate" || id.endsWith("::validate")) return "Validate conductor";
  if (kind === "read-knowledge" || id.endsWith("::read-knowledge")) return "Read knowledge";
  return id.replace("_improve::", "");
}

/** Build BoardSteps for the auto-injected Phase 0 improvement cards. */
function buildImproveSteps(statusSteps: Record<string, RawStepStatus>): BoardStep[] {
  const ids = Object.keys(statusSteps).filter(isImproveId);
  return ids.map((id, index) => {
    const st = statusSteps[id] ?? {};
    const im = st.improve ?? {};
    const isValidate = id === "_validate" || id === "_improve::validate" || im.kind === "validate";
    const title = improveTitleFor(id, im.kind, im.title);
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
      title,
      index,
      instruction: "",
      firstLine: title,
      isCondition: false,
      requires: [],
      isLoop: false,
      column: columnFor(rawStatus, gateState),
      ready: false, // filled by the post-pass once every column is known
      rawStatus,
      gateState,
      attempt: st.attempt ?? 1,
      started_at: st.started_at,
      completed_at: st.completed_at,
      improve,
      phase: "improve",
      branchTaken: undefined,
      output_value: undefined,
      criteria: [],
      loop: undefined,
      heartbeat: buildHeartbeat(st),
      learnings: [],
    } as BoardStep;
  });
}

function norm(s: string | undefined): string {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function statusForStep(step: ConductorStep, statusSteps: Record<string, RawStepStatus>): RawStepStatus {
  if (statusSteps[step.id]) return statusSteps[step.id] ?? {};
  const titleKey = norm(step.title);
  const instructionKey = norm(step.instruction).slice(0, 52);
  for (const [key, value] of Object.entries(statusSteps)) {
    if (isImproveId(key)) continue;
    if (norm(key) === titleKey) return value ?? {};
    if (instructionKey && norm(key).startsWith(instructionKey)) return value ?? {};
    const detail = value.gate_detail?.[0];
    if (detail?.criterion && norm(detail.criterion) === norm(step.instruction)) return value ?? {};
  }
  return {};
}

// Snapshots are fresh objects only when the server pushes an update, so caching
// the derived model by snapshot identity is correct — and it stops the JSON from
// being re-parsed on every render / clock tick (the board re-renders each second).
const modelCache = new WeakMap<Snapshot, BoardModel>();

export function buildModel(snap: Snapshot): BoardModel {
  const cached = modelCache.get(snap);
  if (cached) return cached;
  const model = buildModelImpl(snap);
  modelCache.set(snap, model);
  return model;
}

function buildModelImpl(snap: Snapshot): BoardModel {
  const status = snap.status ?? {};
  const statusSteps = (status.steps as Record<string, RawStepStatus>) ?? {};
  const parsed = parseConductor(snap.workflowJson);
  const fileKnowledge = parseKnowledge(readKnowledgeItems(snap.knowledgeJson));
  const hasConductor = !!parsed && parsed.steps.length > 0;
  const hasWorkflowStatus = Object.keys(statusSteps).some((id) => !isImproveId(id));
  const missingWorkflow = !hasConductor && hasWorkflowStatus;

  const structure: ConductorStep[] = hasConductor
    ? parsed!.steps
    : [];

  // Phase 0 is parked for v3: keep the code path, but leave it off unless a
  // conductor/status file explicitly opts in.
  const statusAutoImprove = (status as { auto_improve?: boolean }).auto_improve;
  const autoImprove =
    statusAutoImprove !== undefined ? statusAutoImprove !== false : parsed?.autoImprove === true;

  const improveSteps = autoImprove ? buildImproveSteps(statusSteps) : [];

  const workflowSteps: BoardStep[] = structure.map((s) => {
    const st = statusForStep(s, statusSteps);
    const rawStatus = st.status ?? "pending";
    const gateState = st.gate ?? "pending";
    const wfStep: BoardStep = {
      ...s,
      column: columnFor(rawStatus, gateState),
      ready: false, // filled by the post-pass once every column is known
      rawStatus,
      gateState,
      attempt: st.attempt ?? 1,
      started_at: st.started_at,
      completed_at: st.completed_at,
      // "shaping" for the integration cards that rewrite the plan (carried as
      // kind from the raw step); the work cards are "workflow". Read distinct.
      phase: s.kind === "shaping" ? "shaping" : "workflow",
      branchTaken: st.branch_taken,
      output_value: st.output,
      criteria: buildCriteria(s, st.gate_detail),
      loop: buildLoop(s, st),
      // include loop sub-step beats so the stall/freeball check + cards see them
      heartbeat: [...buildHeartbeat(st), ...collectSubBeats(st)].sort((a, b) =>
        a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
      ),
      learnings: Array.isArray(st.learnings)
        ? st.learnings.filter((x): x is string => typeof x === "string")
        : [],
      cardOverviews: (st.cardOverviews && typeof st.cardOverviews === "object" ? st.cardOverviews : {}) as Record<string, string>,
      artifact: typeof st.artifact === "string" ? st.artifact : typeof st.receipt === "string" ? st.receipt : undefined,
      receipt: typeof st.receipt === "string" ? st.receipt : typeof st.artifact === "string" ? st.artifact : undefined,
      artifacts: Array.isArray(st.artifacts)
        ? st.artifacts.filter((x): x is string => typeof x === "string")
        : [],
    };
    return wfStep;
  });

  // The Phase 0 improvement cards lead, then the real workflow steps.
  const steps: BoardStep[] = [...improveSteps, ...workflowSteps];

  // --- Derived "ready / next" state (PURE DISPLAY; no writes, no execution) ---
  // `requires` holds card INDEXES (see parse.ts: ConductorStep.index === array
  // position, id === String(index)); dependents are resolved the same way the
  // kanban already does it (steps[idx] / unmetRequirementIndexes). Build byId on
  // the WORKFLOW step's numeric index so dep lookups match the model's indexing.
  // A pending card is `ready` (unblocked, next to go) iff every dependency is
  // column==="done"; any non-done dep leaves it plain (blocked) pending. This
  // runs on every buildModel call (every SSE tick) so the instant a dep flips to
  // done, its dependents read ready on the next render — that immediacy is the
  // point, so it is intentionally NOT memoized away.
  const byId = new Map<number, BoardStep>();
  for (const s of workflowSteps) byId.set(s.index, s);
  for (const s of steps) {
    s.ready =
      s.column === "pending" &&
      s.requires.every((depId) => byId.get(depId)?.column === "done");
  }

  const visibleWorkflowSteps = workflowSteps.filter((s) => !s.retired);

  // Progress counts the WORKFLOW only — Phase 0 is a pre-flight, not the work.
  const total = visibleWorkflowSteps.length;
  const done = visibleWorkflowSteps.filter((s) => s.column === "done").length;

  // Weighted progress: a loop contributes one unit per sub-step per iteration,
  // so a 5-page × 4-sub-step loop reads as 20 units instead of one stuck step.
  let unitsTotal = 0;
  let unitsDone = 0;
  for (const s of visibleWorkflowSteps) {
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
  const developerNotes = Array.isArray(status.developer_notes)
    ? (status.developer_notes as BoardModel["developerNotes"])
    : [];

  // A run can finish with the agent forgetting to set status:done — but if every workflow step is
  // already done, it IS complete. Treat it as done so the timer freezes, the summary shows, and the
  // heart settles instead of "Running" ticking up forever.
  const rawStatus = (status.status as string) ?? (total ? "idle" : "idle");
  const allWorkflowDone = workflowSteps.length > 0 && workflowSteps.every((s) => s.column === "done");
  // `paused` is a top-level run state, distinct from running/done/failed: surface it as-is (never
  // auto-complete a paused run even if all steps read done — pause is an explicit human hold).
  const overall =
    rawStatus === "paused" ? "paused" : rawStatus === "running" && allWorkflowDone ? "done" : rawStatus;
  const settled = overall === "done" || overall === "failed";

  // --- Paused-aware timer accumulator (§run-state) -------------------------------------------
  // elapsed_ms accumulates only RUNNING time; running_since marks the start of the current running
  // interval (null when paused/done/failed). The live display adds (now - running_since) only while
  // running. Backward-compat: when these fields are absent (old runs), fall back to started_at→now/
  // ended so existing runs still render — the App resolves that fallback from startedAt/endedAt.
  const elapsedBaseMs = typeof status.elapsed_ms === "number" ? status.elapsed_ms : undefined;
  const runningSince = typeof status.running_since === "string" ? status.running_since : null;
  const hasAccumulator = elapsedBaseMs !== undefined;

  const knowledge = dedupeKnowledge([...(parsed?.knowledge ?? []), ...fileKnowledge]);

  return {
    workflow: (status.workflow as string) ?? parsed?.name ?? "workflow",
    description: parsed?.description ?? (status.description as string | undefined),
    knowledge,
    goal: (status.goal as string | undefined) ?? parsed?.description,
    currentStepGoal: status.current_step_goal as string | undefined,
    lastBeatAt,
    insightCount,
    suggestions,
    developerNotes,
    runId: status.run_id as string | undefined,
    runName: status.run_name as string | undefined,
    nextUp: (status.next_up as { name?: string; remaining?: number } | undefined) ?? undefined,
    autoImprove,
    maxAttempts: parsed?.maxAttempts ?? 5,
    startedAt: status.started_at as string | undefined,
    // A finished run rarely records a top-level completed_at, which left the done-screen timer
    // ticking to `now` forever. Freeze it: when the run is done/failed, fall back to the last
    // heartbeat (when work actually stopped).
    endedAt: (status.completed_at as string | undefined) ?? (settled ? lastBeatAt : undefined),
    overallStatus: overall,
    // Paused-aware timer accumulator (undefined on old runs => App falls back to started_at→now).
    elapsedBaseMs,
    runningSince,
    hasAccumulator,
    pausedAt: status.paused_at as string | undefined,
    // Failed-reason payload for the modal (written by complete.js on terminal failure).
    failedReason: status.failed_reason as string | undefined,
    failedStep: status.failed_step as string | undefined,
    currentStep: status.current_step as string | undefined,
    steps,
    done,
    total,
    unitsDone,
    unitsTotal,
    hasConductor,
    demo: (status as { _demo?: boolean })._demo === true,
    error: missingWorkflow
      ? "Waiting for workflow.json before rendering cards."
      : status._error as string | undefined,
  };
}

function readKnowledgeItems(src?: string | null): unknown[] {
  if (!src) return [];
  try {
    const doc = JSON.parse(src) as { items?: unknown };
    return Array.isArray(doc?.items) ? doc.items : [];
  } catch {
    return [];
  }
}

function dedupeKnowledge(items: BoardModel["knowledge"]): BoardModel["knowledge"] {
  const out = new Map<string, BoardModel["knowledge"][number]>();
  for (const item of items) {
    const key = item.id || `${item.title}::${item.detail || item.note || ""}`;
    out.set(key, item);
  }
  return [...out.values()];
}
