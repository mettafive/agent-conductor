/**
 * integration.smoke.mjs — deterministic, offline tests for the integration
 * soundness fixes. No model, no workers (the integration pass is model-driven;
 * these tests drive ONLY the crash-safe-commit and open-detection logic, which
 * are pure and need no model).
 *
 *   D. Double-apply: a crash that left a pending-apply marker is replayed on the
 *      next run — insights end applied, never re-integrated.
 *   E. Case-insensitive open detection (server openKnowledgeItems).
 *   G. Idempotence: an already-applied knowledge set → integration skips.
 *
 * Run:  node test/integration.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep these tests OFFLINE: card completion fires the post-card learning loop,
// which would otherwise make a real codex/model call (slow, costly, lingering).
process.env.CONDUCTOR_DECOMPOSE_CODEX = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "intg-smoke-"));
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

const CARDS_V1 = [
  { title: "Alpha", instruction: "Original alpha instruction." },
  { title: "Beta", instruction: "Original beta instruction." },
];
const WF_V1 = {
  conductor: "3.0.0", name: "intgflow", description: "integration test flow.",
  steps: [
    { title: "Alpha", instruction: "Original alpha instruction.", requires: [] },
    { title: "Beta", instruction: "Original beta instruction.", requires: [0] },
  ],
};
// The "post-integration" state captured in the crash marker.
const CARDS_V2 = [
  { title: "Alpha", instruction: "UPGRADED alpha instruction (from insight k1)." },
  { title: "Beta", instruction: "Original beta instruction." },
];
const WF_V2 = {
  ...WF_V1,
  steps: [
    { title: "Alpha", instruction: "UPGRADED alpha instruction (from insight k1).", requires: [] },
    { title: "Beta", instruction: "Original beta instruction.", requires: [0] },
  ],
};

function seedRoot(tmp, { knowledgeItems, marker }) {
  const root = path.join(tmp, ".conductor", "intg");
  writeJson(path.join(root, "cards.json"), CARDS_V1);
  writeJson(path.join(root, "workflow.json"), WF_V1);
  writeJson(path.join(root, "knowledge.json"), { items: knowledgeItems });
  if (marker) writeJson(path.join(root, "pending-apply.json"), marker);
  return root;
}

// ── D. Double-apply across a crash ───────────────────────────────────────────
test("D double-apply: a surviving pending-apply marker is replayed, NOT re-integrated", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  // Simulate a crash: cards/workflow already mutated to V2 on disk, but knowledge
  // still shows k1 "open"; the marker holds the complete intended end-state with
  // k1 already "applied".
  const root = seedRoot(tmp, {
    knowledgeItems: [{ id: "k1", status: "open", scope: "this-conductor", title: "Upgrade alpha", current: "old", proposed: "new", step: "Alpha" }],
    marker: {
      run_id: "R1",
      cards: CARDS_V2,
      workflow: WF_V2,
      knowledge: { items: [{ id: "k1", status: "applied", applied_in: "R1", applied_as: "tier-1:edit-card-0" }] },
    },
  });
  // also write the mutated files to disk (the crash happened after they were written)
  writeJson(path.join(root, "cards.json"), CARDS_V2);
  writeJson(path.join(root, "workflow.json"), WF_V2);

  const ok = await runIntegration(["--dir", root, "--run-id", "R2"]);
  assert(ok === true, "runIntegration should succeed (reconcile + skip)");
  assert(!fs.existsSync(path.join(root, "pending-apply.json")), "marker must be cleared after reconcile");
  const kn = readJson(path.join(root, "knowledge.json"));
  assert(kn.items.length === 1 && kn.items[0].status === "applied", `k1 must end applied, not re-opened: ${JSON.stringify(kn.items)}`);
  // No re-apply: cards must equal the marker's V2 (one upgrade), not double-edited.
  const cards = readJson(path.join(root, "cards.json"));
  assert(cards[0].instruction === CARDS_V2[0].instruction, "cards must match the replayed marker state");
  assert(cards.length === 2, "no duplicate cards added by a re-apply");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── G. Idempotence: already-applied → integration skips ──────────────────────
test("G idempotence: an already-applied knowledge set → integration skips, no marker", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = seedRoot(tmp, {
    knowledgeItems: [{ id: "k1", status: "applied", applied_in: "R1" }],
  });
  const ok = await runIntegration(["--dir", root, "--run-id", "R3"]);
  assert(ok === true, "integration should skip cleanly when nothing is open");
  assert(!fs.existsSync(path.join(root, "pending-apply.json")), "no marker written when there is nothing to apply");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── E. Case-insensitive open detection (server) ──────────────────────────────
test("E case-insensitive: server openKnowledgeItems detects 'Open'/'OPEN'", async () => {
  const { openKnowledgeItems } = await import("../server/server.js");
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "ci");
  writeJson(path.join(root, "knowledge.json"), {
    items: [
      { id: "a", status: "Open" },
      { id: "b", status: "OPEN" },
      { id: "c", status: " open " },
      { id: "d", status: "applied" },
    ],
  });
  const open = openKnowledgeItems({ dir: root });
  const ids = open.map((i) => i.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(["a", "b", "c"]), `expected a,b,c detected as open, got ${JSON.stringify(ids)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── runner ───────────────────────────────────────────────────────────────────
const only = process.argv[2];
const run = scenarios.filter((s) => !only || s.name.includes(only));
let passed = 0, failed = 0;
console.log(`\n  ${bold(`integration.smoke — ${run.length} scenarios`)}\n`);
for (const s of run) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${run.length}\n`);
process.exit(failed ? 1 : 0);
