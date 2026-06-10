import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeAndCheckSkill, compact, flag } from "./decompose.js";
import { ensureBoard, getHealth } from "./ensure-board.js";
import {
  ensureKnowledge,
  migrationMetaPathForRoot,
  scopedConductorDir,
} from "./learning.js";
import { orderAndCheckCards } from "./order.js";
import { validateConductor } from "./validate.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const DEFAULT_MODEL = process.env.CONDUCTOR_DECOMPOSE_MODEL || process.env.OPENAI_MODEL || "gpt-5";
const COMPILER_VERSION = "compile-v3:instruction-situational-cards:numbered-dependency-rules:feedback-heartbeats";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function compileWorkflow(name = "Migrating skill to conductor") {
  return {
    conductor: "3.0.0",
    name,
    description: "First-run skill migration: create cards, map dependencies, and validate the workflow.",
    max_attempts: 5,
    steps: [
      {
        title: "Create Cards",
        instruction: "Read the skill and compose concrete Conductor cards. Record every composer/checker attempt, card count, locked passed cards, and repair feedback.",
        requires: [],
      },
      {
        title: "Map Dependencies",
        instruction: "Add requires arrays to the accepted cards. Record every dependency composer/checker attempt, dependency count, and repair feedback.",
        requires: [0],
      },
      {
        title: "Validate Workflow",
        instruction: "Validate the generated workflow JSON and save accepted cards/workflow artifacts for execution.",
        requires: [1],
      },
    ],
  };
}

function loadStatus(statusPath) {
  return readJsonMaybe(statusPath) || {};
}

