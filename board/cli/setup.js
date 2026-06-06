import fs from "node:fs";
import path from "node:path";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// The self-bootstrapping conductor. Every card is checked by an independent checker against its own instruction.
export const SETUP_JSON = {
  "conductor": "3.0.0",
  "name": "conductor-board-bootstrap",
  "description": "Set up the board, convert a skill into cards, map dependencies, and execute it.",
  "inputs": [
    "skill_content"
  ],
  "steps": [
    {
      "id": "preflight",
      "instruction": "Verify the environment can run conductor-board.\nCheck that Node.js 18+ and npx are available.\n",
      "title": "Preflight",
      "requires": []
    },
    {
      "id": "start-board",
      "instruction": "Start the board server ONCE in the background and leave it running for the\nwhole run. It opens the browser automatically — do NOT pass --headless here,\nthat defeats the live view (--headless is only for CI / no-display runs).\n  npx conductor-board >/tmp/conductor-board.log 2>&1 &\nWait ~3 seconds for it to initialize. It auto-detects a free port if 3042\nis taken and records the chosen port in .conductor/server.json. Do NOT run\nthis command again later — one board per run. Re-running just reuses the\nlive server, but repeatedly launching is how you end up with stray tabs.\n",
      "requires": [
        "preflight"
      ],
      "title": "Start Board"
    },
    {
      "id": "card-design",
      "instruction": "Read the user's skill content and design ONLY the board cards:\n\n{skill_content}\n\nOutput one card for every verifiable unit of work. If a unit of work cannot be independently checked, fold it into a card that can be checked. Do not decide dependencies yet. Do not write requires, loops, parallel flags, or ordering.\n\nSave the result to .conductor/cards.json. Write a JSON array. Use EXACTLY these fields per object:\n\n  [\n    {\n      \"id\": \"research-treatment\",\n      \"title\": \"Research the treatment\",\n      \"instruction\": \"Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.\"\n    }\n  ]\n\nEvery card must have only id, title, and instruction. The instruction is the implicit checker contract: the independent checker compares the card's output to that instruction. The file must not contain gate, dependency, requires, parallel, or ordering fields.",
      "requires": [
        "start-board"
      ],
      "title": "Card Design"
    },
    {
      "id": "dependency-mapping",
      "instruction": "Read .conductor/cards.json and determine the dependency graph. Add requires for each card: [] for cards that can start immediately, or a list of card ids that must be done first. Cards whose dependencies are all satisfied can run; cards with no mutual dependencies can run in parallel.\n\nAssemble the final .conductor/conductor.json from the cards. Preserve each card's id, title, and instruction exactly unless the dependency analysis proves a card must be folded into another verifiable card. The final conductor must have no cycles and every card from cards.json must be present.",
      "requires": [
        "card-design"
      ],
      "title": "Dependency Mapping"
    },
    {
      "id": "review-board",
      "instruction": "Before executing, judge the board as a veteran flow manager would. Can you see the whole story? Is every card independently checkable? Is the grouping one altitude? Do the titles read like promises? Are the instructions concrete enough for an independent checker to compare output against them? Fix every disappointment before running.",
      "requires": [
        "dependency-mapping"
      ],
      "title": "Review Board"
    },
    {
      "id": "execute-workflow",
      "instruction": "Execute the generated conductor workflow.\nInitialize the board with: conductor-board status-init .conductor/conductor.json\nPhase 0 self-improvement is parked in v3 and off by default. If a conductor\nexplicitly sets auto_improve: true, the old improvement cards may be injected,\nbut normal runs should start the work cards directly.\nSet the top-level \"goal\" from the conductor's description, and refresh\n\"current_step_goal\" each time current_step changes.\nWalk each step in order, updating status.json after EVERY transition\n(pending -> running -> checking -> passed/failed -> done). The human is\nwatching the board to follow along — never do real work without updating the\nboard first. Doing work the board doesn't reflect (\"freeballing\") is not\nallowed: if you drift, stop, re-sync the board, restart the step cleanly, and\napologize. The board shows a red \"Freeballing?\" banner after ~3 minutes\nwithout a heartbeat. Retry on checker failure — never skip.\nNOTE: this step runs only after review-board, so the board is already one a\nflow manager would trust before any real work starts.\nAt least once per minute, append a heartbeat {at, note} to the current\nstep's heartbeat array (read prior entries first; orient against the instruction\nAND the goal; use [text](url) links for any PRs or pages you produce).\nBefore marking each step done, append a finalBeat — {at, note, finalBeat:\ntrue, handoff: {to, context, produced}} — summarizing the step and handing\noff to the next; read the previous step's finalBeat before you start one.\nFor loop steps, update \"completed\" and the \"iterations\" object as EACH\niteration finishes — don't wait until the loop ends.\nAt the START of the run, read .conductor/insights.md (if it exists) to carry\nforward what past runs learned — don't repeat insights already recorded there.\nAt run end, before setting status \"done\", write what you learned into the\nconductor's knowledge section — the conductor IS the knowledge base. Use:\n  conductor-board suggest \"title\" --scope <scope> [--step S --current X --proposed Y]\n--scope is REQUIRED (this-conductor | upstream | template | tooling | corpus).\nA repeat sighting escalates emerging -> proven (3x); proven this-conductor\ninsights auto-apply in the next run's Phase 0. Browse them on the board's\n✨ Insights page. Set the top-level status to \"done\" when the last step\ncompletes.\n",
      "requires": [
        "review-board"
      ],
      "title": "Execute Workflow"
    }
  ]
};

export async function runSetup(args) {
  const force = args.includes("--force") || args.includes("-f");
  const target = path.resolve(process.cwd(), "setup.conductor.json");

  if (fs.existsSync(target) && !force) {
    console.log("");
    console.log(dim(`  setup.conductor.json already exists (use --force to replace).`));
    console.log("");
    return true;
  }

  fs.writeFileSync(target, JSON.stringify(SETUP_JSON, null, 2) + "\n");
  console.log("");
  console.log(`${green("✓")} Wrote ${bold("setup.conductor.json")}`);
  console.log(dim("  Point your agent at it: \"Read setup.conductor.json and execute it.\""));
  console.log("");
  return true;
}
