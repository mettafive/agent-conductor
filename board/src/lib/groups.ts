import type { HeartbeatEntry } from "./types";

/** A cluster of related, consecutive heartbeats — one coherent "activity". */
export interface BeatGroup {
  /** stable id (the first beat's timestamp) — used for comment persistence */
  id: string;
  /** context label: "iteration · sub", else the sub, else "activity" */
  label: string;
  beats: HeartbeatEntry[];
  startedAt: string;
  endedAt: string;
  insightCount: number;
  /** the group ended with a finalBeat (a handoff) */
  hasFinal: boolean;
}

const ctxKey = (h: HeartbeatEntry) => `${h.iteration ?? ""}::${h.sub ?? ""}`;
const GAP_MS = 90_000; // a >90s silence starts a new activity, even within the same context

/**
 * Group heartbeats into related activities. The relatedness check: a beat joins the
 * previous group when it shares the same (iteration, sub) context, the group hasn't
 * already handed off (finalBeat), and less than 90s elapsed. Otherwise it starts a new
 * group. This gives the board an always-current "latest activity" instead of a flat list.
 */
export function groupBeats(entries: HeartbeatEntry[]): BeatGroup[] {
  const groups: BeatGroup[] = [];
  for (const h of entries) {
    const last = groups[groups.length - 1];
    const gap = last ? new Date(h.at).getTime() - new Date(last.endedAt).getTime() : Infinity;
    const related =
      last && ctxKey(last.beats[last.beats.length - 1]) === ctxKey(h) && !last.hasFinal && gap < GAP_MS;
    if (related) {
      last.beats.push(h);
      last.endedAt = h.at;
      if (h.insight) last.insightCount++;
      if (h.finalBeat) last.hasFinal = true;
    } else {
      groups.push({
        id: h.at,
        label: h.iteration ? `${h.iteration}${h.sub ? ` · ${h.sub}` : ""}` : h.sub ?? "activity",
        beats: [h],
        startedAt: h.at,
        endedAt: h.at,
        insightCount: h.insight ? 1 : 0,
        hasFinal: !!h.finalBeat,
      });
    }
  }
  return groups;
}

// ── user comments on groups (MVP: localStorage, keyed by group id) ──────────────
// "Submit them at the right place" (server/status.json) is a follow-up; persisting
// locally already lets the user annotate a run and have it stick across reloads.
const commentKey = (groupId: string) => `cb-comment:${groupId}`;

export function loadComment(groupId: string): string {
  try {
    return localStorage.getItem(commentKey(groupId)) ?? "";
  } catch {
    return "";
  }
}

export function saveComment(groupId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(commentKey(groupId), text.trim());
    else localStorage.removeItem(commentKey(groupId));
  } catch {
    /* ignore */
  }
}
