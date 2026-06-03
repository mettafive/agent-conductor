import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import yaml from "js-yaml";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

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

function discoverConductor(statusPath, explicit) {
  if (explicit) return path.resolve(process.cwd(), explicit);
  const dir = path.dirname(statusPath);
  for (const c of ["conductor.yaml", "conductor.yml"]) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  for (const c of ["conductor.yaml", "conductor.yml"]) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * conductor-board complete <step-id> [--attest-soft]
 *
 * Runs the step's HARD gates independently (the agent can't fake the result),
 * then — if all hard gates pass and soft gates are attested — marks the step done
 * with gate_detail tagging each criterion 🔒 verified (CLI ran it) or ✋ attested.
 */
export async function runComplete(args) {
  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const stepId = args.find((a) => !a.startsWith("-"));
  const attestSoft = args.includes("--attest-soft");

  if (!stepId) {
    console.error(red("usage: conductor-board complete <step-id> [--attest-soft]"));
    return false;
  }

  const conductorPath = discoverConductor(statusPath, flag(args, ["--conductor", "-c"]));
  if (!conductorPath) {
    console.error(red("✗ no conductor file found next to status.json or in cwd"));
    return false;
  }
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(conductorPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not parse conductor: ${e.message}`));
    return false;
  }
  // resolve the step — either a top-level id, or a loop sub-step "loop::iter::sub"
  const parts = stepId.split("::");
  let step;
  let loopPath = null;
  if (parts.length === 3) {
    const [loopId, iter, subId] = parts;
    const loopStep = (doc.steps || []).find((s) => s && s.id === loopId && s.type === "loop");
    if (!loopStep) {
      console.error(red(`✗ conductor has no loop "${loopId}"`));
      return false;
    }
    step = (loopStep.steps || []).find((s) => s && s.id === subId);
    if (!step) {
      console.error(red(`✗ loop "${loopId}" has no sub-step "${subId}"`));
      return false;
    }
    loopPath = { loopId, iter, subId };
  } else {
    step = (doc.steps || []).find((s) => s && s.id === stepId);
    if (!step) {
      console.error(red(`✗ conductor has no step "${stepId}"`));
      return false;
    }
  }

  const soft = [];
  const hard = [];
  for (const g of step.gate || []) {
    if (typeof g === "string") soft.push(g);
    else if (g && typeof g.check === "string") hard.push({ name: g.name, check: g.check });
    else if (g) soft.push(String(g));
  }

  console.log("");
  const detail = [];
  let allHardPass = true;

  if (hard.length) {
    console.log("  Hard gates:");
    for (const h of hard) {
      let passed = false;
      let exitCode = 1;
      try {
        execSync(h.check, { stdio: "ignore", shell: "/bin/sh" });
        passed = true;
        exitCode = 0;
      } catch (e) {
        exitCode = typeof e.status === "number" ? e.status : 1;
      }
      allHardPass = allHardPass && passed;
      console.log(
        `    ${passed ? green("🔒 ✓") : red("🔒 ✕")} ${h.name || h.check} ${dim(`(exit ${exitCode})`)}`,
      );
      detail.push({ criterion: h.check, name: h.name, kind: "hard", passed, exit_code: exitCode, verified: true });
    }
  }

  if (soft.length) {
    console.log("  Soft gates:");
    for (const s of soft) {
      const attested = attestSoft;
      console.log(`    ${attested ? amber("✋ attested") : dim("✋ not attested")}  "${s}"`);
      detail.push({ criterion: s, kind: "soft", passed: attested ? true : null, verified: false });
    }
  }

  const softOk = soft.length === 0 || attestSoft;
  const ok = allHardPass && softOk;

  console.log("");
  if (ok) {
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      let st;
      if (loopPath) {
        const lp = (status.steps[loopPath.loopId] = status.steps[loopPath.loopId] || {
          type: "loop",
          iterations: {},
        });
        lp.iterations = lp.iterations || {};
        const it = (lp.iterations[loopPath.iter] = lp.iterations[loopPath.iter] || {});
        st = it[loopPath.subId] = it[loopPath.subId] || { attempt: 1 };
      } else {
        st = status.steps[stepId] = status.steps[stepId] || { attempt: 1 };
      }
      st.status = "done";
      st.gate = "passed";
      st.gate_detail = detail;
      st.completed_at = new Date().toISOString();
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    } catch (e) {
      console.error(red(`✗ gates passed but could not update status.json: ${e.message}`));
      return false;
    }
    console.log(green(`  ✅ All gates passed. Step ${stepId} → done.`));
    console.log("");
    return true;
  }

  if (!allHardPass) console.log(red("  ✕ Hard gate(s) failed — fix and retry. Step not advanced."));
  else console.log(amber("  ✋ Soft gates not attested — re-run with --attest-soft once you've verified them."));
  console.log("");
  return false;
}
