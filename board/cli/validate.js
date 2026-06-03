import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const SEMVER = /^\d+\.\d+\.\d+$/;

function gateOk(g) {
  if (typeof g === "string") return true;
  return g && typeof g === "object" && typeof g.check === "string";
}

function countGates(steps, acc) {
  for (const s of steps) {
    for (const g of s.gate ?? []) {
      if (typeof g === "string") acc.soft++;
      else if (g && typeof g === "object" && typeof g.check === "string") acc.hard++;
    }
    if (s.type === "loop" && Array.isArray(s.steps)) countGates(s.steps, acc);
  }
}

/** Validate sub-steps of a loop; pushes errors with a prefix. */
function validateSubSteps(loop, errors) {
  const seen = new Set();
  for (const sub of loop.steps ?? []) {
    if (!sub || !sub.id) {
      errors.push(`Loop "${loop.id}" has a sub-step with no id`);
      continue;
    }
    if (seen.has(sub.id)) errors.push(`Loop "${loop.id}" has duplicate sub-step id "${sub.id}"`);
    seen.add(sub.id);
    if (!sub.instruction) errors.push(`Loop sub-step "${sub.id}" has no instruction`);
    for (const g of sub.gate ?? []) {
      if (!gateOk(g)) errors.push(`Loop sub-step "${sub.id}" has a malformed gate criterion`);
    }
  }
}

/** Reachability from the first step, following flow (not requires). */
function findOrphans(steps, ids) {
  if (steps.length === 0) return [];
  const indexById = new Map(steps.map((s, i) => [s.id, i]));
  const successors = (s, i) => {
    if (s.type === "condition") return [s.if_true, s.if_false].filter(Boolean);
    if (s.type === "approval")
      return [s.approval?.actions?.approve, s.approval?.actions?.reject].filter(Boolean);
    if (s.then) return [s.then];
    const next = steps[i + 1];
    return next ? [next.id] : [];
  };
  const reachable = new Set();
  const queue = [steps[0].id];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id) || !ids.has(id)) continue;
    reachable.add(id);
    const i = indexById.get(id);
    for (const n of successors(steps[i], i)) if (!reachable.has(n)) queue.push(n);
  }
  return steps.map((s) => s.id).filter((id) => !reachable.has(id));
}

/** Detect a cycle in the `requires` dependency graph. */
function hasRequiresCycle(steps, ids) {
  const deps = new Map(steps.map((s) => [s.id, (s.requires ?? []).filter((d) => ids.has(d))]));
  const state = new Map(); // white/gray/black
  const dfs = (id) => {
    state.set(id, "gray");
    for (const d of deps.get(id) ?? []) {
      const st = state.get(d);
      if (st === "gray") return true;
      if (st !== "black" && dfs(d)) return true;
    }
    state.set(id, "black");
    return false;
  };
  for (const s of steps) if (state.get(s.id) !== "black" && dfs(s.id)) return true;
  return false;
}

