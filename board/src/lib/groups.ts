import type { HeartbeatEntry } from "./types";

/**
 * An activity card — one coherent unit of work (a single intent on a single target).
 * Cards are how a run reads as a story instead of a heartbeat firehose.
 *
 * Preferred: the AGENT declares the boundary (`heartbeat … --card "Writing fågel's FAQ"`),
 * so the title is composed by the intelligence doing the work. When a run has no declared
 * cards (legacy), we fall back to mechanical clustering by context + time so it still groups.
 */
export interface BeatGroup {
  /** stable id (first beat's timestamp) — used for comment persistence */
  id: string;
  /** the activity's intent — the card-opener's note, or (fallback) the context label */
  title: string;
  /** every beat in the card, in order. When `titleFromBeat`, beats[0] IS the title beat. */
  beats: HeartbeatEntry[];
  /** true = agent-declared card (--card) — drives the accent only */
  explicit: boolean;
  /** the title is beats[0]'s note (card-driven groups) vs a synthetic context label (mechanical) */
  titleFromBeat: boolean;
  startedAt: string;
  endedAt: string;
  insightCount: number;
  /** the card ended with a finalBeat (a handoff to the next step) */
  hasFinal: boolean;
}

/** The detail beats shown under a card — excludes the title beat when the title came from one. */
export function detailBeats(g: BeatGroup): HeartbeatEntry[] {
  return g.titleFromBeat ? g.beats.slice(1) : g.beats;
}

/** Group heartbeats into activity cards. Uses declared --card boundaries when present. */
export function groupBeats(entries: HeartbeatEntry[]): BeatGroup[] {
  return entries.some((h) => h.card) ? byCards(entries) : mechanical(entries);
}

function newGroup(h: HeartbeatEntry, explicit: boolean, title: string, titleFromBeat: boolean): BeatGroup {
  return {
    id: h.at,
    title,
    beats: [h],
    explicit,
    titleFromBeat,
    startedAt: h.at,
    endedAt: h.at,
    insightCount: h.insight ? 1 : 0,
    hasFinal: !!h.finalBeat,
  };
}

function extend(g: BeatGroup, h: HeartbeatEntry): void {
  g.beats.push(h);
  g.endedAt = h.at;
  if (h.insight) g.insightCount++;
  if (h.finalBeat) g.hasFinal = true;
}

/** Agent-declared cards: a `--card` beat opens a card (its note is the title); the beats
 *  that follow are its detail, until the next --card. Leading un-carded beats form an
 *  implicit opening card so nothing is dropped. */
function byCards(entries: HeartbeatEntry[]): BeatGroup[] {
  const groups: BeatGroup[] = [];
  for (const h of entries) {
    // a --card beat opens a card; the very first beat opens an implicit one. Either way the
    // title comes from the beat, so it's excluded from the detail (no duplicate line).
    if (h.card || groups.length === 0) groups.push(newGroup(h, !!h.card, h.note, true));
    else extend(groups[groups.length - 1], h);
  }
  return groups;
}

// ── mechanical fallback — context + time clustering (unlabeled/legacy runs) ──────
const ctxKey = (h: HeartbeatEntry) => `${h.iteration ?? ""}::${h.sub ?? ""}`;
const GAP_MS = 90_000; // a >90s silence starts a new activity, even within the same context

function mechanical(entries: HeartbeatEntry[]): BeatGroup[] {
  const groups: BeatGroup[] = [];
  for (const h of entries) {
    const last = groups[groups.length - 1];
    const gap = last ? new Date(h.at).getTime() - new Date(last.endedAt).getTime() : Infinity;
    // an unparseable timestamp must not shatter grouping — only split on a *known* long silence
    const within = Number.isNaN(gap) || gap < GAP_MS;
    const related = !!last && ctxKey(last.beats[last.beats.length - 1]) === ctxKey(h) && !last.hasFinal && within;
    if (related) extend(last!, h);
    else
      groups.push(
        newGroup(h, false, h.iteration ? `${h.iteration}${h.sub ? ` · ${h.sub}` : ""}` : h.sub ?? "activity", false),
      );
  }
  return groups;
}

// ── user comments on cards (MVP: localStorage, keyed by card id) ────────────────
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
