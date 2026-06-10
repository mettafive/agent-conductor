// THE ONE pause path — shared by the UI endpoint, the CLI command, so the action and
// its confirmation are a single locked event everywhere.
//
// The endpoint that receives the click knows IMMEDIATELY that pause happened, so it owns
// the whole moment: flip status, fold the clock, and emit the control heartbeat — in one
// locked mutateStatus. The dispatcher still DRAINS (its job) but no longer ANNOUNCES (by
// the time it noticed, the user had already waited). One beat per action, system+control
// so the terminal renders it immediately.

import { stampBeat } from "./status-store.js";

const stepStatusOf = (status, i) =>
  (status.steps && status.steps[String(i)] && status.steps[String(i)].status) || "pending";

/** Indices of cards the dispatcher has in flight right now (status.json is authoritative). */
export function runningIndices(status) {
  return Object.entries(status.steps || {})
    .filter(([, s]) => s && s.status === "running")
    .map(([k]) => Number(k));
}

/** The cards the hand-out would pick next: pending, deps satisfied (index order). */
export function nextEligible(status, doc) {
  if (!doc || !Array.isArray(doc.steps)) return [];
  const elig = [];
  for (let i = 0; i < doc.steps.length; i++) {
    if (stepStatusOf(status, i) !== "pending") continue;
    const reqs = ((doc.steps[i] && doc.steps[i].requires) || []).map(Number);
    if (reqs.every((d) => stepStatusOf(status, d) === "done")) elig.push(i);
  }
  return elig;
}

/** The one heartbeat line: pause names the in-flight COUNT; resume names the next card. */
export function pauseResumeNote(action, status, doc) {
  if (action === "pause") {
    const n = runningIndices(status).length;
    return n > 0
      ? `Pausing — ${n} card${n === 1 ? "" : "s"} still running will finish, then holding.`
      : "Pausing before the next card.";
  }
  const elig = nextEligible(status, doc);
  if (elig.length) {
    const title = (doc && doc.steps[elig[0]] && doc.steps[elig[0]].title) || `card ${elig[0]}`;
    const more = elig.length > 1 ? ` (+${elig.length - 1} more)` : "";
    return `Resuming — dispatching ${title}${more}.`;
  }
  return "Resuming.";
}

// Anchor the run-level beat to a card so it lands in the stream: a live in-flight card on
// pause, the next-to-dispatch on resume, else the current/first card.
function anchorFor(action, status, doc) {
  const cs = Number.isInteger(Number(status.current_step)) ? Number(status.current_step) : 0;
  if (action === "pause") {
    const live = runningIndices(status);
    if (live.length) return live[0];
  }
  const elig = nextEligible(status, doc);
  return elig.length ? elig[0] : cs;
}

/** Append a control beat (system+control ⇒ renders immediately) to a card's heartbeat. */
export function appendControlBeat(status, stepIndex, note) {
  const key = String(Number.isInteger(stepIndex) ? stepIndex : 0);
  status.steps = status.steps || {};
  const step = (status.steps[key] = status.steps[key] || { attempt: 1 });
  step.heartbeat = Array.isArray(step.heartbeat) ? step.heartbeat : [];
  step.heartbeat.push(stampBeat(status, { at: new Date().toISOString(), note, system: true, control: true }));
}

/**
 * Flip status + fold the clock + emit the control beat — IN PLACE, inside the caller's
 * locked mutator. Returns "paused"/"running" when applied, or null for a no-op (so the
 * caller can skip the write). Idempotent: pause-while-paused / resume-while-running → null.
 */
export function applyPauseResume(status, action, doc) {
  if (!status) return null;
  if (action === "pause") {
    if (status.status !== "running") return null;
    if (typeof status.running_since === "string") {
      const ran = Date.now() - Date.parse(status.running_since);
      if (Number.isFinite(ran) && ran > 0) {
        status.elapsed_ms = (typeof status.elapsed_ms === "number" ? status.elapsed_ms : 0) + ran;
      }
    }
    status.running_since = null;
    status.paused_at = new Date().toISOString();
    status.status = "paused";
  } else if (action === "resume") {
    if (status.status !== "paused") return null;
    status.running_since = new Date().toISOString();
    delete status.paused_at;
    status.status = "running";
  } else {
    return null;
  }
  appendControlBeat(status, anchorFor(action, status, doc), pauseResumeNote(action, status, doc));
  return status.status;
}
