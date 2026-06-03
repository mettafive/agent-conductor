export type Column = "pending" | "running" | "gate" | "done" | "failed";

export interface HardGate {
  text: string;
  name?: string;
}

export interface GateCriterion {
  kind: "soft" | "hard";
  text: string;
  name?: string;
  /** filled from status.gate_detail when available */
  passed?: boolean | null;
  exitCode?: number;
  /** true when the gate-runner (conductor-board complete) actually ran the check */
  verified?: boolean;
}

export interface ApprovalConfig {
  prompt?: string;
  items?: string[]; // per-item templates, e.g. "{page} — ready to ship"
  approve?: string; // target step on approve
  reject?: string; // target step on reject
}

export interface ApprovalItem {
  label: string;
  decision: "approved" | "rejected" | null;
}

export interface ApprovalState {
  prompt?: string;
  items: ApprovalItem[];
  decided: boolean;
}

export interface ConductorStep {
  id: string;
  index: number;
  instruction: string;
  firstLine: string;
  isCondition: boolean;
  ifTrue?: string;
  ifFalse?: string;
  then?: string;
  output?: string;
  requires: string[];
  soft: string[];
  hard: HardGate[];
  // loops (§4.3)
  isLoop: boolean;
  over?: string;
  as?: string;
  parallel?: boolean | "auto";
  subSteps?: ConductorStep[];
  // human approval (§4.4)
  isApproval: boolean;
  approval?: ApprovalConfig;
}

export interface IterationStep {
  id: string;
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

export interface Insight {
  type: string;
  seed: string;
  step?: string;
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
  handoff?: Handoff;
}

export interface Suggestion {
  id: string;
  type: string;
  step?: string;
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

/** One entry in a workflow's persistent insights ledger (.conductor/insights). */
export interface InsightItem {
  key: string;
  type: string;
  step?: string;
  title: string;
  rationale?: string;
  current?: string;
  proposed?: string;
  confidence?: string;
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

export interface BoardStep extends ConductorStep {
  column: Column;
  rawStatus: string; // pending | running | done | failed | (unknown)
  gateState: string; // pending | checking | passed | failed
  attempt: number;
  started_at?: string;
  completed_at?: string;
  branchTaken?: string;
  output_value?: unknown;
  criteria: GateCriterion[];
  loop?: LoopState;
  approvalState?: ApprovalState;
  heartbeat: HeartbeatEntry[];
  learnings: string[];
}

export interface BoardModel {
  workflow: string;
  description?: string;
  goal?: string;
  currentStepGoal?: string;
  lastBeatAt?: string;
  insightCount: number;
  suggestions: Suggestion[];
  runId?: string;
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
  conductorYaml: string | null;
  statusPath: string;
  conductorPath: string | null;
}
