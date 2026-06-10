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
//   1. CONDUCTOR_WORKER_CMD set  → env-override adapter (conservative cap)
//   2. else `claude` on PATH     → claude adapter (cap 5)
//   3. else `codex` on PATH      → codex adapter  (its own, larger cap)
//   4. else                      → null → run-card fails LOUD (no silent run)
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

// Per-runtime safe descendant caps. 5 is tuned to Claude's ~1-2 helper procs.
// Codex's `exec` sandbox spawns a larger helper subtree (observed ~9) and would
// trip a cap of 5 every time — so it owns a higher cap (audit §4c). The env
// override gets a conservative middle value since its footprint is unknown.
const CLAUDE_CAP = 5;
const CODEX_CAP = 16;
const ENV_CAP = 8;

// Registry order IS the selection priority (first whose detect() is true wins).
export const adapters = [
  {
    id: "env",
    label: "CONDUCTOR_WORKER_CMD",
    detect: () => !!process.env.CONDUCTOR_WORKER_CMD,
    descendantCap: ENV_CAP,
    leashLabel: "sh -c $CONDUCTOR_WORKER_CMD (brief on stdin)",
    note: null,
    launch: (brief) => ({
      cmd: "/bin/sh",
      argv: ["-c", String(process.env.CONDUCTOR_WORKER_CMD)],
      input: brief,
      stream: false,
    }),
  },
  {
    id: "claude",
    label: "claude",
    detect: () => has("claude"),
    descendantCap: CLAUDE_CAP,
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
  },
  {
    id: "codex",
    label: "codex",
    detect: () => has("codex"),
    descendantCap: CODEX_CAP,
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
  },
];

/** Detect-and-tier: the first adapter whose runtime is present, or null. */
export function selectAdapter() {
  for (const a of adapters) {
    if (a.detect()) return a;
  }
  return null;
}

/**
 * The effective descendant cap for a chosen adapter. CONDUCTOR_WORKER_CAP (a
 * positive integer) overrides the adapter default — used by tests to prove the
 * cap is per-adapter, and an escape hatch for an unusual runtime footprint.
 */
export function adapterCap(adapter) {
  const env = Number(process.env.CONDUCTOR_WORKER_CAP);
  if (Number.isInteger(env) && env > 0) return env;
  return adapter ? adapter.descendantCap : CLAUDE_CAP;
}

/** The single human-readable worker line (printed at run start + per worker). */
export function workerLine(adapter, cap) {
  if (!adapter) {
    return "no worker found — need claude or codex on PATH (or set CONDUCTOR_WORKER_CMD)";
  }
  const note = adapter.note ? ` — ${adapter.note}` : "";
  return `worker: ${adapter.label} (cap ${cap})${note}`;
}
