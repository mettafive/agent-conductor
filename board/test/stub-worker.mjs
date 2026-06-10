#!/usr/bin/env node
/**
 * Stub worker for run/dispatch tests — NO model usage. Emulates a real worker:
 * reads the brief on stdin, finds the card index + receipt path + status/workflow
 * paths + the local CLI binary from the brief, writes a real receipt, then reports
 * an HONEST pass through the same CLI verbs a real worker uses (gate-result →
 * complete). Deterministic, instant, offline.
 *
 * Wire it via:  CONDUCTOR_WORKER_CMD="node /abs/test/stub-worker.mjs"
 *
 * Env knobs (for failure-mode tests):
 *   STUB_FAIL=1     record --failed instead of --passed (drives the retry/breaker)
 *   STUB_NOOP=1     do nothing (worker exits without reporting → reclaim path)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const brief = fs.readFileSync(0, "utf8");

if (process.env.STUB_NOOP === "1") {
  process.exit(0); // never reports → dispatcher reclaims the card
}

const idxM = brief.match(/# Your card: index (\d+)/);
const receiptM = brief.match(/Write your primary markdown receipt to EXACTLY this path[^\n]*\n\n\s+([^\n]+)/);
const verbM = brief.match(/node (\S+cli\.js) check \d+ --path ("(?:[^"]*)"|\S+) --workflow ("(?:[^"]*)"|\S+)/);

if (!idxM || !receiptM || !verbM) {
  console.error("stub-worker: could not parse brief");
  process.exit(2);
}

const unquote = (s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
const idx = idxM[1];
const receiptRel = receiptM[1].trim();
const cli = verbM[1];
const statusArg = unquote(verbM[2]);
const workflowArg = unquote(verbM[3]);

// 1. Write a real receipt (with a verifiable record so complete's rubric holds).
const receiptAbs = path.resolve(process.cwd(), receiptRel);
fs.mkdirSync(path.dirname(receiptAbs), { recursive: true });
fs.writeFileSync(
  receiptAbs,
  [
    `# Stub receipt — card ${idx}`,
    "",
    "Command: stub-worker.mjs (deterministic test worker)",
    "Return: receipt written to disk",
    `Changed resource: ${receiptRel}`,
    "Verification: this file exists and was written by the stub worker.",
  ].join("\n"),
);

const passed = process.env.STUB_FAIL === "1" ? "--failed" : "--passed";
const evidence = process.env.STUB_FAIL === "1"
  ? "FAIL\nSUMMARY: Stub deliberately failed this card."
  : "PASS\nSUMMARY: Stub completed the card and verified the receipt.";
const summary = process.env.STUB_FAIL === "1"
  ? "The stub worker recorded a deliberate failure. Nothing was completed."
  : "The stub worker did the card. It verified the receipt file exists on disk.";

// 2. Record the verdict, then 3. finalize — exactly the real worker's verbs.
const run = (extra) =>
  spawnSync("node", [cli, ...extra, "--path", statusArg, "--workflow", workflowArg], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

run(["gate-result", idx, passed, "--evidence", evidence, "--summary", summary]);
if (process.env.STUB_FAIL !== "1") {
  run(["complete", idx]);
}
process.exit(0);
