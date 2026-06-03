// Zero-dependency board server.
//
// Responsibilities:
//   1. Serve the built React app (dist/) over plain HTTP.
//   2. Expose GET /api/state — a snapshot of { conductorYaml, status }.
//   3. Stream GET /events (Server-Sent Events) — pushes a fresh snapshot every
//      time .conductor/status.json (or the conductor file) changes on disk.
//
// The server never parses YAML (keeps it dependency-free) — it ships the raw
// conductor text to the browser, which parses it client-side.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Find the conductor definition file that pairs with a status.json. */
function discoverConductor(statusPath, explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const dir = path.dirname(statusPath);
  const candidates = [
    path.join(dir, "conductor.yaml"),
    path.join(dir, "conductor.yml"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // any *.yaml / *.yml sitting next to the status file
  if (fs.existsSync(dir)) {
    const yaml = fs
      .readdirSync(dir)
      .find((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    if (yaml) return path.join(dir, yaml);
  }
  // fall back to a conductor file in the working directory
  for (const c of ["conductor.yaml", "conductor.yml"]) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readSnapshot(statusPath, conductorPath) {
  let status = null;
  let conductorYaml = null;
  try {
    if (fs.existsSync(statusPath)) {
      status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    }
  } catch (e) {
    status = { _error: `Could not parse status.json: ${e.message}` };
  }
  try {
    if (conductorPath && fs.existsSync(conductorPath)) {
      conductorYaml = fs.readFileSync(conductorPath, "utf8");
    }
  } catch {
    /* conductor optional — board degrades gracefully */
  }
  return {
    status,
    conductorYaml,
    statusPath,
    conductorPath: conductorPath ?? null,
  };
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  let filePath = path.join(DIST, path.normalize(urlPath));
  // contain within DIST
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html"); // SPA fallback
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end("Board not built. Run `npm run build` first.");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

export function startServer({ statusPath, conductorPath: explicitConductor, port }) {
  const absStatus = path.resolve(process.cwd(), statusPath);
  let conductorPath = discoverConductor(absStatus, explicitConductor);

  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();

  const broadcast = () => {
    // conductor may appear after the server starts — re-discover if missing
    if (!conductorPath) conductorPath = discoverConductor(absStatus, explicitConductor);
    const payload = JSON.stringify(readSnapshot(absStatus, conductorPath));
    for (const res of clients) {
      res.write(`event: update\ndata: ${payload}\n\n`);
    }
  };

  // Watch the directory that holds the status file (more reliable than
  // watching a single file that gets atomically replaced). Debounced.
  const watchDir = path.dirname(absStatus);
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(broadcast, 80);
  };
  try {
    fs.mkdirSync(watchDir, { recursive: true });
    fs.watch(watchDir, schedule);
  } catch (e) {
    console.warn(`[agent-conductor] watch failed: ${e.message}`);
  }

  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/state") {
      if (!conductorPath) conductorPath = discoverConductor(absStatus, explicitConductor);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(readSnapshot(absStatus, conductorPath)));
      return;
    }

    if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      // send an immediate snapshot so the board paints on connect
      res.write(
        `event: update\ndata: ${JSON.stringify(
          readSnapshot(absStatus, conductorPath),
        )}\n\n`,
      );
      clients.add(res);
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }

    serveStatic(req, res);
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, conductorPath, absStatus }));
  });
}
