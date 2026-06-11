import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// worker-adapters — the worker-agnostic registry.
//
// run-card spawns exactly ONE non-interactive agent per card. WHICH runtime
// (Claude, Codex, or a user-supplied command) is declared here, never inline.
// Each adapter owns four facts (audit §3):
//   - launch(brief, opts) → { cmd, argv, input, stream }  (the launch command)
//   - leashLabel                                          (how it is bounded)
//   - descendantCap                                       (its SAFE subtree cap)
//   - the done/artifact signal is shared (status.json:done + receipt + verdict)
//
// Selection is a deterministic detect-and-tier — no reasoning:
//   1. CONDUCTOR_WORKER_CMD set  → env-override adapter
//   2. else `claude` on PATH     → claude adapter
//   3. else `codex` on PATH      → codex adapter
//   4. else                      → null → run-card fails LOUD (no silent run)
// Every adapter shares one per-worker descendant cap (DEFAULT_DESCENDANT_CAP),
// overridable per run with CONDUCTOR_WORKER_CAP.
//
// The chosen worker line is always printed (workerLine) so the runtime that
// actually ran is never a mystery — that is what kills the silent fallback
// that quietly switched Claude→Codex and tripped a Claude-tuned cap (audit §4b/c).
// ---------------------------------------------------------------------------

