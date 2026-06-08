import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runStatusInit } from "./writer.js";

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

function getHealth(url, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get(`${url.replace(/\/$/, "")}/health`, { timeout }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const body = JSON.parse(data);
          resolve(res.statusCode === 200 && body?.status === "ok" ? body : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort */
  }
}

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

  const conductorDir = path.dirname(statusPath);
  const serverJsonPath = path.join(conductorDir, "server.json");
  const registry = registryPath();
  let board = registeredBoard(registry) || existingLiveBoard(serverJsonPath);
  let health = board ? await getHealth(board.url) : null;

  if (board && health && !healthWatchesRoot(health, conductorDir)) {
    board = null;
    health = null;
    removeRegistry(registry);
  }

  if (board && health) {
    syncRegistry(registry, board.info, {
      url: board.url,
      conductor_root: conductorDir,
      status_path: statusPath,
      workflow_path: workflowPath,
    });
  } else if (board && !health) {
    removeRegistry(registry);
  }

  if (!board || !health) {
    killPortIfBoard(port);
    try {
      fs.mkdirSync(conductorDir, { recursive: true });
      const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
      const logPath = path.join(conductorDir, "board.log");
      const out = fs.openSync(logPath, "a");
      const child = spawn(
        process.execPath,
        [
          cliPath,
          "--path",
          statusPath,
          "--workflow",
          workflowPath,
          "--port",
          String(port),
          "--headless",
        ],
        {
          cwd: process.cwd(),
          detached: true,
          stdio: ["ignore", out, out],
          env: { ...process.env, CONDUCTOR_HEADLESS: "1" },
        },
      );
      child.unref();
    } catch (e) {
      console.error(red(`✗ could not start board: ${e.message}`));
      return false;
    }

    try {
      const ready = await waitForHealthyBoard(serverJsonPath, workflow);
      board = { info: ready.info, url: ready.url };
      health = ready.health;
      syncRegistry(registry, ready.info, {
        url: ready.url,
        conductor_root: conductorDir,
        status_path: statusPath,
        workflow_path: workflowPath,
      });
    } catch (e) {
      console.error(red(`✗ ${e.message}`));
      return false;
    }
  }

  health = await waitForWorkflow(board.url, workflow, conductorDir);
  if (!healthHasWorkflow(health, workflow)) {
    console.error(red(`✗ board is live but is not serving workflow "${workflow}"`));
    console.error(dim(`  workflows: ${Object.keys(health?.workflows || {}).join(", ") || "(none)"}`));
    return false;
  }

  const browserUrl = boardBrowserUrl(board.url, workflow);
  if (!headless && !browserAlreadyOpened(serverJsonPath, registry)) {
    openBrowser(browserUrl);
    markBrowserOpened(serverJsonPath, browserUrl, registry);
  }

  console.log("");
  console.log(`${green("✓")} Board initialized and live: ${browserUrl}`);
  console.log(dim(`  workflow: ${workflow}`));
  console.log(dim(`  health:   ${board.url.replace(/\/$/, "")}/health`));
  console.log("");
  return true;
}
