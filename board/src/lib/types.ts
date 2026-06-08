export type Column = "pending" | "running" | "checking" | "done" | "failed";

export interface GateCriterion {
  text: string;
  name?: string;
  /** filled from status.gate_detail when available */
  passed?: boolean | null;
  checker?: "instruction";
  evidence?: string;
  summary?: string;
  made_summary?: string;
  checked_summary?: string;
}

export interface ConductorStep {
  id: string;
  title: string;
  index: number;
  instruction: string;
  firstLine: string;
  isCondition: boolean;
  retired?: boolean;
  retired_by?: string;
  output?: string;
  requires: number[];
  // loops (§4.3)
  isLoop: boolean;
  over?: string;
  as?: string;
  parallel?: boolean | "auto";
  subSteps?: ConductorStep[];
}

export interface IterationStep {
  id: string;
  title: string;
  status: string;
  gate: string;
  attempt: number;
  started_at?: string;
  completed_at?: string;
  /** per-criterion results, when the agent / gate-runner recorded gate_detail */
  criteria: GateCriterion[];
}

export interface LoopIteration {
  item: string;
  steps: IterationStep[];
  done: boolean;
  failed: boolean;
}

export interface LoopState {
  total: number;
  completed: number;
  currentItem?: string;
  iterations: LoopIteration[];
}

/** Where an insight applies — drives whether it can be auto-applied (§5.1). */
export type Scope = "this-conductor" | "upstream" | "template" | "tooling" | "corpus";

/** Lifecycle of a knowledge entry (§10.3). */
export type KnowledgeStatus = "emerging" | "proven" | "applied" | "open";

/**
 * One durable learning, stored in the conductor file's `knowledge:` section —
 * the conductor IS the knowledge base. Accumulates across runs; proven
 * this-conductor entries with current/proposed auto-apply in the Phase 0
 * improvement pass (§10).
 */
export interface KnowledgeEntry {
  id?: string;
  title: string;
  status: KnowledgeStatus;
  scope?: Scope;
  observed?: number;
  step?: string;
  source?: string;
  source_run?: string;
  source_card?: string | number;
  source_card_title?: string;
  created?: string;
  tag?: string;
  detail?: string;
  card_duration_seconds?: number;
  /** instruction | gate | new_step | remove_step | reorder */
  type?: string;
  current?: string;
  proposed?: string;
  run_applied?: string;
  applied_in?: string | null;
  applied_as?: string | null;
  note?: string;
}

export interface Insight {
  id?: string;
  type: string;
  seed: string;
  title?: string;
  step?: string;
  scope?: Scope;
  confidence?: string;
}

export interface Handoff {
  to?: string;
  to_iteration?: string;
  context?: string;
  produced?: string;
}

export interface HeartbeatEntry {
  at: string;
  note: string;
  iteration?: string;
  /** the loop sub-step this beat belongs to (when bubbled from a sub-step) */
  sub?: string;
  insight?: Insight;
  /** The last beat of a step — summarizes + carries context to the next step. */
  finalBeat?: boolean;
  system?: boolean;
  tone?: "feedback" | "insight";
  /** Opens a new activity card (one coherent unit of work: one intent, one target).
   *  This beat's note is the card title; following beats (no card) are its detail. */
  card?: boolean;
  handoff?: Handoff;
}

export interface Suggestion {
  id: string;
  type: string;
  step?: string;
  scope?: Scope;
  title: string;
  rationale?: string;
  source_heartbeat?: string;
  current?: string;
  proposed?: string;
  impact?: string;
  confidence?: string;
  source?: string; // "user" for user-authored
  provenance?: string; // e.g. "run 2026-06-03T18-34" — set by the ledger
}

/** A single sighting of an insight, accumulated across runs (§5.2). */
export interface Observation {
  run?: string;
  at?: string;
  note?: string;
}

/** One entry in a workflow's persistent insights ledger (.conductor/insights). */
export interface InsightItem {
  key: string;
  type: string;
  step?: string;
  scope?: Scope;
  title: string;
  rationale?: string;
  current?: string;
  proposed?: string;
  /** low | medium | high | proven — auto-escalates with evidence (§5.2). */
  confidence?: string;
  impact_when_applied?: string;
  observations?: Observation[];
  times_observed?: number;
  times_applied?: number;
  source_heartbeat?: string;
  status: "open" | "applied" | "dismissed";
  provenance?: string;
  first_seen_at?: string;
  decided_at?: string;
}

export interface InsightLedger {
  workflow: string;
  items: InsightItem[];
}

