import fs from "node:fs";
import path from "node:path";
import { parseCardsJson } from "./cards.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

const SEMVER = /^\d+\.\d+\.\d+$/;

// Naming hints — pure label checks (no judgment, no skill-reading). WARNINGS only,
// never affect the exit code. Teaches the naming discipline without blocking anyone.
const SHRUG = new Set(["finish", "process", "handle", "misc", "stuff", "todo", "task", "do-stuff", "step"]);

// Folded-phase backstop (authoring-a-good-board §1). A single step whose instruction
// runs 2+ DISTINCT tool commands is a smell that two phases were bundled into one card
// (the classic "paid recon hidden inside pick-batch"). Heuristic + WARNING only — the
// authoritative check is `conductor-board coverage` against the work-unit ledger; this
// catches hand-authored conductors that never went through the bootstrap. We only count
// "does-work" runners, so trivial scaffolding (mkdir/cd/git/test/echo) never trips it.
const WORK_RUNNERS = /^(npx|node|npm|pnpm|yarn|tsx|deno|bun|python3?|ruby|go|cargo|make|\.\/)/;
const SCRIPTISH = /[\/.]|\.(ts|js|mjs|cjs|sh|py|rb)$/;
// signature → a short distinguishing label (the subcommand/script that differs between
// otherwise-identical invocations): the token right after the script path, else the 2nd token.
function commandLabel(kept) {
  const scriptIdx = kept.findIndex((t) => SCRIPTISH.test(t));
  if (scriptIdx !== -1 && kept[scriptIdx + 1]) return kept[scriptIdx + 1];
  if (scriptIdx !== -1) return kept[scriptIdx].split("/").pop();
  return kept[1] || kept[0];
}
function commandSignatures(instruction) {
  const map = new Map(); // signature → label
  for (const raw of String(instruction || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[$>]\s*/, "").replace(/\s+#.*$/, ""); // strip prompt + inline comment
    if (!WORK_RUNNERS.test(line)) continue;
    // keep meaningful tokens: drop flags (+their values), bare numbers, and <placeholder> args,
    // so `npx tsx foo.ts gate <proposalFile>` and `… faq-check <proposalFile>` differ by the
    // subcommand but `… next --count 5` and `… next --count 9` collapse to one.
    const toks = line.split(/\s+/);
    const kept = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.startsWith("-")) { if (toks[i + 1] && !toks[i + 1].startsWith("-")) i++; continue; }
      if (/^\d+$/.test(t)) continue;
      if (/^[<{].*[>}]$/.test(t)) continue; // <proposalFile>, {placeholder}
      kept.push(t);
    }
    if (kept.length) map.set(kept.join(" "), commandLabel(kept));
  }
  return [...map.values()];
}

