import { stampBeat } from "./status-store.js";

export function appendAutoHeartbeat(status, loopPath, stepId, note) {
  status.steps = status.steps || {};
  // System/transition beats occur at their natural moment, so event_at ≈ at.
  // stampBeat assigns the monotonic seq (runs under the caller's mutateStatus lock).
  const entry = stampBeat(status, { at: new Date().toISOString(), note, system: true });
  if (loopPath) {
    entry.iteration = loopPath.iter;
    entry.sub = loopPath.subId;
    const parent = (status.steps[loopPath.loopId] = status.steps[loopPath.loopId] || {
      type: "loop",
      iterations: {},
    });
    if (!Array.isArray(parent.heartbeat)) parent.heartbeat = [];
    parent.heartbeat.push(entry);
    return;
  }
  const step = (status.steps[stepId] = status.steps[stepId] || { attempt: 1 });
  if (!Array.isArray(step.heartbeat)) step.heartbeat = [];
  step.heartbeat.push(entry);
}

export function firstEvidenceLine(evidence) {
  const line = String(evidence || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean);
  if (!line) return "Checker failed without evidence.";
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}
