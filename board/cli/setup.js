import fs from "node:fs";
import path from "node:path";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// The self-bootstrapping conductor. Every gate is a HARD gate — in the
// bootstrap, either it works or it doesn't, no soft judgment.
export const SETUP_YAML = `conductor: 1.0.0
name: conductor-board-bootstrap
description: Set up the board, convert a skill into a gated workflow, and execute it.

inputs:
  - skill_content

steps:
  - id: preflight
    instruction: |
      Verify the environment can run conductor-board.
      Check that Node.js 18+ and npx are available.
    gate:
      - name: "Node.js installed"
        check: "node --version"
      - name: "npx available"
        check: "npx --version"

  - id: start-board
    instruction: |
      Start the board server ONCE in the background and leave it running for the
      whole run. It opens the browser automatically — do NOT pass --headless here,
      that defeats the live view (--headless is only for CI / no-display runs).
        npx conductor-board >/tmp/conductor-board.log 2>&1 &
      Wait ~3 seconds for it to initialize. It auto-detects a free port if 3042
      is taken and records the chosen port in .conductor/server.json. Do NOT run
      this command again later — one board per run. Re-running just reuses the
      live server, but repeatedly launching is how you end up with stray tabs.
    requires: [preflight]
    gate:
      - name: "Server config file exists"
        check: "test -f .conductor/server.json"
      - name: "Server responds to health check"
        check: "curl -sf http://localhost:$(node -p \\"require('./.conductor/server.json').port\\")/health -o /dev/null"

  - id: read-skill
    instruction: |
      Read and analyze the user's skill content:

      {skill_content}

      Break it down into: the discrete sequential steps; decision points where
      the flow could branch; repeated operations that need loops; and which
      checks are verifiable by a shell command vs which need judgment.
      Save your analysis to .conductor/skill-analysis.md.
    requires: [start-board]
    gate:
      - name: "Analysis saved"
        check: "test -f .conductor/skill-analysis.md"

  - id: convert-to-conductor
    instruction: |
      Convert the analysis into a conductor YAML. Follow the format in
      spec/conductor-spec.md and the examples/ directory. Rules:
      - every step gets at least one gate criterion
      - hard gates (check:) for anything verifiable by command; soft gates for judgment
      - conditions (type: condition) where the flow branches
      - loops (type: loop) where steps repeat over a list
      - chain data between steps with output: and requires:
      Make it a board a flow manager would TRUST at a glance:
      - SURFACE EVERY WORK-UNIT as its own card — including inputs (recon / research /
        read-prior-state) and outputs (publish / link / index / notify); those are
        the phases that vanish first. Never fold a phase into another step's
        instruction; log anything deliberately skipped, never drop it silently.
      - GROUP at one altitude: one card per phase the operator would name; siblings
        comparable in size; mechanical sub-actions are beats INSIDE a card, not their
        own cards; card-count matched to the work. Repetition -> loop, decision -> fork.
      - NAME each card like a promise: imperative verb-object, honest about its real
        weight (ship-and-verify not stage; run-destructive-reset not run-script),
        brief (2-4 words), each paired with a "green means ..." done-contract. Do the
        naming as its own pass, after grouping. See docs/authoring-a-good-board.md.
      Save the conductor to .conductor/conductor.yaml.
    requires: [read-skill]
    gate:
      - name: "Conductor file created"
        check: "test -f .conductor/conductor.yaml"
      - name: "Conductor passes validation"
        check: "npx conductor-board validate .conductor/conductor.yaml"

  - id: review-board
    instruction: |
      Before executing, judge the board as a veteran FLOW MANAGER would: "If I had
      to RUN this work from this board, would I be DISAPPOINTED or FILLED WITH JOY?"
      Concretely — can I see the WHOLE story (no phase hidden; inputs + outputs both
      present)? Is the GROUPING right (one altitude, no black-box card, no noise)?
      Do the NAMES read like promises (verb-object, honest, brief, each with a "green
      means" contract)? Do I TRUST a green (the gate sits on the card it verifies)?
      Fix every "disappointed" before running — naming is its own pass, after
      grouping. (validate also prints free naming hints.) See docs/authoring-a-good-board.md.
    requires: [convert-to-conductor]
    gate:
      - name: "Conductor still valid after the review pass"
        check: "npx conductor-board validate .conductor/conductor.yaml"
      - "Judged the board as a flow manager and fixed every disappointment: every work-unit has a card or a logged exclusion, grouping is one-altitude + complexity-matched, names are honest verb-object headlines each with a green-contract, and greens are trustworthy"

  - id: execute-workflow
    instruction: |
      Execute the generated conductor workflow.
      Initialize the board with: conductor-board status-init .conductor/conductor.yaml
      This also auto-injects a Phase 0 "improvement" pass — if the conductor's
      knowledge section holds any PROVEN this-conductor insights with current/
      proposed text, apply each (rewrite the named step), then validate, before
      step 1. Structural changes (add/remove/reorder a step) wait for human
      Approve on the board. If nothing is proven, Phase 0 is empty — start the work.
      Set the top-level "goal" from the conductor's description, and refresh
      "current_step_goal" each time current_step changes.
      Walk each step in order, updating status.json after EVERY transition
      (pending -> running -> gate checking -> passed/failed -> done). The human is
      watching the board to follow along — never do real work without updating the
      board first. Doing work the board doesn't reflect ("freeballing") is not
      allowed: if you drift, stop, re-sync the board, restart the step cleanly, and
      apologize. The board shows a red "Freeballing?" banner after ~3 minutes
      without a heartbeat. Retry on gate failure — never skip.
      NOTE: this step runs only after review-board, so the board is already one a
      flow manager would trust before any real work starts.
      At least once per minute, append a heartbeat {at, note} to the current
      step's heartbeat array (read prior entries first; orient against the gate
      AND the goal; use [text](url) links for any PRs or pages you produce).
      Before marking each step done, append a finalBeat — {at, note, finalBeat:
      true, handoff: {to, context, produced}} — summarizing the step and handing
      off to the next; read the previous step's finalBeat before you start one.
      For loop steps, update "completed" and the "iterations" object as EACH
      iteration finishes — don't wait until the loop ends.
      At the START of the run, read .conductor/insights.md (if it exists) to carry
      forward what past runs learned — don't repeat insights already recorded there.
      At run end, before setting status "done", write what you learned into the
      conductor's knowledge section — the conductor IS the knowledge base. Use:
        conductor-board suggest "title" --scope <scope> [--step S --current X --proposed Y]
      --scope is REQUIRED (this-conductor | upstream | template | tooling | corpus).
      A repeat sighting escalates emerging -> proven (3x); proven this-conductor
      insights auto-apply in the next run's Phase 0. Browse them on the board's
      ✨ Insights page. Set the top-level status to "done" when the last step
      completes.
    requires: [review-board]
    gate:
      - name: "Status file exists"
        check: "test -f .conductor/status.json"
      - name: "Workflow completed successfully"
        check: "node -p \\"JSON.parse(require('fs').readFileSync('.conductor/status.json','utf8')).status\\" | grep done"
      - name: "Captured cross-cutting learnings (≥1 insight, ≥2 scopes)"
        check: "npx conductor-board knowledge --min 1 --min-scopes 2"
      - "Answered: what did I learn that does NOT fit a step of this workflow? (upstream, template, tooling, or corpus insights logged with scope tags)"
`;

export async function runSetup(args) {
  const force = args.includes("--force") || args.includes("-f");
  const target = path.resolve(process.cwd(), "setup.conductor.yaml");

  if (fs.existsSync(target) && !force) {
    console.log("");
    console.log(dim(`  setup.conductor.yaml already exists (use --force to replace).`));
    console.log("");
    return true;
  }

  fs.writeFileSync(target, SETUP_YAML);
  console.log("");
  console.log(`${green("✓")} Wrote ${bold("setup.conductor.yaml")}`);
  console.log(dim("  Point your agent at it: \"Read setup.conductor.yaml and execute it.\""));
  console.log("");
  return true;
}