export function validateConductor(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["File is empty or not a YAML mapping"];

  for (const key of ["conductor", "name", "description", "steps"]) {
    if (doc[key] === undefined) errors.push(`Missing required top-level key "${key}"`);
  }
  if (doc.conductor !== undefined && !SEMVER.test(String(doc.conductor))) {
    errors.push(`"conductor" must be a semver version (e.g. 1.1.0), got "${doc.conductor}"`);
  }

  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  if (doc.steps !== undefined && !Array.isArray(doc.steps)) errors.push(`"steps" must be a list`);

  const ids = new Set();
  for (const s of steps) {
    if (!s || typeof s !== "object" || !s.id) {
      errors.push("A step is missing its id");
      continue;
    }
    if (ids.has(s.id)) errors.push(`Duplicate step id "${s.id}"`);
    ids.add(s.id);
  }

  for (const s of steps) {
    if (!s || !s.id) continue;
    const isCond = s.type === "condition";
    const isLoop = s.type === "loop";
    const isApproval = s.type === "approval";

    if (!isLoop && !isApproval && !s.instruction)
      errors.push(`Step "${s.id}" has no instruction`);

    if (isApproval) {
      if (!s.approval || typeof s.approval !== "object") {
        errors.push(`Approval step "${s.id}" is missing the "approval" block`);
      } else {
        const approve = s.approval.actions?.approve;
        const reject = s.approval.actions?.reject;
        if (approve && !ids.has(approve))
          errors.push(`Approval "${s.id}" references unknown step "${approve}" in actions.approve`);
        if (reject && !ids.has(reject))
          errors.push(`Approval "${s.id}" references unknown step "${reject}" in actions.reject`);
      }
    }

    for (const g of s.gate ?? []) {
      if (!gateOk(g)) errors.push(`Step "${s.id}" has a malformed gate criterion`);
    }

    if (isCond) {
      if (!s.if_true) errors.push(`Step "${s.id}" is a condition but missing if_true`);
      if (!s.if_false) errors.push(`Step "${s.id}" is a condition but missing if_false`);
    }

    if (isLoop) {
      if (!s.over) errors.push(`Loop "${s.id}" is missing "over"`);
      if (!s.as) errors.push(`Loop "${s.id}" is missing "as"`);
      if (!Array.isArray(s.steps) || s.steps.length === 0)
        errors.push(`Loop "${s.id}" has no sub-steps`);
      else validateSubSteps(s, errors);
    }

    for (const [field, val] of [
      ["if_true", s.if_true],
      ["if_false", s.if_false],
      ["then", s.then],
    ]) {
      if (val && !ids.has(val)) {
        errors.push(`Step "${s.id}" references unknown step "${val}" in ${field}`);
      }
    }
    for (const dep of s.requires ?? []) {
      if (!ids.has(dep)) errors.push(`Step "${s.id}" references unknown step "${dep}" in requires`);
    }
  }

  if (steps.length && hasRequiresCycle(steps, ids)) {
    errors.push("Circular dependency detected in requires");
  }

  for (const orphan of findOrphans(steps, ids)) {
    errors.push(`Step "${orphan}" is unreachable`);
  }

  return errors;
}

export async function runValidate(args) {
  const fileArg = args.find((a) => !a.startsWith("-"));
  const file = path.resolve(process.cwd(), fileArg || ".conductor/conductor.yaml");

  if (!fs.existsSync(file)) {
    console.error(red(`✗ No conductor file at ${path.relative(process.cwd(), file)}`));
    return false;
  }

  let doc;
  try {
    doc = yaml.load(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(red(`✗ Could not parse YAML: ${e.message}`));
    return false;
  }

  const errors = validateConductor(doc);
  console.log("");
  if (errors.length === 0) {
    const steps = Array.isArray(doc.steps) ? doc.steps : [];
    const acc = { soft: 0, hard: 0 };
    countGates(steps, acc);
    const conditions = steps.filter((s) => s.type === "condition").length;
    const loops = steps.filter((s) => s.type === "loop").length;
    const approvals = steps.filter((s) => s.type === "approval").length;
    const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    console.log(green(`✓ ${path.basename(file)} is valid`));
    console.log(
      dim(
        `  ${part(steps.length, "step", "steps")}, ` +
          `${part(acc.soft, "soft gate", "soft gates")}, ` +
          `${part(acc.hard, "hard gate", "hard gates")}, ` +
          `${part(conditions, "condition", "conditions")}, ` +
          `${part(loops, "loop", "loops")}, ` +
          `${part(approvals, "approval", "approvals")}`,
      ),
    );
    console.log("");
    return true;
  }

  for (const e of errors) console.error(red(`✗ ${e}`));
  console.error("");
  console.error(`${errors.length} error${errors.length === 1 ? "" : "s"} found`);
  console.error("");
  return false;
}
