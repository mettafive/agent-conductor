/**
 * Loop smoke test — the board's safety net for its killer feature.
 *
 * The board renders a `type: loop` step as a per-item kanban of iterations. If a
 * regression silently breaks loop creation (status-init / loop-scope) or loop
 * rendering (parse → merge → BoardStep.isLoop + loop.iterations), the feature dies
 * quietly. This test guarantees that across ~20 DIVERSE valid loop shapes the REAL
 * pipeline keeps producing a BoardStep where `isLoop === true`, every scoped item
 * becomes an iteration, every iteration exposes the loop's sub-step ids, and driving
 * a sub-step to `done` moves its column and bumps `completed`.
 *
 * It exercises the REAL machinery — no mocks:
 *   - `node bin/cli.js validate <yaml>`            (cli/validate.js)
 *   - `node bin/cli.js status-init <yaml>`         (cli/writer.js → runStatusInit)
 *   - `node bin/cli.js loop-scope <loop> <item…>`  (cli/writer.js → runLoopScope)
 *   - `node bin/cli.js loop <loop> <item> <sub> done`
 *   - buildModel(parseConductor + merge)           (src/lib/parse.ts + merge.ts)
 *
 * Run:  npm run test:loops    (from board/)   — or:  npx tsx test/loops.smoke.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { buildModel } from "../src/lib/merge";
import type { BoardStep, Snapshot } from "../src/lib/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const CLI = path.join(BOARD, "bin", "cli.js");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── shape generation ────────────────────────────────────────────────────────

interface Shape {
  name: string;
  yaml: string;
  loopId: string;
  subIds: string[];
  items: string[];
  parallel: boolean | "auto" | undefined;
  loopIsOnlyStep: boolean;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A small, deterministic pseudo-random generator so shapes are diverse but stable. */
function rng(seed: number) {
  let x = seed * 2654435761 + 0x9e3779b9;
  return () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return (x >>> 0) / 0xffffffff;
  };
}

const DOMAINS = [
  { wf: "clinic-pricing", over: "clinic_list", as: "clinic", subs: ["scrape", "validate", "persist", "verify"], items: ["Evidensia Sthlm", "AniCura Göteborg", "Distriktsvet Lund", "Blå Stjärnan", "VetCity Malmö", "Djursjukhuset Albano", "Anicura Bagarmossen", "Regiondjur Umeå", "Strömsholm", "Helsingborg Vet", "Kalmar Smådjur", "Visby Vet", "Karlstad Djurklinik", "Falu Vet", "Örebro Djursjukhus"] },
  { wf: "treatment-readability", over: "treatment_pages", as: "page", subs: ["polish", "dejargon", "faq", "index"], items: ["akutvård katt", "marsvin", "reptil", "allergitestning hund", "kastrering", "tandvård", "vaccination", "röntgen", "ultraljud", "blodprov", "kloklippning", "avmaskning"] },
  { wf: "breed-pages", over: "breeds", as: "breed", subs: ["research", "write", "review"], items: ["labrador", "golden", "tax", "schäfer", "border-collie", "pudel", "chihuahua", "bulldog", "beagle", "rottweiler"] },
  { wf: "image-batch", over: "articles", as: "article", subs: ["prompt", "generate", "ship"], items: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12", "a13", "a14"] },
  { wf: "seo-sweep", over: "families", as: "family", subs: ["gsc", "rewrite", "submit"], items: ["fam-a", "fam-b", "fam-c", "fam-d", "fam-e", "fam-f", "fam-g"] },
  { wf: "enrichment", over: "queue", as: "candidate", subs: ["enrich"], items: ["c-01", "c-02", "c-03", "c-04", "c-05", "c-06", "c-07", "c-08"] },
];

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => (l.length ? pad + l : l))
    .join("\n");
}

