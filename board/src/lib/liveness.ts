// Two liveness signals, one definition each — so the navigator, the board, the sidebar,
// and the pause button can never disagree about what's alive.
//
//   isFeedLive(entry, now)     — has this feed PULSED recently (heartbeat / running_since
//                                / started_at / completed_at within the window)?
//   hasActiveDispatch(entry)   — is a dispatcher CURRENTLY running for this feed?
//
// Trust the pulse, not the flag: a "running"/"paused" record whose flag outlived its
// truth (a stale zombie) is not live, and a stale "running" with no dispatcher has none.

import type { WorkflowEntry } from "./useBoardState";

export const LIVE_WINDOW_MS = 10 * 60 * 1000; // generous vs a momentarily-quiet live run

type StatusShape = {
  status?: string;
  running_since?: string;
  started_at?: string;
  completed_at?: string;
  steps?: Record<string, { heartbeat?: { at?: string }[] }>;
} | null;

function statusOf(entry?: WorkflowEntry): StatusShape {
  const s = entry?.snap.status as StatusShape;
  return s && typeof s === "object" ? s : null;
}

/** The most recent moment this feed showed any sign of life (ms epoch, 0 if none). */
export function feedLastActivityMs(entry?: WorkflowEntry): number {
  const s = statusOf(entry);
  if (!s) return 0;
  let max = 0;
  const stamp = (v?: string) => {
    if (typeof v !== "string") return;
    const t = Date.parse(v);
    if (Number.isFinite(t) && t > max) max = t;
  };
  stamp(s.running_since);
  stamp(s.started_at);
  stamp(s.completed_at);
  for (const step of Object.values(s.steps ?? {})) {
    for (const b of step?.heartbeat ?? []) stamp(b?.at);
  }
  return max;
}

/** Is this feed LIVE — pulsed within the window? */
export function isFeedLive(entry: WorkflowEntry | undefined, now: number): boolean {
  const last = feedLastActivityMs(entry);
  return last > 0 && now - last < LIVE_WINDOW_MS;
}

/** Is a dispatcher CURRENTLY running for this feed? A lifecycle feed (compile/integration)
 *  has no dispatch loop; a run feed has one when it's paused (the dispatcher holding/
 *  draining) or running with a live pulse. A stale "running" with no pulse has none. */
export function hasActiveDispatch(entry: WorkflowEntry | undefined, now: number): boolean {
  const variant = entry?.snap?.variant;
  if (variant === "compile" || variant === "integration") return false;
  const status = statusOf(entry)?.status;
  if (status === "paused") return true;
  if (status === "running") return isFeedLive(entry, now);
  return false;
}
