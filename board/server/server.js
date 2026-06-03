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

let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"),
  ).version;
} catch {
  /* version is best-effort */
}

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

// ---------------------------------------------------------------------------
// History — completed/failed runs are archived as self-contained records.
// ---------------------------------------------------------------------------

const safeId = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, "-");

function summarize(record) {
  // everything except the heavy snapshot — for the sidebar list
  const { snapshot, ...rest } = record;
  void snapshot;
  return rest;
}

function listHistory(historyDir) {
  if (!fs.existsSync(historyDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(historyDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(historyDir, f), "utf8"));
      out.push({ ...summarize(rec), filename: f });
    } catch {
      /* skip a corrupt archive */
    }
  }
  // newest first
  const key = (r) => r.completed_at || r.archived_at || r.started_at || "";
  return out.sort((a, b) => String(key(b)).localeCompare(String(key(a))));
}

/** Resolve a history record by filename (with or without .json) or by run_id. */
function getHistory(historyDir, id) {
  if (!fs.existsSync(historyDir)) return null;
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(historyDir, f), "utf8"));
    } catch {
      return null;
    }
  };
  // exact filename
  for (const cand of [id, `${id}.json`]) {
    if (cand.endsWith(".json") && fs.existsSync(path.join(historyDir, cand))) {
      const rec = read(cand);
      if (rec) return rec;
    }
  }
  // scan: match run_id or filename
  for (const f of fs.readdirSync(historyDir)) {
    if (!f.endsWith(".json")) continue;
    const rec = read(f);
    if (rec && (rec.run_id === id || f === id || f === `${id}.json`)) return rec;
  }
  return null;
}

