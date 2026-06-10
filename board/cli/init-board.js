import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runStatusInit } from "./writer.js";
import { ensureBoard, getHealth as getHealthShared, openBrowser as openBrowserShared, canonicalUrl } from "./ensure-board.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function flag(args, names, fallback) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i !== -1) {
      const next = args[i + 1];
      return next && !next.startsWith("-") ? next : true;
    }
  }
  return fallback;
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      const v = args[i + 1];
      if (v && !v.startsWith("-")) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function repoKey(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 24);
}

function registryPath(cwd = process.cwd()) {
  return path.join(os.homedir(), ".conductor", "servers", `${repoKey(cwd)}.json`);
}

function conductorRootFromStatus(statusPath) {
  return path.dirname(path.resolve(statusPath));
}

function workflowName(workflowPath) {
  return readJson(workflowPath).name || "workflow";
}

// Consolidated: delegate to the single shared health check (identity = port).
function getHealth(url, timeout = 1200) {
  let port;
  try {
    port = Number(new URL(url).port) || 80;
  } catch {
    return Promise.resolve(null);
  }
  return getHealthShared(port, timeout);
}

// Consolidated: single shared openBrowser (stable canonical URL focuses the tab).
const openBrowser = openBrowserShared;

function boardBrowserUrl(url, workflow) {
  const u = new URL(url);
  u.pathname = "/";
  if (workflow) u.searchParams.set("wf", workflow);
  return u.toString();
}

async function waitForHealthyBoard(serverJsonPath, workflow, timeoutMs = 7000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const info = readJson(serverJsonPath);
      const url = info.url || `http://localhost:${info.port}`;
      const health = await getHealth(url);
      if (health) return { info, url, health };
      last = { info, url };
    } catch {
      /* server.json may not exist yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const hint = last?.url ? ` at ${last.url}` : "";
  throw new Error(`board did not become healthy${hint} for workflow "${workflow}"`);
}

async function waitForWorkflow(url, workflow, conductorDir, timeoutMs = 2500) {
  const start = Date.now();
  let health = await getHealth(url);
  while (Date.now() - start < timeoutMs) {
    if (health && healthWatchesRoot(health, conductorDir) && healthHasWorkflow(health, workflow)) return health;
    await new Promise((r) => setTimeout(r, 150));
    health = await getHealth(url);
  }
  return health;
}

function healthHasWorkflow(health, workflow) {
  return !!health?.workflows && Object.prototype.hasOwnProperty.call(health.workflows, workflow);
}

function healthWatchesRoot(health, conductorDir) {
  return path.resolve(health?.conductor_root || "") === path.resolve(conductorDir);
}

function existingLiveBoard(serverJsonPath) {
  try {
    const info = readJson(serverJsonPath);
    if (!pidAlive(info.pid)) return null;
    const url = info.url || `http://localhost:${info.port}`;
    return { info, url };
  } catch {
    return null;
  }
}

function markBrowserOpened(serverJsonPath, url, registry) {
  try {
    const info = readJson(serverJsonPath);
    const next = {
      ...info,
      browser_opened_url: url,
      browser_opened_at: info.browser_opened_at || new Date().toISOString(),
    };
    writeJson(serverJsonPath, next);
    if (registry) writeJson(registry, { ...readJson(registry), ...next });
  } catch {
    /* best effort */
  }
}

function browserAlreadyOpened(serverJsonPath, registry) {
  try {
    const info = fs.existsSync(registry) ? readJson(registry) : readJson(serverJsonPath);
    return typeof info.browser_opened_at === "string";
  } catch {
    return false;
  }
}

function removeRegistry(registry) {
  try {
    fs.unlinkSync(registry);
  } catch {
    /* already gone */
  }
}

function registeredBoard(registry) {
  try {
    const info = readJson(registry);
    if (!info?.pid || !pidAlive(info.pid)) return null;
    const url = info.url || `http://localhost:${info.port}`;
    return { info, url };
  } catch {
    return null;
  }
}

function syncRegistry(registry, info, extras = {}) {
  const previous = fs.existsSync(registry) ? readJson(registry) : {};
  writeJson(registry, {
    ...previous,
    ...info,
    ...extras,
    repo: path.resolve(process.cwd()),
    registry_key: repoKey(),
    updated_at: new Date().toISOString(),
  });
}

function portPid(port) {
  if (process.platform === "win32") return null;
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  const pid = Number(r.stdout.trim().split(/\s+/)[0]);
  return Number.isInteger(pid) ? pid : null;
}

