import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function flag(args, names) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) {
      const v = args[i + 1];
      return v && !v.startsWith("-") ? v : true;
    }
  }
  return undefined;
}

function cliPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/cli.js");
}

function run(args, cwd) {
  const r = spawnSync("node", [cliPath(), ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function fail(step, result) {
  console.error(red(`✗ test failed during ${step}`));
  if (result?.out) console.error(result.out.trim());
  return false;
}

function conductorFromCards(cards) {
  return {
    conductor: "3.0.0",
    name: "skill-test",
    description: "Temporary structural test generated from a skill.",
    max_attempts: 5,
    steps: cards.map((card, i) => ({
      ...card,
      requires: i === 0 ? [] : [i - 1],
    })),
  };
}

export async function runTest(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board test --skill <path>\n\n" +
        "  Runs a clean structural end-to-end test in /tmp: decompose, linear\n" +
        "  conductor generation, validate, status-init, check, gate-result, complete.",
    );
    return true;
  }

  const skill = flag(args, ["--skill", "-s"]);
  if (typeof skill !== "string") {
    console.error(red("usage: conductor-board test --skill <path>"));
    return false;
  }

  const skillPath = path.resolve(process.cwd(), skill);
  if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) {
    console.error(red(`✗ skill file not found: ${path.relative(process.cwd(), skillPath)}`));
    return false;
  }

  const tmp = fs.mkdtempSync(path.join("/tmp", `conductor-test-${Date.now()}-`));
  try {
    fs.mkdirSync(path.join(tmp, ".conductor", "artifacts"), { recursive: true });
    const localSkill = path.join(tmp, "SKILL.md");
    fs.copyFileSync(skillPath, localSkill);

    let r = run(["decompose", "--skill", "SKILL.md"], tmp);
    if (r.code !== 0) return fail("decompose", r);

    const cards = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "cards.json"), "utf8"));
    fs.writeFileSync(path.join(tmp, ".conductor", "workflow.json"), JSON.stringify(conductorFromCards(cards), null, 2));

    r = run(["validate", ".conductor/workflow.json"], tmp);
    if (r.code !== 0) return fail("validate", r);

    r = run(["status-init", ".conductor/workflow.json"], tmp);
    if (r.code !== 0) return fail("status-init", r);

    let completed = 0;
    for (const [i, card] of cards.entries()) {
      const key = String(i);
      r = run(["step", key, "running", "--headless"], tmp);
      if (r.code !== 0) return fail(`step ${key}`, r);

      const outputFile = path.join(tmp, ".conductor", "artifacts", `${key}.md`);
      fs.writeFileSync(outputFile, `# ${card.title}\n\nStructural test output for: ${card.instruction}\n`);

      r = run(["check", key], tmp);
      if (r.code !== 0) return fail(`check ${key}`, r);

      r = run(["gate-result", key, "--passed", "--evidence", "PASS structural test output recorded"], tmp);
      if (r.code !== 0) return fail(`gate-result ${key}`, r);

      r = run(["complete", key], tmp);
      if (r.code !== 0) return fail(`complete ${key}`, r);
      completed++;
    }

    const status = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "status.json"), "utf8"));
    console.log("");
    console.log(green("✓ conductor structural test passed"));
    console.log(dim(`  temp: ${tmp}`));
    console.log(`cards_created: ${cards.length}`);
    console.log(`cards_completed: ${completed}`);
    console.log(`run_status: ${status.status}`);
    console.log("");
    return status.status === "done" && completed === cards.length;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
