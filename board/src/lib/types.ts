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
}

export interface BoardStep extends ConductorStep {
  column: Column;
  rawStatus: string; // pending | running | done | failed | (unknown)
  gateState: string; // pending | checking | passed | failed
  attempt: number;
  branchTaken?: string;
  output_value?: unknown;
  criteria: GateCriterion[];
}

export interface BoardModel {
  workflow: string;
  description?: string;
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