/** Render one loop step block (the loop itself) as YAML text. */
function renderLoopStep(s: Shape, opts: { withChecks: boolean; parallel: Shape["parallel"] }): string {
  const lines: string[] = [];
  lines.push(`  - id: ${s.loopId}`);
  lines.push(`    type: loop`);
  lines.push(`    over: ${s.over}`);
  lines.push(`    as: ${s.as}`);
  if (opts.parallel !== undefined) lines.push(`    parallel: ${opts.parallel}`);
  lines.push(`    steps:`);
  s.subIds.forEach((subId, i) => {
    lines.push(`      - id: ${subId}`);
    lines.push(`        instruction: "${subId} for {${s.as}} (sub ${i + 1})."`);
    // hard check gate on some sub-steps when requested; always at least one soft gate.
    lines.push(`        gate:`);
    lines.push(`          - "${subId} completed for {${s.as}}"`);
    if (opts.withChecks && i % 2 === 0) {
      lines.push(`          - check: "test -n '{${s.as}}'"`);
      lines.push(`            name: ${subId}-check`);
    }
  });
  return lines.join("\n");
}

interface ShapeFull extends Shape {
  over: string;
  as: string;
}

function makeShapes(): ShapeFull[] {
  const shapes: ShapeFull[] = [];
  const rnd = rng(42);

  for (let i = 0; i < 20; i++) {
    const dom = DOMAINS[i % DOMAINS.length];
    const subCount = 1 + Math.floor(rnd() * 4); // 1–4
    const itemCount = 2 + Math.floor(rnd() * 14); // 2–15
    const parChoice = i % 4; // 0 seq(undef), 1 false, 2 true, 3 auto
    const parallel: Shape["parallel"] =
      parChoice === 0 ? undefined : parChoice === 1 ? false : parChoice === 2 ? true : "auto";
    const withChecks = i % 3 !== 0; // ~2/3 carry hard check gates
    // loop position: 0 = only step; 1 = right after a setup step; 2 = deep in flow.
    const position = i % 3;
    const loopIsOnlyStep = position === 0;

    const subIds = dom.subs.slice(0, subCount).map((s, k) => `${s}${subCount > dom.subs.length ? k : ""}`);
    // guarantee enough sub ids even if subCount > available
    while (subIds.length < subCount) subIds.push(`sub${subIds.length + 1}`);

    const items = dom.items.slice(0, itemCount);
    // diversify over/as identifiers per shape so we don't always reuse the domain default
    const over = i % 2 === 0 ? dom.over : `${dom.over}_${i}`;
    const as = i % 2 === 0 ? dom.as : `${dom.as}_${i}`;
    const loopId = `loop-${slug(dom.wf)}-${i}`;

    const s: ShapeFull = {
      name: `${dom.wf} #${i} (${subCount} sub × ${itemCount} iter, parallel=${String(parallel)}, checks=${withChecks}, pos=${["only", "after-setup", "deep"][position]})`,
      yaml: "",
      loopId,
      subIds,
      items,
      parallel,
      loopIsOnlyStep,
      over,
      as,
    };

    // Assemble surrounding steps based on position.
    const head: string[] = [
      `conductor: 1.1.0`,
      `name: ${slug(dom.wf)}-${i}`,
      `description: Smoke shape ${i} — a ${itemCount}-item loop with ${subCount} sub-steps.`,
      `inputs:`,
      `  - ${over}`,
      `steps:`,
    ];

    const stepBlocks: string[] = [];
    if (position === 1 || position === 2) {
      stepBlocks.push(
        [
          `  - id: setup`,
          `    instruction: "Prepare the run and resolve the ${over} list."`,
          `    output: ${over}`,
          `    gate:`,
          `      - "${over} resolved to a non-empty list"`,
        ].join("\n"),
      );
    }
    if (position === 2) {
      stepBlocks.push(
        [
          `  - id: warm-context`,
          `    instruction: "Read prior insights before iterating."`,
          `    requires:`,
          `      - setup`,
          `    gate:`,
          `      - "Insights ledger read"`,
        ].join("\n"),
      );
    }

    stepBlocks.push(renderLoopStep(s, { withChecks, parallel }));

    if (position === 2) {
      stepBlocks.push(
        [
          `  - id: finalize`,
          `    instruction: "Open a PR summarizing the loop's results."`,
          `    gate:`,
          `      - "PR opened"`,
        ].join("\n"),
      );
    }

    s.yaml = head.join("\n") + "\n" + stepBlocks.join("\n") + "\n";
    shapes.push(s);
  }

  return shapes;
}