function killPortIfBoard(port) {
  const pid = portPid(port);
  if (!pid) return false;
  try {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    const command = r.stdout || "";
    if (!command.includes("conductor") && !command.includes("board/bin/cli.js")) return false;
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/**
 * openRunBoard — the shared "always open/attach a VISIBLE board for THIS run"
 * step. Extracted from runInitBoard so the run command (and anything else that
 * starts a run) gets a board on the RUN's status/workflow without re-stitching
 * ensureBoard → waitForWorkflow → openBrowser by hand (audit §2).
 *
 * Identity is the port (ensureBoard): a healthy board there is attached, else
 * one is spawned. Pure logic + side effects (registry sync, browser open); the
 * caller prints. Returns a structured result so callers can report precisely.
 *
 * @returns {Promise<{ok, healthy, served, spawned, url, browserUrl, workflow, health, workflows}>}
 */
export async function openRunBoard(statusPath, workflowPath, { headless = false, port = 3042, openBrowserTab = true } = {}) {
  const conductorDir = path.dirname(path.resolve(statusPath));
  const serverJsonPath = path.join(conductorDir, "server.json");
  const registry = registryPath();

  let workflow;
  try {
    workflow = workflowName(workflowPath);
  } catch {
    workflow = "workflow";
  }

  // PHASE A: one shared find-or-spawn rule (identity = port). A healthy board is
  // attached, never SIGTERMed; only an unanswered /health spawns one.
  const ensured = await ensureBoard(port, { statusPath, workflowPath });
  const health0 = ensured.health;
  if (!health0) {
    return { ok: false, healthy: false, served: false, spawned: ensured.spawned, url: ensured.url, browserUrl: null, workflow, health: null, workflows: {} };
  }

  syncRegistry(registry, { port, url: ensured.url, pid: health0.pid }, {
    url: ensured.url,
    conductor_root: health0.conductor_root || conductorDir,
    status_path: statusPath,
    workflow_path: workflowPath,
  });

  // If WE spawned the board it must serve our workflow; an ATTACH to another
  // root's board legitimately may not (cross-root attach is not an error).
  const health = await waitForWorkflow(ensured.url, workflow, conductorDir);
  const served = healthHasWorkflow(health, workflow);
  if (ensured.spawned && !served) {
    return { ok: false, healthy: true, served: false, spawned: true, url: ensured.url, browserUrl: null, workflow, health, workflows: health?.workflows || {} };
  }

  // Stable canonical URL — opening the same URL focuses the existing tab.
  const browserUrl = canonicalUrl(port, workflow);
  if (!headless && openBrowserTab && !browserAlreadyOpened(serverJsonPath, registry)) {
    openBrowser(browserUrl);
    markBrowserOpened(serverJsonPath, browserUrl, registry);
  }

  return { ok: true, healthy: true, served, spawned: ensured.spawned, url: ensured.url, browserUrl, workflow, health, workflows: health?.workflows || {} };
}

/**
 * Fix 3: open a VISIBLE board EARLY — before/at compile — so the migration
 * (compile) feed is watched live, cards pending → running → done, instead of
 * appearing already finished. Opens the canonical port URL (no wf); the board's
 * run-feed preference then auto-advances compile → integration → run on the
 * SAME window. Idempotent: later openRunBoard attaches and won't re-open the tab.
 */
export async function ensureBoardVisible(statusPath, { headless = false, port = 3042 } = {}) {
  const ensured = await ensureBoard(port, { statusPath });
  if (!headless && ensured.health) {
    openBrowser(canonicalUrl(port));
    try {
      const serverJsonPath = path.join(path.dirname(path.resolve(statusPath)), "server.json");
      markBrowserOpened(serverJsonPath, canonicalUrl(port), registryPath());
    } catch { /* best-effort — prevents a duplicate tab from the later openRunBoard */ }
  }
  return ensured;
}

export async function runInitBoard(args) {
  const [workflowArg] = positionals(args);
  const workflowPath = path.resolve(process.cwd(), workflowArg || ".conductor/workflow.json");
  const statusPath = path.resolve(
    process.cwd(),
    String(flag(args, ["--path", "-p"], ".conductor/status.json")),
  );
  const port = Number(flag(args, ["--port"], 3042)) || 3042;
  const headless = args.includes("--headless") || process.env.CONDUCTOR_HEADLESS === "1";

  if (!fs.existsSync(workflowPath)) {
    console.error(red(`✗ workflow.json not found: ${path.relative(process.cwd(), workflowPath)}`));
    return false;
  }

  let workflow;
  try {
    workflow = workflowName(workflowPath);
  } catch (e) {
    console.error(red(`✗ could not read workflow.json: ${e.message}`));
    return false;
  }

  const ok = await runStatusInit([workflowPath, "--path", statusPath]);
  if (!ok) return false;

  // PHASE A: one shared find-or-spawn rule via openRunBoard. Identity is the
  // PORT, not the cwd. A healthy board on the port IS the board — attach, spawn
  // nothing, never SIGTERM it. Only when /health does not answer do we spawn one.
  const board = await openRunBoard(statusPath, workflowPath, { headless, port });

  if (!board.healthy) {
    console.error(red(`✗ board did not become healthy on port ${port}`));
    return false;
  }
  if (!board.ok && board.spawned && !board.served) {
    console.error(red(`✗ board is live but is not serving workflow "${workflow}"`));
    console.error(dim(`  workflows: ${Object.keys(board.workflows || {}).join(", ") || "(none)"}`));
    return false;
  }

  console.log("");
  console.log(`${green("✓")} Board initialized and live: ${board.browserUrl}`);
  console.log(dim(`  workflow: ${workflow}`));
  console.log(dim(`  health:   ${board.url.replace(/\/$/, "")}/health`));
  console.log("");
  return true;
}
