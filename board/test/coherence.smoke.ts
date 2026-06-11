/**
 * coherence.smoke.ts — one identity, one display scheme (offline, tsx).
 *
 *   CO1 identity helpers: displayName strips the lifecycle suffix; phaseLabel reads
 *       Compiling/Improving for lifecycle keys and the status for a run feed.
 *   CO2 header uses displayName(canonicalKey) + a phase badge — never the inner title.
 *   CO3 navigator uses the same scheme (displayName + phaseLabel).
 *   CO4 selection is sticky-by-identity + stale-excluded (a stale zombie can't win).
 *   CO5 pause is gated to the run phase and posts the CANONICAL key (not model.workflow).
 *   CO6 regression: the binding fix stays — server still namespaces variants, never
 *       un-namespaces them at the display layer.
 *
 * Run:  npx tsx test/coherence.smoke.ts    (from board/)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { displayName, lifecyclePhase, isLifecycle, phaseLabel } from "../src/lib/identity";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const src = (rel: string) => fs.readFileSync(path.join(BOARD, rel), "utf8");

let failed = 0;
const assert = (c: boolean, m: string) => {
  if (!c) { failed++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); } else { console.log(`  \x1b[32mPASS\x1b[0m  ${m}`); }
};

// CO1 — identity helpers
assert(displayName("landing-forge (compile)") === "landing-forge", "displayName strips (compile)");
assert(displayName("landing-forge (integration)") === "landing-forge", "displayName strips (integration)");
assert(displayName("landing-forge") === "landing-forge", "displayName leaves a plain key");
assert(lifecyclePhase("x (compile)") === "compile" && lifecyclePhase("x (integration)") === "integration" && lifecyclePhase("x") === null, "lifecyclePhase reads the suffix");
assert(isLifecycle("x (compile)") && !isLifecycle("landing-forge"), "isLifecycle true only for lifecycle keys");
assert(phaseLabel("x (compile)") === "Compiling", "compile → Compiling");
assert(phaseLabel("x (integration)") === "Improving", "integration → Improving");
assert(phaseLabel("landing-forge", "running") === "Running" && phaseLabel("landing-forge", "paused") === "Paused" && phaseLabel("landing-forge", "done") === "Done", "run feed → status label");

// CO2 — header: displayName + phase badge, not the inner title
const kanban = src("src/components/WorkflowKanban.tsx");
assert(/const baseName = displayName\(key\)/.test(kanban), "header derives baseName from the canonical key");
assert(/const phase = phaseLabel\(key, shownStatus\)/.test(kanban), "header derives a phase from the key");
assert(/<h2[^>]*>\{baseName\}<\/h2>/.test(kanban), "the header title renders baseName (not model.workflow)");
assert(/const key = canonicalKey \?\? model\.workflow/.test(kanban), "the canonical key is the identity (model.workflow only as a last-resort fallback)");

// CO3 — navigator: same scheme
const sidebar = src("src/components/WorkflowSidebar.tsx");
assert(/displayName\(live\.workflow\)/.test(sidebar), "navigator live entry uses displayName");
assert(/phaseLabel\(live\.workflow, live\.status\)/.test(sidebar), "navigator live entry uses phaseLabel");
assert(/displayName\(name\)/.test(sidebar), "navigator group header uses displayName");

// CO4 — selection: sticky + stale-excluded
const app = src("src/App.tsx");
const settings = src("src/components/Settings.tsx");
const settingsLib = src("src/lib/settings.ts");
assert(/stickyWfRef/.test(app) && /stickyChoice/.test(app), "activeWf has a sticky-by-identity choice");
assert(/displayName\(n\) === stickyId/.test(app), "sticky holds the same IDENTITY (advances compile→run within it)");
assert(/isFeedLive\(workflows\[n\], now\)/.test(app), "auto-selection requires a LIVE feed (stale-exclusion)");
const liveness = src("src/lib/liveness.ts");
assert(/Trust the pulse, not the flag/.test(liveness), "stale-exclusion is by recent activity, not the flag");
assert(/export function isFeedLive/.test(liveness) && /export function hasActiveDispatch/.test(liveness), "two liveness signals, one definition each");
assert(/variant === "compile" \|\| variant === "integration"/.test(liveness), "hasActiveDispatch excludes lifecycle feeds (no dispatch loop)");

// CO4b — URL as a passive shadow: mirrors the DELIBERATE selection (selectedWf), never
// the resolved activeWf; fires only when selectedWf changes; the seed resolves by identity.
assert(/\}, \[selectedWf\]\);/.test(app), "the URL effect fires on selectedWf (the deliberate ask), not activeWf");
assert(/if \(selectedWf\) url\.searchParams\.set\("wf", selectedWf\)/.test(app), "the URL mirrors selectedWf");
assert(!/searchParams\.set\("wf", activeWf\)/.test(app), "a resolved/guessed activeWf never reaches the URL");
assert(/const selectedChoice = selectedWf/.test(app) && /displayName\(n\) === displayName\(selectedWf\)/.test(app), "the ?wf seed resolves by identity (follows compile → run)");

// CO4c — a status/SSE event is never a deselection: the fresh-run-id/integration-detection
// null is gone; the selection holds its canonical identity across a run start.
assert(/A STATUS\/SSE EVENT IS NEVER A DESELECTION/.test(app), "the status-event deselection is replaced by the hold principle");
assert(!/prevLiveRunId/.test(app) && !/freshLoop/.test(app), "the fresh-run-id deselection effect is removed");
assert(/integration is a preflight overlay, not a Kanban feed/.test(app), "integration is rendered as preflight, not the central Kanban feed");
assert(/never select integration as the central board surface/.test(app), "activeWf selection excludes integration feeds");
assert(!/setSelectedWf\(null\); \/\/ unpin so the running integration feed can lead/.test(app), "relaunch no longer clears identity to let integration take over");

// CO5 — pause: run-phase only, canonical key
assert(/\{activeDispatch && \(/.test(kanban), "pause gates on the shared activeDispatch signal (hasActiveDispatch), not a bare flag");
assert(/encodeURIComponent\(key\)\}\/\$\{pauseAction\}/.test(kanban), "pause posts the canonical key, not the inner title");

// CO6 — binding fix intact (display-layer change only; server still namespaces variants)
const server = src("server/server.js");
assert(/\$\{runName\} \(\$\{variant\}\)/.test(server) || /variantName/.test(server), "server still namespaces variants <run> (compile)/(integration)");
assert(/the run owns the primary id/.test(server), "the lifecycle launch still does not squat the primary id");

// CO8 — the lifecycle sweep
// Part 1: every UI POST resolves by the canonical key, never the inner title
assert(/const postKey = canonicalKey \?\? model\.workflow/.test(kanban), "summary/start-run panels resolve by the canonical key (postKey)");
assert(!/encodeURIComponent\(model\.workflow\)/.test(kanban), "no UI request carries the inner workflow title");
// Part 4 / cold-start: surface on served with an honest "starting…" state
const compileSrc = src("cli/compile.js");
assert(/waitCompileServed/.test(compileSrc), "compile confirms its feed is served");
const runSrc = src("cli/run.js");
assert(/starting: true/.test(runSrc) && /ensureBoardVisible/.test(runSrc), "run.js opens early with the honest starting state (?starting=1)");
// the board shows "starting…" until a phase feed is live — never empty/stale
assert(/showStarting/.test(app) && /params\.get\("starting"\)/.test(app) && /StartingState/.test(app), "the board has a cold-start 'starting…' state, suppressing stale history");
assert(/function StartingState/.test(app) && /ConductorDiamondMark active/.test(app) && /delay: 0\.22/.test(app), "starting workflow screen uses a staged loading entrance");
assert(/Loading board/.test(app) && !/No workflow found/.test(app), "refresh fallback is a neutral loading state, not a false no-workflow error");
assert(/setColdStart\(false\)/.test(app) && /liveStarted \|\| preflight/.test(app), "the starting state clears the moment a live or preflight feed streams");
assert(/IntegrationPreflightState/.test(app) && /Integrating insights/.test(app), "integration gets a dedicated preflight screen");
assert(/AnimatePresence mode="wait" initial=\{false\}/.test(app) && /truncate whitespace-nowrap/.test(app), "integration subtitle swaps in a fixed one-line crossfade");
// integration gets the same served check compile and run have
const integ = src("cli/integration.js");
assert(/waitIntegrationServed/.test(integ) && /\(integration\)`\)/.test(integ), "integration now has a served check");
// Part 5: the overlay always ends on a named outcome
assert(/relaunchOutcome/.test(app) && /RelaunchOutcomeBanner/.test(app), "the overlay resolves to a named outcome banner");
assert(/"unconfirmed"/.test(app) && /halted-after-integration-failure/.test(app), "named terminals: unconfirmed + halted-after-integration-failure (no silent vanish)");

// CO9 — one view identity: local ids are never treated as global
assert(/const viewKey = viewing/.test(app) && /history:\$\{viewing\.wf\}:\$\{viewing\.runId\}/.test(app), "viewKey is defined once from (wf, runId)");
assert(/heldViewRef/.test(app) && /HOLD THE OUTGOING UNTIL THE INCOMING IS READY/.test(app), "the outgoing model is held until the incoming is ready (no flash in the gap)");
assert(/key=\{displayKey\}/.test(app) && /AnimatePresence mode="wait"/.test(app), "the main view crossfades keyed by the view identity");
assert(/viewingKey === `\$\{name\}:\$\{r\.run_id\}`/.test(sidebar), "the navigator active row compares (wf, runId), not run_id alone");
assert(/\$\{viewKey\}:workflow-card-\$\{step\.id\}/.test(kanban) && /ViewKeyContext/.test(kanban), "card layoutId is scoped by viewKey (no cross-run slide)");
assert(/setOpenCards\(new Set\(\)\);\n  \}, \[viewKey\]\)/.test(kanban), "card open state resets on viewKey change");
const monitor = src("src/components/HeartbeatMonitor.tsx");
assert(/streamIdentity/.test(monitor) && /idRef\.current !== streamIdentity/.test(monitor), "the heartbeat monitor resets its typing cache on view change");
assert(/usePageVisibility/.test(monitor) && /visibilitychange/.test(monitor), "heartbeat monitor observes tab visibility");
assert(/pageResumeAtMs/.test(monitor) && /beatMs\(b\.at\) <= pageResumeAtMs/.test(monitor), "heartbeat monitor settles pre-resume beats instead of catch-up replaying them");
assert(/currentWorkflow/.test(monitor) && /currentRunId/.test(monitor), "heartbeat clipboard digest is scoped to the displayed workflow/run");
assert(/source_run !== currentRunId/.test(monitor), "heartbeat clipboard includes insights from this run by source_run");
assert(/Copy run notes/.test(monitor), "heartbeat copy control uses compact copy");
assert(/bg-line-2\/80/.test(monitor), "heartbeat phase dividers are prominent enough to read");
assert(/-translate-y-0\.5/.test(monitor), "expanded heartbeat header heart is optically aligned with the Updates label");
assert(/<motion\.button[\s\S]*Copy run notes/.test(monitor) && /AnimatePresence mode="popLayout"/.test(monitor), "heartbeat floating controls animate layout instead of snapping");

const topBar = src("src/components/TopBar.tsx");
assert(/translate-y-px/.test(topBar), "top-bar wordmark/version are optically aligned with the diamond mark");
assert(/inline-flex h-5/.test(kanban) && /leading-none/.test(kanban), "phase/status badges use fixed-height baseline alignment");
assert(/<RunCompleteBanner[\s\S]*elapsed=\{elapsed\}/.test(app), "run-complete banner uses the shared paused-aware elapsed value");
assert(/setLeaving\(true\)/.test(kanban) && /exit=\{\{ opacity: 0, y: 10, height: 0/.test(kanban), "run-complete bar eases away on Improve & Run instead of disappearing instantly");
assert(/onOpenInsights && insightCount > 0/.test(kanban) && /key="run-insights"/.test(kanban), "run-complete insights button appears only for this-run insights and eases in when they arrive");
assert(/useLayoutMotionEnabled/.test(kanban) && /document\.visibilityState === "hidden"/.test(kanban), "card layout motion watches tab visibility");
assert(/layout=\{layoutMotion \? "position" : false\}/.test(kanban) && /layoutId=\{layoutMotion \?/.test(kanban), "card layout animation is disabled after hidden-tab catch-up");
assert(/layout=\{layoutMotion \? "position" : false\}/.test(kanban) && /min-h-\[50px\]/.test(kanban), "cards move position-only with a stable collapsed shell height");
assert(/useBoardEntrance/.test(kanban) && /entranceStyle/.test(kanban), "board refresh enters in a staged sequence");
assert(/scrollbarGutter: "stable"/.test(kanban), "board reserves the scrollbar gutter to prevent horizontal refresh nudges");

// CO10 — prewarm is default-on, user-toggleable, and flows through the one-click run path.
assert(/return v == null \? true : v !== "0"/.test(settingsLib), "prewarm setting defaults ON and persists as a local browser preference");
assert(/savePrewarmAgents/.test(settingsLib) && /cb-prewarm-agents/.test(settingsLib), "prewarm setting has stable localStorage persistence");
assert(/Pre-warm agents/.test(settings) && /onTogglePrewarmAgents/.test(settings), "settings exposes the prewarm agents toggle");
assert(!/Update interval/.test(settings) && !/Shortcuts/.test(settings), "settings menu stays clean: no cadence selector or shortcuts block");
assert(/loadPrewarmAgents/.test(app) && /savePrewarmAgents\(prewarmAgents\)/.test(app), "App loads and persists the prewarm setting");
assert(/prewarmAgents=\{prewarmAgents\}/.test(app), "App passes the prewarm preference to run controls");
assert(/Agent pre-warming turned/.test(app) && /this applies to the next run/.test(app), "prewarm toggle emits a local heartbeat explaining next-run scope");
assert(/JSON\.stringify\(\{ prewarm: prewarmAgents \}\)/.test(kanban), "run buttons POST the prewarm preference to start-run");
assert(/body\?\.prewarm === false/.test(server) && /runArgs\.push\("--no-prewarm"\)/.test(server) && /runArgs\.push\("--prewarm"\)/.test(server), "server bridges the browser prewarm preference into run args");
assert(/const prewarm = !args\.includes\("--no-prewarm"\)/.test(runSrc) && /if \(prewarm\) dispatchArgs\.push\("--prewarm"\)/.test(runSrc), "run defaults prewarm on and hands it to dispatch");

const timeline = src("src/components/HeartbeatTimeline.tsx");
assert(/text-\[12\.5px\]/.test(timeline) && /text-\[13px\]/.test(timeline), "card comments use readable text sizing");
assert(/rows=\{composer \? 2 : 2\}/.test(timeline) && /space-y-1\.5 rounded-md/.test(timeline), "card comment composer is compact, not a whitespace-heavy form");

console.log(`\n  ${failed ? `\x1b[31m${failed} failed\x1b[0m` : "\x1b[32mall passed\x1b[0m"}\n`);
process.exit(failed ? 1 : 0);