/** A runtime is "present" if `<cmd> --version` exits 0. */
function has(cmd) {
  try {
    return spawnSync(cmd, ["--version"], { encoding: "utf8", stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

// Allow-list: only what a card needs to do its own work + report through the
// CLI verbs (node bin/cli.js ...). NOT Task/Agent/Workflow — no delegation path.
export const WORKER_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
export const WORKER_DISALLOWED_TOOLS = ["Task"];

// Per-worker descendant cap — the limit on how many processes ONE worker's
// subtree may spawn (NOT --cap concurrency, NOT the dispatcher's aggregate
// ceiling). This is a runaway net, so it must sit far above honest work:
//   An honest busy card peaks around 15-20 processes (npx ~6 + git/gh + worker
//   helpers + any parallelism). A true runaway spirals into the hundreds or
//   thousands. 200 is ~10x any honest card and still catches a real spiral.
// The old 5 was rated at the worker's OWN overhead, with no room for the work,
// so any card shelling out to a normal multi-process tool (e.g. `npx tsx`, ~6
// procs by itself) tripped it. One number for every runtime is fine now: once
// the bar sits far above all legitimate work, the old claude-vs-codex
// difference stops mattering. Easy to revisit — the reasoning is recorded here.
const DEFAULT_DESCENDANT_CAP = 200;

// Registry order IS the selection priority (first whose detect() is true wins).
export const adapters = [
  {
    id: "env",
    label: "CONDUCTOR_WORKER_CMD",
    detect: () => !!process.env.CONDUCTOR_WORKER_CMD,
    descendantCap: DEFAULT_DESCENDANT_CAP,
    leashLabel: "sh -c $CONDUCTOR_WORKER_CMD (brief on stdin)",
    note: null,
    launch: (brief) => ({
      cmd: "/bin/sh",
      argv: ["-c", String(process.env.CONDUCTOR_WORKER_CMD)],
      input: brief,
      stream: false,
    }),
    prewarm: (prompt) => ({
      cmd: "/bin/sh",
      argv: ["-c", String(process.env.CONDUCTOR_WORKER_CMD)],
      input: prompt,
      stream: false,
    }),
  },
  {
    id: "claude",
    label: "claude",
    detect: () => has("claude"),
    descendantCap: DEFAULT_DESCENDANT_CAP,
    leashLabel: `--permission-mode dontAsk --allowedTools "${WORKER_ALLOWED_TOOLS.join(" ")}" --disallowedTools "Task"`,
    note: null,
    // claude takes the brief as the -p argument. Under --permission-mode dontAsk
    // the allow-list runs non-interactively and the explicit --disallowedTools
    // "Task" deny holds in every mode (the reliable leash). --timing turns on the
    // stream parse; default OFF = byte-identical to today's plain `claude -p`.
    launch: (brief, { extraDir, timing } = {}) => {
      const argv = [
        "-p", brief,
        "--permission-mode", "dontAsk",
        "--allowedTools", WORKER_ALLOWED_TOOLS.join(" "),
        "--disallowedTools", WORKER_DISALLOWED_TOOLS.join(" "),
      ];
      if (timing) argv.push("--output-format", "stream-json", "--verbose");
      if (extraDir) argv.push("--add-dir", extraDir);
      return { cmd: "claude", argv, input: null, stream: !!timing };
    },
    prewarm: (prompt, { extraDir } = {}) => {
      const argv = [
        "-p", prompt,
        "--permission-mode", "dontAsk",
        "--allowedTools", WORKER_ALLOWED_TOOLS.join(" "),
        "--disallowedTools", WORKER_DISALLOWED_TOOLS.join(" "),
      ];
      if (extraDir) argv.push("--add-dir", extraDir);
      return { cmd: "claude", argv, input: null, stream: false };
    },
  },
  {
    id: "codex",
    label: "codex",
    detect: () => has("codex"),
    descendantCap: DEFAULT_DESCENDANT_CAP,
    leashLabel: `exec - --sandbox workspace-write -c approval_policy="never"`,
    // Only reached when claude is absent — say so out loud.
    note: "claude not found, using codex",
    // codex reads the brief on stdin (`exec -`). Under --sandbox workspace-write
    // it already protects .git/.agents/.codex read-only, and in exec mode approval
    // is auto-downgraded to never regardless — the leash is real. (Do NOT use the
    // deprecated --full-auto; the explicit --sandbox workspace-write is correct.)
    launch: (brief, { extraDir } = {}) => {
      const argv = [
        "exec", "-",
        "--skip-git-repo-check",
        "--sandbox", "workspace-write",
        "-c", "approval_policy=\"never\"",
        "--color", "never",
      ];
      if (extraDir) argv.push("--add-dir", extraDir);
      return { cmd: "codex", argv, input: brief, stream: false };
    },
    prewarm: (prompt, { extraDir } = {}) => {
      const argv = [
        "exec", "-",
        "--skip-git-repo-check",
        "--sandbox", "workspace-write",
        "-c", "approval_policy=\"never\"",
        "--color", "never",
      ];
      if (extraDir) argv.push("--add-dir", extraDir);
      return { cmd: "codex", argv, input: prompt, stream: false };
    },
  },
];

/** Detect-and-tier: the first adapter whose runtime is present, or null. */
export function selectAdapter() {
  for (const a of adapters) {
    if (a.detect()) return a;
  }
  return null;
}

/** True when a valid CONDUCTOR_WORKER_CAP override is in effect. */
export function capIsOverridden() {
  const env = Number(process.env.CONDUCTOR_WORKER_CAP);
  return Number.isInteger(env) && env > 0;
}

/**
 * The effective descendant cap for a chosen adapter. Resolution order:
 * CONDUCTOR_WORKER_CAP (a positive integer) override → adapter default. The
 * override is the per-run escape hatch for an unusual runtime footprint.
 */
export function adapterCap(adapter) {
  if (capIsOverridden()) return Number(process.env.CONDUCTOR_WORKER_CAP);
  return adapter ? adapter.descendantCap : DEFAULT_DESCENDANT_CAP;
}

/**
 * The single human-readable worker line (printed at run start + per worker).
 * `cap` is the RESOLVED cap; when it came from the override, the source is named
 * so the effective cap is never a mystery — e.g.
 *   worker: claude (cap 200)
 *   worker: claude (cap 24, CONDUCTOR_WORKER_CAP)
 */
export function workerLine(adapter, cap) {
  if (!adapter) {
    return "no worker found — need claude or codex on PATH (or set CONDUCTOR_WORKER_CMD)";
  }
  const source = capIsOverridden() ? ", CONDUCTOR_WORKER_CAP" : "";
  const note = adapter.note ? ` — ${adapter.note}` : "";
  return `worker: ${adapter.label} (cap ${cap}${source})${note}`;
}

export function prewarmLine(adapter) {
  return adapter?.prewarm ? `prewarm: ${adapter.label}` : "prewarm unavailable for selected worker";
}
