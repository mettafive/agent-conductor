import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function flag(args, names) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i !== -1) {
      const next = args[i + 1];
      return next && !next.startsWith("-") ? next : true;
    }
  }
  return undefined;
}

function buildYaml({ name, description, steps }) {
  const lines = [
    "# A good board shows EVERY phase the skill does — including the easily-dropped",
    "# ends: inputs (recon / research / read-prior-state) and outputs (publish / link",
    "# / index / notify). Group at one altitude; name each card like a promise:",
    "# verb-object, honest, brief — with a \"green means …\" contract. (Naming is its",
    "# own pass, after grouping.)  →  docs/authoring-a-good-board.md",
    "conductor: 1.0.0",
    `name: ${name}`,
    `description: ${description}`,
    "",
    "steps:",
  ];
  for (let i = 1; i <= steps; i++) {
    if (i === 1)
      lines.push(`  # ↳ rename step-${i} to a verb-object headline a manager reads at a glance (e.g. claim-batch, ship-and-verify)`);
    lines.push(`  - id: step-${i}`);
    lines.push("    instruction: |");
    lines.push("      TODO: what this phase does (include its real weight / risk).");
    if (i > 1) lines.push(`    requires: [step-${i - 1}]`);
    lines.push("    gate:");
    lines.push('      - "green: TODO — what a green card here proves"');
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

export async function runInit(args) {
  const force = flag(args, ["--force", "-f"]) === true;
  const dir = path.resolve(process.cwd(), String(flag(args, ["--dir"]) ?? ".conductor"));
  const target = path.join(dir, "conductor.yaml");

  let name = flag(args, ["--name", "-n"]);
  let description = flag(args, ["--description", "-d"]);
  let stepsRaw = flag(args, ["--steps", "-s"]);

  // interactive unless a name was passed
  const interactive = name === undefined;
  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log("");
      name = (await rl.question("? Workflow name: ")).trim() || "my-workflow";
      description = (await rl.question("? Description: ")).trim() || "A gated agent workflow.";
      stepsRaw = (await rl.question("? How many steps? ")).trim() || "3";
    } finally {
      rl.close();
    }
  }

  name = String(name || "my-workflow").trim();
  description = String(description ?? "A gated agent workflow.").trim();
  let steps = parseInt(String(stepsRaw ?? "3"), 10);
  if (!Number.isFinite(steps) || steps < 1) steps = 3;
  steps = Math.min(steps, 50);

  if (fs.existsSync(target) && !force) {
    console.error("");
    console.error(red(`✗ ${path.relative(process.cwd(), target)} already exists.`));
    console.error(dim("  Use --force to overwrite it."));
    console.error("");
    return false;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, buildYaml({ name, description, steps }));

  const rel = path.relative(process.cwd(), target) || target;
  console.log("");
  console.log(`${green("✓")} Created ${bold(rel)} with ${steps} step${steps === 1 ? "" : "s"}.`);
  console.log(dim("  Edit the steps, then run: ") + "conductor-board");
  console.log(dim("  What makes a board people trust: ") + "docs/authoring-a-good-board.md");
  console.log("");
  return true;
}
