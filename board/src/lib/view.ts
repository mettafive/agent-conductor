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

/** The step the main area auto-follows: the current step, else the running one. */
export function followStep(model: BoardModel): BoardStep | null {
  return (
    model.steps.find((s) => s.id === model.currentStep && s.phase === "workflow") ??
    model.steps.find((s) => s.column === "running" && s.phase === "workflow") ??
    null
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
