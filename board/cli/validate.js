import fs from "node:fs";
import path from "node:path";
import { parseCardsJson } from "./cards.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

const SEMVER = /^\d+\.\d+\.\d+$/;
const EXPLICIT_GATE_FIELDS = ["gate", "gates", "command", "check", "agent", "prompt"];
const WORK_RUNNERS = /^(npx|node|npm|pnpm|yarn|tsx|deno|bun|python3?|ruby|go|cargo|make|\.\/)/;
const SCRIPTISH = /[\/.]|\.(ts|js|mjs|cjs|sh|py|rb)$/;

function rejectExplicitGateFields(obj, label, errors) {
  for (const field of EXPLICIT_GATE_FIELDS) {
    if (obj?.[field] !== undefined) errors.push(`${label} uses removed field "${field}"`);
  }
}

function commandLabel(kept) {
  const scriptIdx = kept.findIndex((t) => SCRIPTISH.test(t));
  if (scriptIdx !== -1 && kept[scriptIdx + 1]) return kept[scriptIdx + 1];
  if (scriptIdx !== -1) return kept[scriptIdx].split("/").pop();
  return kept[1] || kept[0];
}

function commandSignatures(instruction) {
  const map = new Map();
  for (const raw of String(instruction || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[$>]\s*/, "").replace(/\s+#.*$/, "");
    if (!WORK_RUNNERS.test(line)) continue;
    const toks = line.split(/\s+/);
    const kept = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.startsWith("-")) { if (toks[i + 1] && !toks[i + 1].startsWith("-")) i++; continue; }
      if (/^\d+$/.test(t)) continue;
      if (/^[<{].*[>}]$/.test(t)) continue;
      kept.push(t);
    }
    if (kept.length) map.set(kept.join(" "), commandLabel(kept));
  }
  return [...map.values()];
}

function nameLints(steps, acc = []) {
  for (const [i, s] of (steps ?? []).entries()) {
    if (!s || typeof s !== "object") continue;
    const title = s.title || `card ${i}`;
    if (/TODO/.test(JSON.stringify([s.instruction ?? ""]))) {
      acc.push(`card ${i} "${title}" still contains a TODO — fill it in before running`);
    }
    const labels = commandSignatures(s.instruction);
    if (labels.length >= 2) {
      acc.push(
        `card ${i} "${title}" bundles ${labels.length} distinct commands (${labels.map((c) => `\`${c}\``).join(", ")}) — ` +
          `if these are distinct phases, give each its own card so neither is hidden`,
      );
    }
    if (s.type === "loop" && Array.isArray(s.steps)) nameLints(s.steps, acc);
  }
  return acc;
}

function validateCardList(steps, errors, label = "Card") {
  if (!Array.isArray(steps)) return;
  const seenIds = new Map();
  for (const [i, s] of steps.entries()) {
    const cardLabel = `${label} ${i}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      errors.push(`${cardLabel} must be an object`);
      continue;
    }
    if (s.id !== undefined) {
      const prior = seenIds.get(String(s.id));
      if (prior !== undefined) errors.push(`Duplicate step id "${s.id}"`);
      else seenIds.set(String(s.id), i);
    }
    const legacy = s.id !== undefined;
    if (!legacy && !s.title) errors.push(`${cardLabel} has no title`);
    if (s.title && String(s.title).trim().length > 40) errors.push(`${cardLabel} title must be 40 characters or fewer`);
    if (!s.instruction) errors.push(`${cardLabel} has no instruction`);
    if (!legacy && !Array.isArray(s.requires)) errors.push(`${cardLabel} must define requires as a list (use [] for no dependencies)`);
    if (s.condition !== undefined) errors.push(`${cardLabel} uses removed field "condition"`);
    rejectExplicitGateFields(s, cardLabel, errors);
    const idMap = new Map(steps.map((step, idx) => [String(step?.id), idx]));
    for (const dep of s.requires ?? []) {
      const ok = Number.isInteger(dep) || (typeof dep === "string" && idMap.has(dep));
      if (!ok || (Number.isInteger(dep) && (dep < 0 || dep >= steps.length))) {
        errors.push(`${cardLabel} references unknown step "${dep}" in requires`);
      }
    }
    if (s.type === "approval") errors.push(`${cardLabel} uses removed type "approval"`);
    if (s.type === "condition") errors.push(`${cardLabel} uses removed type "condition"`);
    for (const field of ["if_true", "if_false"]) {
      if (s[field] !== undefined) errors.push(`${cardLabel} uses removed field "${field}"`);
    }
    if (s.then !== undefined) errors.push(`${cardLabel} uses removed field "then"`);
    if (s.type === "loop") {
      if (!s.over) errors.push(`${cardLabel} loop is missing "over"`);
      if (!s.as) errors.push(`${cardLabel} loop is missing "as"`);
      if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push(`${cardLabel} loop has no sub-steps`);
      else validateCardList(s.steps, errors, `${cardLabel} sub-card`);
      if (s.parallel !== undefined && s.parallel !== true && s.parallel !== false && s.parallel !== "auto")
        errors.push(`${cardLabel} loop has invalid "parallel" (use true, false, or auto)`);
    }
  }
}

