// Zero-dependency board server.
//
// Responsibilities:
//   1. Serve the built React app (dist/) over plain HTTP.
//   2. Expose GET /api/state — a snapshot of { workflowJson, status }.
//   3. Stream GET /events (Server-Sent Events) — pushes a fresh snapshot every
//      time .conductor/status.json (or the conductor file) changes on disk.
//
// The server ships the raw workflow JSON to the browser, which parses it client-side.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { integrateRoot } from "../cli/integration.js";
import { ensureKnowledge, readJsonMaybe, timestampRunId } from "../cli/learning.js";
import { validateConductor } from "../cli/validate.js";

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

/** Apply optimization suggestions to a parsed conductor doc (in place). */
function applyMutations(doc, suggestions) {
  doc.steps = Array.isArray(doc.steps) ? doc.steps : [];
  const byId = new Map(doc.steps.map((s, i) => [String(i), s]));
  for (const sug of suggestions) {
    const step = sug.step ? byId.get(sug.step) : null;
    switch (sug.type) {
      case "instruction":
        if (step) {
          if (sug.current && typeof step.instruction === "string" && step.instruction.includes(sug.current)) {
            step.instruction = step.instruction.replace(sug.current, sug.proposed ?? "");
          } else if (sug.proposed) {
            step.instruction = sug.proposed;
          }
        }
        break;
      case "gate":
        if (step && Array.isArray(step.gate)) {
          const i = step.gate.findIndex((g) => g === sug.current);
          if (i >= 0 && sug.proposed != null) step.gate[i] = sug.proposed;
          else if (sug.proposed != null) step.gate.push(sug.proposed);
        }
        break;
      case "new_gate":
        if (step && sug.proposed != null) {
          step.gate = sug.proposed;
        }
        break;
      case "new_step":
        doc.steps.push({
          id: sug.step || `step-${doc.steps.length + 1}`,
          instruction: sug.proposed || "TODO",
        });
        break;
      case "remove_step":
        if (sug.step) doc.steps = doc.steps.filter((_, i) => String(i) !== String(sug.step));
        break;
      // `reorder` is not auto-applied in v1
    }
  }
  return doc;
}

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
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const ARTIFACT_MAX_BYTES = 1024 * 1024;
const PREVIEW_EXTENSIONS = new Set([".md", ".txt", ".json", ".log", ".html", ".csv", ".tsv"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

function artifactPreviewKind(ext) {
  if (PREVIEW_EXTENSIONS.has(ext)) return ext === ".html" ? "html" : "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  return "download";
}

function isDiagnosticArtifact(relPath) {
  const name = path.basename(String(relPath || ""));
  return /(^|-)check-prompt\.(txt|md)$/i.test(name) || /^attempt-\d+-(compose|check)-(prompt|raw)\.(txt|md)$/i.test(name);
}

function artifactRootFor(wf) {
  const current = path.join(wf.dir, "artifacts");
  if (fs.existsSync(current)) return current;
  const legacy = path.join(wf.dir, "outputs");
  return fs.existsSync(legacy) ? legacy : current;
}

function initRuntimeStatus(workflow, statusPath) {
  const now = new Date().toISOString();
  const runId = now.replace(/\.\d+Z$/, "").replace(/:/g, "-");
  const nameSlug = String(workflow.name || "workflow").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const historyDir = path.join(path.dirname(statusPath), "history");
  let priorRuns = 0;
  try {
    priorRuns = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).length;
  } catch {
    /* no history yet */
  }
  const tsShort = runId.replace(/-\d{2}$/, "");
  const steps = {};
  for (const [index] of (workflow.steps || []).entries()) {
    steps[String(index)] = { status: "pending", gate: "pending", attempt: 1 };
  }
  return {
    workflow: workflow.name || "workflow",
    run_id: runId,
    run_name: `${nameSlug}-run-${priorRuns + 1}-${tsShort}`,
    auto_improve: workflow.auto_improve === true,
    status: "running",
    goal: workflow.description || workflow.name || "workflow",
    current_step: null,
    started_at: now,
    steps,
  };
}

function openKnowledgeItems(wf) {
  const knowledge = ensureKnowledge(wf.dir);
  return knowledge.items.filter((item) => item && item.status === "open");
}

function latestIntegrationSummary(wf) {
  const runs = path.join(wf.dir, "runs");
  if (!fs.existsSync(runs)) return null;
  const dirs = fs.readdirSync(runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const dir of dirs) {
    const summary = readJsonMaybe(path.join(runs, dir, "integration-summary.json"));
    if (summary) return summary;
  }
  return null;
}

function safeArtifactPath(wf, relPath) {
  const root = artifactRootFor(wf);
  const clean = String(relPath || "").replace(/^[/\\]+/, "");
  const abs = path.resolve(root, clean);
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { root, abs, rel: relative.split(path.sep).join("/") };
}

function listArtifacts(wf) {
  const root = artifactRootFor(wf);
  if (!fs.existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (isDiagnosticArtifact(rel)) continue;
      files.push({
        path: rel,
        name: path.basename(rel),
        size: st.size,
        mtime: st.mtime.toISOString(),
        mime: MIME[path.extname(rel).toLowerCase()] || "application/octet-stream",
        preview_kind: artifactPreviewKind(path.extname(rel).toLowerCase()),
      });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Find the conductor definition file that pairs with a status.json. */
function discoverConductor(statusPath, explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  const dir = path.dirname(statusPath);
  const candidates = [
    path.join(dir, "workflow.json"),
    path.join(path.dirname(path.dirname(dir)), "workflow.json"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // fall back to a conductor file in the working directory
  for (const c of ["workflow.json"]) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readSnapshot(statusPath, conductorPath) {
  let status = null;
  let workflowJson = null;
  let knowledgeJson = null;
  const workflowDir = path.dirname(statusPath);
  try {
    if (fs.existsSync(statusPath)) {
      status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    }
  } catch (e) {
    status = { _error: `Could not parse status.json: ${e.message}` };
  }
  try {
    if (conductorPath && fs.existsSync(conductorPath)) {
      workflowJson = fs.readFileSync(conductorPath, "utf8");
    }
  } catch {
    /* conductor optional — board degrades gracefully */
  }
  try {
    const knowledgePath = path.join(workflowDir, "knowledge.json");
    if (fs.existsSync(knowledgePath)) {
      knowledgeJson = fs.readFileSync(knowledgePath, "utf8");
    }
  } catch {
    /* knowledge optional */
  }
  return {
    status,
    workflowJson,
    knowledgeJson,
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

  // Capturing learnings is now enforced by the final step's knowledge gate
  // (`conductor-board knowledge --min 3`), not the archiver — suggestions are
  // written to the conductor's knowledge section, not status.json.

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
    run_name: status.run_name || null,
    workflow: status.workflow || "workflow",
    status: status.status,
    started_at: status.started_at || null,
    completed_at: status.completed_at || new Date().toISOString(),
    archived_at: new Date().toISOString(),
    done,
    total,
    snapshot: { status, workflowJson: snapshot.workflowJson ?? null },
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

// ---------------------------------------------------------------------------
// Insights ledger — a persistent, accumulating memory per workflow.
//
// insights.json is the source of truth (structured, with apply/dismiss state);
// insights.md is a human- and agent-readable view regenerated on every change.
// Suggestions from each completed run are merged in (deduped) as `open`; the
// board lets the user apply or dismiss them, which updates both files.
// ---------------------------------------------------------------------------

const insightsPaths = (wf) => ({
  json: path.join(wf.dir, "insights.json"),
  md: path.join(wf.dir, "insights.md"),
});

const insightKey = (s) =>
  `${s.type || "note"}::${s.step || ""}::${String(s.title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")}`;

function loadInsights(wf) {
  try {
    const l = JSON.parse(fs.readFileSync(insightsPaths(wf).json, "utf8"));
    if (l && Array.isArray(l.items)) return l;
  } catch {
    /* fresh ledger */
  }
  return { workflow: wf.name, items: [] };
}

// Confidence auto-escalates with evidence (§5.2):
//   low (1×) → medium (2–3×) → high (4×) → proven (applied + measured impact,
//   or observed 5×+). A higher confidence is never downgraded.
const CONF_RANK = { low: 0, medium: 1, high: 2, proven: 3 };
function deriveConfidence(item) {
  const obs = item.times_observed || 1;
  const applied = item.times_applied || 0;
  let evidence = "low";
  if ((applied >= 1 && item.impact_when_applied) || obs >= 5) evidence = "proven";
  else if (obs >= 4) evidence = "high";
  else if (obs >= 2) evidence = "medium";
  const declared = item.confidence || "low";
  return CONF_RANK[evidence] >= CONF_RANK[declared] ? evidence : declared;
}

const CONF_BADGE = { proven: "✅", high: "🟢", medium: "🟡", low: "⚪" };

function renderInsightsMd(ledger) {
  const open = ledger.items.filter((i) => i.status === "open");
  const applied = ledger.items.filter((i) => i.status === "applied");
  const dismissed = ledger.items.filter((i) => i.status === "dismissed");
  const byConf = (c) => open.filter((i) => (i.confidence || "low") === c && (i.scope || "this-conductor") === "this-conductor");
  const byScope = (sc) => open.filter((i) => (i.scope || "this-conductor") === sc);

  const line = (i) => {
    const n = i.times_observed || 1;
    const seen = `${n}× observed`;
    const ap = i.times_applied ? `, applied` : "";
    const imp = i.impact_when_applied ? ` — ${i.impact_when_applied}` : "";
    return `- ${CONF_BADGE[i.confidence || "low"] || "⚪"} ${i.title} ${`_(${seen}${ap})_`}${imp}`;
  };
  const sect = (title, items) =>
    `## ${title}\n${items.length ? items.map(line).join("\n") : "_none yet_"}\n`;

  return (
    `# Conductor insights — ${ledger.workflow}\n\n` +
    `_Accumulated across runs. The agent reads this at the start of each run and ` +
    `automatically applies **proven** patterns; the board appends new sightings, ` +
    `escalates confidence with evidence, and routes cross-cutting insights by scope._\n\n` +
    sect("Proven — auto-applied", byConf("proven")) +
    `\n` +
    sect("High confidence", byConf("high")) +
    `\n` +
    sect("Emerging (2–3×, watching)", byConf("medium")) +
    `\n` +
    sect("New (1×)", byConf("low")) +
    `\n` +
    sect("Upstream — routed outside this conductor", byScope("upstream")) +
    `\n` +
    sect("Template", byScope("template")) +
    `\n` +
    sect("Tooling — improvements to agent-conductor itself", byScope("tooling")) +
    `\n` +
    sect("Corpus", byScope("corpus")) +
    `\n` +
    sect("Applied", applied) +
    `\n` +
    sect("Dismissed", dismissed)
  );
}

function saveInsights(wf, ledger) {
  const { json, md } = insightsPaths(wf);
  try {
    fs.mkdirSync(wf.dir, { recursive: true });
    fs.writeFileSync(json, JSON.stringify(ledger, null, 2));
    fs.writeFileSync(md, renderInsightsMd(ledger));
  } catch (e) {
    console.warn(`[conductor-board] could not write insights: ${e.message}`);
  }
}

/**
 * Merge a run's suggestions into the ledger. A repeat sighting of an existing
 * insight is NOT dropped — it adds an observation, bumps times_observed, and
 * re-escalates confidence (§5.2). New insights enter as `open` at low/declared
 * confidence. Returns true if anything changed.
 */
function mergeInsights(wf, suggestions, runId, at) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return false;
  const ledger = loadInsights(wf);
  const byKey = new Map(ledger.items.map((i) => [i.key, i]));
  const when = at || new Date().toISOString();
  let changed = 0;
  for (const s of suggestions) {
    if (!s || !s.title) continue;
    const key = insightKey(s);
    const obs = { run: runId || "?", at: when, note: s.rationale || s.title };
    const existing = byKey.get(key);
    if (existing) {
      existing.observations = Array.isArray(existing.observations) ? existing.observations : [];
      // don't double-count the same run; times_observed tracks the sighting count
      if (!existing.observations.some((o) => o.run === obs.run)) {
        existing.observations.push(obs);
        existing.times_observed = existing.observations.length;
      }
      // freshen mutable fields if the new sighting carries more detail
      if (s.scope) existing.scope = s.scope;
      if (s.impact) existing.impact_when_applied = s.impact;
      if (s.current) existing.current = s.current;
      if (s.proposed) existing.proposed = s.proposed;
      if (s.rationale) existing.rationale = s.rationale;
      if (existing.status !== "dismissed") existing.confidence = deriveConfidence(existing);
      changed += 1;
    } else {
      const item = {
        key,
        type: s.type || "note",
        step: s.step,
        scope: s.scope || "this-conductor",
        title: s.title,
        rationale: s.rationale,
        current: s.current,
        proposed: s.proposed,
        impact_when_applied: s.impact,
        confidence: s.confidence || "low",
        observations: [obs],
        times_observed: 1,
        times_applied: 0,
        source_heartbeat: s.source_heartbeat,
        status: "open",
        provenance: `run ${runId || "?"}`,
        first_seen_at: when,
      };
      item.confidence = deriveConfidence(item);
      ledger.items.push(item);
      byKey.set(key, item);
      changed += 1;
    }
  }
  if (changed) saveInsights(wf, ledger);
  return changed > 0;
}

/**
 * Promote proven insights into the conductor's `knowledge:` section and
 * auto-apply proven `this-conductor` insights (§5.3, §5.4). Proven patterns no
 * longer need human gatekeeping — they travel with the repo as knowledge, and
 * step-scoped ones mutate the conductor directly. Returns true if files changed.
 */
function consolidateProven(wf) {
  const ledger = loadInsights(wf);
  const proven = ledger.items.filter(
    (i) => i.status !== "dismissed" && (i.confidence || "low") === "proven",
  );
  if (proven.length === 0) return false;
  if (!wf.conductorPath || !fs.existsSync(wf.conductorPath)) return false;

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(wf.conductorPath, "utf8"));
  } catch {
    return false;
  }
  if (!doc || typeof doc !== "object") return false;

  let docChanged = false;
  let ledgerChanged = false;

  // 1. knowledge promotion — every proven insight becomes a knowledge line
  doc.knowledge = Array.isArray(doc.knowledge) ? doc.knowledge : [];
  for (const i of proven) {
    const tag = `[proven, ${i.times_observed || 1} run${(i.times_observed || 1) === 1 ? "" : "s"}]`;
    const lineKey = i.title.trim().toLowerCase();
    const already = doc.knowledge.some(
      (k) => typeof k === "string" && k.trim().toLowerCase().startsWith(lineKey),
    );
    if (!already) {
      doc.knowledge.push(`${i.title} ${tag}`);
      docChanged = true;
    }
  }

  // 2. auto-apply proven, step-scoped (this-conductor) insights still open
  const appliable = proven.filter(
    (i) => i.status === "open" && (i.scope || "this-conductor") === "this-conductor",
  );
  if (appliable.length) {
    applyMutations(doc, appliable);
    const errors = validateConductor(doc);
    if (errors.length === 0) {
      for (const i of appliable) {
        i.status = "applied";
        i.times_applied = (i.times_applied || 0) + 1;
        i.decided_at = new Date().toISOString();
        ledgerChanged = true;
      }
      docChanged = true;
    }
  }

  if (docChanged) {
    try {
      fs.writeFileSync(wf.conductorPath, JSON.stringify(doc, null, 2) + "\n");
    } catch (e) {
      console.warn(`[conductor-board] could not write knowledge: ${e.message}`);
    }
  }
  if (ledgerChanged) saveInsights(wf, ledger);
  return docChanged || ledgerChanged;
}

/** Mark ledger items applied/dismissed/open by key. */
function decideInsights(wf, keys, status) {
  const ledger = loadInsights(wf);
  let changed = 0;
  for (const it of ledger.items) {
    if (keys.includes(it.key) && it.status !== status) {
      it.status = status;
      it.decided_at = new Date().toISOString();
      changed += 1;
    }
  }
  if (changed) saveInsights(wf, ledger);
  return changed;
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
  const headers = { "content-type": MIME[ext] || "application/octet-stream" };
  // index.html must always revalidate so a fresh build is picked up on reload;
  // the hashed /assets/ files are content-addressed, so cache them hard.
  if (ext === ".html") {
    headers["cache-control"] = "no-cache, no-store, must-revalidate";
  } else if (urlPath.startsWith("/assets/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

/** Best-effort workflow name from status/conductor paths. */
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
      const cp = fs.existsSync(path.join(dir, "workflow.json"))
        ? path.join(dir, "workflow.json")
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
      const rec = archiveIfDone(wf.historyDir, snap, archivedSetFor(wf));
      if (rec) {
        // Insights live in the conductor's knowledge section (written by the
        // agent via `suggest`), not a separate ledger — nothing to merge here.
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
      res.write(
        `event: insights\ndata: ${JSON.stringify({
          workflow: wf.name,
          ledger: loadInsights(wf),
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
      const workflows = {};
      for (const wf of wfs()) {
        let kb = 0;
        let beats = 0;
        let st = null;
        try {
          kb = Math.round(fs.statSync(wf.statusPath).size / 1024);
        } catch {
          /* no status file yet */
        }
        try {
          const s = JSON.parse(fs.readFileSync(wf.statusPath, "utf8"));
          st = s.status ?? "idle";
          beats = Object.values(s.steps || {}).reduce(
            (n, x) => n + (Array.isArray(x && x.heartbeat) ? x.heartbeat.length : 0),
            0,
          );
        } catch {
          /* unreadable / not started */
        }
        let archiveLines = 0;
        try {
          archiveLines = fs
            .readFileSync(path.join(wf.dir, "heartbeat-archive.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean).length;
        } catch {
          /* no archive */
        }
        workflows[wf.name] = {
          status: st ?? "idle",
          status_file_kb: kb,
          heartbeat_count: beats,
          archive_lines: archiveLines,
          history_count: listHistory(wf.historyDir).length,
        };
      }
      return json(res, 200, {
        status: "ok",
        version: VERSION,
        pid: process.pid,
        port: server.address()?.port ?? null,
        uptime_seconds: Math.round(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        watching: path.relative(process.cwd(), conductorDir) || conductorDir,
        conductor_root: conductorDir,
        workflows,
        sse_connections: clients.size,
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
          // Phase 0 (_improve::* / _validate) cards are a pre-flight, not the work.
          const wfSteps = Object.entries(snap.status?.steps ?? {}).filter(
            ([id]) => !id.startsWith("_improve::") && id !== "_validate" && id !== "_improve",
          );
          return {
            name: wf.name,
            status: st ?? "idle",
            active: st === "running",
            done: wfSteps.filter(([, s]) => s && s.status === "done").length,
            total: wfSteps.length,
            started_at: snap.status?.started_at ?? null,
            runs: listHistory(wf.historyDir).length,
            hasConductor: !!snap.workflowJson,
          };
        }),
      );
    }

    let m;

    // apply optimization suggestions back to the conductor (mutate + backup + re-validate)
    if (req.method === "POST" && (m = url.match(/^\/api\/workflow\/([^/]+)\/apply-suggestion$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "workflow not found" });
      readBody(req).then((bodyStr) => {
        let payload;
        try {
          payload = JSON.parse(bodyStr || "{}").suggestions;
        } catch {
          return json(res, 400, { error: "invalid request body" });
        }
        if (!Array.isArray(payload) || payload.length === 0)
          return json(res, 400, { error: "suggestions must be a non-empty array" });
        if (!wf.conductorPath || !fs.existsSync(wf.conductorPath))
          return json(res, 400, { error: "no conductor file for this workflow" });

        // Accept either a list of ids (resolved against the live status) or full
        // suggestion objects — the latter lets a past run's suggestions apply
        // even after the live status has moved on to another run.
        let chosen;
        if (payload.every((x) => typeof x === "string")) {
          let status;
          try {
            status = JSON.parse(fs.readFileSync(wf.statusPath, "utf8"));
          } catch {
            return json(res, 500, { error: "could not read status.json" });
          }
          chosen = (status.suggestions || []).filter((s) => payload.includes(s.id));
        } else {
          chosen = payload.filter((x) => x && typeof x === "object");
        }
        if (chosen.length === 0) return json(res, 400, { error: "no matching suggestions" });

        const original = fs.readFileSync(wf.conductorPath, "utf8");
        const backup = `${wf.conductorPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
        try {
          fs.writeFileSync(backup, original);
        } catch {
          /* backup best-effort */
        }

        let doc;
        try {
          doc = JSON.parse(original);
        } catch (e) {
          return json(res, 500, { error: `conductor parse error: ${e.message}` });
        }
        applyMutations(doc, chosen);

        const errors = validateConductor(doc);
        if (errors.length) {
          // leave the original conductor untouched (we never wrote it)
          return json(res, 422, { error: `would be invalid: ${errors[0]}`, errors });
        }
        try {
          fs.writeFileSync(wf.conductorPath, JSON.stringify(doc, null, 2) + "\n");
        } catch (e) {
          try {
            fs.writeFileSync(wf.conductorPath, original); // rollback
          } catch {
            /* ignore */
          }
          return json(res, 500, { error: `write failed, rolled back: ${e.message}` });
        }
        // record the decision in the persistent ledger and push it to clients
        decideInsights(wf, chosen.map(insightKey), "applied");
        sendAll("insights", { workflow: wf.name, ledger: loadInsights(wf) });
        return json(res, 200, {
          ok: true,
          applied: chosen.map((s) => s.id),
          backup: path.basename(backup),
        });
      });
      return;
    }

    if ((m = url.match(/^\/api\/workflow\/([^/]+)\/state$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      return wf ? json(res, 200, snapshotFor(wf)) : json(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && (m = url.match(/^\/api\/workflow\/([^/]+)\/artifacts$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "workflow not found" });
      return json(res, 200, {
        workflow: wf.name,
        root: path.relative(process.cwd(), artifactRootFor(wf)) || artifactRootFor(wf),
        files: listArtifacts(wf),
      });
    }
    if (req.method === "GET" && (m = url.match(/^\/api\/workflow\/([^/]+)\/artifact$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "workflow not found" });
      const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const resolved = safeArtifactPath(wf, parsed.searchParams.get("path"));
      if (!resolved || !fs.existsSync(resolved.abs)) return json(res, 404, { error: "artifact not found" });
      const st = fs.statSync(resolved.abs);
      if (!st.isFile()) return json(res, 404, { error: "artifact not found" });
      const ext = path.extname(resolved.rel).toLowerCase();
      const previewKind = artifactPreviewKind(ext);
      const rawUrl = `/api/workflow/${encodeURIComponent(wf.name)}/artifact-raw?path=${encodeURIComponent(resolved.rel)}`;
      if (st.size > ARTIFACT_MAX_BYTES) {
        return json(res, 200, {
          path: resolved.rel,
          name: path.basename(resolved.rel),
          size: st.size,
          mtime: st.mtime.toISOString(),
          mime: MIME[ext] || "application/octet-stream",
          previewable: previewKind === "image" || previewKind === "pdf",
          preview_kind: previewKind,
          too_large: true,
          max_preview_size: ARTIFACT_MAX_BYTES,
          content: "",
          download_url: rawUrl,
        });
      }
      if (previewKind !== "text" && previewKind !== "html") {
        return json(res, 200, {
          path: resolved.rel,
          name: path.basename(resolved.rel),
          size: st.size,
          mtime: st.mtime.toISOString(),
          mime: MIME[ext] || "application/octet-stream",
          previewable: previewKind === "image" || previewKind === "pdf",
          preview_kind: previewKind,
          content: "",
          download_url: rawUrl,
        });
      }
      let text = fs.readFileSync(resolved.abs, "utf8");
      if (ext === ".json") {
        try {
          text = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          /* show invalid JSON as written */
        }
      }
      return json(res, 200, {
        path: resolved.rel,
        name: path.basename(resolved.rel),
        size: st.size,
        mtime: st.mtime.toISOString(),
        mime: MIME[ext] || "text/plain; charset=utf-8",
        previewable: true,
        preview_kind: previewKind,
        content: text,
        download_url: rawUrl,
      });
    }
    if (req.method === "GET" && (m = url.match(/^\/api\/workflow\/([^/]+)\/artifact-raw$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "workflow not found" });
      const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const resolved = safeArtifactPath(wf, parsed.searchParams.get("path"));
      if (!resolved || !fs.existsSync(resolved.abs)) return json(res, 404, { error: "artifact not found" });
      const st = fs.statSync(resolved.abs);
      if (!st.isFile()) return json(res, 404, { error: "artifact not found" });
      const ext = path.extname(resolved.rel).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": st.size,
        "Content-Disposition": `inline; filename="${path.basename(resolved.rel).replace(/"/g, "")}"`,
      });
      fs.createReadStream(resolved.abs).pipe(res);
      return;
    }
    if (req.method === "GET" && (m = url.match(/^\/api\/workflow\/([^/]+)\/insights$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      return wf ? json(res, 200, loadInsights(wf)) : json(res, 404, { error: "not found" });
    }
    if (req.method === "POST" && (m = url.match(/^\/api\/workflow\/([^/]+)\/insights\/decide$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "not found" });
      readBody(req).then((bodyStr) => {
        let body;
        try {
          body = JSON.parse(bodyStr || "{}");
        } catch {
          return json(res, 400, { error: "invalid request body" });
        }
        const keys = Array.isArray(body.keys) ? body.keys : [];
        if (!["open", "applied", "dismissed"].includes(body.status))
          return json(res, 400, { error: "status must be open | applied | dismissed" });
        const changed = decideInsights(wf, keys, body.status);
        sendAll("insights", { workflow: wf.name, ledger: loadInsights(wf) });
        return json(res, 200, { ok: true, changed });
      });
      return;
    }

    // "Up next" — the human asks to continue to the next queued batch. We can't spawn an agent from
    // the board, so we record the request in status.json; the orchestrator/loop picks up next_requested.
    if (req.method === "POST" && (m = url.match(/^\/api\/workflow\/([^/]+)\/next$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "not found" });
      let status;
      try {
        status = JSON.parse(fs.readFileSync(wf.statusPath, "utf8"));
      } catch {
        return json(res, 500, { error: "could not read status.json" });
      }
      status.next_requested = { at: new Date().toISOString() };
      try {
        fs.writeFileSync(wf.statusPath, JSON.stringify(status, null, 2));
      } catch (e) {
        return json(res, 500, { error: `write failed: ${e.message}` });
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && (m = url.match(/^\/api\/workflow\/([^/]+)\/compile-summary$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "workflow not found" });
      const runtimeWorkflowPath = path.join(wf.dir, "workflow.json");
      let runtimeWorkflow = null;
      let status = null;
      let decomposition = null;
      let order = null;
      try {
        if (fs.existsSync(runtimeWorkflowPath)) runtimeWorkflow = JSON.parse(fs.readFileSync(runtimeWorkflowPath, "utf8"));
      } catch {
        /* summary can still render without it */
      }
      try {
        status = JSON.parse(fs.readFileSync(wf.statusPath, "utf8"));
      } catch {
        /* optional */
      }
      try {
        const p = path.join(wf.dir, "decomposition-check.json");
        if (fs.existsSync(p)) decomposition = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        /* optional */
      }
      try {
        const p = path.join(wf.dir, "order-check.json");
        if (fs.existsSync(p)) order = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        /* optional */
      }
      const cardCount = Array.isArray(runtimeWorkflow?.steps) ? runtimeWorkflow.steps.length : 0;
      const edgeCount = Array.isArray(runtimeWorkflow?.steps)
        ? runtimeWorkflow.steps.reduce((sum, step) => sum + (Array.isArray(step.requires) ? step.requires.length : 0), 0)
        : 0;
      return json(res, 200, {
        ok: true,
        ready: !!runtimeWorkflow,
        workflow_name: runtimeWorkflow?.name || null,
        card_count: cardCount,
        edge_count: edgeCount,
        card_attempts: decomposition?.attempts?.length ?? null,
        dependency_attempts: order?.attempts?.length ?? null,
        artifacts: {
          create_cards: status?.steps?.["0"]?.artifact || null,
          map_dependencies: status?.steps?.["1"]?.artifact || null,
          validate_workflow: status?.steps?.["2"]?.artifact || null,
        },
      });
    }

    if (req.method === "POST" && (m = url.match(/^\/api\/workflow\/([^/]+)\/start-run$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "workflow not found" });
      readBody(req).then(async (bodyStr) => {
        let body = {};
        try {
          body = bodyStr ? JSON.parse(bodyStr) : {};
        } catch {
          return json(res, 400, { error: "invalid request body" });
        }
        const runtimeWorkflowPath = path.join(wf.dir, "workflow.json");
        if (!fs.existsSync(runtimeWorkflowPath)) return json(res, 400, { error: "compiled workflow.json not found" });
        const runId = body.run_id || timestampRunId();
        const confirmed = body.confirmed === true;
        if (!confirmed) {
          const openItems = openKnowledgeItems(wf);
          if (openItems.length > 0) {
            const meta = readJsonMaybe(path.join(wf.dir, "migration-meta.json"));
            const ok = await integrateRoot({ root: wf.dir, skillPath: meta?.skill_path, runId });
            if (!ok) return json(res, 500, { error: "integration failed" });
            const summary = readJsonMaybe(path.join(wf.dir, "runs", runId, "integration-summary.json"));
            broadcast();
            return json(res, 200, { ok: true, integration_required: true, run_id: runId, summary });
          }
        }

        let runtimeWorkflow;
        try {
          runtimeWorkflow = JSON.parse(fs.readFileSync(runtimeWorkflowPath, "utf8"));
        } catch (e) {
          return json(res, 500, { error: `could not read compiled workflow: ${e.message}` });
        }
        try {
          if (wf.conductorPath) fs.copyFileSync(runtimeWorkflowPath, wf.conductorPath);
          const status = initRuntimeStatus(runtimeWorkflow, wf.statusPath);
          status.run_id = runId;
          status.run_dir = `runs/${runId}`;
          const integration = latestIntegrationSummary(wf);
          if (integration && integration.run_id === runId) {
            status.integration_summary = integration;
            status.integration_tier = integration.added > 0 ? 2 : integration.applied > 0 ? 1 : 0;
            status.integration_changes = (integration.changes || []).map((change) => change.change).filter(Boolean);
          }
          fs.mkdirSync(path.join(wf.dir, "runs", runId, "artifacts"), { recursive: true });
          fs.writeFileSync(wf.statusPath, JSON.stringify(status, null, 2));
          fs.writeFileSync(path.join(wf.dir, "runs", runId, "status.json"), JSON.stringify(status, null, 2));
        } catch (e) {
          return json(res, 500, { error: `could not start run: ${e.message}` });
        }
        broadcast();
        return json(res, 200, { ok: true, workflow: runtimeWorkflow.name || "workflow", run_id: runId });
      });
      return;
    }

    // developer notes / directives on activity cards — the flow-manager feedback loop.
    // Body actions: create {card, cardTitle, step, text, directive, scope}; edit {id, text, directive,
    // scope}; remove {id, action:"remove"}. Edits/removals are logged to the note's audit history,
    // never destroyed — the record stays, the footnote grows ("edited from X to Y").
    if (req.method === "POST" && (m = url.match(/^\/api\/workflow\/([^/]+)\/comment$/))) {
      const wf = findWf(decodeURIComponent(m[1]));
      if (!wf) return json(res, 404, { error: "not found" });
      readBody(req).then((bodyStr) => {
        let body;
        try {
          body = JSON.parse(bodyStr || "{}");
        } catch {
          return json(res, 400, { error: "invalid request body" });
        }
        let status;
        try {
          status = JSON.parse(fs.readFileSync(wf.statusPath, "utf8"));
        } catch {
          return json(res, 500, { error: "could not read status.json" });
        }
        const notes = (status.developer_notes = Array.isArray(status.developer_notes) ? status.developer_notes : []);
        const at = new Date().toISOString();
        const text = typeof body.text === "string" ? body.text.trim() : "";

        if (body.id) {
          const n = notes.find((x) => x && x.id === body.id);
          if (!n) return json(res, 404, { error: "note not found" });
          n.history = Array.isArray(n.history) ? n.history : [];
          if (body.action === "remove") {
            n.history.push({ at, action: "removed", from: n.text });
            n.status = "removed";
          } else {
            if (n.text !== text)
              n.history.push({ at, action: n.status === "removed" ? "restored" : "edited", from: n.text, to: text });
            n.text = text;
            n.directive = !!body.directive;
            if (typeof body.scope === "string") n.scope = body.scope;
            n.updated_at = at;
            n.status = "open"; // an edit reopens the ask so the next run reconsiders it
            delete n.resolution;
          }
        } else {
          // create
          if (!body.card || !text) return json(res, 400, { error: "card id and text required" });
          notes.push({
            id: `${body.card}:${Date.now()}`,
            at,
            updated_at: at,
            step: body.step || "",
            card: body.card,
            card_title: typeof body.cardTitle === "string" ? body.cardTitle : undefined,
            text,
            directive: !!body.directive,
            scope: typeof body.scope === "string" ? body.scope : undefined,
            status: "open",
            history: [{ at, action: "created", to: text }],
          });
        }
        try {
          fs.writeFileSync(wf.statusPath, JSON.stringify(status, null, 2));
        } catch (e) {
          return json(res, 500, { error: `write failed: ${e.message}` });
        }
        return json(res, 200, { ok: true });
      });
      return;
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
      return json(res, 200, primary ? snapshotFor(primary) : { status: null, workflowJson: null });
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
      if (clients.size >= 5) {
        // cap concurrent streams so stray tabs can't silently pile up memory
        res.writeHead(429, { "content-type": "text/plain" });
        return res.end("Too many board connections (max 5). Close a tab and reload.");
      }
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
              url: `http://localhost:${actualPort}/`,
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
