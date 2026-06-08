import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, compact, extractJson } from "./decompose.js";
import {
  artifactReadSources,
  findArtifactsReferencedInReceipt,
  findReceiptArtifact,
} from "./artifacts.js";

export function timestampRunId(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
}

export function skillSlug(skillPath, explicit) {
  const raw =
    explicit ||
    (skillPath ? path.basename(path.dirname(path.resolve(skillPath))) : "") ||
    (skillPath ? path.basename(skillPath, path.extname(skillPath)) : "workflow");
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "workflow";
}

export function scopedConductorDir(skillPath, explicitName, cwd = process.cwd()) {
  return path.resolve(cwd, ".conductor", skillSlug(skillPath, explicitName));
}

export function conductorRootFromStatus(statusPath) {
  const dir = path.dirname(path.resolve(statusPath));
  const parent = path.dirname(dir);
  if (path.basename(parent) === "runs") return path.dirname(parent);
  return dir;
}

export function knowledgePathForRoot(root) {
  return path.join(root, "knowledge.json");
}

export function migrationMetaPathForRoot(root) {
  return path.join(root, "migration-meta.json");
}

export function sha256File(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function readJsonMaybe(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function withKnowledgeLock(root, fn) {
  const lockDir = path.join(root, ".locks", "knowledge.lock");
  const deadline = Date.now() + 5000;
  let clearedStale = false;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      break;
    } catch (e) {
      if (Date.now() >= deadline) {
        if (!clearedStale) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          clearedStale = true;
          continue;
        }
        throw new Error(`could not acquire knowledge lock: ${e.message}`);
      }
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

export function ensureKnowledge(root) {
  const file = knowledgePathForRoot(root);
  const existing = readJsonMaybe(file);
  if (existing && Array.isArray(existing.items)) return existing;
  const fresh = { items: [] };
  writeJson(file, fresh);
  return fresh;
}

function nextKnowledgeId(items) {
  let max = 0;
  for (const item of items || []) {
    const m = String(item?.id || "").match(/^K-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `K-${String(max + 1).padStart(3, "0")}`;
}

export function appendKnowledge(root, item) {
  return withKnowledgeLock(root, () => {
    const file = knowledgePathForRoot(root);
    const knowledge = ensureKnowledge(root);
    const title = String(item.title || "").trim();
    const detail = String(item.detail || item.note || item.title || "").trim();
    const duplicate = knowledge.items.find(
      (existing) =>
        existing &&
        String(existing.title || "").trim().toLowerCase() === title.toLowerCase() &&
        String(existing.detail || "").trim().toLowerCase() === detail.toLowerCase(),
    );
    if (duplicate) return duplicate;
    const entry = {
      id: nextKnowledgeId(knowledge.items),
      created: new Date().toISOString(),
      source: item.source || "agent",
      ...(item.source_run ? { source_run: item.source_run } : {}),
      ...(item.source_card !== undefined ? { source_card: item.source_card } : {}),
      ...(item.source_card_title ? { source_card_title: item.source_card_title } : {}),
      ...(item.tag ? { tag: item.tag } : {}),
      title,
      detail,
      ...(item.card_duration_seconds !== undefined
        ? { card_duration_seconds: item.card_duration_seconds }
        : {}),
      status: item.status || "open",
      applied_in: item.applied_in ?? null,
      applied_as: item.applied_as ?? null,
    };
    knowledge.items.push(entry);
    writeJson(file, knowledge);
    return entry;
  });
}

function logLearning(root, message) {
  try {
    const file = path.join(root, "logs", "post-card-learning.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* learning logs are best-effort */
  }
}

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

function resolveStep(doc, stepId) {
  const parts = String(stepId).split("::");
  if (parts.length === 3) {
    const [loopId, iter, subId] = parts;
    const loopStep = (doc.steps || [])[Number(loopId)] || (doc.steps || []).find((s) => s && s.id === loopId);
    const step = (loopStep?.steps || [])[Number(subId)] || (loopStep?.steps || []).find((s) => s && s.id === subId);
    if (!step) return null;
    return { step, loopPath: { loopId, iter, subId } };
  }
  const step = (doc.steps || [])[Number(stepId)] || (doc.steps || []).find((s) => s && s.id === stepId);
  return step ? { step, loopPath: null } : null;
}

function statusEntryFor(status, loopPath, stepId) {
  if (loopPath) return status.steps?.[loopPath.loopId]?.iterations?.[loopPath.iter]?.[loopPath.subId] || null;
  return status.steps?.[stepId] || null;
}

function durationSeconds(entry) {
  const started = entry?.started_at || entry?.startedAt;
  const completed = entry?.completed_at || entry?.completedAt || entry?.endedAt;
  if (!started || !completed) return null;
  const seconds = Math.round((Date.parse(completed) - Date.parse(started)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function truncate(text, max) {
  const src = String(text || "");
  return src.length > max ? `${src.slice(0, max)}\n...[truncated]` : src;
}

function traceForPrompt(entry) {
  const trace = {
    status: entry?.status,
    attempt: entry?.attempt,
    started_at: entry?.started_at,
    completed_at: entry?.completed_at,
    heartbeat: Array.isArray(entry?.heartbeat) ? entry.heartbeat : [],
    checker_results: Array.isArray(entry?.gate_detail) ? entry.gate_detail : [],
    last_feedback: entry?.last_feedback,
  };
  return truncate(JSON.stringify(trace, null, 2), 12000);
}

function artifactForPrompt({ statusPath, stepId, entry }) {
  const receipt = findReceiptArtifact({ statusPath, stepId, entry });
  const referenced = findArtifactsReferencedInReceipt(statusPath, receipt);
  const readable = artifactReadSources({ statusPath, stepId, entry });
  const byPath = new Map();
  for (const source of readable) byPath.set(source.path, source);
  for (const artifact of referenced) {
    if (!byPath.has(artifact.path)) {
      const sources = artifactReadSources({ statusPath, stepId, entry: { artifacts: [artifact.path] } });
      for (const source of sources) byPath.set(source.path, source);
    }
  }
  const sources = [...byPath.values()];
  if (!sources.length) return "_No readable artifact was found._";
  return truncate(
    sources
      .map((source) => `--- ${source.label || source.path} ---\n${source.text}`)
      .join("\n\n"),
    24000,
  );
}

function postCardLearningPrompt({ step, entry, artifact, duration }) {
  return `You are reviewing a completed card from an automated workflow. The card passed its checker — the goal was achieved and the artifact is correct.

Do not suggest changes to what the card does. The goal is fixed.

Your job: determine whether the NEXT run of this card could arrive at the same result dramatically faster.

Look for:
- Facts that were rediscovered from scratch (file paths, database locations, API endpoints, CLI commands) that could be provided upfront
- Unnecessary tool calls or wrong paths tried before finding the right approach
- Setup work that is identical every run and could be skipped
- Information that was fetched remotely but is stable and could be cached in the instruction

If there is a meaningful improvement, return:
{ "insight": true, "detail": "<one sentence describing what to provide or change so the next run is faster>" }

If the card executed efficiently and there is no meaningful improvement, return:
{ "insight": false }

Return only the JSON object. No other text.

Card instruction:
${step.instruction || step.title || ""}

Card duration seconds:
${duration ?? "unknown"}

Execution trace available from status.json:
${traceForPrompt(entry)}

Final artifact:
${artifact}`;
}

async function withTimeout(promise, ms) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`post-card learning timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function postCardLearning({ statusPath, workflowPath, stepId } = {}) {
  const resolvedStatusPath = path.resolve(process.cwd(), statusPath || ".conductor/status.json");
  const root = conductorRootFromStatus(resolvedStatusPath);
  try {
    const status = readJsonMaybe(resolvedStatusPath);
    const workflow = readJsonMaybe(path.resolve(process.cwd(), workflowPath || path.join(root, "workflow.json")));
    if (!status || !workflow) throw new Error("missing status.json or workflow.json");
    const resolved = resolveStep(workflow, stepId);
    if (!resolved) throw new Error(`workflow has no card ${stepId}`);
    const entry = statusEntryFor(status, resolved.loopPath, stepId);
    if (!entry || entry.status !== "done") throw new Error(`card ${stepId} is not done`);
    const duration = durationSeconds(entry);
    const artifact = artifactForPrompt({ statusPath: resolvedStatusPath, stepId, entry });
    const prompt = postCardLearningPrompt({ step: resolved.step, entry, artifact, duration });
    const raw = await withTimeout(callModel(prompt, { role: "post-card-learning", attempt: 1 }), 45000);
    const json = extractJson(raw);
    if (json?.insight !== true) {
      logLearning(root, `card ${stepId}: no efficiency insight`);
      return null;
    }
    const detail = compact(json.detail);
    if (!detail) {
      logLearning(root, `card ${stepId}: insight=true without detail`);
      return null;
    }
    const entryWritten = appendKnowledge(root, {
      source: "agent",
      source_run: status.run_id,
      source_card: Number.isInteger(Number(stepId)) ? Number(stepId) : stepId,
      source_card_title: resolved.step.title || String(stepId),
      tag: "efficiency",
      title: `${resolved.step.title || `Card ${stepId}`} — efficiency insight`,
      detail,
      card_duration_seconds: duration,
      status: "open",
      applied_in: null,
      applied_as: null,
    });
    logLearning(root, `card ${stepId}: wrote ${entryWritten.id}`);
    return entryWritten;
  } catch (e) {
    logLearning(root, `card ${stepId}: ${e.message}`);
    return null;
  }
}

export function queuePostCardLearning({ statusPath, workflowPath, stepId } = {}) {
  try {
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
    const child = spawn(
      process.execPath,
      [cli, "learn-card", String(stepId), "--path", path.resolve(statusPath), "--workflow", path.resolve(workflowPath)],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        env: { ...process.env, CONDUCTOR_LEARNING_WORKER: "1" },
      },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function runLearnCard(args) {
  const status = flag(args, ["--path", "-p"]);
  const workflow = flag(args, ["--workflow", "--conductor", "-c"]);
  const stepId = args.find((arg) => !arg.startsWith("-"));
  if (!stepId || typeof status !== "string" || typeof workflow !== "string") {
    console.error("usage: conductor-board learn-card <step> --path status.json --workflow workflow.json");
    return false;
  }
  await postCardLearning({ statusPath: status, workflowPath: workflow, stepId });
  return true;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

export function archiveRun(statusPath, workflowPath) {
  const status = readJsonMaybe(statusPath);
  if (!status || (status.status !== "done" && status.status !== "failed")) return null;
  const root = conductorRootFromStatus(statusPath);
  const runId = status.run_id || timestampRunId();
  const runDir = path.join(root, "runs", runId);
  if (fs.existsSync(path.join(runDir, "summary.json"))) return runDir;

  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, "status.json"), status);

  const artifacts = path.join(root, "artifacts");
  const outputs = path.join(root, "outputs");
  if (fs.existsSync(artifacts)) copyDir(artifacts, path.join(runDir, "artifacts"));
  else if (fs.existsSync(outputs)) copyDir(outputs, path.join(runDir, "artifacts"));

  const developerNotes = Array.isArray(status.developer_notes) ? status.developer_notes : [];
  writeJson(path.join(runDir, "developer_notes.json"), { items: developerNotes });

  const steps = status.steps || {};
  const values = Object.values(steps).filter((step) => step && typeof step === "object");
  const cardsPassed = values.filter((step) => step.status === "done").length;
  const cardsFailed = values.filter((step) => step.status === "failed").length;
  const totalAttempts = values.reduce((sum, step) => sum + Math.max(1, Number(step.attempt || 1)), 0);
  const started = status.started_at || status.startedAt || null;
  const finished = status.completed_at || status.endedAt || new Date().toISOString();
  const durationSeconds =
    started && finished ? Math.max(0, Math.round((Date.parse(finished) - Date.parse(started)) / 1000)) : null;
  writeJson(path.join(runDir, "summary.json"), {
    run_id: runId,
    skill: status.workflow || null,
    started,
    finished,
    duration_seconds: durationSeconds,
    card_count: values.length,
    outcome: status.status,
    cards_passed: cardsPassed,
    cards_failed: cardsFailed,
    total_checker_attempts: totalAttempts,
    integration_tier: status.integration_tier ?? null,
    integration_changes: status.integration_changes || [],
    new_knowledge_items: status.new_knowledge_items || [],
    open_comments: developerNotes.filter((note) => note && note.status === "open").length,
  });

  const created = [];
  for (const note of developerNotes) {
    if (!note || note.status !== "open" || note.status === "removed") continue;
    const entry = appendKnowledge(root, {
      source: "human",
      source_run: runId,
      source_card: note.step,
      title: note.card_title || `Human note on card ${note.step || note.card || "unknown"}`,
      detail: note.text,
      status: "open",
    });
    created.push(entry.id);
  }
  if (created.length) {
    const summaryPath = path.join(runDir, "summary.json");
    const summary = readJsonMaybe(summaryPath, {});
    summary.new_knowledge_items = [...new Set([...(summary.new_knowledge_items || []), ...created])];
    writeJson(summaryPath, summary);
  }

  void workflowPath;
  return runDir;
}
