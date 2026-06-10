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

console.log(`\n  ${failed ? `\x1b[31m${failed} failed\x1b[0m` : "\x1b[32mall passed\x1b[0m"}\n`);
process.exit(failed ? 1 : 0);