function hasRequiresCycle(steps) {
  const idMap = new Map(steps.map((s, i) => [String(s?.id), i]));
  const deps = new Map(steps.map((s, i) => [i, (s.requires ?? []).map((d) => Number.isInteger(d) ? d : idMap.get(String(d))).filter((d) => Number.isInteger(d) && d >= 0 && d < steps.length)]));
  const state = new Map();
  const dfs = (id) => {
    state.set(id, "gray");
    for (const dep of deps.get(id) ?? []) {
      const st = state.get(dep);
      if (st === "gray") return true;
      if (st !== "black" && dfs(dep)) return true;
    }
    state.set(id, "black");
    return false;
  };
  for (let i = 0; i < steps.length; i++) if (state.get(i) !== "black" && dfs(i)) return true;
  return false;
}

export function validateConductor(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["File is empty or not a JSON object"];

  for (const key of ["conductor", "name", "description", "steps"]) {
    if (doc[key] === undefined) errors.push(`Missing required top-level key "${key}"`);
  }
  if (doc.conductor !== undefined && !SEMVER.test(String(doc.conductor))) {
    errors.push(`"conductor" must be a semver version (e.g. 3.0.0), got "${doc.conductor}"`);
  }
  if (doc.max_attempts !== undefined) {
    const n = Number(doc.max_attempts);
    if (!Number.isInteger(n) || n < 1) errors.push(`"max_attempts" must be a positive integer`);
  }

  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  if (doc.steps !== undefined && !Array.isArray(doc.steps)) errors.push(`"steps" must be a list`);
  validateCardList(steps, errors);
  if (steps.length && hasRequiresCycle(steps)) errors.push("Circular dependency detected in requires");

  return errors;
}

function cardCoverageErrors(doc, workflowFile) {
  const cardsPath = path.join(path.dirname(workflowFile), "cards.json");
  if (!fs.existsSync(cardsPath)) return [];
  let cards;
  try {
    cards = parseCardsJson(fs.readFileSync(cardsPath, "utf8"));
  } catch (e) {
    return [`could not parse cards.json: ${e.message}`];
  }
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  return cards.length === steps.length
    ? []
    : [`cards.json has ${cards.length} card(s), workflow.json has ${steps.length} step(s)`];
}

export async function runValidate(args) {
  const fileArg = args.find((a) => !a.startsWith("-"));
  const file = path.resolve(process.cwd(), fileArg || ".conductor/workflow.json");

  if (!fs.existsSync(file)) {
    console.error(red(`✗ No workflow file at ${path.relative(process.cwd(), file)}`));
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
    const loops = steps.filter((s) => s.type === "loop").length;
    const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    console.log(green(`✓ ${path.basename(file)} is valid`));
    console.log(dim(`  ${part(steps.length, "step", "steps")}, ${part(loops, "loop", "loops")}`));
    const hints = nameLints(steps);
    if (hints.length) {
      console.log("");
      console.log(amber(`  ${hints.length} naming hint${hints.length === 1 ? "" : "s"} ${dim("(warnings, not errors)")}`));
      for (const h of hints) console.log(amber(`    ⚠ ${h}`));
    }
    console.log("");
    return true;
  }

  for (const e of errors) console.error(red(`✗ ${e}`));
  console.error("");
  return false;
}
