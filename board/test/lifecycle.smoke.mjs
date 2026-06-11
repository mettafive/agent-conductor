/**
 * lifecycle.smoke.mjs — product lifecycle guardrails for the board surface.
 *
 * This is a source-level smoke: it verifies the intended wiring without making
 * model calls. The deterministic execution paths are covered by run/integration
 * smokes; this file locks the visual/lifecycle contract:
 *   L1 fresh skill: board opens before migration/compose work starts.
 *   L2 insight run: integration is shown as a minimal preflight screen.
 *   L3 handoff: integration never takes over the Kanban; run feed fades in.
 *   L4 receipt paths: runtime normalizes legacy flat artifact paths to scoped paths.
 *   L5 handoff beat: run emits a user-visible beat before dispatching work.
 *   L10 fast integration: done preflight dwells long enough to be seen.
 *   L11 setup prewarm: compile warms map/validate and the first work card.
 *   L12 live terminal scope + synced active LEDs.
 *   L13 integration prewarm: final-card window warms the integration composer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const src = (rel) => fs.readFileSync(path.join(BOARD, rel), "utf8");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const before = (text, a, b, msg) => {
  const ai = text.indexOf(a);
  const bi = text.indexOf(b);
  assert(ai !== -1, `missing ${a}`);
  assert(bi !== -1, `missing ${b}`);
  assert(ai < bi, msg);
};

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("L1 fresh skill: visible board is opened before compile/migration work", () => {
  const run = src("cli/run.js");
  before(
    run,
    "ensureBoardVisible(statusPath, { headless, port, starting: true })",
    "const ok = await runCompile(compileArgs)",
    "run must surface the board before invoking compile",
  );
  assert(/compileArgs\.push\("--no-open"\)/.test(run), "run-owned compile must not open a second board tab");

  const compile = src("cli/compile.js");
  before(
    compile,
    "compileBoard = await initCompileBoard",
    "result = await compileSkill",
    "standalone compile must initialize/serve/open the compile board before composing cards",
  );
  assert(/openBoard = !args\.includes\("--headless"\) && !args\.includes\("--no-open"\)/.test(compile), "standalone compile opens unless headless/no-open");
  assert(/url\.searchParams\.set\("starting", "1"\)/.test(compile), "standalone compile opens the shared starting surface");
  assert(/waitCompileServed\(port, key\)/.test(compile), "compile waits until the compile feed is served/renderable");

  const initBoard = src("cli/init-board.js");
  assert(/u\.searchParams\.set\("wf", path\.basename\(path\.dirname\(path\.resolve\(statusPath\)\)\)\)/.test(initBoard), "starting URLs seed the target workflow identity");
  const app = src("src/App.tsx");
  assert(/waitingForSelectedSeed/.test(app), "starting view holds for the requested workflow until its feed is discovered");
  assert(/activeWf =\s*waitingForSelectedSeed\s*\?\s*null/s.test(app), "old workflows cannot auto-select during a targeted cold start");
  assert(!/order\.find\(\(n\) => isRunFeed\(n\)\) \?\?/.test(app), "bare routes must not auto-select arbitrary idle run feeds");
  assert(!/order\.find\(\(n\) => isCompileFeed\(n\)\) \?\?/.test(app), "bare routes must not auto-select arbitrary idle compile feeds");
});

test("L2 insights: integration renders as a minimal preflight screen", () => {
  const app = src("src/App.tsx");
  assert(/IntegrationPreflightState/.test(app), "app must include a dedicated integration preflight screen");
  assert(/Integrating insights/.test(app), "preflight screen names the integration phase plainly");
  assert(/Improving/.test(app) && /inline-flex h-5 items-center/.test(app), "integration phase chip is user-facing and vertically centered");
  assert(!/step\.heartbeat\.map/.test(app), "preflight screen does not duplicate heartbeat notes from integration status");
  assert(!/notes\.map\(\(n, i\)/.test(app), "preflight screen stays minimal; detailed beats live in the terminal");
  assert(!/parseAppliedInsights/.test(app), "preflight screen does not duplicate the applied-insights heartbeat");
  assert(!/Applied insights/.test(app), "applied insight details live in the heartbeat stream, not a redundant preflight block");
  assert(/active=\{activePhase\}/.test(app), "integration diamond pulses while the preflight is active");
  assert(/motion\.h1/.test(app), "integration title has active progress animation");
  assert(/batchActive = activePhase && !failed/.test(app), "batched integration pulses every preflight row while insight work is active");
  assert(/stepDone \? "Valid"/.test(app), "preflight rows turn green only after the integration/check step is valid");
  assert(/duration: 1\.45/.test(app), "integration text and row pulses share the diamond's calm cadence");
  assert(/showStarting = coldStart && \(waitingForSelectedSeed \|\| !liveStarted\) && !preflight/.test(app), "starting screen yields to preflight as soon as integration is served");
  assert(/ConductorDiamondMark/.test(app), "startup/preflight/waiting screens use the same diamond mark as the top bar");
  assert(!/src="\.\/conductor\.svg"/.test(app), "startup/preflight/waiting screens must not use the old graph logo");

  const server = src("server/server.js");
  assert(/clean\.startsWith\(`\$\{rootName\}\/`\)/.test(server), "artifact API accepts legacy artifacts/foo.md paths when rooted at artifacts/");
});

test("L3 handoff: integration never becomes the central Kanban; run feed takes over", () => {
  const app = src("src/App.tsx");
  assert(/never select integration as the central board surface/.test(app), "activeWf selection must exclude integration");
  assert(/isCompileFeed\(n\)/.test(app), "compile may be selected as setup board before first run");
  assert(/isIntegrationFeed\(n\)/.test(app), "integration is detected separately");
  assert(/preflight:\$\{preflight\.key\}/.test(app), "preflight has its own view identity");
  assert(/preflight \? \(/.test(app) && /<IntegrationPreflightState/.test(app), "main content renders preflight instead of Kanban while integrating");
  assert(/statusOf\(workflows\[n\]\) === "done" &&/.test(app), "completed integration preflight must remain eligible");
  assert(/runFeedHasTakenOverAfterIntegration/.test(app), "completed integration must know when the regular run has claimed the surface");
  assert(/!runFeedHasTakenOverAfterIntegration\(workflows\[n\]\) \|\| integrationDoneStillDwelling/.test(app), "done integration should not reclaim the board after the work run starts");
  assert(/freshRunLive/.test(app) && /rid !== relaunch\.fromRunId/.test(app), "handoff waits for a new run feed before declaring the work run live");
  assert(/AnimatePresence mode="wait"/.test(app) && /key=\{displayKey\}/.test(app), "preflight to run uses the existing eased main-view transition");
  assert(/initial=\{\{ opacity: 0, y: reduceMotion \? 0 : 10, scale: reduceMotion \? 1 : 0\.992 \}\}/.test(app), "incoming lifecycle views ease in, not snap");
  assert(/exit=\{\{ opacity: 0, y: reduceMotion \? 0 : -10, scale: reduceMotion \? 1 : 0\.992 \}\}/.test(app), "outgoing lifecycle views ease out, not snap");
  assert(/!preflight &&/.test(app), "completion/terminal UI is suppressed during preflight");

  const kanban = src("src/components/WorkflowKanban.tsx");
  assert(/min-h-\[116px\]/.test(kanban), "settled/live header reserves stable height while controls appear");
  assert(/min-w-\[148px\]/.test(kanban), "header action area reserves width before Summary/Board controls render");
  assert(/min-h-\[150px\]/.test(kanban), "lifecycle summary panels reserve height before async summaries arrive");
});

test("L10 fast integration: done preflight dwells before run handoff", () => {
  const app = src("src/App.tsx");
  assert(/INTEGRATION_DONE_DWELL_MS = 2500/.test(app), "fast integration should have a perceptible completion dwell");
  assert(/function latestLifecycleMs/.test(app), "integration dwell must be based on persisted lifecycle timestamps");
  assert(/function startedLifecycleMs/.test(app), "run takeover must compare the run start to integration completion");
  assert(/function hasWorkflowSteps/.test(app), "run takeover must require real workflow steps, not just a stale identity");
  assert(/integrationDoneStillDwelling/.test(app), "app must keep recently completed integration eligible for preflight");
  assert(/runStarted >= integrationEnded/.test(app), "a run that started after integration owns the surface from then on");
  assert(/!runFeedHasTakenOverAfterIntegration\(workflows\[n\]\) \|\| integrationDoneStillDwelling/.test(app), "done integration should dwell only until the regular run takes over");
});

test("L11 setup prewarm warms map/validate and first work card", () => {
  const compile = src("cli/compile.js");
  assert(/createCompilePrewarmer/.test(compile), "compile owns setup-phase prewarm probes");
  assert(/compilePrewarmPrompt/.test(compile), "compile has a no-work setup prewarm prompt");
  assert(/firstCardPrewarmPrompt/.test(compile), "compile has a no-work first-card prewarm prompt");
  assert(/prewarmer\.launch\("map-dependencies"/.test(compile), "compile warms Map Dependencies while Create Cards runs");
  assert(/prewarmer\.launch\("validate-workflow"/.test(compile), "compile warms Validate Workflow while Map Dependencies runs");
  assert(/prewarmer\.launch\("first-work-card"/.test(compile), "compile warms the first real work card before dispatch");
  assert(/prewarmer\.cancelAll\(\)/.test(compile), "compile cleanup cancels warm probes on failure/throw");
  assert(/prewarm: !args\.includes\("--no-prewarm"\) && process\.env\.CONDUCTOR_PREWARM !== "0"/.test(compile), "compile prewarm is default-on and can be disabled");

  const run = src("cli/run.js");
  assert(/if \(!prewarm\) compileArgs\.push\("--no-prewarm"\)/.test(run), "run --no-prewarm disables compile prewarm too");
});

test("L12 terminal follows the visible workflow and active LEDs pulse together", () => {
  const app = src("src/App.tsx");
  assert(/const streamOrder = useMemo/.test(app), "app computes a visible-workflow heartbeat stream");
  assert(/preflight \? \[preflight\.key\] : activeWf \? \[activeWf\] : \[\]/.test(app), "heartbeat terminal scopes to preflight or active workflow only");
  assert(/useHeartbeatStream\(streamWorkflows, streamOrder\)/.test(app), "heartbeat stream must not flatten every discovered workflow");

  const led = src("src/components/Led.tsx");
  assert(/Date\.now\(\) % syncMs/.test(led), "active LEDs join the shared animation phase on mount");
  assert(/animationDelay/.test(led), "active LED animation delay is set from the shared phase");
  const css = src("src/index.css");
  assert(/\.led-running[\s\S]*animation: led-running 1\.9s/.test(css), "running LED uses the shared cadence");
  assert(/\.led-gate[\s\S]*animation: led-gate 1\.9s/.test(css), "checking LED uses the shared cadence");
});

test("L13 final card warms the integration composer for the next loop", () => {
  const dispatch = src("cli/dispatch.js");
  assert(/integrationPrewarmPrompt/.test(dispatch), "dispatcher has a no-work integration prewarm prompt");
  assert(/launchIntegrationPrewarm/.test(dispatch), "dispatcher can launch an integration composer prewarm probe");
  assert(/CONDUCTOR_DECOMPOSE_ROLE: "integration-prewarm"/.test(dispatch), "integration prewarm is tagged as composer prewarm, not card work");
  assert(/nonTerminal\.length !== 1/.test(dispatch), "integration prewarm only considers the final non-terminal card window");
  assert(/entry\?\.status === "running" \|\| entry\?\.gate === "checking"/.test(dispatch), "integration prewarm starts only while the final card is actively running/checking");
  assert(/killGroup\(integrationPrewarm\.pgid\)/.test(dispatch), "integration prewarm is cleaned up with speculative workers");
});

test("L4 receipt paths: cached workflows are normalized before dispatch", () => {
  const run = src("cli/run.js");
  const normalize = src("cli/workflow-normalize.js");
  before(
    run,
    "normalizeWorkflowReceiptInstructions({ workflowPath, statusPath })",
    "doc = readJson(workflowPath)",
    "run must normalize cached/fresh workflow instructions before loading doc for dispatch",
  );
  assert(/LEGACY_RECEIPT_RE/.test(normalize), "normalizer must detect legacy .conductor/artifacts receipt paths");
  assert(/artifactsDir\(statusPath\)/.test(normalize), "normalizer must rewrite to the scoped artifact directory paired with status.json");

  const decompose = src("cli/decompose.js");
  assert(!/Every card instruction must require one primary markdown receipt at\n`\.conductor\/artifacts/.test(decompose), "composer must not teach flat .conductor/artifacts as the receipt authority");
  assert(/receipt path assigned by the conductor-board worker brief/.test(decompose), "composer/checker prompt must make the runtime-assigned path authoritative");
  assert(/Do not invent,\npredict, or name the receipt file/.test(decompose), "composer must forbid guessed receipt names");
  assert(/a card invents, predicts, or names a receipt file/.test(decompose), "checker must reject guessed receipt names");
});

test("L5 handoff beat: run announces the move from setup to dispatch", () => {
  const run = src("cli/run.js");
  before(
    run,
    "Workflow accepted — regular run is ready",
    "return await runDispatch(dispatchArgs)",
    "run must append the transition heartbeat before dispatch starts",
  );
  assert(/run_handoff_announced/.test(run), "handoff heartbeat should be idempotent per run");
  assert(/Dispatching is starting now/.test(run), "handoff heartbeat should end by naming dispatch startup");
  assert(/appendAutoHeartbeat/.test(run) && /mutateStatus/.test(run), "handoff heartbeat must use the locked status write path");
});

test("L6 board claim: attach updates active workflow metadata", () => {
  const init = src("cli/init-board.js");
  assert(/function claimActiveBoard/.test(init), "init-board must have a board active-claim helper");
  assert(/active_workflow/.test(init) && /active_status_path/.test(init), "server.json must record the active workflow/status path");
  before(
    init,
    "const health = await waitForWorkflow",
    "return { ok: true",
    "openRunBoard must claim the active board after the served baton",
  );
});

test("L7 worker brief: receipt handoff moves promptly into checking", () => {
  const runCard = src("cli/run-card.js");
  assert(/Once the\n   receipt is written, do not keep polishing/.test(runCard), "worker brief must stop post-receipt polishing");
  assert(/The conductor's checker is the authoritative\n   review/.test(runCard), "worker brief must make the gate the authoritative review");
});

test("L8 learning helpers: codex calls are async and killable", () => {
  const decompose = src("cli/decompose.js");
  assert(/CONDUCTOR_CODEX_EXEC_TIMEOUT_MS/.test(decompose), "codex exec must have an explicit hard timeout");
  assert(/process\.kill\(-child\.pid, "SIGTERM"\)/.test(decompose), "codex exec timeout must kill the process group");
  assert(/role === "post-card-learning" \? 45000/.test(decompose), "post-card learning must have a short hard timeout");
});

test("L9 complete banner: archived snapshots still reflect open insights", () => {
  const server = src("server/server.js");
  const app = src("src/App.tsx");
  const kanban = src("src/components/WorkflowKanban.tsx");
  assert(/knowledgeJson: snapshot\.knowledgeJson/.test(server), "history archive must preserve knowledgeJson");
  assert(/knowledgeOverride=\{!viewing \? liveModel\.knowledge : undefined\}/.test(app), "live complete banner must use current knowledge");
  assert(/knowledgeOverride \?\? model\.knowledge/.test(kanban), "complete banner must prefer knowledge override for Improve & Run label");
});

let passed = 0, failed = 0;
console.log(`\n  ${bold(`lifecycle.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
