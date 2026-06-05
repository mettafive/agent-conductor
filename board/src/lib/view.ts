import type { BoardModel, BoardStep, GateCriterion, HeartbeatEntry } from "./types";
import { subStepColumn } from "./loop";

/** The single unit the main area follows: a step, or a loop's active sub-step. */
export interface ActiveUnit {
  step: BoardStep;
  /** "step-id" or "item · sub-id" */
  title: string;
  beats: HeartbeatEntry[];
  criteria: GateCriterion[];
  startedAt?: string;
  completedAt?: string;
  running: boolean;
}

/** Resolve the deepest active unit for a step — descends into the live loop. */
export function resolveActiveUnit(step: BoardStep): ActiveUnit {
  if (step.isLoop && step.loop) {
    const iters = step.loop.iterations;
    const item =
      step.loop.currentItem ??
      iters.find((it) => !it.done && !it.failed)?.item ??
      iters[iters.length - 1]?.item;
    const iter = iters.find((it) => it.item === item);
    if (iter && item) {
      const sub =
        iter.steps.find((s) => subStepColumn(s) === "running") ??
        iter.steps.find((s) => subStepColumn(s) === "gate") ??
        iter.steps.find((s) => subStepColumn(s) === "pending") ??
        iter.steps[iter.steps.length - 1];
      const exact = step.heartbeat.filter((h) => h.iteration === item && (!sub || h.sub === sub.id));
      const forItem = step.heartbeat.filter((h) => h.iteration === item);
      return {
        step,
        title: sub ? `${item} · ${sub.id}` : item,
        beats: exact.length ? exact : forItem,
        criteria: sub?.criteria ?? [],
        startedAt: sub?.started_at,
        completedAt: sub?.completed_at,
        running: sub ? subStepColumn(sub) === "running" : false,
      };
    }
  }
  return {
    step,
    title: step.id,
    beats: step.heartbeat,
    criteria: step.criteria,
    startedAt: step.started_at,
    completedAt: step.completed_at,
    running: step.column === "running",
  };
}

/** The workflow step with the most recent heartbeat — i.e. wherever the agent last narrated. */
function latestBeatStep(workflow: BoardStep[]): BoardStep | null {
  let best: BoardStep | null = null;
  let bestAt = "";
  for (const s of workflow) {
    const last = s.heartbeat[s.heartbeat.length - 1];
    if (last && last.at > bestAt) {
      bestAt = last.at;
      best = s;
    }
  }
  return best;
}

/** The step the main area auto-follows. A running step wins; otherwise we follow wherever the
 *  agent LAST narrated (the most recent heartbeat) so any activity lights up the live view —
 *  it never snaps to a dead "preparing…" while cards are being written, and Esc lands here.
 *  Only with zero heartbeats anywhere (truly nothing yet) do we fall through to idle/last. */
export function followStep(model: BoardModel): BoardStep | null {
  const workflow = model.steps.filter((s) => s.phase === "workflow");
  return (
    workflow.find((s) => s.column === "running") ??
    workflow.find((s) => s.id === model.currentStep && s.heartbeat.length > 0) ??
    latestBeatStep(workflow) ??
    workflow.find((s) => s.id === model.currentStep) ??
    // Phase 0 (the improve cards) is real pre-step-1 work — applying proven insights. Surface it
    // too, so the board isn't dark while the agent reads + improves before the first workflow step.
    model.steps.find((s) => s.phase === "improve" && s.column === "running") ??
    latestBeatStep(model.steps) ??
    (model.overallStatus === "done" || model.overallStatus === "failed"
      ? (workflow[workflow.length - 1] ?? null)
      : null)
  );
}

/**
 * The loop iteration the agent is currently working — currentItem if set, else
 * the first not-yet-done one, else the last. Undefined if the step isn't a loop
 * or has no iterations yet. This is what the live view locks onto so you watch
 * the agent's sub-step cards move.
 */
export function activeIterationItem(step: BoardStep | null): string | undefined {
  if (!step?.isLoop || !step.loop) return undefined;
  const iters = step.loop.iterations;
  if (iters.length === 0) return undefined;
  return (
    (step.loop.currentItem && iters.some((it) => it.item === step.loop!.currentItem)
      ? step.loop.currentItem
      : undefined) ??
    iters.find((it) => !it.done && !it.failed)?.item ??
    iters[iters.length - 1]?.item
  );
}

/**
 * "m:ss" since `start` (to `end` if given, else now). Returns null — never
 * "NaN:NaN" — when the timestamp is missing or unparseable (§5.5).
 */
export function clockSince(start: string | undefined, now: number, end?: string): string | null {
  if (!start) return null;
  const a = new Date(start).getTime();
  if (Number.isNaN(a)) return null;
  const b = end ? new Date(end).getTime() : now;
  if (Number.isNaN(b) || b < a) return null;
  const secs = Math.floor((b - a) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