// ── assertion harness ───────────────────────────────────────────────────────

class AssertError extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertError(msg);
}

function cli(args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function snapshotFrom(statusPath: string, conductorPath: string): Snapshot {
  return {
    status: JSON.parse(fs.readFileSync(statusPath, "utf8")),
    conductorYaml: fs.readFileSync(conductorPath, "utf8"),
    statusPath,
    conductorPath,
  };
}

interface Outcome {
  name: string;
  pass: boolean;
  detail: string;
}

function runShape(shape: ShapeFull): Outcome {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-smoke-"));
  try {
    const conductorDir = path.join(tmp, ".conductor");
    fs.mkdirSync(conductorDir, { recursive: true });
    const yamlPath = path.join(conductorDir, "conductor.yaml");
    const statusPath = path.join(conductorDir, "status.json");
    fs.writeFileSync(yamlPath, shape.yaml);

    // 1) validate via the REAL CLI
    const v = cli(["validate", yamlPath], tmp);
    assert(v.ok, `validate failed:\n${shape.yaml}\n--- cli output ---\n${v.out}`);

    // 2) status-init — loop step must register as type: "loop"
    // auto_improve off keeps the status focused on workflow steps for the test.
    const initYaml = shape.yaml.replace(/^description:/m, "auto_improve: false\ndescription:");
    fs.writeFileSync(yamlPath, initYaml);
    const init = cli(["status-init", yamlPath, "--path", statusPath], tmp);
    assert(init.ok, `status-init failed: ${init.out}`);
    const status0 = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const loopStatus0 = status0.steps?.[shape.loopId];
    assert(loopStatus0, `status.json has no step "${shape.loopId}"`);
    assert(
      loopStatus0.type === "loop",
      `status-init: loop step type is "${loopStatus0.type}", expected "loop"`,
    );
    assert(
      loopStatus0.iterations && typeof loopStatus0.iterations === "object",
      `status-init: loop step missing iterations map`,
    );

    // 3) loop-scope — iterations map gets EXACTLY the scoped items
    const scope = cli(["loop-scope", shape.loopId, ...shape.items, "--path", statusPath], tmp);
    assert(scope.ok, `loop-scope failed: ${scope.out}`);
    const status1 = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const loopStatus1 = status1.steps[shape.loopId];
    const scopedKeys = Object.keys(loopStatus1.iterations);
    assert(
      scopedKeys.length === shape.items.length,
      `loop-scope: ${scopedKeys.length} iterations, expected ${shape.items.length}`,
    );
    for (const item of shape.items) {
      assert(
        Object.prototype.hasOwnProperty.call(loopStatus1.iterations, item),
        `loop-scope: missing iteration "${item}"`,
      );
    }
    assert(
      loopStatus1.total === shape.items.length,
      `loop-scope: total=${loopStatus1.total}, expected ${shape.items.length}`,
    );

    // 4) buildModel (REAL parse + merge) — BoardStep must be a fully wired loop
    const model1 = buildModel(snapshotFrom(statusPath, yamlPath));
    const loopBoard = model1.steps.find((s) => s.id === shape.loopId) as BoardStep | undefined;
    assert(loopBoard, `buildModel: no BoardStep for "${shape.loopId}"`);
    assert(loopBoard.isLoop === true, `buildModel: BoardStep.isLoop !== true`);
    assert(loopBoard.loop, `buildModel: BoardStep.loop is undefined`);
    assert(
      loopBoard.loop!.total === shape.items.length,
      `buildModel: loop.total=${loopBoard.loop!.total}, expected ${shape.items.length}`,
    );
    assert(
      loopBoard.loop!.iterations.length === shape.items.length,
      `buildModel: ${loopBoard.loop!.iterations.length} iterations, expected ${shape.items.length}`,
    );
    // parallel flag survives parse
    const expectedParallel = shape.parallel === "auto" ? "auto" : shape.parallel === true;
    assert(
      loopBoard.parallel === expectedParallel,
      `buildModel: parallel=${String(loopBoard.parallel)}, expected ${String(expectedParallel)}`,
    );
    // every iteration exposes the loop's sub-step ids
    for (const item of shape.items) {
      const iter = loopBoard.loop!.iterations.find((it) => it.item === item);
      assert(iter, `buildModel: no iteration "${item}"`);
      const ids = iter!.steps.map((s) => s.id);
      assert(
        ids.length === shape.subIds.length && shape.subIds.every((id) => ids.includes(id)),
        `buildModel: iteration "${item}" sub-steps [${ids.join(",")}] != [${shape.subIds.join(",")}]`,
      );
      // before any work, every iteration is pending (not done)
      assert(!iter!.done, `buildModel: iteration "${item}" already done before work`);
    }
    assert(loopBoard.loop!.completed === 0, `buildModel: completed=${loopBoard.loop!.completed}, expected 0`);

    // 5) drive ONE iteration to done across all its sub-steps; assert columns + completed
    const target = shape.items[0];
    for (const subId of shape.subIds) {
      const r = cli(["loop", shape.loopId, target, subId, "done", "--path", statusPath], tmp);
      assert(r.ok, `loop ${target}/${subId} done failed: ${r.out}`);
    }
    const model2 = buildModel(snapshotFrom(statusPath, yamlPath));
    const loopBoard2 = model2.steps.find((s) => s.id === shape.loopId) as BoardStep;
    const doneIter = loopBoard2.loop!.iterations.find((it) => it.item === target)!;
    assert(doneIter.done === true, `after done: iteration "${target}" not marked done`);
    for (const ss of doneIter.steps) {
      assert(
        ss.status === "done",
        `after done: sub-step "${ss.id}" status=${ss.status}, expected done`,
      );
    }
    assert(
      loopBoard2.loop!.completed === 1,
      `after done: loop.completed=${loopBoard2.loop!.completed}, expected 1`,
    );
    // remaining iterations untouched (loop semantics: others not affected)
    const others = loopBoard2.loop!.iterations.filter((it) => it.item !== target);
    for (const it of others) {
      assert(!it.done, `after done: untargeted iteration "${it.item}" became done`);
    }
    // a partial iteration must NOT count as completed: drive one sub-step of a second item
    if (shape.items.length >= 2 && shape.subIds.length >= 2) {
      const partialItem = shape.items[1];
      const r = cli(["loop", shape.loopId, partialItem, shape.subIds[0], "done", "--path", statusPath], tmp);
      assert(r.ok, `loop ${partialItem}/${shape.subIds[0]} done failed: ${r.out}`);
      const model3 = buildModel(snapshotFrom(statusPath, yamlPath));
      const lb3 = model3.steps.find((s) => s.id === shape.loopId) as BoardStep;
      assert(
        lb3.loop!.completed === 1,
        `partial iteration counted: completed=${lb3.loop!.completed}, expected 1`,
      );
    }

    return { name: shape.name, pass: true, detail: `${shape.items.length} iters × ${shape.subIds.length} sub` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name: shape.name, pass: false, detail: msg.split("\n")[0] };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── runner ──────────────────────────────────────────────────────────────────

function main() {
  // sanity: the conductor YAML must parse (catch generator bugs early)
  const shapes = makeShapes();
  for (const s of shapes) {
    try {
      yaml.load(s.yaml);
    } catch (e) {
      console.error(red(`generator produced invalid YAML for ${s.name}: ${(e as Error).message}`));
      console.error(s.yaml);
      process.exit(2);
    }
  }

  console.log(bold(`\n  Loop smoke test — ${shapes.length} shapes through the real pipeline\n`));
  const results: Outcome[] = [];
  for (const s of shapes) results.push(runShape(s));

  const nameW = Math.min(72, Math.max(...results.map((r) => r.name.length)));
  for (const r of results) {
    const tag = r.pass ? green("PASS") : red("FAIL");
    console.log(`  ${tag}  ${r.name.padEnd(nameW)}  ${dim(r.detail)}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log("");
  console.log(
    `  ${bold("Summary:")} ${green(`${passed} passed`)}` +
      (failed ? `, ${red(`${failed} failed`)}` : "") +
      ` / ${results.length}`,
  );
  console.log("");
  process.exit(failed ? 1 : 0);
}

main();
