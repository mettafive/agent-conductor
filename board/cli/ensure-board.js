import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { registerRoot, registerBoard } from "./registry.js";

// ---------------------------------------------------------------------------
// ensureBoard — the single, shared "find-or-spawn" rule for the board.
//
// Phase A of the one-persistent-board consolidation. Identity is the PORT, not
// the cwd: a healthy board answering /health on the canonical port IS the board,
// whatever root started it. All three front doors (init-board, the default
// bin/cli.js board, and compile) route through this so they stop
// duplicating/killing each other's boards.
//
//   - healthy /health on the port  -> ATTACH (return its URL; spawn NOTHING)
//   - no / unhealthy response       -> spawn ONE board on that port
//   - NEVER SIGTERM a healthy board (no killPortIfBoard in the spawn path)
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = Number(process.env.CONDUCTOR_PORT) || 3042;

/**
 * The single consolidated health check. GET /health on a local port; resolves
 * the parsed health body when the board answers "ok", otherwise null. This is
 * the one impl ensureBoard uses; other call sites should import this too.
 */
export function getHealth(port, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const body = JSON.parse(data);
            resolve(res.statusCode === 200 && body?.status === "ok" ? { port, ...body } : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * The single canonical, stable browser URL for a port. Opening the SAME URL on
 * re-run lets the OS focus the existing tab instead of stacking a new one.
 */
export function canonicalUrl(port, workflow) {
  const u = new URL("http://localhost:" + port + "/");
  if (workflow) u.searchParams.set("wf", workflow);
  return u.toString();
}

/** The single openBrowser impl — best-effort, focuses via the stable URL. */
export function openBrowser(url) {
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
    /* opening the browser is best-effort */
  }
}

function boardCliPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
}

/**
 * Ensure exactly one board is live on port.
 *
 * @param {number} port            canonical port (configurable; identity = port)
 * @param {object} opts
 * @param {string} [opts.statusPath]   status.json the spawned board should watch
 * @param {string} [opts.workflowPath] workflow.json the spawned board should serve
 * @param {boolean} [opts.headless]    spawn headless; the caller owns the tab
 * @param {number} [opts.waitMs]       how long to wait for a freshly spawned board
 *
 * @returns {Promise<{url:string, port:number, attached:boolean, spawned:boolean, health:object|null}>}
 */
export async function ensureBoard(port = DEFAULT_PORT, opts = {}) {
  const { statusPath, workflowPath, waitMs = 8000 } = opts;
  const p = Number(port) || DEFAULT_PORT;

  // 1. ATTACH: a healthy board on the port IS the board — spawn nothing.
  const existing = await getHealth(p);
  if (existing) {
    // PHASE B: registering this root is what makes the ONE board span every
    // project. Attaching (not spawning) is Phase A; adding our root to the
    // machine-wide registry tells the live board to discover + watch it too.
    if (statusPath) registerRoot(path.dirname(path.resolve(statusPath)));
    registerBoard({ port: p, pid: existing.pid, url: canonicalUrl(p) });
    return { url: canonicalUrl(p), port: p, attached: true, spawned: false, health: existing };
  }

  // 2. SPAWN ONE: no/unhealthy response. NEVER SIGTERM a healthy board — we
  //    only reach here because /health did not answer ok, so there is no
  //    healthy incumbent to kill.
  const spawnArgs = [boardCliPath(), "--port", String(p)];
  if (statusPath) spawnArgs.push("--path", statusPath);
  if (workflowPath) spawnArgs.push("--workflow", workflowPath);
  // The spawned board runs headless/detached; the caller owns opening the tab.
  spawnArgs.push("--headless");

  let logOut = "ignore";
  try {
    if (statusPath) {
      const dir = path.dirname(statusPath);
      fs.mkdirSync(dir, { recursive: true });
      logOut = fs.openSync(path.join(dir, "board.log"), "a");
    }
  } catch {
    logOut = "ignore";
  }

  const child = spawn(process.execPath, spawnArgs, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logOut, logOut],
    env: { ...process.env, CONDUCTOR_HEADLESS: "1" },
  });
  child.unref();

  // Wait for the freshly spawned board to answer /health on the port.
  const start = Date.now();
  let health = null;
  while (Date.now() - start < waitMs) {
    health = await getHealth(p);
    if (health) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // PHASE B: the board we just spawned should also watch our root via the
  // machine-wide registry (so later attaches from other projects union in).
  if (statusPath) registerRoot(path.dirname(path.resolve(statusPath)));
  registerBoard({ port: p, pid: health?.pid, url: canonicalUrl(p) });

  return { url: canonicalUrl(p), port: p, attached: false, spawned: true, health };
}
