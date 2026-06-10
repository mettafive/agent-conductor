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
assert(/stickyWfRef/.test(app) && /stickyChoice/.test(app), "activeWf has a sticky-by-identity choice");
assert(/displayName\(n\) === stickyId/.test(app), "sticky holds the same IDENTITY (advances compile→run within it)");
assert(/isLiveFeed\(workflows\[n\], now\)/.test(app), "auto-selection requires a LIVE feed (stale-exclusion)");
assert(/Trust the pulse, not the flag/.test(app), "stale-exclusion is by recent activity, not the flag");

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
assert(/setSelectedWf\(null\); \/\/ unpin so the running integration feed can lead/.test(app), "only the user-initiated relaunch still unpins (deliberate, in scope)");

// CO5 — pause: run-phase only, canonical key
assert(/!isLifecycle\(key\)/.test(kanban), "pause is hidden for lifecycle feeds (no dispatch to drain)");
assert(/encodeURIComponent\(key\)\}\/\$\{action\}/.test(kanban), "pause posts the canonical key, not the inner title");

// CO6 — binding fix intact (display-layer change only; server still namespaces variants)
const server = src("server/server.js");
assert(/\$\{runName\} \(\$\{variant\}\)/.test(server) || /variantName/.test(server), "server still namespaces variants <run> (compile)/(integration)");
assert(/the run owns the primary id/.test(server), "the lifecycle launch still does not squat the primary id");

console.log(`\n  ${failed ? `\x1b[31m${failed} failed\x1b[0m` : "\x1b[32mall passed\x1b[0m"}\n`);
process.exit(failed ? 1 : 0);
