/**
 * parallel-siblings.smoke.mjs — the decomposer can split parallel siblings (offline).
 *
 * The BEHAVIORAL split (3 genres → siblings, 661 clinics → one card) is model-driven
 * and is the watched check. What's deterministic — and tested here — is the PLUMBING
 * that lets a parallel sibling survive end-to-end, plus that the calibrated wording
 * actually landed in the two prompts:
 *
 *   PSI1 normalizeCards accepts + preserves kind/rationale (and ordinary cards omit them).
 *   PSI2 normalizeWorkflow carries kind/rationale onto the workflow.json steps.
 *   PSI3 the compose prompt carries the parallel-sibling nudge + the reframed fold rule.
 *   PSI4 the checker prompt carries the kind:"parallel" carve-out.
 *
 * Run:  node test/parallel-siblings.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCards } from "../cli/decompose.js";
import { normalizeWorkflow } from "../cli/order.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

const CARDS = [
  { title: "Roll the dice", instruction: "Pick the genres.", summary: "A. B." },
  { title: "Write genre A", instruction: "Write the genre-A file. References no other card.", summary: "A. B.", kind: "parallel", rationale: "parallel sibling — runs concurrently with its siblings, saves time" },
  { title: "Write genre B", instruction: "Write the genre-B file. References no other card.", summary: "A. B.", kind: "parallel", rationale: "parallel sibling — runs concurrently with its siblings, saves time" },
];

test("PSI1 normalizeCards accepts + preserves kind/rationale; ordinary cards omit them", () => {
  const out = normalizeCards({ cards: CARDS });
  assert(out.length === 3, "all three cards survive");
  assert(out[0].kind === undefined && out[0].rationale === undefined, "ordinary card has no kind/rationale");
  assert(out[1].kind === "parallel", `parallel sibling keeps kind (got ${out[1].kind})`);
  assert(/saves time/.test(out[1].rationale || ""), "parallel sibling keeps its rationale");
  // an unsupported field still throws — the allowlist only grew by kind/rationale.
  let threw = false;
  try { normalizeCards({ cards: [{ title: "x", instruction: "y", summary: "A. B.", bogus: 1 }] }); } catch { threw = true; }
  assert(threw, "an unknown field still throws (allowlist only added kind/rationale)");
});

test("PSI2 normalizeWorkflow carries kind/rationale onto workflow.json steps", () => {
  const cards = normalizeCards({ cards: CARDS });
  // siblings share the one upstream (card 0), no inter-sibling edge.
  const wf = normalizeWorkflow(
    { steps: [{ requires: [] }, { requires: [0] }, { requires: [0] }] },
    cards,
    { name: "multiverse", description: "fan-out.", maxAttempts: 5 },
  );
  assert(wf.steps.length === 3, "three workflow steps");
  assert(wf.steps[0].kind === undefined, "upstream step has no kind");
  assert(wf.steps[1].kind === "parallel" && wf.steps[2].kind === "parallel", "both siblings keep kind:parallel on the workflow step");
  assert(/saves time/.test(wf.steps[1].rationale || ""), "the rationale survives onto the workflow step");
  // the parallel shape: shared upstream, no inter-sibling edge.
  assert(JSON.stringify(wf.steps[1].requires) === "[0]" && JSON.stringify(wf.steps[2].requires) === "[0]", "siblings share the one upstream");
  assert(!wf.steps[1].requires.includes(2) && !wf.steps[2].requires.includes(1), "no inter-sibling edge");
});

test("PSI3 the compose prompt carries the parallel nudge + the reframed fold rule", () => {
  const src = fs.readFileSync(path.join(BOARD, "cli", "decompose.js"), "utf8");
  assert(/These are parallel siblings: they share the same upstream\s+and run concurrently/.test(src), "compose nudge present");
  assert(/small, fixed set of distinctly named outputs/.test(src), "nudge names the split condition (named + small/fixed)");
  assert(/generic, large, or open-ended\s+collection/.test(src), "fold rule reframed to the generic/large/open case");
  assert(/do not create a card per item/.test(src), "fold rule keeps the no-per-item bar");
});

test("PSI4 the checker prompt carries the kind:\"parallel\" carve-out", () => {
  const src = fs.readFileSync(path.join(BOARD, "cli", "decompose.js"), "utf8");
  assert(/deliberate parallel sibling, not a too-tiny/.test(src), "checker carve-out present (don't fold a parallel sibling)");
  assert(/no sibling's output feeding\s+another/.test(src), "carve-out verifies independence, not folds");
  assert(/too-tiny rule still applies to\s+unmarked small cards/.test(src), "the too-tiny rule still bites unmarked small cards");
  assert(/cardinality rule still fails a generic or large collection/.test(src), "the cardinality rule still fails a lost-multiplicity collection");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`parallel-siblings.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