/** Diff metadata for an auto-injected Phase 0 improvement card (§10.2). */
export interface ImproveMeta {
  step?: string; // the workflow step this improvement modifies
  title: string;
  current?: string;
  proposed?: string;
  note?: string;
  observed?: number;
  scope?: Scope;
  structural?: boolean;
  kind?: string; // instruction | gate | new_step | remove_step | reorder | validate
}

export interface BoardStep extends ConductorStep {
  column: Column;
  rawStatus: string; // pending | running | done | failed | (unknown)
  gateState: string; // pending | checking | passed | failed
  attempt: number;
  started_at?: string;
  completed_at?: string;
  /** present on auto-injected _improve::* / _validate Phase 0 cards */
  improve?: ImproveMeta;
  /** "improve" for the Phase 0 self-improvement cards, else "workflow" */
  phase: "improve" | "workflow";
  branchTaken?: string;
  output_value?: unknown;
  criteria: GateCriterion[];
  loop?: LoopState;
  heartbeat: HeartbeatEntry[];
  learnings: string[];
  /** parallel-agent overviews of activity cards, keyed by card id (the opener beat's `at`) */
  cardOverviews?: Record<string, string>;
  /** primary card artifact under .conductor/artifacts, or legacy .conductor/outputs */
  artifact?: string;
  /** legacy alias for artifact */
  receipt?: string;
  /** durable artifact files under .conductor/artifacts, plus legacy outputs */
  artifacts?: string[];
}

/** One entry in a note's audit trail — an edit or removal never destroys the record, it logs here. */
export interface NoteEvent {
  at: string;
  action: "created" | "edited" | "removed" | "restored";
  from?: string;
  to?: string;
}

/**
 * A note the developer (the "flow manager") left on an activity card. A plain note is
 * transparency; promoted to a `directive` it becomes a flow-changer the next run's Phase 0
 * improve-pass MUST resolve — applied (with how) or deferred (with why), never silently glossed.
 *
 * A card can hold several notes (a thread), each with its own audit `history`. Editing or
 * removing a note keeps the record and appends to `history` ("edited from X to Y").
 */
export interface DeveloperNote {
  /** unique note id (`<card>:<ts>`) — a card can carry more than one */
  id: string;
  at: string;
  updated_at?: string;
  step: string;
  /** the card id this note is pinned to */
  card: string;
  /** FOOTNOTE — the card's title (its intent), so the agent knows what was commented on */
  card_title?: string;
  text: string;
  /** promoted from a note to a steering directive the next run must acknowledge */
  directive: boolean;
  /** where it should land: this-conductor | upstream | template | tooling | corpus */
  scope?: string;
  status: "open" | "applied" | "deferred" | "removed";
  /** how it was applied, or why it was deferred */
  resolution?: string;
  resolved_at?: string;
  resolved_run?: string;
  /** audit trail — created / edited (from→to) / removed / restored */
  history?: NoteEvent[];
}

export interface BoardModel {
  workflow: string;
  description?: string;
  goal?: string;
  knowledge: KnowledgeEntry[];
  currentStepGoal?: string;
  lastBeatAt?: string;
  insightCount: number;
  suggestions: Suggestion[];
  /** developer notes/directives left on activity cards (the flow-manager feedback loop) */
  developerNotes: DeveloperNote[];
  runId?: string;
  /** Human run name set at run start, e.g. "treatment-readability-run-4-2026-06-04T12-30" (§6.2). */
  runName?: string;
  /** Set at run start when the work is pulled from a queue: what the NEXT run would be + how many
   *  items remain after this one. Drives the done-screen "Up next" / NEXT affordance. */
  nextUp?: { name?: string; remaining?: number };
  /** Whether the Phase 0 self-improvement pass is enabled for this conductor (§6.1). Default true. */
  autoImprove: boolean;
  maxAttempts: number;
  startedAt?: string;
  endedAt?: string;
  overallStatus: string; // running | done | failed | idle
  currentStep?: string;
  steps: BoardStep[];
  done: number;
  total: number;
  /** Weighted work units: a loop counts as its iteration count, not 1 step. */
  unitsDone: number;
  unitsTotal: number;
  hasConductor: boolean;
  demo?: boolean;
  error?: string;
}

export interface HistoryRun {
  run_id: string;
  /** Human run name, e.g. "treatment-readability-run-4-2026-06-04T12-30" (§6.2). */
  run_name?: string;
  filename: string;
  workflow: string;
  status: string; // done | failed
  started_at?: string | null;
  completed_at?: string | null;
  archived_at?: string;
  done: number;
  total: number;
}

export interface RunRecord extends HistoryRun {
  snapshot: Snapshot;
}

export interface Snapshot {
  status: Record<string, unknown> | null;
  workflowJson: string | null;
  knowledgeJson?: string | null;
  statusPath: string;
  conductorPath: string | null;
}
