import type { Column, IterationStep, LoopIteration } from "./types";

/** Which board column a single loop iteration belongs in, from its sub-steps. */
export function iterationColumn(it: LoopIteration): Column {
  if (it.failed) return "failed";
  if (it.steps.length > 0 && it.steps.every((s) => s.status === "done")) return "done";
  if (it.steps.some((s) => s.gate === "checking")) return "gate";
  if (it.steps.some((s) => s.status === "running")) return "running";
  return "pending";
}

/** Which column a single loop sub-step (one cell in a swim lane) belongs in. */
export function subStepColumn(s: IterationStep): Column {
  if (s.status === "failed" || s.gate === "failed") return "failed";
  if (s.status === "done") return "done";
  if (s.gate === "checking") return "gate";
  if (s.status === "running") return "running";
  return "pending";
}