/** Archive a run once it is done/failed. Returns the record if newly written. */
function archiveIfDone(historyDir, snapshot, archived) {
  const status = snapshot.status;
  if (!status || (status.status !== "done" && status.status !== "failed")) return null;

  const runId =
    status.run_id ||
    (status.started_at ? safeId(status.started_at).replace(/-\d+Z$/, "") : null);
  if (!runId || archived.has(runId)) return null;

  const workflow = status.workflow || "workflow";
  // {run_id}_{workflow}.json — e.g. 2026-06-03T14-30-00_treatment-page.json
  const file = path.join(historyDir, `${safeId(runId)}_${safeId(workflow)}.json`);
  if (fs.existsSync(file)) {
    archived.add(runId);
    return null;
  }

  const steps = status.steps || {};
  const total = Object.keys(steps).length;
  const done = Object.values(steps).filter((s) => s && s.status === "done").length;

  const record = {
    run_id: runId,
    workflow: status.workflow || "workflow",
    status: status.status,
    started_at: status.started_at || null,
    completed_at: status.completed_at || new Date().toISOString(),
    archived_at: new Date().toISOString(),
    done,
    total,
    snapshot: { status, conductorYaml: snapshot.conductorYaml ?? null },
  };

  try {
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    archived.add(runId);
    return record;
  } catch (e) {
    console.warn(`[agent-conductor] could not archive ${runId}: ${e.message}`);
    return null;
  }
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

/** Best-effort workflow name without parsing YAML (keeps the server dep-free). */
function workflowName(statusPath, conductorPath, dir) {
  try {
    if (fs.existsSync(statusPath)) {
      const s = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      if (s && typeof s.workflow === "string") return s.workflow;
    }
  } catch {
    /* ignore */
  }
  try {
    if (conductorPath && fs.existsSync(conductorPath)) {
      const m = fs.readFileSync(conductorPath, "utf8").match(/^name:\s*(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch {
    /* ignore */
  }
  return path.basename(dir);
}

/**
 * Discover workflows under the .conductor root. Supports both the flat layout
 * (.conductor/status.json — a single workflow, for v1 backwards compatibility)
 * and the subdirectory layout (.conductor/<name>/status.json — many workflows).
 */
function discoverWorkflows(conductorDir, explicitStatus, explicitConductor) {
  const found = [];
  const seen = new Set();
  const add = (name, dir, statusPath, conductorPath) => {
    if (seen.has(name)) return;
    seen.add(name);
    found.push({
      name,
      dir,
      statusPath,
      conductorPath,
      historyDir: path.join(dir, "history"),
    });
  };

  // flat / explicit --path
  const flatStatus = explicitStatus || path.join(conductorDir, "status.json");
  const flatConductor = discoverConductor(flatStatus, explicitConductor);
  if (fs.existsSync(flatStatus) || (flatConductor && fs.existsSync(flatConductor))) {
    add(workflowName(flatStatus, flatConductor, conductorDir), conductorDir, flatStatus, flatConductor);
  }

  // subdirectories
  if (fs.existsSync(conductorDir)) {
    for (const entry of fs.readdirSync(conductorDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "history") continue;
      const dir = path.join(conductorDir, entry.name);
      const sp = path.join(dir, "status.json");
      const cp = fs.existsSync(path.join(dir, "conductor.yaml"))
        ? path.join(dir, "conductor.yaml")
        : discoverConductor(sp, null);
      if (fs.existsSync(sp) || (cp && fs.existsSync(cp))) {
        add(workflowName(sp, cp, dir), dir, sp, cp);
      }
    }
  }
  return found;
}

export function startServer({ statusPath, conductorPath: explicitConductor, port }) {
  const absStatus = path.resolve(process.cwd(), statusPath);
  const conductorDir = path.dirname(absStatus);

  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();
  /** @type {Map<string, Set<string>>} per-workflow archived run ids */
  const archivedByWf = new Map();

  const archivedSetFor = (wf) => {
    let set = archivedByWf.get(wf.name);
    if (!set) {
      set = new Set();
      for (const r of listHistory(wf.historyDir)) if (r.run_id) set.add(r.run_id);
      archivedByWf.set(wf.name, set);
    }
    return set;
  };

  const snapshotFor = (wf) => {
    const snap = readSnapshot(wf.statusPath, wf.conductorPath);
    snap.workflow = wf.name;
    return snap;
  };

  const findWf = (name) =>
    discoverWorkflows(conductorDir, absStatus, explicitConductor).find((w) => w.name === name);

  const sendAll = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const broadcast = () => {
    for (const wf of discoverWorkflows(conductorDir, absStatus, explicitConductor)) {
      const snap = snapshotFor(wf);
      sendAll("update", snap);
      if (archiveIfDone(wf.historyDir, snap, archivedSetFor(wf))) {
        sendAll("history", { workflow: wf.name, runs: listHistory(wf.historyDir) });
      }
    }
  };

  // Recursively watch the .conductor root so subdirectory status files are seen.
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(broadcast, 80);
  };
  try {
    fs.mkdirSync(conductorDir, { recursive: true });
    try {
      fs.watch(conductorDir, { recursive: true }, schedule);
    } catch {
      fs.watch(conductorDir, schedule); // platforms without recursive watch
    }
  } catch (e) {
    console.warn(`[conductor-board] watch failed: ${e.message}`);
  }

  const sendSnapshotsTo = (res) => {
    for (const wf of discoverWorkflows(conductorDir, absStatus, explicitConductor)) {
      res.write(`event: update\ndata: ${JSON.stringify(snapshotFor(wf))}\n\n`);
      res.write(
        `event: history\ndata: ${JSON.stringify({
          workflow: wf.name,
          runs: listHistory(wf.historyDir),
        })}\n\n`,
      );
    }
  };

  const json = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const wfs = () => discoverWorkflows(conductorDir, absStatus, explicitConductor);

    if (url === "/health") {
      return json(res, 200, {
        status: "ok",
        version: VERSION,
        watching: path.relative(process.cwd(), conductorDir) || conductorDir,
        port: server.address()?.port ?? null,
        workflows: wfs().map((w) => w.name),
      });
    }

    // ---- multi-workflow API ----
    if (url === "/api/workflows") {
      return json(
        res,
        200,
        wfs().map((wf) => {
          const snap = snapshotFor(wf);
          const st = snap.status?.status;
          return {
            name: wf.name,
            status: st ?? "idle",
            active: st === "running",
            done: snap.status?.steps
              ? Object.values(snap.status.steps).filter((s) => s && s.status === "done").length
              : 0,
            total: snap.status?.steps ? Object.keys(snap.status.steps).length : 0,
            started_at: snap.status?.started_at ?? null,
            runs: listHistory(wf.historyDir).length,
            hasConductor: !!snap.conductorYaml,
          };
        }),
      );
    }

    let m;
    if ((m = url.match(/^\/api\/workflow\/([^/]+)\/state$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      return wf ? json(res, 200, snapshotFor(wf)) : json(res, 404, { error: "not found" });
    }
    if ((m = url.match(/^\/api\/workflow\/([^/]+)\/history$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      return wf ? json(res, 200, listHistory(wf.historyDir)) : json(res, 404, { error: "not found" });
    }
    if ((m = url.match(/^\/api\/workflow\/([^/]+)\/history\/(.+)$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "not found" });
      const rec = getHistory(wf.historyDir, decodeURIComponent(m[2]));
      return rec ? json(res, 200, rec) : json(res, 404, { error: "not found" });
    }

    // ---- backwards-compatible single-workflow API (primary = first found) ----
    const primary = wfs()[0];
    if (url === "/api/state") {
      return json(res, 200, primary ? snapshotFor(primary) : { status: null, conductorYaml: null });
    }
    if (url === "/history") {
      return json(res, 200, primary ? listHistory(primary.historyDir) : []);
    }
    if (url.startsWith("/history/")) {
      const id = decodeURIComponent(url.slice("/history/".length));
      const rec = primary ? getHistory(primary.historyDir, id) : null;
      return rec ? json(res, 200, rec) : json(res, 404, { error: "not found" });
    }

    if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      sendSnapshotsTo(res);
      clients.add(res);
      const hb = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(hb);
        clients.delete(res);
      });
      return;
    }

    serveStatic(req, res);
  });

  const serverJsonPath = path.join(conductorDir, "server.json");

  return new Promise((resolve, reject) => {
    // Reject on listen errors (e.g. EADDRINUSE) so the CLI can walk to the next
    // port instead of crashing on an unhandled 'error' event.
    const onError = (e) => {
      server.off("error", onError);
      reject(e);
    };
    server.once("error", onError);
    server.listen(port, () => {
      server.off("error", onError);
      const actualPort = server.address().port;
      const discovered = discoverWorkflows(conductorDir, absStatus, explicitConductor);
      try {
        fs.mkdirSync(conductorDir, { recursive: true });
        fs.writeFileSync(
          serverJsonPath,
          JSON.stringify(
            {
              port: actualPort,
              url: `http://localhost:${actualPort}`,
              pid: process.pid,
              started_at: new Date().toISOString(),
              workflows: discovered.map((w) => w.name),
            },
            null,
            2,
          ),
        );
      } catch (e) {
        console.warn(`[conductor-board] could not write server.json: ${e.message}`);
      }
      resolve({
        server,
        serverJsonPath,
        absStatus,
        conductorPath: discovered[0]?.conductorPath ?? null,
        workflows: discovered.map((w) => w.name),
      });
    });
  });
}
