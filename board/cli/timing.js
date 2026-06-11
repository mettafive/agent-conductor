// The Timekeeper — pure instrumentation for the conductor execution plane.
//
// PURE INSTRUMENTATION: timestamps + logging only. NOTHING in this module
// changes dispatch / run-card / reclaim / breaker / claim behavior. It is
// gated by an OPT-IN flag (`--timing`) AND an env var (`CONDUCTOR_TIMING=1`);
// default OFF means the rest of the system is byte-identical to before.
//
// Boundaries stamped (per card, per run):
//   conductor-side (precise, dispatch.js): t_eligible, t_handout, t_spawn, t_exit
//   worker-side    (best-effort, run-card.js stream parse):
//                  t_boot_done, t_first_action, t_gate
//
// Leak map spans (ms): dispatch_wait, launch, boot, ingest, work, teardown.

import fs from "node:fs";
import path from "node:path";

/**
 * Timing is enabled ONLY when the caller passed --timing AND the env var
 * CONDUCTOR_TIMING=1 is set. Both gates must be on. Default OFF.
 */
export function timingEnabled(args) {
  const flagOn = Array.isArray(args) && args.includes("--timing");
  const envOn = process.env.CONDUCTOR_TIMING === "1";
  return flagOn && envOn;
}

/** ISO timestamp for an epoch-ms value (or now). */
export function isoOf(ms) {
  return new Date(ms == null ? Date.now() : ms).toISOString();
}

/**
 * Conductor-side per-card timing ledger, held in memory by the dispatcher.
 * Keyed by card index. Each cell is an epoch-ms number or null (unseen).
 * Worker-side cells (boot/first_action/gate) are folded in at exit, parsed
 * from a sidecar the worker writes (see worker-side parse in run-card.js).
 */
export class TimingLedger {
  constructor() {
    this.cards = new Map();
  }

  _row(index) {
    let r = this.cards.get(index);
    if (!r) {
      r = {
        index,
        title: "",
        t_eligible: null,
        t_handout: null,
        t_spawn: null,
        t_exit: null,
        t_prewarm_start: null,
        t_prewarm_ready: null,
        t_prewarm_assigned: null,
        exit_code: null,
        worker: null,
      };
      this.cards.set(index, r);
    }
    return r;
  }

  markEligible(index, title, ms = Date.now()) {
    const r = this._row(index);
    if (title) r.title = title;
    if (r.t_eligible == null) r.t_eligible = ms;
  }

  markHandout(index, ms = Date.now()) {
    const r = this._row(index);
    if (r.t_handout == null) r.t_handout = ms;
  }

  markSpawn(index, title, ms = Date.now()) {
    const r = this._row(index);
    if (title) r.title = title;
    if (r.t_spawn == null) r.t_spawn = ms;
  }

  markExit(index, exitCode, ms = Date.now()) {
    const r = this._row(index);
    r.t_exit = ms;
    r.exit_code = exitCode;
  }

  markPrewarmStart(index, title, ms = Date.now()) {
    const r = this._row(index);
    if (title) r.title = title;
    if (r.t_prewarm_start == null) r.t_prewarm_start = ms;
  }

  markPrewarmReady(index, ms = Date.now()) {
    const r = this._row(index);
    if (r.t_prewarm_ready == null) r.t_prewarm_ready = ms;
  }

  markPrewarmAssigned(index, ms = Date.now()) {
    const r = this._row(index);
    if (r.t_prewarm_assigned == null) r.t_prewarm_assigned = ms;
  }

  foldWorker(index, worker) {
    const r = this._row(index);
    r.worker = worker || null;
  }
}

/**
 * Sidecar path where a run-card worker drops its worker-side stamps for the
 * dispatcher to fold in. One file per card, next to status.json under
 * `.conductor/timing/`. Best-effort; absence => worker-side cells bracketed.
 */
export function workerSidecarPath(statusPath, index) {
  return path.join(path.dirname(statusPath), "timing", `worker-${index}.json`);
}

