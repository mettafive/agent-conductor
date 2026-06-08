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

function buildJson({ name, description, steps }) {
  const doc = {
    conductor: "3.0.0",
    name,
    description,
    max_attempts: 5,
    steps: [],
  };
  for (let i = 1; i <= steps; i++) {
    doc.steps.push({
      title: `Step ${i}`,
      instruction: "TODO: what this phase does (include its real weight / risk).",
      requires: i > 1 ? [i - 2] : [],
    });
  }
  return JSON.stringify(doc, null, 2) + "\n";
}

export async function runInit(args) {
  const force = flag(args, ["--force", "-f"]) === true;
  const dir = path.resolve(process.cwd(), String(flag(args, ["--dir"]) ?? ".conductor"));
  const target = path.join(dir, "workflow.json");

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
      description = (await rl.question("? Description: ")).trim() || "An independently checked agent workflow.";
      stepsRaw = (await rl.question("? How many steps? ")).trim() || "3";
    } finally {
      rl.close();
    }
  }

  name = String(name || "my-workflow").trim();
  description = String(description ?? "An independently checked agent workflow.").trim();
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
  fs.writeFileSync(target, buildJson({ name, description, steps }));

  const rel = path.relative(process.cwd(), target) || target;
  console.log("");
  console.log(`${green("✓")} Created ${bold(rel)} with ${steps} step${steps === 1 ? "" : "s"}.`);
  console.log(dim("  Edit the steps, then run: ") + "conductor-board");
  console.log(dim("  What makes a board people trust: ") + "docs/authoring-a-good-board.md");
  console.log("");
  return true;
}