function saveStatus(statusPath, status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function statusStep(status, step) {
  status.steps = status.steps && typeof status.steps === "object" ? status.steps : {};
  status.steps[String(step)] = status.steps[String(step)] || { status: "pending", gate: "pending", attempt: 1 };
  return status.steps[String(step)];
}

function updateCompileStatus(statusPath, step, event, { note, done = false, failed = false, checking = false, tone } = {}) {
  const status = loadStatus(statusPath);
  status.status = failed ? "failed" : done && step === 2 ? "done" : "running";
  status.current_step = done ? null : String(step);
  const cell = statusStep(status, step);
  if (!cell.started_at) cell.started_at = nowIso();
  cell.status = failed ? "failed" : done ? "done" : "running";
  cell.gate = failed ? "failed" : done ? "passed" : checking ? "checking" : "pending";
  cell.heartbeat = Array.isArray(cell.heartbeat) ? cell.heartbeat : [];
  if (note) {
    const normalizedTone =
      tone || (/^(Create cards feedback|Map dependencies feedback|Auditing dependency graph: failed)/i.test(note)
        ? "feedback"
        : undefined);
    cell.heartbeat.push({ at: nowIso(), note, ...(normalizedTone ? { tone: normalizedTone } : {}) });
  }
  if (done || failed) cell.completed_at = nowIso();
  if (status.status === "done" || status.status === "failed") status.completed_at = nowIso();
  saveStatus(statusPath, status);
}

function attachCompileArtifact(statusPath, step, relPath) {
  if (!statusPath || !relPath) return;
  const status = loadStatus(statusPath);
  const cell = statusStep(status, step);
  cell.artifact = relPath;
  cell.receipt = relPath;
  cell.artifacts = [...new Set([relPath, ...(Array.isArray(cell.artifacts) ? cell.artifacts : [])])];
  saveStatus(statusPath, status);
}

function writeCompileArtifact(statusPath, name, body) {
  const dir = path.join(path.dirname(statusPath), "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  const rel = `${name}.md`;
  fs.writeFileSync(path.join(dir, rel), body);
  return rel;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function acquireCompileLock(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const lockPath = path.join(outDir, "compile.lock.json");
  try {
    const lock = readJson(lockPath);
    if (lock?.pid && pidAlive(lock.pid)) {
      throw new Error(
        `compile already running for ${outDir} (pid ${lock.pid}). Stop it or wait for it to finish before starting another compile.`,
      );
    }
  } catch (e) {
    if (e.message?.startsWith("compile already running")) throw e;
    /* missing/corrupt/stale lock: replace it */
  }
  writeJson(lockPath, {
    pid: process.pid,
    started_at: nowIso(),
  });
  return () => {
    try {
      const lock = readJson(lockPath);
      if (lock?.pid === process.pid) fs.unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
}

async function initCompileBoard(outDir, name, port) {
  // The compile workflow/status files still live in the skill-scoped outDir so
  // progress notes have somewhere to write — but we do NOT start a board keyed
  // to that subdir. PHASE A: identity = port. We attach to the canonical board
  // on the main port (ensureBoard spawns one only if nothing is live there),
  // never SIGTERM-and-respawn the main board.
  const workflowPath = path.join(outDir, "compile.workflow.json");
  const statusPath = path.join(outDir, "compile.status.json");
  writeJson(workflowPath, compileWorkflow(name));
  await ensureBoard(port, { statusPath, workflowPath });
  // BATON A — confirm SERVED, not just healthy. The compile feed is ready only when it's
  // discovered + renderable. We confirm it (the run's early ?starting=1 open is what
  // surfaces the tab; the board swaps "starting…" → compile cards once this feed is live).
  // The feed's canonical key is the namespaced compile variant (the 3.3.5 binding); during
  // compile the dir name is the base, so it reads "<dir> (compile)".
  const served = await waitCompileServed(port, `${path.basename(outDir)} (compile)`);
  return { workflowPath, statusPath, served };
}

// Poll /health until THIS compile feed is served (discovered). Bounded; returns
// whether it was confirmed in time (the board re-discovers per request).
async function waitCompileServed(port, key, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await getHealth(port);
    if (h?.workflows && Object.prototype.hasOwnProperty.call(h.workflows, key)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function progressNote(evt) {
  const label = `${evt.attempt}/${evt.maxAttempts}`;
  if (evt.phase === "cards") {
    if (evt.event === "compose-start") return `Creating cards: composer attempt ${label} started.`;
    if (evt.event === "compose-end") return `Creating cards: composer attempt ${label} produced ${evt.cards} cards${evt.locked ? `, ${evt.locked} locked` : ""}.`;
    if (evt.event === "check-start") return `Creating cards: checker attempt ${label} started for ${evt.cards} cards.`;
    if (evt.event === "check-end") {
      return evt.passed
        ? `Creating cards: checker attempt ${label} passed with ${evt.cards} cards.`
        : `Create cards feedback: ${compact(evt.feedback)}`;
    }
  }
  if (evt.phase === "dependencies") {
    if (evt.event === "compose-start") return `Creating dependencies: composer attempt ${label} started for ${evt.cards} cards.`;
    if (evt.event === "compose-end") return `Creating dependencies: composer attempt ${label} produced ${evt.dependencies} dependency edges.`;
    if (evt.event === "check-start") return `Creating dependencies: checker attempt ${label} started.`;
    if (evt.event === "check-end") {
      return evt.passed
        ? `Creating dependencies: checker attempt ${label} passed.`
        : `Map dependencies feedback: ${compact(evt.feedback)}`;
    }
  }
  if (evt.phase === "audit") {
    if (evt.event === "audit-start") return `Auditing dependency graph: ${evt.samples} sampled relationships started.`;
    if (evt.event === "audit-end") {
      return evt.passed
        ? `Auditing dependency graph: passed ${evt.samples} sampled relationships.`
        : `Auditing dependency graph: failed. ${compact(evt.feedback)}`;
    }
  }
  return `${evt.phase}: ${evt.event}`;
}

function summarizeAttemptFixes(attempts = []) {
  return attempts
    .filter((attempt) => attempt?.check && attempt.check.passed === false)
    .map((attempt) => {
      const feedback = compact(attempt.check.feedback || attempt.check.repair_prompt || "");
      const issues = (attempt.check.blocking_issues || [])
        .map((issue) => compact(issue.required_repair || issue.problem || issue.reference || ""))
        .filter(Boolean)
        .slice(0, 3);
      const line = [`Attempt ${attempt.attempt}: ${feedback || "checker requested repairs"}`, ...issues.map((x) => `- ${x}`)];
      return line.join("\n");
    });
}

function createCardsArtifact(cards, report, maxAttempts) {
  const attempts = report?.attempts || [];
  const passedAttempt = report?.final?.passed ? attempts.at(-1)?.attempt || attempts.length : attempts.length;
  const fixes = summarizeAttemptFixes(attempts);
  return [
    "# Create Cards",
    "",
    `Final card count: ${cards.length}`,
    `Passed on attempt ${passedAttempt} of ${maxAttempts}`,
    "",
    "## Cards",
    "",
    ...cards.flatMap((card, index) => [
      `### ${index}. ${card.title}`,
      "",
      card.instruction,
      "",
    ]),
    "## What Was Caught And Fixed",
    "",
    fixes.length ? fixes.join("\n\n") : "No repair attempts were needed.",
    "",
  ].join("\n");
}

function dependencyDepths(workflow) {
  const steps = workflow.steps || [];
  const memo = new Map();
  const depth = (index, seen = new Set()) => {
    if (memo.has(index)) return memo.get(index);
    if (seen.has(index)) return 0;
    seen.add(index);
    const requires = steps[index]?.requires || [];
    const value = requires.length ? 1 + Math.max(...requires.map((dep) => depth(dep, new Set(seen)))) : 0;
    memo.set(index, value);
    return value;
  };
  return steps.map((_, index) => depth(index));
}

function createDependenciesArtifact(workflow, report, maxAttempts) {
  const attempts = report?.attempts || [];
  const passedAttempt = report?.final?.passed ? attempts.at(-1)?.attempt || attempts.length : attempts.length;
  const edgeCount = (workflow.steps || []).reduce((sum, step) => sum + (step.requires || []).length, 0);
  const depths = dependencyDepths(workflow);
  const maxDepth = Math.max(0, ...depths);
  const layers = Array.from({ length: maxDepth + 1 }, (_, layer) =>
    workflow.steps
      .map((step, index) => ({ step, index }))
      .filter((item) => depths[item.index] === layer),
  );
  const fixes = summarizeAttemptFixes(attempts);
  return [
    "# Map Dependencies",
    "",
    `Step count: ${workflow.steps.length}`,
    `Dependency edge count: ${edgeCount}`,
    `Passed on attempt ${passedAttempt} of ${maxAttempts}`,
    "",
    "## Parallel Layers",
    "",
    ...layers.flatMap((items, layer) => [
      `### Layer ${layer}`,
      "",
      items.map(({ step, index }) => `- ${index}. ${step.title}`).join("\n") || "- (none)",
      "",
    ]),
    "## Ordered List",
    "",
    ...workflow.steps.map((step, index) => `- ${index}. ${step.title} — requires [${(step.requires || []).join(", ")}]`),
    "",
    "## Text DAG",
    "",
    ...workflow.steps.map((step, index) => {
      const deps = (step.requires || []).map((dep) => `${dep}. ${workflow.steps[dep]?.title || "unknown"}`).join("; ");
      return `${index}. ${step.title}\n   waits for: ${deps || "nothing"}`;
    }),
    "",
    "## What Was Caught And Fixed",
    "",
    fixes.length ? fixes.join("\n\n") : "No repair attempts were needed.",
    "",
  ].join("\n");
}

function createMigrationPlanArtifact(workflow, cardsReport, orderReport, cardAttempts, orderAttempts) {
  const cardAttempt = cardsReport?.final?.passed ? cardsReport?.attempts?.at(-1)?.attempt || cardsReport?.attempts?.length || 1 : cardsReport?.attempts?.length || 0;
  const orderAttempt = orderReport?.final?.passed ? orderReport?.attempts?.at(-1)?.attempt || orderReport?.attempts?.length || 1 : orderReport?.attempts?.length || 0;
  const edgeCount = (workflow.steps || []).reduce((sum, step) => sum + (step.requires || []).length, 0);
  const depths = dependencyDepths(workflow);
  const maxDepth = Math.max(0, ...depths);
  const layers = Array.from({ length: maxDepth + 1 }, (_, layer) =>
    workflow.steps
      .map((step, index) => ({ step, index }))
      .filter((item) => depths[item.index] === layer),
  );
  const cardFixes = summarizeAttemptFixes(cardsReport?.attempts || []);
  const dependencyFixes = summarizeAttemptFixes(orderReport?.attempts || []);

  return [
    "# Migration Plan",
    "",
    `Workflow: ${workflow.name}`,
    `Cards: ${workflow.steps.length}`,
    `Dependency edges: ${edgeCount}`,
    `Cards passed on attempt ${cardAttempt} of ${cardAttempts}`,
    `Dependencies passed on attempt ${orderAttempt} of ${orderAttempts}`,
    "",
    "## Cards And Dependencies",
    "",
    ...workflow.steps.flatMap((step, index) => [
      `### ${index}. ${step.title}`,
      "",
      `Requires: [${(step.requires || []).join(", ")}]`,
      "",
      step.instruction,
      "",
    ]),
    "## Parallel Layers",
    "",
    ...layers.flatMap((items, layer) => [
      `### Layer ${layer}`,
      "",
      items.map(({ step, index }) => `- ${index}. ${step.title}`).join("\n") || "- (none)",
      "",
    ]),
    "## Dependency Flow",
    "",
    ...workflow.steps.map((step, index) => {
      const deps = (step.requires || []).map((dep) => `${dep}. ${workflow.steps[dep]?.title || "unknown"}`).join("; ");
      return `${index}. ${step.title}\n   waits for: ${deps || "nothing"}`;
    }),
    "",
    "## What Was Caught And Fixed",
    "",
    "### Cards",
    "",
    cardFixes.length ? cardFixes.join("\n\n") : "No card repair attempts were needed.",
    "",
    "### Dependencies",
    "",
    dependencyFixes.length ? dependencyFixes.join("\n\n") : "No dependency repair attempts were needed.",
    "",
  ].join("\n");
}

function createValidationArtifact(workflow, validation, warnings = []) {
  return [
    "# Validate Workflow",
    "",
    `Validation result: ${validation.length ? "fail" : "pass"}`,
    `Step count: ${workflow.steps?.length || 0}`,
    "",
    "## Errors",
    "",
    validation.length ? validation.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Warnings",
    "",
    warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- none",
    "",
  ].join("\n");
}

function makeCompileProgress(statusPath) {
  return (evt) => {
    const step = evt.phase === "cards" ? 0 : evt.phase === "dependencies" ? 1 : 2;
    updateCompileStatus(statusPath, step, evt.event, {
      note: progressNote(evt),
      checking: evt.event.includes("check") || evt.event.includes("audit"),
      done: evt.passed === true,
      failed: false,
      tone: evt.event === "check-end" && evt.passed === false ? "feedback" : undefined,
    });
  };
}

function defaultCacheDir() {
  return path.join(os.homedir(), ".conductor", "cache", "skills");
}

function copyAccepted(cacheDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of [
    "cards.json",
    "workflow.json",
    "decomposition-check.json",
    "order-check.json",
    "compile-meta.json",
    "migration-meta.json",
  ]) {
    const src = path.join(cacheDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
  }
  ensureKnowledge(outDir);
}

function cacheAccepted(cacheDir, outDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const name of [
    "cards.json",
    "workflow.json",
    "decomposition-check.json",
    "order-check.json",
    "compile-meta.json",
    "migration-meta.json",
  ]) {
    const src = path.join(outDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(cacheDir, name));
  }
}

function cacheIsAccepted(cacheDir, expected) {
  try {
    const meta = readJson(path.join(cacheDir, "compile-meta.json"));
    if (meta.skill_hash !== expected.skill_hash) return false;
    if (meta.compiler_version !== expected.compiler_version) return false;
    if (meta.package_version !== expected.package_version) return false;
    if (meta.accepted !== true) return false;
    for (const name of ["cards.json", "workflow.json", "decomposition-check.json", "order-check.json"]) {
      if (!fs.existsSync(path.join(cacheDir, name))) return false;
    }
    const workflow = readJson(path.join(cacheDir, "workflow.json"));
    if (validateConductor(workflow).length) return false;
    const order = readJson(path.join(cacheDir, "order-check.json"));
    return order?.ok === true;
  } catch {
    return false;
  }
}

function packageVersion() {
  try {
    return readJson(new URL("../package.json", import.meta.url)).version || "unknown";
  } catch {
    return "unknown";
  }
}

function workflowName(skillPath, explicit) {
  if (explicit) return compact(explicit);
  const base = path.basename(path.dirname(skillPath));
  return base && base !== "." ? base : path.basename(skillPath, path.extname(skillPath));
}

export async function compileSkill(skillPath, {
  outDir = path.resolve(process.cwd(), ".conductor"),
  cacheRoot = process.env.CONDUCTOR_CACHE_DIR || defaultCacheDir(),
  force = false,
  noCache = false,
  name,
  description,
  maxAttempts = 15,
  orderAttempts = 15,
  runMaxAttempts = 5,
  auditSample = 0,
  model = DEFAULT_MODEL,
  progress,
  compileStatusPath,
} = {}) {
  const resolvedSkill = path.resolve(process.cwd(), skillPath);
  const skill = fs.readFileSync(resolvedSkill, "utf8");
  const pkg = packageVersion();
  const skillHash = sha256(skill);
  const cacheKey = sha256(JSON.stringify({
    skill_hash: skillHash,
    compiler_version: COMPILER_VERSION,
    package_version: pkg,
  })).slice(0, 24);
  const cacheDir = path.join(cacheRoot, cacheKey);
  const metaBase = {
    accepted: true,
    skill_path: resolvedSkill,
    skill_hash: skillHash,
    cache_key: cacheKey,
    compiler_version: COMPILER_VERSION,
    package_version: pkg,
    compiled_at: new Date().toISOString(),
  };

  if (!force && !noCache && cacheIsAccepted(cacheDir, metaBase)) {
    copyAccepted(cacheDir, outDir);
    if (!fs.existsSync(migrationMetaPathForRoot(outDir))) {
      writeJson(migrationMetaPathForRoot(outDir), {
        skill_path: resolvedSkill,
        skill_hash: `sha256:${skillHash}`,
        migrated_at: new Date().toISOString(),
        migration_attempts: { cards: 0, dependencies: 0 },
      });
    }
    ensureKnowledge(outDir);
    return {
      mode: "cache-hit",
      cacheDir,
      cacheKey,
      cards: readJson(path.join(outDir, "cards.json")),
      workflow: readJson(path.join(outDir, "workflow.json")),
      meta: readJson(path.join(outDir, "compile-meta.json")),
    };
  }

  const cardsDetail = await composeAndCheckSkill(skill, {
    maxAttempts,
    model,
    progress,
    debugDir: path.join(outDir, "debug", "cards"),
  });
  if (!cardsDetail.report.ok) {
    if (compileStatusPath) {
      updateCompileStatus(compileStatusPath, 0, "failed", {
        note: `Creating cards failed after ${cardsDetail.report.attempts?.length || maxAttempts} attempts.`,
        failed: true,
      });
    }
    return {
      mode: "compile-failed",
      phase: "decompose",
      cacheDir,
      cacheKey,
      cards: cardsDetail.cards,
      report: cardsDetail.report,
    };
  }
  if (compileStatusPath) {
    const rel = writeCompileArtifact(
      compileStatusPath,
      "create-cards",
      createCardsArtifact(cardsDetail.cards, cardsDetail.report, maxAttempts),
    );
    attachCompileArtifact(compileStatusPath, 0, rel);
  }

  const wfName = workflowName(resolvedSkill, name);
  const wfDescription = compact(description) || `Workflow compiled from ${path.basename(resolvedSkill)}`;
  const orderDetail = await orderAndCheckCards(cardsDetail.cards, {
    name: wfName,
    description: wfDescription,
    maxAttempts: orderAttempts,
    runMaxAttempts,
    model,
    progress,
    debugDir: path.join(outDir, "debug", "dependencies"),
  });
  if (!orderDetail.report.ok) {
    if (compileStatusPath) {
      updateCompileStatus(compileStatusPath, 1, "failed", {
        note: `Creating dependencies failed after ${orderDetail.report.attempts?.length || orderAttempts} attempts.`,
        failed: true,
      });
    }
    return {
      mode: "compile-failed",
      phase: "order",
      cacheDir,
      cacheKey,
      cards: cardsDetail.cards,
      workflow: orderDetail.workflow,
      decomposition: cardsDetail.report,
      report: orderDetail.report,
    };
  }
  if (compileStatusPath) {
    const dependencyRel = writeCompileArtifact(
      compileStatusPath,
      "map-dependencies",
      createDependenciesArtifact(orderDetail.workflow, orderDetail.report, orderAttempts),
    );
    attachCompileArtifact(compileStatusPath, 1, dependencyRel);
    const planRel = writeCompileArtifact(
      compileStatusPath,
      "migration-plan",
      createMigrationPlanArtifact(orderDetail.workflow, cardsDetail.report, orderDetail.report, maxAttempts, orderAttempts),
    );
    attachCompileArtifact(compileStatusPath, 0, dependencyRel);
    attachCompileArtifact(compileStatusPath, 0, planRel);
  }
  const validation = validateConductor(orderDetail.workflow);
  if (compileStatusPath) {
    updateCompileStatus(compileStatusPath, 2, "validate-start", {
      note: `Validating generated workflow with ${orderDetail.workflow.steps.length} cards.`,
      checking: true,
    });
  }
  if (validation.length) {
    if (compileStatusPath) {
      const rel = writeCompileArtifact(
        compileStatusPath,
        "validate-workflow",
        createValidationArtifact(orderDetail.workflow, validation),
      );
      attachCompileArtifact(compileStatusPath, 2, rel);
    }
    if (compileStatusPath) {
      updateCompileStatus(compileStatusPath, 2, "failed", {
        note: `Workflow validation failed: ${validation.slice(0, 3).join("; ")}`,
        failed: true,
      });
    }
    return {
      mode: "compile-failed",
      phase: "validate",
      cacheDir,
      cacheKey,
      cards: cardsDetail.cards,
      workflow: orderDetail.workflow,
      decomposition: cardsDetail.report,
      order: orderDetail.report,
      report: { ok: false, errors: validation },
    };
  }

  const meta = {
    ...metaBase,
    cards: cardsDetail.cards.length,
    workflow_name: orderDetail.workflow.name,
    cache_dir: cacheDir,
  };

  writeJson(path.join(outDir, "cards.json"), cardsDetail.cards);
  writeJson(path.join(outDir, "workflow.json"), orderDetail.workflow);
  writeJson(path.join(outDir, "decomposition-check.json"), cardsDetail.report);
  writeJson(path.join(outDir, "order-check.json"), orderDetail.report);
  writeJson(path.join(outDir, "compile-meta.json"), meta);
  writeJson(migrationMetaPathForRoot(outDir), {
    skill_path: resolvedSkill,
    skill_hash: `sha256:${skillHash}`,
    migrated_at: meta.compiled_at,
    migration_attempts: {
      cards: cardsDetail.report?.attempts?.length || 0,
      dependencies: orderDetail.report?.attempts?.length || 0,
    },
  });
  ensureKnowledge(outDir);
  if (compileStatusPath) {
    const rel = writeCompileArtifact(
      compileStatusPath,
      "validate-workflow",
      createValidationArtifact(orderDetail.workflow, validation),
    );
    attachCompileArtifact(compileStatusPath, 2, rel);
  }
  if (compileStatusPath) {
    updateCompileStatus(compileStatusPath, 2, "validate-end", {
      note: `Workflow accepted: ${orderDetail.workflow.steps.length} cards written to .conductor/workflow.json.`,
      done: true,
    });
  }

  if (!noCache) cacheAccepted(cacheDir, outDir);

  return {
    mode: "compiled",
    cacheDir,
    cacheKey,
    cards: cardsDetail.cards,
    workflow: orderDetail.workflow,
    meta,
  };
}

export async function runCompile(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board compile --skill SKILL.md [--force] [--no-cache]\n\n" +
        "  Prepares .conductor/cards.json and .conductor/workflow.json. On first\n" +
        "  run, compiles cards, orders dependencies, validates, and stores\n" +
        "  the accepted skeleton. Later runs reuse the accepted skeleton when the\n" +
        "  skill and compiler version have not changed.",
    );
    return true;
  }

  const skill = flag(args, ["--skill", "-s"]);
  if (typeof skill !== "string") {
    console.error(red("usage: conductor-board compile --skill SKILL.md"));
    return false;
  }
  const skillPath = path.resolve(process.cwd(), skill);
  if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) {
    console.error(red(`✗ skill file not found: ${path.relative(process.cwd(), skillPath)}`));
    return false;
  }

  const explicitOutDir = flag(args, ["--out-dir", "--dir"]);
  const outDir = explicitOutDir
    ? path.resolve(process.cwd(), explicitOutDir)
    : scopedConductorDir(skillPath, flag(args, ["--name", "-n"]));
  const cacheRoot = path.resolve(process.cwd(), flag(args, ["--cache-dir"]) || process.env.CONDUCTOR_CACHE_DIR || defaultCacheDir());
  const compilePort = Number(flag(args, ["--compile-port", "--port"], 3042)) || 3042;
  let compileBoard = null;
  let releaseLock = null;

  try {
    releaseLock = acquireCompileLock(outDir);
  } catch (e) {
    console.error(red(`✗ ${e.message}`));
    return false;
  }

  try {
    if (!args.includes("--no-compile-board")) {
      try {
        compileBoard = await initCompileBoard(outDir, "Migrating skill to conductor", compilePort);
        console.log(dim(`  compile board: ${path.relative(process.cwd(), compileBoard.statusPath)}${compileBoard.served ? " (served)" : ""}`));
      } catch (e) {
        console.error(red(`✗ could not initialize compile board: ${e.message}`));
        return false;
      }
    }

    let result;
    result = await compileSkill(skillPath, {
      outDir,
      cacheRoot,
      force: args.includes("--force") || args.includes("-f"),
      noCache: args.includes("--no-cache"),
      name: flag(args, ["--name", "-n"]),
      description: flag(args, ["--description", "-d"]),
      maxAttempts: Number(flag(args, ["--max-attempts"], 15)) || 15,
      orderAttempts: Number(flag(args, ["--order-attempts"], flag(args, ["--max-attempts"], 15))) || 15,
      runMaxAttempts: Number(flag(args, ["--run-max-attempts"], 5)) || 5,
      auditSample: 0,
      model: String(flag(args, ["--model"], DEFAULT_MODEL)),
      progress: compileBoard ? makeCompileProgress(compileBoard.statusPath) : undefined,
      compileStatusPath: compileBoard?.statusPath,
    });

    console.log("");
    if (result.mode === "cache-hit") {
      console.log(green("✓ accepted compiled workflow found"));
      console.log(dim(`  cache: ${result.cacheKey}`));
      console.log(dim(`  cards: ${result.cards.length}`));
      console.log(dim(`  copied ${path.relative(process.cwd(), path.join(outDir, "cards.json"))}`));
      console.log(dim(`  copied ${path.relative(process.cwd(), path.join(outDir, "workflow.json"))}`));
      console.log("");
      return true;
    }

    if (result.mode === "compiled") {
      console.log(green("✓ compiled accepted workflow"));
      console.log(dim(`  cache: ${result.cacheKey}`));
      console.log(dim(`  cards: ${result.cards.length}`));
      console.log(dim(`  workflow: ${result.workflow.name}`));
      console.log(dim(`  wrote ${path.relative(process.cwd(), path.join(outDir, "cards.json"))}`));
      console.log(dim(`  wrote ${path.relative(process.cwd(), path.join(outDir, "workflow.json"))}`));
      console.log("");
      return true;
    }

    console.error(red(`✗ compile failed during ${result.phase}`));
    const feedback = result.report?.final?.feedback || result.report?.audit?.feedback || result.report?.feedback;
    if (feedback) console.error(red(`  ${feedback}`));
    const issues = result.report?.final?.blocking_issues || result.report?.audit?.issues || result.report?.issues || [];
    for (const issue of issues.slice(0, 5)) {
      const repair = issue.required_repair || issue.problem;
      if (repair) console.error(red(`  - ${repair}`));
    }
    console.log("");
    return false;
  } catch (e) {
    if (compileBoard?.statusPath) {
      updateCompileStatus(compileBoard.statusPath, 0, "failed", {
        note: `Compile crashed: ${e.message}`,
        failed: true,
      });
    }
    console.error(red(`✗ compile failed: ${e.message}`));
    return false;
  } finally {
    if (releaseLock) releaseLock();
  }
}