/** Read + parse a worker sidecar if present; returns null on any failure. */
export function readWorkerSidecar(statusPath, index) {
  try {
    const f = workerSidecarPath(statusPath, index);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

/** Write a worker sidecar (called from run-card.js). Best-effort. */
export function writeWorkerSidecar(statusPath, index, payload) {
  try {
    const f = workerSidecarPath(statusPath, index);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(payload, null, 2));
    return f;
  } catch {
    return null;
  }
}

const SPAN_KEYS = ["dispatch_wait", "launch", "boot", "ingest", "work", "teardown"];

/**
 * Derive the leak-map spans for one card row. Each span is { ms, measured }.
 * measured=false means BRACKETED (a worker-side boundary we could not see).
 */
export function deriveSpans(row) {
  const w = row.worker || {};
  const span = (a, b, measured) => ({
    ms: a != null && b != null ? b - a : null,
    measured: !!measured,
  });

  const haveBoot = w.t_boot_done != null;
  const haveFirst = w.t_first_action != null;
  const haveGate = w.t_gate != null;
  const fullySeen = haveBoot && haveFirst && haveGate;

  if (fullySeen) {
    return {
      dispatch_wait: span(row.t_eligible, row.t_handout, true),
      launch: span(row.t_handout, row.t_spawn, true),
      boot: span(row.t_spawn, w.t_boot_done, true),
      ingest: span(w.t_boot_done, w.t_first_action, true),
      work: span(w.t_first_action, w.t_gate, true),
      teardown: span(w.t_gate, row.t_exit, true),
      bracketed: false,
    };
  }

  const firstObservable =
    w.t_first_observable != null
      ? w.t_first_observable
      : haveBoot
        ? w.t_boot_done
        : haveFirst
          ? w.t_first_action
          : haveGate
            ? w.t_gate
            : null;

  const insideWorker = span(row.t_spawn, row.t_exit, false);
  return {
    dispatch_wait: span(row.t_eligible, row.t_handout, true),
    launch: span(row.t_handout, row.t_spawn, true),
    boot: {
      ms: insideWorker.ms,
      measured: false,
      note: "inside_worker = t_exit − t_spawn (combined; worker stream cells not seen)",
    },
    ingest: { ms: null, measured: false },
    work: { ms: null, measured: false },
    teardown: { ms: null, measured: false },
    bracketed: true,
    t_first_observable: firstObservable,
  };
}

/** Total wall time for a card: t_exit − t_eligible. */
export function cardWall(row) {
  return row.t_eligible != null && row.t_exit != null ? row.t_exit - row.t_eligible : null;
}

function fmtMs(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function cell(spanObj) {
  if (!spanObj || spanObj.ms == null) return "—";
  return fmtMs(spanObj.ms) + (spanObj.measured ? "" : " *");
}

/**
 * Build the per-card table + run-level aggregate as { md, json }.
 */
export function buildReport(rows, meta) {
  const perCard = rows.map((row) => {
    const spans = deriveSpans(row);
    return { row, spans, wall: cardWall(row) };
  });

  const totals = Object.fromEntries(SPAN_KEYS.map((k) => [k, 0]));
  const totalsMeasured = Object.fromEntries(SPAN_KEYS.map((k) => [k, true]));
  let anyBracketed = false;
  let totalWall = 0;
  for (const { spans, wall } of perCard) {
    if (spans.bracketed) anyBracketed = true;
    for (const k of SPAN_KEYS) {
      const s = spans[k];
      if (s && s.ms != null) totals[k] += s.ms;
      if (s && s.measured === false && s.ms != null) totalsMeasured[k] = false;
    }
    if (wall != null) totalWall += wall;
  }
  const grandSpanSum = SPAN_KEYS.reduce((a, k) => a + totals[k], 0) || 0;
  const pct = (k) => (grandSpanSum > 0 ? ((totals[k] / grandSpanSum) * 100).toFixed(1) + "%" : "—");

  let leakKey = null;
  let leakMs = -1;
  for (const k of SPAN_KEYS) {
    if (totals[k] > leakMs) {
      leakMs = totals[k];
      leakKey = k;
    }
  }

  const L = [];
  L.push(`# The Timekeeper — run timing`);
  L.push("");
  L.push(`- run_id: \`${meta.runId}\``);
  L.push(`- workflow: \`${meta.workflow || "(unknown)"}\``);
  L.push(`- generated: ${isoOf()}`);
  L.push(`- cards timed: ${rows.length}`);
  L.push(`- \`*\` = **bracketed** (worker-side boundary not directly observed); no star = **measured**.`);
  L.push("");
  L.push(`## Leak map (per card)`);
  L.push("");
  L.push(
    "| card | title | prewarm | ready_before_handout | dispatch_wait | launch | boot | ingest | work | teardown | wall (exit−eligible) | exit |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { row, spans, wall } of perCard) {
    const title = (row.title || "").slice(0, 28).replace(/\|/g, "/");
    const prewarmMs = row.t_prewarm_start != null && row.t_prewarm_ready != null ? row.t_prewarm_ready - row.t_prewarm_start : null;
    const readyBeforeHandout = row.t_prewarm_ready != null && row.t_handout != null ? row.t_handout - row.t_prewarm_ready : null;
    L.push(
      `| ${row.index} | ${title} | ${fmtMs(prewarmMs)} | ${fmtMs(readyBeforeHandout)} | ${cell(spans.dispatch_wait)} | ${cell(spans.launch)} | ${cell(spans.boot)} | ${cell(spans.ingest)} | ${cell(spans.work)} | ${cell(spans.teardown)} | ${fmtMs(wall)} | ${row.exit_code ?? "—"} |`,
    );
  }
  L.push(
    `| **TOTAL** | ${rows.length} cards | — | — | ${fmtMs(totals.dispatch_wait)}${totalsMeasured.dispatch_wait ? "" : " *"} | ${fmtMs(totals.launch)}${totalsMeasured.launch ? "" : " *"} | ${fmtMs(totals.boot)}${totalsMeasured.boot ? "" : " *"} | ${fmtMs(totals.ingest)}${totalsMeasured.ingest ? "" : " *"} | ${fmtMs(totals.work)}${totalsMeasured.work ? "" : " *"} | ${fmtMs(totals.teardown)}${totalsMeasured.teardown ? "" : " *"} | ${fmtMs(totalWall)} | — |`,
  );
  L.push("");
  L.push(`**The largest span is the leak: \`${leakKey}\` (${fmtMs(leakMs)}).**`);
  L.push("");

  L.push(`## Run-level aggregate (where the whole run's time went)`);
  L.push("");
  L.push("| phase | total | % of summed spans |");
  L.push("|---|---|---|");
  for (const k of SPAN_KEYS) {
    L.push(`| ${k} | ${fmtMs(totals[k])}${totalsMeasured[k] ? "" : " *"} | ${pct(k)} |`);
  }
  L.push(`| **summed spans** | ${fmtMs(grandSpanSum)} | 100% |`);
  L.push(`| total wall (Σ exit−eligible) | ${fmtMs(totalWall)} | — |`);
  L.push("");
  if (anyBracketed) {
    L.push(
      `> Some worker-side cells are **bracketed** (\`*\`): the \`claude -p\` stream did not surface boot/ingest/work separately for those cards, so they are reported as one combined inside-worker figure under \`boot\`. A real-worker \`--timing\` run is needed to split boot vs ingest for those rows.`,
    );
    L.push("");
  }

  const json = {
    run_id: meta.runId,
    workflow: meta.workflow || null,
    generated_at: isoOf(),
    leak: { phase: leakKey, ms: leakMs },
    aggregate: Object.fromEntries(
      SPAN_KEYS.map((k) => [k, { ms: totals[k], measured: totalsMeasured[k], pct: pct(k) }]),
    ),
    summed_spans_ms: grandSpanSum,
    total_wall_ms: totalWall,
    cards: perCard.map(({ row, spans, wall }) => ({
      index: row.index,
      title: row.title,
      exit_code: row.exit_code,
      stamps: {
        t_prewarm_start: row.t_prewarm_start != null ? isoOf(row.t_prewarm_start) : null,
        t_prewarm_ready: row.t_prewarm_ready != null ? isoOf(row.t_prewarm_ready) : null,
        t_prewarm_assigned: row.t_prewarm_assigned != null ? isoOf(row.t_prewarm_assigned) : null,
        t_eligible: row.t_eligible != null ? isoOf(row.t_eligible) : null,
        t_handout: row.t_handout != null ? isoOf(row.t_handout) : null,
        t_spawn: row.t_spawn != null ? isoOf(row.t_spawn) : null,
        t_boot_done: row.worker?.t_boot_done != null ? isoOf(row.worker.t_boot_done) : null,
        t_first_action: row.worker?.t_first_action != null ? isoOf(row.worker.t_first_action) : null,
        t_gate: row.worker?.t_gate != null ? isoOf(row.worker.t_gate) : null,
        t_exit: row.t_exit != null ? isoOf(row.t_exit) : null,
      },
      spans: Object.fromEntries(
        SPAN_KEYS.map((k) => [k, { ms: spans[k]?.ms ?? null, measured: spans[k]?.measured ?? false }]),
      ),
      prewarm: {
        ms: row.t_prewarm_start != null && row.t_prewarm_ready != null ? row.t_prewarm_ready - row.t_prewarm_start : null,
        ready_before_handout_ms: row.t_prewarm_ready != null && row.t_handout != null ? row.t_handout - row.t_prewarm_ready : null,
      },
      bracketed: spans.bracketed,
      wall_ms: wall,
    })),
  };

  return { md: L.join("\n"), json, leakKey, leakMs };
}

/**
 * Resolve the emit paths for the run-level timing files. Writes into the status
 * dir (the real flat .conductor/ layout): timing-<run_id>.md + .json.
 */
export function emitPaths(statusPath, runId) {
  const dir = path.dirname(statusPath);
  const safe = String(runId).replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    md: path.join(dir, `timing-${safe}.md`),
    json: path.join(dir, `timing-${safe}.json`),
  };
}
