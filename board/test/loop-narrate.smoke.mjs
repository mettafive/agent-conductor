/**
 * loop-narrate.smoke.mjs — the loop narrates what it just learned (offline).
 *
 *   LN1 normalizeIntegration preserves the composer's applied_notes.
 *   LN2 mergeLocked carries applied_notes through unchanged.
 *   LN3 buildAppliedSummary → ONE multi-line note (lead + one line per insight);
 *       null when nothing applied; falls back to change summaries.
 *   LN4 integrationProgressNote routes the summary onto the instruction phase-end.
 *   LN5 emitting the phase-end appends EXACTLY ONE beat (not N) to the card.
 *   LN6 no extra model call — the notes ride the composer's existing output.
 *   LN7 insight prompts prefer speed/efficiency and agent-usable placement.
 *
 * Run:  node test/loop-narrate.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeIntegration,
  mergeLocked,
  buildAppliedSummary,
  integrationProgressNote,
  makeIntegrationProgress,
} from "../cli/integration.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "loopnarr-smoke-"));

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

const THREE = {
  changes: [
    { type: "edit_instruction", card: 1, knowledge_ids: ["K-001"], new_instruction: "x", change: "Added synonym expansion." },
  ],
  dismissed: [],
  applied_notes: [
    { knowledge_id: "K-001", note: "Added synonym expansion to the research card so the next run won't miss variants." },
    { knowledge_id: "K-002", note: "Preserved per-page image scope so generation covers parent and child pages." },
    { knowledge_id: "K-003", note: "Passed the prior card's checksum as an explicit input so the precondition is verifiable." },
  ],
};

test("LN1 normalizeIntegration preserves applied_notes", () => {
  const r = normalizeIntegration(THREE);
  assert(Array.isArray(r.applied_notes) && r.applied_notes.length === 3, `expected 3 applied_notes, got ${JSON.stringify(r.applied_notes)}`);
  assert(r.applied_notes[0].knowledge_id === "K-001" && /synonym expansion/.test(r.applied_notes[0].note), "first note preserved");
  // entries without a note are dropped (stock-text-only / empty are not "applications").
  const sparse = normalizeIntegration({ applied_notes: [{ knowledge_id: "K-9" }, { knowledge_id: "K-8", note: "real." }] });
  assert(sparse.applied_notes.length === 1, "an entry with no note is dropped");
});

test("LN2 mergeLocked carries applied_notes through", () => {
  const merged = mergeLocked(normalizeIntegration(THREE), new Map());
  assert(Array.isArray(merged.applied_notes) && merged.applied_notes.length === 3, `mergeLocked must preserve applied_notes, got ${JSON.stringify(merged.applied_notes)}`);
});

test("LN3 buildAppliedSummary → one multi-line note; null when empty; fallback", () => {
  const s = buildAppliedSummary(normalizeIntegration(THREE));
  assert(typeof s === "string", "returns a string");
  const lines = s.split("\n");
  assert(lines[0] === "Applied 3 insights.", `lead line should count insights (got "${lines[0]}")`);
  assert(lines.filter((l) => l.startsWith("- ")).length === 3, `one bullet per insight (got ${lines.length - 1})`);
  assert(/K-001/.test(s) && /synonym expansion/.test(s), "notes carry the application text");
  // singular
  const one = buildAppliedSummary({ applied_notes: [{ knowledge_id: "K-1", note: "Did a thing." }] });
  assert(one.startsWith("Applied 1 insight."), `singular lead (got "${one.split("\n")[0]}")`);
  // nothing applied → null (no bare "Applied 0")
  assert(buildAppliedSummary({ changes: [], dismissed: [], applied_notes: [] }) === null, "empty → null");
  assert(buildAppliedSummary({}) === null, "missing → null");
  // fallback: no applied_notes, but change summaries exist → derive from them
  const fb = buildAppliedSummary({ changes: [{ knowledge_ids: ["K-5"], change: "Folded the API path in." }], applied_notes: [] });
  assert(fb && /Applied 1 insight/.test(fb) && /Folded the API path in\./.test(fb), `fallback derives from change summaries (got ${fb})`);
});

test("LN4 integrationProgressNote routes the summary onto instruction phase-end", () => {
  const summary = "Applied 2 insights.\n- K-001: a\n- K-002: b";
  const withSummary = integrationProgressNote({ phase: "instruction", event: "phase-end", passed: true, summaryNote: summary });
  assert(withSummary === summary, "phase-end + summaryNote returns the multi-line summary verbatim");
  const noSummary = integrationProgressNote({ phase: "instruction", event: "phase-end", passed: true });
  assert(/passed\.$/.test(noSummary) && !/Applied/.test(noSummary), `no summary → quiet "passed." (got "${noSummary}")`);
  const failed = integrationProgressNote({ phase: "instruction", event: "phase-end", passed: false, feedback: "nope" });
  assert(/failed/.test(failed), "failure still reads as failed");
});

test("LN5 emitting phase-end appends EXACTLY ONE beat (not N) to the card", () => {
  const tmp = tmpdir();
  const statusPath = path.join(tmp, "status.json");
  const progress = makeIntegrationProgress({ statusPath, phaseToStep: new Map([["instruction", 0]]) });
  const summary = buildAppliedSummary(normalizeIntegration(THREE)); // 3 insights, multi-line
  progress({ phase: "instruction", event: "phase-start" });
  progress({ phase: "instruction", event: "phase-end", passed: true, summaryNote: summary });
  const st = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  const beats = st.steps["0"].heartbeat || [];
  const applied = beats.filter((b) => /^Applied \d+ insight/.test(b.note || ""));
  assert(applied.length === 1, `EXACTLY ONE closing beat, not one per insight — got ${applied.length}: ${JSON.stringify(beats.map((b) => b.note))}`);
  assert(/\n- K-001:/.test(applied[0].note) && applied[0].note.split("\n").length === 4, "the one beat is multi-line (lead + 3 bullets)");
  assert(st.steps["0"].status === "done", "the summary rides the done beat (card completes)");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("LN6 no extra model call — notes ride the composer's existing output", () => {
  const src = fs.readFileSync(path.join(BOARD, "cli", "integration.js"), "utf8");
  // the field is requested IN the composer prompt (same call), not a new pass:
  assert(/Return these as applied_notes/.test(src), "the composer prompt must request applied_notes (rides the existing call)");
  assert(/"applied_notes":/.test(src), "applied_notes is part of the composer's JSON output shape");
  // buildAppliedSummary is pure — it must not call the model:
  const body = src.slice(src.indexOf("function buildAppliedSummary"), src.indexOf("function integrationProgressNote"));
  assert(!/callModel/.test(body), "buildAppliedSummary must not call the model");
});

test("LN7 insight prompts prefer speed/efficiency and agent-usable placement", () => {
  const learning = fs.readFileSync(path.join(BOARD, "cli", "learning.js"), "utf8");
  const integration = fs.readFileSync(path.join(BOARD, "cli", "integration.js"), "utf8");
  assert(/Favor speed and efficiency improvements/.test(learning), "learning prompt should frame insights as speed/efficiency optimizations");
  assert(/instruction-ready optimization/.test(learning), "learning prompt should ask for details ready to fold into instructions");
  assert(/reusable shortcut\/source\/decision rule/.test(learning), "learning prompt should capture concrete shortcuts/sources/rules");
  assert(/place that source, path, command, schema, or decision rule near the start/.test(integration), "integration composer should place solutions before the worker searches");
  assert(/Do not bury the optimization after output requirements/.test(integration), "efficiency details must not be buried late in the instruction");
  assert(/A buried or vague optimization is not\s+integrated/s.test(integration), "checker should reject vague or buried efficiency integrations");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`loop-narrate.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
