/**
 * shaping.smoke.ts — Change 2: the `kind` label survives the parser into the
 * board model, and integration ("shaping") cards become phase "shaping" while
 * work cards stay "workflow". Tests the EXACT field the parser used to drop.
 *
 * Run:  npx tsx test/shaping.smoke.ts    (from board/)
 */
import { parseConductor } from "../src/lib/parse";
import { buildModel } from "../src/lib/merge";
import type { Snapshot } from "../src/lib/types";

let failed = 0;
const assert = (c: boolean, m: string) => { if (!c) { failed++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); } else { console.log(`  \x1b[32mPASS\x1b[0m  ${m}`); } };

const workflowJson = JSON.stringify({
  conductor: "3.0.0",
  name: "shapeflow",
  description: "shaping label test.",
  steps: [
    { title: "Apply instruction insights", instruction: "Shape the plan.", kind: "shaping", requires: [] },
    { title: "Do the work", instruction: "Run the work.", requires: [0] },
  ],
});

// 1. The parser carries `kind` through toStep into ConductorStep (was dropped).
const parsed = parseConductor(workflowJson);
assert(!!parsed, "parseConductor returns a result");
assert(parsed!.steps[0].kind === "shaping", `parsed shaping step carries kind="shaping" (got ${parsed!.steps[0].kind})`);
assert(parsed!.steps[1].kind === undefined, `parsed work step has no kind (got ${parsed!.steps[1].kind})`);

// 2. The board model maps kind → phase: shaping cards become "shaping", work "workflow".
const snap: Snapshot = {
  status: { steps: { "0": { status: "running" }, "1": { status: "pending" } } },
  workflowJson,
  statusPath: ".conductor/status.json",
  conductorPath: null,
};
const model = buildModel(snap);
const shape = model.steps.find((s) => s.title === "Apply instruction insights");
const work = model.steps.find((s) => s.title === "Do the work");
assert(!!shape && shape.phase === "shaping", `shaping card has phase "shaping" in the board model (got ${shape?.phase})`);
assert(!!work && work.phase === "workflow", `work card has phase "workflow" (got ${work?.phase})`);

// 3. No checking→running→done flicker: a card whose gate has PASSED but isn't
//    done yet (the state between gate-result and complete) must stay in Checking,
//    never revert to Running.
const colSnap: Snapshot = {
  status: {
    steps: {
      "0": { status: "running", gate: "checking" }, // mid-check
      "1": { status: "running", gate: "passed" },   // gate accepted, complete pending
    },
  },
  workflowJson: JSON.stringify({
    conductor: "3.0.0", name: "colflow", description: "column test.",
    steps: [
      { title: "Checking card", instruction: "x", requires: [] },
      { title: "Finalizing card", instruction: "y", requires: [] },
    ],
  }),
  statusPath: ".conductor/status.json",
  conductorPath: null,
};
const colModel = buildModel(colSnap);
const checking = colModel.steps.find((s) => s.title === "Checking card");
const finalizing = colModel.steps.find((s) => s.title === "Finalizing card");
assert(!!checking && checking.column === "checking", `gate=checking card → "checking" column (got ${checking?.column})`);
assert(!!finalizing && finalizing.column === "checking", `gate=passed (pre-done) card must stay "checking", NOT revert to "running" (got ${finalizing?.column})`);

// 4. Parallel siblings: kind:"parallel" + rationale carry through the parser to the
//    board model; phase stays "workflow" (real work, just concurrent); and the
//    dependency shape (shared upstream, no inter-sibling edge) is preserved so the
//    scheduler runs them in parallel.
const parSnap: Snapshot = {
  status: { steps: { "0": { status: "done" }, "1": { status: "pending" }, "2": { status: "pending" } } },
  workflowJson: JSON.stringify({
    conductor: "3.0.0", name: "multiverse", description: "fan-out.",
    steps: [
      { title: "Roll the dice", instruction: "Pick genres.", requires: [] },
      { title: "Write genre A", instruction: "Write A.", requires: [0], kind: "parallel", rationale: "parallel sibling — saves time" },
      { title: "Write genre B", instruction: "Write B.", requires: [0], kind: "parallel", rationale: "parallel sibling — saves time" },
    ],
  }),
  statusPath: ".conductor/status.json",
  conductorPath: null,
};
const parModel = buildModel(parSnap);
const sibA = parModel.steps.find((s) => s.title === "Write genre A");
const sibB = parModel.steps.find((s) => s.title === "Write genre B");
assert(!!sibA && sibA.kind === "parallel", `parallel sibling carries kind="parallel" to the board model (got ${sibA?.kind})`);
assert(!!sibA && sibA.phase === "workflow", `parallel sibling is real work — phase "workflow" (got ${sibA?.phase})`);
assert(!!sibA && /saves time/.test(sibA.rationale || ""), `the rationale carries to the board model (got ${sibA?.rationale})`);
assert(!!sibA && !!sibB && JSON.stringify(sibA.requires) === "[0]" && JSON.stringify(sibB.requires) === "[0]", "siblings share the one upstream");
assert(!!sibA && !!sibB && !sibA.requires.includes(2) && !sibB.requires.includes(1), "no inter-sibling edge (scheduler runs them in parallel)");

// 5. Work-order (Part B): the terminal sorts by (event_at, seq), NOT flush time `at`.
//    The Card 2 scenario — a worker beat emitted EARLY but flushed LATE must sort
//    BEFORE the gate beats; equal event_at breaks deterministically by seq.
import("../src/lib/heartbeatStream").then(({ flattenBeats }) => {
  const entry = {
    snap: {
      status: {
        steps: {
          "0": {
            heartbeat: [
              { at: "2026-01-01T00:00:05Z", event_at: "2026-01-01T00:00:01Z", seq: 5, note: "wrote the file" }, // early event, LATE flush
              { at: "2026-01-01T00:00:02Z", event_at: "2026-01-01T00:00:02Z", seq: 2, note: "Checking" },
              { at: "2026-01-01T00:00:03Z", event_at: "2026-01-01T00:00:03Z", seq: 3, note: "Passed" },
              { at: "2026-01-01T00:00:04Z", event_at: "2026-01-01T00:00:01Z", seq: 1, note: "tiebreak" }, // same event_at as first, lower seq
            ],
          },
        },
      },
      workflowJson: JSON.stringify({ steps: [{ title: "A" }] }),
    },
    history: [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const beats = flattenBeats({ wf: entry as any }, ["wf"]);
  const order = beats.map((b) => b.note);
  assert(order[0] === "tiebreak" && order[1] === "wrote the file", `equal event_at breaks by seq, then later event_at (got ${order.join(", ")})`);
  assert(order.indexOf("wrote the file") < order.indexOf("Checking"), "early-event/late-flush beat sorts BEFORE the gate beats (Card 2 fixed)");

  console.log(`\n  ${failed ? `\x1b[31m${failed} failed\x1b[0m` : "\x1b[32mall passed\x1b[0m"}\n`);
  process.exit(failed ? 1 : 0);
});