function nameLints(steps, acc = []) {
  for (const s of steps ?? []) {
    if (!s || !s.id) continue;
    if (/^step-\d+$/i.test(s.id))
      acc.push(`step "${s.id}" still has its scaffold name — rename to a verb-object headline (e.g. claim-batch, ship-and-verify)`);
    else if (SHRUG.has(String(s.id).toLowerCase()))
      acc.push(`step "${s.id}" is vague — name the phase + its deliverable, in verb-object form`);
    if (/TODO/.test(JSON.stringify([s.instruction ?? ""])))
      acc.push(`step "${s.id}" still contains a TODO — fill it in before running`);
    const labels = commandSignatures(s.instruction);
    if (labels.length >= 2)
      acc.push(
        `step "${s.id}" bundles ${labels.length} distinct commands (${labels.map((c) => `\`${c}\``).join(", ")}) — ` +
          `if these are distinct phases, give each its own card so neither is hidden (docs/authoring-a-good-board.md §1)`,
      );
    if (s.type === "loop" && Array.isArray(s.steps)) nameLints(s.steps, acc);
  }
  return acc;
}

const EXPLICIT_GATE_FIELDS = ["gate", "gates", "command", "check", "agent", "prompt"];

function rejectExplicitGateFields(obj, label, errors) {
  for (const field of EXPLICIT_GATE_FIELDS) {
    if (obj?.[field] !== undefined) errors.push(`${label} uses removed field "${field}"`);
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
    if (!sub.title) errors.push(`Loop sub-step "${sub.id}" has no title`);
    if (!sub.instruction) errors.push(`Loop sub-step "${sub.id}" has no instruction`);
    rejectExplicitGateFields(sub, `Loop sub-step "${sub.id}"`, errors);
    if (sub.requires !== undefined && !Array.isArray(sub.requires)) {
      errors.push(`Loop sub-step "${sub.id}" has requires but it is not a list`);
    }
  }
}

/** Reachability from the first step, following flow (not requires). */
function findOrphans(steps, ids) {
  if (steps.length === 0) return [];
  const indexById = new Map(steps.map((s, i) => [s.id, i]));
  const successors = (s, i) => {
    if (s.type === "condition") return [s.if_true, s.if_false].filter(Boolean);
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
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["File is empty or not a JSON object"];

  for (const key of ["conductor", "name", "description", "steps"]) {
    if (doc[key] === undefined) errors.push(`Missing required top-level key "${key}"`);
  }
  if (doc.conductor !== undefined && !SEMVER.test(String(doc.conductor))) {
    errors.push(`"conductor" must be a semver version (e.g. 1.1.0), got "${doc.conductor}"`);
  }
  if (doc.max_attempts !== undefined) {
    const n = Number(doc.max_attempts);
    if (!Number.isInteger(n) || n < 1) errors.push(`"max_attempts" must be a positive integer`);
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

    if (s.type === "approval") errors.push(`Step "${s.id}" uses removed type "approval"`);

    if (!s.title) errors.push(`Step "${s.id}" has no title`);
    if (!s.instruction) errors.push(`Step "${s.id}" has no instruction`);
    if (!Array.isArray(s.requires)) errors.push(`Step "${s.id}" must define requires as a list (use [] for no dependencies)`);

    rejectExplicitGateFields(s, `Step "${s.id}"`, errors);

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
      if (s.parallel !== undefined && s.parallel !== true && s.parallel !== false && s.parallel !== "auto")
        errors.push(`Loop "${s.id}" has invalid "parallel" (use true, false, or auto)`);
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

  return errors;
}

function cardCoverageErrors(doc, conductorFile) {
  const cardsPath = path.join(path.dirname(conductorFile), "cards.json");
  if (!fs.existsSync(cardsPath)) return [];
  let cards;
  try {
    cards = parseCardsJson(fs.readFileSync(cardsPath, "utf8"));
  } catch (e) {
    return [`could not parse cards.json: ${e.message}`];
  }
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  const present = new Set();
  const collect = (list) => {
    for (const s of list || []) {
      if (s?.id) present.add(s.id);
      if (s?.type === "loop" && Array.isArray(s.steps)) collect(s.steps);
    }
  };
  collect(steps);
  return cards
    .filter((card) => card.id && !present.has(card.id))
    .map((card) => `cards.json card "${card.id}" is missing from conductor.json`);
}

export async function runValidate(args) {
  const fileArg = args.find((a) => !a.startsWith("-"));
  const file = path.resolve(process.cwd(), fileArg || ".conductor/conductor.json");

  if (!fs.existsSync(file)) {
    console.error(red(`✗ No conductor file at ${path.relative(process.cwd(), file)}`));
    return false;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(red(`✗ Could not parse JSON: ${e.message}`));
    return false;
  }

  const errors = [...validateConductor(doc), ...cardCoverageErrors(doc, file)];
  console.log("");
  if (errors.length === 0) {
    const steps = Array.isArray(doc.steps) ? doc.steps : [];
    const conditions = steps.filter((s) => s.type === "condition").length;
    const loops = steps.filter((s) => s.type === "loop").length;
    const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    console.log(green(`✓ ${path.basename(file)} is valid`));
    console.log(
      dim(
        `  ${part(steps.length, "step", "steps")}, ` +
          `${part(conditions, "condition", "conditions")}, ` +
          `${part(loops, "loop", "loops")}`,
      ),
    );
    const hints = nameLints(steps);
    if (hints.length) {
      console.log("");
      console.log(amber(`  ${hints.length} naming hint${hints.length === 1 ? "" : "s"} ${dim("(warnings, not errors)")}`));
      for (const h of hints) console.log(amber(`    ⚠ ${h}`));
      console.log(dim("    → what makes a board people trust: docs/authoring-a-good-board.md"));
    }
    console.log("");
    return true;
  }

  for (const e of errors) console.error(red(`✗ ${e}`));
  console.error("");
  console.error(`${errors.length} error${errors.length === 1 ? "" : "s"} found`);
  console.error("");
  return false;
}
