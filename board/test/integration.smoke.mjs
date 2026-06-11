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
 *   H. Honesty: local fallback is explicit opt-in, never the default Improve & Run path.
 *
 * Run:  node test/integration.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import http from "node:http";
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
const src = (rel) => fs.readFileSync(path.join(BOARD, rel), "utf8");

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

const CARDS_V1 = [
  { title: "Apply Opening Upgrade", instruction: "Original opening upgrade instruction." },
  { title: "Validate Follow-up Step", instruction: "Original follow-up validation instruction." },
];
const WF_V1 = {
  conductor: "3.0.0", name: "intgflow", description: "integration test flow.",
  steps: [
    { title: "Apply Opening Upgrade", instruction: "Original opening upgrade instruction.", requires: [] },
    { title: "Validate Follow-up Step", instruction: "Original follow-up validation instruction.", requires: [0] },
  ],
};
// The "post-integration" state captured in the crash marker.
const CARDS_V2 = [
  { title: "Apply Opening Upgrade", instruction: "UPGRADED opening instruction (from insight k1)." },
  { title: "Validate Follow-up Step", instruction: "Original follow-up validation instruction." },
];
const WF_V2 = {
  ...WF_V1,
  steps: [
    { title: "Apply Opening Upgrade", instruction: "UPGRADED opening instruction (from insight k1).", requires: [] },
    { title: "Validate Follow-up Step", instruction: "Original follow-up validation instruction.", requires: [0] },
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

function writeMockModel(tmp) {
  const file = path.join(tmp, "mock-model.mjs");
  fs.writeFileSync(file, `#!/usr/bin/env node
const role = process.env.CONDUCTOR_DECOMPOSE_ROLE;
if (process.env.MOCK_MODEL_FAIL === "1") {
  console.error("mock model intentionally failed for " + role);
  process.exit(42);
}
if (role === "integration") {
  console.log(JSON.stringify({
    changes: [{
      type: "edit_instruction",
      card: 0,
      title: "Apply Opening Upgrade",
      change: "Added the FAST MODEL TOKEN instruction from K-SIM.",
      knowledge_ids: ["K-SIM"],
      new_instruction: "Original opening upgrade instruction. FAST MODEL TOKEN: mention the demo-safe integration detail."
    }],
    dismissed: [],
    applied_notes: [{ knowledge_id: "K-SIM", note: "Added the demo-safe integration detail to the opening upgrade card because the insight asks for it before execution." }]
  }));
} else if (role === "integration-checker") {
  console.log(JSON.stringify({
    verdict: "PASS",
    feedback: "model patch includes the requested insight and preserves the original instruction",
    passed: [{ card: 0, knowledge_ids: ["K-SIM"], kind: "edit_instruction", reason: "FAST MODEL TOKEN is present and the original instruction remains." }],
    failed: []
  }));
} else if (role === "integration-summary") {
  console.log(JSON.stringify({ summary: "This card applies the opening upgrade with the demo-safe integration detail. It produces a checked instruction that carries the prior learning into execution." }));
} else {
  console.log(JSON.stringify({ verdict: "PASS", feedback: "unused mock role" }));
}
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function writeRoleMock(tmp, handlers) {
  const file = path.join(tmp, "role-mock.mjs");
  fs.writeFileSync(file, `#!/usr/bin/env node
const role = process.env.CONDUCTOR_DECOMPOSE_ROLE;
const handlers = ${JSON.stringify(handlers, null, 2)};
const payload = handlers[role] || { verdict: "PASS", feedback: "unused role" };
console.log(JSON.stringify(payload));
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function withEnv(vars, fn) {
  const prior = {};
  for (const [key, value] of Object.entries(vars)) {
    prior[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function withServedHealth(root, fn) {
  const key = `${path.basename(root)} (integration)`;
  const server = http.createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", workflows: { [key]: { status: "running" } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function seedOpenIntegrationRoot(tmp, id = "K-SIM") {
  return seedRoot(tmp, {
    knowledgeItems: [{
      id,
      status: "open",
      scope: "this-conductor",
      title: "Opening demo-safe integration detail",
      detail: "opening upgrade instruction should mention fallback token",
      step: "Apply Opening Upgrade",
    }],
  });
}

// ── D. Double-apply across a crash ───────────────────────────────────────────
test("D double-apply: a surviving pending-apply marker is replayed, NOT re-integrated", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  // Simulate a crash: cards/workflow already mutated to V2 on disk, but knowledge
  // still shows k1 "open"; the marker holds the complete intended end-state with
  // k1 already "applied".
  const root = seedRoot(tmp, {
    knowledgeItems: [{ id: "k1", status: "open", scope: "this-conductor", title: "Upgrade opening step", current: "old", proposed: "new", step: "Apply Opening Upgrade" }],
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

test("D2 run reconciles pending integration before counting open insights", () => {
  const run = src("cli/run.js");
  const reconcileAt = run.indexOf("reconcilePendingApply(outDir)");
  const openAt = run.indexOf("const openInsights = openInsightsForRoot(outDir)");
  assert(reconcileAt !== -1, "run must reconcile pending integration commits");
  assert(openAt !== -1, "run must count open insights");
  assert(reconcileAt < openAt, "run must reconcile before open-insight detection to prevent double-apply");
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

// ── H. No silent fallback in normal Improve & Run ───────────────────────────
test("H honesty: integration fallback is explicit opt-in only", async () => {
  const integration = src("cli/integration.js");
  assert(/--allow-local-fallback/.test(integration), "help/flag must expose fallback as explicit opt-in");
  assert(/const strictIntegration = !args\.includes\("--allow-local-fallback"\)/.test(integration), "strict integration must be the default");
  assert(!/strict: args\.includes\("--strict"\)/.test(integration), "normal integration must not default to non-strict fallback mode");
});

test("I simulate success: mocked model integrates, checker accepts, knowledge is applied", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = seedOpenIntegrationRoot(tmp);
  const mock = writeMockModel(tmp);
  await withServedHealth(root, async (port) => {
    await withEnv({ CONDUCTOR_DECOMPOSE_COMMAND: `node ${mock}`, MOCK_MODEL_FAIL: undefined }, async () => {
      const ok = await runIntegration(["--dir", root, "--run-id", "R-SUCCESS", "--port", String(port)]);
      assert(ok === true, "mocked model integration should pass");
    });
  });
  const cards = readJson(path.join(root, "cards.json"));
  const knowledge = readJson(path.join(root, "knowledge.json"));
  const status = readJson(path.join(root, "integration.status.json"));
  assert(cards[0].instruction.includes("FAST MODEL TOKEN"), "card instruction must come from mocked model output");
  assert(knowledge.items[0].status === "applied", "knowledge item must be marked applied after success");
  assert(knowledge.items[0].applied_as === "tier-1:edit-card-0", "success should record the tier/card application");
  const beats = Object.values(status.steps).flatMap((step) => step.heartbeat || []).map((beat) => beat.note).join("\n");
  assert(beats.includes("Added the demo-safe integration detail"), "closing heartbeat should include the model's applied note");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("J simulate failure: normal integration fails visibly and does not apply fallback", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = seedOpenIntegrationRoot(tmp);
  const mock = writeMockModel(tmp);
  await withServedHealth(root, async (port) => {
    await withEnv({ CONDUCTOR_DECOMPOSE_COMMAND: `node ${mock}`, MOCK_MODEL_FAIL: "1" }, async () => {
      const ok = await runIntegration(["--dir", root, "--run-id", "R-FAIL", "--port", String(port)]);
      assert(ok === false, "strict default should stop when the integration model fails");
    });
  });
  const cards = readJson(path.join(root, "cards.json"));
  const knowledge = readJson(path.join(root, "knowledge.json"));
  const status = readJson(path.join(root, "integration.status.json"));
  assert(cards[0].instruction === CARDS_V1[0].instruction, "strict failure must not mutate card instructions");
  assert(knowledge.items[0].status === "open", "strict failure must leave knowledge open");
  const first = Object.values(status.steps)[0];
  assert(first.status === "failed" && first.gate === "failed", "integration preflight should show a failed card");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("K simulate explicit fallback: opt-in fallback applies locally", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = seedOpenIntegrationRoot(tmp, "K-FALLBACK");
  const mock = writeMockModel(tmp);
  await withServedHealth(root, async (port) => {
    await withEnv({ CONDUCTOR_DECOMPOSE_COMMAND: `node ${mock}`, MOCK_MODEL_FAIL: "1" }, async () => {
      const ok = await runIntegration(["--dir", root, "--run-id", "R-FALLBACK", "--port", String(port), "--allow-local-fallback"]);
      assert(ok === true, "explicit fallback mode should still be available for offline recovery");
    });
  });
  const cards = readJson(path.join(root, "cards.json"));
  const knowledge = readJson(path.join(root, "knowledge.json"));
  assert(cards[0].instruction.includes("opening upgrade instruction should mention fallback token"), "fallback should append the local learning detail");
  assert(!cards[0].instruction.includes("FAST MODEL TOKEN"), "fallback output must be distinguishable from model output");
  assert(knowledge.items[0].status === "applied", "explicit fallback applies the knowledge item");
  assert(knowledge.items[0].applied_as === "tier-1:edit-card-0", "fallback records the tier/card application");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("L ledger evidence: concise numeric word-count insight is detectable when applied", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = seedRoot(tmp, {
    knowledgeItems: [{
      id: "K-080",
      status: "open",
      scope: "this-conductor",
      title: "Write friendly launch variant",
      detail: "lets make it 80 words instead",
      source_card: "0",
    }],
  });
  const mock = writeRoleMock(tmp, {
    integration: {
      changes: [{
        type: "edit_instruction",
        card: 0,
        title: "Apply Opening Upgrade",
        change: "Changed the launch message requirement to exactly 80 words.",
        knowledge_ids: ["K-080"],
        new_instruction: "Original opening upgrade instruction. Write exactly 80 words for the launch message."
      }],
      dismissed: [],
      applied_notes: [{ knowledge_id: "K-080", note: "Changed the launch message to exactly 80 words so the worker has one target." }]
    },
    "integration-checker": {
      verdict: "PASS",
      feedback: "numeric word-count requirement is applied",
      passed: [{ card: 0, knowledge_ids: ["K-080"], kind: "edit_instruction", reason: "exactly 80 words is present" }],
      failed: []
    },
    "integration-summary": { summary: "Applies a precise 80-word requirement." }
  });
  await withServedHealth(root, async (port) => {
    await withEnv({ CONDUCTOR_DECOMPOSE_COMMAND: `node ${mock}` }, async () => {
      const ok = await runIntegration(["--dir", root, "--run-id", "R-NUMERIC", "--port", String(port)]);
      assert(ok === true, "numeric word-count integration should pass when exact phrase is present");
    });
  });
  const knowledge = readJson(path.join(root, "knowledge.json"));
  assert(knowledge.items[0].status === "applied", "numeric insight should be marked applied");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("M guard rejection: validation card fails visibly instead of staying pending", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = seedRoot(tmp, {
    knowledgeItems: [{
      id: "K-MISS",
      status: "open",
      scope: "this-conductor",
      title: "Critical missing marker",
      detail: "must mention criticalmarker",
      source_card: "0",
    }],
  });
  const mock = writeRoleMock(tmp, {
    integration: {
      changes: [{
        type: "edit_instruction",
        card: 0,
        title: "Apply Opening Upgrade",
        change: "Claims to apply K-MISS but omits the marker.",
        knowledge_ids: ["K-MISS"],
        new_instruction: "Original opening upgrade instruction. This instruction keeps working but omits the required evidence."
      }],
      dismissed: [],
      applied_notes: [{ knowledge_id: "K-MISS", note: "Claimed to apply the marker." }]
    },
    "integration-checker": {
      verdict: "PASS",
      feedback: "intentionally over-trusting checker fixture",
      passed: [{ card: 0, knowledge_ids: ["K-MISS"], kind: "edit_instruction", reason: "fixture says pass" }],
      failed: []
    }
  });
  await withServedHealth(root, async (port) => {
    await withEnv({ CONDUCTOR_DECOMPOSE_COMMAND: `node ${mock}` }, async () => {
      const ok = await runIntegration(["--dir", root, "--run-id", "R-GUARD-FAIL", "--port", String(port)]);
      assert(ok === false, "ledger guard should reject a claimed but undetectable learning");
    });
  });
  const status = readJson(path.join(root, "integration.status.json"));
  assert(status.status === "failed", `integration status should be failed:\n${JSON.stringify(status, null, 2)}`);
  assert(status.steps["1"].status === "failed" && status.steps["1"].gate === "failed", `validate step should fail visibly:\n${JSON.stringify(status.steps["1"], null, 2)}`);
  const knowledge = readJson(path.join(root, "knowledge.json"));
  assert(knowledge.items[0].status === "open", "guard failure must leave knowledge open for retry");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("N human comments may override conflicting original requirements", async () => {
  const { runIntegration } = await import("../cli/integration.js");
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "human-override");
  writeJson(path.join(root, "cards.json"), [
    { title: "Write Launch Copy", instruction: "Write the launch message in English. Keep the tone direct and friendly." },
  ]);
  writeJson(path.join(root, "workflow.json"), {
    conductor: "3.0.0",
    name: "human-override",
    description: "human override integration test",
    steps: [
      { title: "Write Launch Copy", instruction: "Write the launch message in English. Keep the tone direct and friendly.", requires: [] },
    ],
  });
  writeJson(path.join(root, "knowledge.json"), {
    items: [{
      id: "K-HUMAN-SV",
      status: "open",
      source: "human",
      scope: "this-conductor",
      title: "Write Launch Copy",
      detail: "No, now we're going to do it in Swedish instead",
      source_card: "0",
    }],
  });
  const integrationSource = src("cli/integration.js");
  assert(/source "human" are user comments/.test(integrationSource), "composer prompt should frame human comments as user direction");
  assert(/intentional override/.test(integrationSource), "checker prompt should allow human-comment overrides");
  const mock = writeRoleMock(tmp, {
    integration: {
      changes: [{
        type: "edit_instruction",
        card: 0,
        title: "Write Launch Copy",
        change: "Changed the launch message language from English to Swedish per the human comment.",
        knowledge_ids: ["K-HUMAN-SV"],
        new_instruction: "Write the launch message in Swedish. Keep the tone direct and friendly."
      }],
      dismissed: [],
      applied_notes: [{ knowledge_id: "K-HUMAN-SV", note: "Changed the launch card to Swedish because the user comment overrides the old English requirement." }]
    },
    "integration-checker": {
      verdict: "PASS",
      feedback: "human comment intentionally overrides the old language requirement",
      passed: [{ card: 0, knowledge_ids: ["K-HUMAN-SV"], reason: "Swedish replaces English and the remaining tone requirement is preserved." }],
      failed: []
    },
    "integration-summary": { summary: "Applies the human language override." }
  });
  await withServedHealth(root, async (port) => {
    await withEnv({ CONDUCTOR_DECOMPOSE_COMMAND: `node ${mock}` }, async () => {
      const ok = await runIntegration(["--dir", root, "--run-id", "R-HUMAN-OVERRIDE", "--port", String(port)]);
      assert(ok === true, "human override should integrate successfully");
    });
  });
  const cards = readJson(path.join(root, "cards.json"));
  const knowledge = readJson(path.join(root, "knowledge.json"));
  assert(cards[0].instruction.includes("Swedish"), `instruction should carry the human override:\n${cards[0].instruction}`);
  assert(!cards[0].instruction.includes("English"), `conflicting old requirement should be removed:\n${cards[0].instruction}`);
  assert(knowledge.items[0].status === "applied", "human override should be marked applied");
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
