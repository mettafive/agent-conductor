import fs from "node:fs";
import path from "node:path";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const STALE_MS = 5 * 60 * 1000; // 5 minutes of silence ⇒ the board is stale

/**
 * Board-sync pre-check (spec §8.1). Run as the FIRST gate criterion on every
 * step — `check: "npx conductor-board check <step-id>"` — so an agent that does
 * work without keeping the board current literally fails its own gate.
 *
 * Passes only when, for <step-id>:
 *   1. status.json's current_step matches it (it's marked running);
 *   2. it has at least one heartbeat;
 *   3. its most recent heartbeat is within the last 5 minutes (not stale).
 *
 * (We check the latest heartbeat's age, not started_at — a legitimately long
 * step that keeps beating is fine; only silence means the board has gone stale.)
 */
export async function runCheck(args) {
  const flagIdx = (names) => {
    for (const n of names) {
      const i = args.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const pi = flagIdx(["--path", "-p"]);
  const statusPath = path.resolve(
    process.cwd(),
    pi !== -1 && args[pi + 1] ? args[pi + 1] : ".conductor/status.json",
  );
  const stepId = args.find((a) => !a.startsWith("-"));

  const fail = (msg) => {
    console.error(`${red("✗ board-sync")} ${msg}`);
    return false;
  };

  if (!stepId) return fail("usage: conductor-board check <step-id> [--path status.json]");

  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return fail(
      `could not read ${path.relative(process.cwd(), statusPath)} — start the board and write status.json first.`,
    );
  }

  const step = status.steps?.[stepId];
  if (!step) return fail(`status.json has no step "${stepId}". Write the step before gating it.`);

  if (status.current_step !== stepId) {
    return fail(
      `current_step is "${status.current_step ?? "—"}", not "${stepId}". Mark this step running on the board before its gate.`,
    );
  }

  const beats = Array.isArray(step.heartbeat) ? step.heartbeat : [];
  if (beats.length === 0) {
    return fail(`step "${stepId}" has no heartbeats. Heartbeat as you work — the gate can't pass on a silent step.`);
  }

  const lastAt = beats
    .map((h) => (h && typeof h.at === "string" ? new Date(h.at).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  if (!Number.isFinite(lastAt)) {
    return fail(`step "${stepId}" has heartbeats but none with a valid timestamp.`);
  }
  const age = Date.now() - lastAt;
  if (age > STALE_MS) {
    return fail(
      `step "${stepId}" last beat was ${Math.round(age / 60000)}m ago — the board is stale. ` +
        `Re-sync status.json to reality and restart the step; don't back-fill (that's freeballing).`,
    );
  }

  console.log(
    `${green("✓ board-sync")} "${stepId}" ${dim(
      `— current, ${beats.length} heartbeat(s), last ${Math.round(age / 1000)}s ago`,
    )}`,
  );
  return true;
}
