// Board settings persisted in localStorage. The heartbeat interval is the agent's narration
// cadence: it sets the board's stall threshold and the "expected next beat" the monitor shows.
// The agent's *default* cadence lives in code (DEFAULT_HEARTBEAT_INTERVAL) + CONDUCTOR.md.

export const DEFAULT_HEARTBEAT_INTERVAL = 30; // seconds

export const HEARTBEAT_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 15, label: "15s" },
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
];

const KEY = "cb-hb-interval";
const PREWARM_KEY = "cb-prewarm-agents";

export function loadHeartbeatInterval(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return HEARTBEAT_OPTIONS.some((o) => o.seconds === v) ? v : DEFAULT_HEARTBEAT_INTERVAL;
  } catch {
    return DEFAULT_HEARTBEAT_INTERVAL;
  }
}

export function saveHeartbeatInterval(seconds: number): void {
  try {
    localStorage.setItem(KEY, String(seconds));
  } catch {
    /* ignore */
  }
}

export function loadPrewarmAgents(): boolean {
  try {
    const v = localStorage.getItem(PREWARM_KEY);
    return v == null ? true : v !== "0";
  } catch {
    return true;
  }
}

export function savePrewarmAgents(enabled: boolean): void {
  try {
    localStorage.setItem(PREWARM_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** A stall is flagged after ~3 missed beats — scales with the chosen cadence (floored at 45s). */
export function stallSecondsFor(interval: number): number {
  return Math.max(45, interval * 3);
}
