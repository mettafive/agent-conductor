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
  subSteps?: ConductorStep[];
}

export interface IterationStep {
  id: string;
  status: string;
  gate: string;
  attempt: number;
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

export interface HeartbeatEntry {
  at: string;
  note: string;
  iteration?: string;
  insight?: Insight;
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
}

export interface BoardStep extends ConductorStep {
  column: Column;
  rawStatus: string; // pending | running | done | failed | (unknown)
  gateState: string; // pending | checking | passed | failed
  attempt: number;
  branchTaken?: string;
  output_value?: unknown;
  criteria: GateCriterion[];
  loop?: LoopState;
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
  hasConductor: boolean;
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
