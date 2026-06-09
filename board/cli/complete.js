import fs from "node:fs";
import path from "node:path";
import { dependencyBlockers, dependencyBlockerMessage } from "./dependencies.js";
import { appendAutoHeartbeat, firstEvidenceLine } from "./heartbeats.js";
import { archiveRun, queuePostCardLearning, queueCardFold } from "./learning.js";
import { sequentialOrderGuard } from "./writer.js";
import {
  artifactRequirementMessage,
  findArtifacts,
  findArtifactsReferencedInReceipt,
  findReceiptArtifact,
} from "./artifacts.js";
import { callModel, extractJson } from "./decompose.js";
import { accumulateAndFreeze } from "./pause.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

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

export function discoverConductor(statusPath, explicit) {
  if (explicit) return path.resolve(process.cwd(), explicit);
  const dir = path.dirname(statusPath);
  for (const paired of [
    path.join(dir, "workflow.json"),
    path.join(path.dirname(path.dirname(dir)), "workflow.json"),
  ]) {
    if (fs.existsSync(paired)) return paired;
  }
  const local = path.resolve(process.cwd(), "workflow.json");
  if (fs.existsSync(local)) return local;
  return null;
}

function loadConductorJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * conductor-board complete <step-id>
 *
 * Every card is independently checked against its own instruction. The checker
 * verdict must be recorded with `gate-result` before completion.
 */
export async function runComplete(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board complete <step-id>\n" +
        "       conductor-board complete <loop-id>::<iteration>::<sub-step>\n\n" +
        "  Consumes the independent checker verdict recorded by `check` or `gate-result`.\n" +
        "  PASS plus .conductor/artifacts/<card-index>-<slugified-card-title>.md moves the card to done.\n" +
        "  Supporting files must be referenced from that markdown receipt.\n" +
        "  FAIL stores checker feedback, increments the\n" +
        "  attempt counter, and keeps the card running until max_attempts is exhausted.",
    );
    return true;
  }
  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const stepId = args.find((a) => !a.startsWith("-"));

  if (!stepId) {
    console.error(red("usage: conductor-board complete <step-id>[::iter::sub]"));
    return false;
  }

  const conductorPath = discoverConductor(statusPath, flag(args, ["--workflow", "--conductor", "-c"]));
  if (!conductorPath) {
    console.error(red("✗ no conductor file found next to status.json or in cwd"));
    return false;
  }
  let doc;
  try {
    doc = loadConductorJson(conductorPath);
  } catch (e) {
    console.error(red(`✗ could not parse conductor: ${e.message}`));
    return false;
  }
  // resolve the card — either a top-level index, or a loop sub-step "loopIndex::iter::subIndex"
  const parts = stepId.split("::");
  let step;
  let loopPath = null;
  if (parts.length === 3) {
    const [loopId, iter, subId] = parts;
    const loopStep = (doc.steps || [])[Number(loopId)] || (doc.steps || []).find((s) => s && s.id === loopId);
    if (!loopStep) {
      console.error(red(`✗ conductor has no loop "${loopId}"`));
      return false;
    }
    step = (loopStep.steps || [])[Number(subId)] || (loopStep.steps || []).find((s) => s && s.id === subId);
    if (!step) {
      console.error(red(`✗ loop "${loopId}" has no sub-step "${subId}"`));
      return false;
    }
    loopPath = { loopId, iter, subId };
    // SEQUENTIAL-ORDER guard: completing this iteration's sub-step advances it toward
    // done, so for a sequential loop refuse while any earlier scoped iteration is still
    // incomplete (parallel loops are not guarded — see sequentialOrderGuard).
    const g = sequentialOrderGuard(statusPath, loopId, iter);
    if (!g.ok) {
      console.error(g.message);
      return false; // don't run gates / write — process iterations in order
    }
  } else {
    step = (doc.steps || [])[Number(stepId)] || (doc.steps || []).find((s) => s && s.id === stepId);
    if (!step) {
      console.error(red(`✗ workflow has no card index "${stepId}"`));
      return false;
    }
  }

  // Loop-coverage guard: a loop step can't be completed while any frontloaded iteration is
  // still incomplete — this catches skipped pages (an item left pending or only partly done),
  // so you can never silently lose loop coverage. (§ "Loops": do every iteration, in order.)
  if (!loopPath && step.type === "loop") {
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      const iters = (status.steps && status.steps[stepId] && status.steps[stepId].iterations) || {};
      const subIds = (step.steps || []).map((s, i) => s?.id ? String(s.id) : String(i));
      const incomplete = [];
      for (const [item, subs] of Object.entries(iters)) {
        const missing = subIds.filter((sid) => !(subs && subs[sid] && subs[sid].status === "done"));
        if (missing.length) incomplete.push(`${item} (missing: ${missing.join(", ")})`);
      }
      if (incomplete.length) {
        console.error(
          red(`\n  ✕ Loop "${stepId}" has ${incomplete.length} incomplete iteration(s) — finish them before completing the loop:`),
        );
        for (const i of incomplete) console.error(red(`      - ${i}`));
        console.error(dim("    Every frontloaded iteration must finish all its sub-steps; none may be skipped or reordered away."));
        return false;
      }
    } catch {
      /* if status is unreadable, fall through to the normal gate flow */
    }
  }

  console.log("");
  let statusBefore;
  try {
    statusBefore = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not read status.json: ${e.message}`));
    return false;
  }
  const stBefore = statusEntry(statusBefore, loopPath, stepId);
  const blockers = dependencyBlockers(doc, statusBefore, stepId);
  if (blockers.length) {
    console.error(red(`  ✕ ${dependencyBlockerMessage(stepId, blockers)}`));
    console.log("");
    return false;
  }
  const maxAttempts = maxAttemptsFor(doc);
  if (attemptsExhausted(stBefore, maxAttempts)) {
    console.error(red(`  ✕ ${stepId} has exhausted ${maxAttempts}/${maxAttempts} attempts. No more retries.`));
    console.log("");
    return false;
  }

  const recorded = readRecordedCheckerResult(statusPath, loopPath, stepId);
  if (!recorded) {
    console.error(red("  ✕ no checker result — run the independent checker first."));
    console.log("");
    return false;
  }
  const ok = recorded.passed === true;
  const detail = [recorded];
  console.log(`  ${ok ? green("✓") : red("✕")} ${step.title || stepId} ${dim("(instruction checker)")}`);

  console.log("");
  if (ok) {
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      let st;
      if (loopPath) {
        const lp = (status.steps[loopPath.loopId] = status.steps[loopPath.loopId] || {
          type: "loop",
          iterations: {},
        });
        lp.iterations = lp.iterations || {};
        const it = (lp.iterations[loopPath.iter] = lp.iterations[loopPath.iter] || {});
        st = it[loopPath.subId] = it[loopPath.subId] || { attempt: 1 };
      } else {
        st = status.steps[stepId] = status.steps[stepId] || { attempt: 1 };
      }
      const artifact = findReceiptArtifact({ statusPath, stepId, entry: st, step });
      const artifacts = [
        ...findArtifacts({ statusPath, stepId, entry: st, step }),
        ...findArtifactsReferencedInReceipt(statusPath, artifact),
      ];
      if (!artifact) {
        console.error(red(`  ✕ ${artifactRequirementMessage(stepId, step)}`));
        console.log("");
        return false;
      }
      st.status = "done";
      st.gate = "passed";
      st.artifact = artifact.path;
      st.receipt = artifact.path; // legacy alias
      st.artifacts = [...new Set([artifact.path, ...artifacts.map((artifact) => artifact.path)])];
      st.gate_detail = detail.map((item) => ({
        ...item,
        artifact_paths: st.artifacts,
        artifact_path: artifact.path,
        receipt_path: artifact.path,
      }));
      st.last_feedback = undefined;
      st.last_failed_attempt = undefined;
      st.completed_at = new Date().toISOString();
      appendAutoHeartbeat(status, loopPath, stepId, `Passed: ${step.title || stepId}`);
      if (!loopPath && allTopLevelStepsDone(doc, status)) {
        status.status = "done";
        status.current_step = null;
        status.endedAt = new Date().toISOString();
        // Freeze the paused-aware timer: fold the live running interval into elapsed_ms.
        accumulateAndFreeze(status);
      }
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
      queuePostCardLearning({ statusPath, workflowPath: conductorPath, stepId });
      // Per-card crash-safety + the overlap win: fold THIS done card's own
      // artifacts into the run dir in a detached background process — off this
      // worker's gate→exit teardown. By run-end every earlier card is already
      // folded, so the run-end snapshot (archiveRun, idempotent skip-existing)
      // only has the last card left to absorb. Touches finished cards only.
      queueCardFold({ statusPath, stepId });
      // The heavy whole-run consolidation runs ONCE, at run-end (last card), not
      // per card. archiveRun's copy is now idempotent: cards the background folder
      // already absorbed are skipped, so this is a cheap final fold, and it is
      // re-runnable + safe after an interrupted run (nothing deferred is lost).
      if (status.status === "done") archiveRun(statusPath, conductorPath);
    } catch (e) {
      console.error(red(`✗ checker passed but could not update status.json: ${e.message}`));
      return false;
    }
      console.log(green(`  ✓ Checker passed. Card ${stepId} -> done.`));
    console.log("");
    return true;
  }

  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const st = statusEntry(status, loopPath, stepId);
    const recordedId = recorded.check_id || recorded.checked_at;
    if (st.last_consumed_check_id === recordedId) {
      console.error(red("  ✕ This failed checker result was already consumed. Run `conductor-board feedback` before retrying, then run `check` again."));
      console.log("");
      return false;
    }
    const failedAttempt = Number.isFinite(Number(st.attempt)) ? Number(st.attempt) : 1;
    st.gate = "failed";
    st.gate_detail = detail;
    st.last_feedback = recorded.evidence || "Checker failed without evidence.";
    st.last_failed_attempt = failedAttempt;
    st.last_failed_at = new Date().toISOString();
    st.last_consumed_check_id = recordedId || new Date().toISOString();
    appendAutoHeartbeat(
      status,
      loopPath,
      stepId,
      `Failed attempt ${failedAttempt}/${maxAttempts}: ${firstEvidenceLine(recorded.evidence)}`,
    );
    if (failedAttempt >= maxAttempts) {
      st.status = "failed";
      st.attempt = maxAttempts;
      status.status = "failed";
      status.failed_step = stepId;
      status.failed_reason = st.last_feedback;
      // Freeze the paused-aware timer on terminal failure.
      accumulateAndFreeze(status);
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
      archiveRun(statusPath, conductorPath);
      console.log(red(`  ✕ Checker failed on attempt ${maxAttempts}/${maxAttempts}. Card and run failed.`));
      console.log(dim("  Run `conductor-board feedback " + stepId + "` for the final failure reason."));
      console.log("");
      return false;
    }
    st.status = "running";
    st.attempt = failedAttempt + 1;
    status.status = "running";
    status.endedAt = undefined;
    if (!loopPath) status.current_step = stepId;
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch (e) {
    console.error(red(`✗ checker failed and could not update status.json: ${e.message}`));
    return false;
  }
  console.log(red("  ✕ Checker failed — redo the card and retry. Step remains running."));
  console.log(dim(`  Run: conductor-board feedback ${stepId}`));
  console.log("");
  return false;
}

export async function runGateResult(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board gate-result <step-id>[::iter::sub] --passed|--failed [--evidence \"...\"]\n" +
        "       [--summary \"...\"] [--made \"...\"] [--checked \"...\"]\n\n" +
        "  Records an independent checker verdict for a card instruction. `complete` consumes\n" +
        "  this result before moving the card to done.\n\n" +
        "  --summary / --made / --checked set the three human display lines (one complete\n" +
        "  sentence each). Any line you omit is generated from --evidence so the stored\n" +
        "  verdict always carries three distinct, bounded lines.",
    );
    return true;
  }

  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const stepId = args.find((a) => !a.startsWith("-"));
  const passed = args.includes("--passed");
  const failed = args.includes("--failed");
  const evidence = flag(args, ["--evidence", "-e"]);
  const summaryFlag = flag(args, ["--summary"]);
  const madeFlag = flag(args, ["--made"]);
  const checkedFlag = flag(args, ["--checked"]);

  if (!stepId || passed === failed) {
    console.error(red("usage: conductor-board gate-result <step-id>[::iter::sub] --passed|--failed [--evidence \"...\"]"));
    return false;
  }

  const conductorPath = discoverConductor(statusPath, flag(args, ["--workflow", "--conductor", "-c"]));
  if (!conductorPath) {
    console.error(red("✗ no conductor file found next to status.json or in cwd"));
    return false;
  }

  let doc;
  try {
    doc = loadConductorJson(conductorPath);
  } catch (e) {
    console.error(red(`✗ could not parse conductor: ${e.message}`));
    return false;
  }

  const resolved = resolveStep(doc, stepId);
  if (!resolved.ok) {
    console.error(red(resolved.error));
    return false;
  }

  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not read status.json: ${e.message}`));
    return false;
  }

  const parsedEvidence = parseCheckerEvidence(typeof evidence === "string" ? evidence : undefined);
  recordCheckerResult(status, resolved, stepId, passed, typeof evidence === "string" ? evidence : undefined, {
    summary: typeof summaryFlag === "string" ? summaryFlag : undefined,
    made_summary: typeof madeFlag === "string" ? madeFlag : undefined,
    checked_summary: typeof checkedFlag === "string" ? checkedFlag : undefined,
  });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  console.log("");
  console.log(green(`✓ checker result recorded for ${stepId}: ${passed ? "passed" : "failed"}`));
  if (parsedEvidence.evidence) console.log(dim(`  evidence: ${parsedEvidence.evidence}`));
  if (parsedEvidence.summary) console.log(dim(`  summary: ${parsedEvidence.summary}`));
  console.log("");
  return true;
}

export async function runFeedback(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board feedback <step-id>[::iter::sub] [--path status.json]\n\n" +
        "  Prints the latest checker failure, failed attempt number, and attempts\n" +
        "  remaining so the agent can fix the card before retrying.",
    );
    return true;
  }
  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const stepId = args.find((a) => !a.startsWith("-"));
  if (!stepId) {
    console.error(red("usage: conductor-board feedback <step-id>[::iter::sub]"));
    return false;
  }
  const conductorPath = discoverConductor(statusPath, flag(args, ["--workflow", "--conductor", "-c"]));
  if (!conductorPath) {
    console.error(red("✗ no conductor file found next to status.json or in cwd"));
    return false;
  }
  let doc;
  try {
    doc = loadConductorJson(conductorPath);
  } catch (e) {
    console.error(red(`✗ could not parse conductor: ${e.message}`));
    return false;
  }
  const resolved = resolveStep(doc, stepId);
  if (!resolved.ok) {
    console.error(red(resolved.error));
    return false;
  }
  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not read status.json: ${e.message}`));
    return false;
  }
  const st = statusEntry(status, resolved.loopPath, stepId);
  const max = maxAttemptsFor(doc);
  const failedAttempt = Number(st.last_failed_attempt || 0);
  const reason = st.last_feedback || latestFailureEvidence(st);
  if (!failedAttempt || !reason) {
    console.log(green(`✓ no checker failure feedback recorded for ${stepId}`));
    return true;
  }
  const remaining = Math.max(0, max - failedAttempt);
  console.log("");
  console.log(feedbackMessage(failedAttempt, max, reason));
  console.log(dim(`attempt: ${failedAttempt}/${max}`));
  console.log(dim(`attempts_remaining: ${remaining}`));
  console.log("");
  return true;
}

export function resolveStep(doc, stepId) {
  const parts = stepId.split("::");
  if (parts.length === 3) {
    const [loopId, iter, subId] = parts;
    const loopStep = (doc.steps || [])[Number(loopId)] || (doc.steps || []).find((s) => s && s.id === loopId);
    if (!loopStep || loopStep.type !== "loop") return { ok: false, error: `✗ workflow has no loop card index "${loopId}"` };
    const step = (loopStep.steps || [])[Number(subId)] || (loopStep.steps || []).find((s) => s && s.id === subId);
    if (!step) return { ok: false, error: `✗ loop "${loopId}" has no sub-card index "${subId}"` };
    return { ok: true, step, loopPath: { loopId, iter, subId } };
  }
  const step = (doc.steps || [])[Number(stepId)] || (doc.steps || []).find((s) => s && s.id === stepId);
  if (!step) return { ok: false, error: `✗ workflow has no card index "${stepId}"` };
  return { ok: true, step, loopPath: null };
}

export function statusEntry(status, loopPath, stepId) {
  status.steps = status.steps || {};
  if (loopPath) {
    const lp = (status.steps[loopPath.loopId] = status.steps[loopPath.loopId] || { type: "loop", iterations: {} });
    lp.iterations = lp.iterations || {};
    const it = (lp.iterations[loopPath.iter] = lp.iterations[loopPath.iter] || {});
    return (it[loopPath.subId] = it[loopPath.subId] || { attempt: 1 });
  }
  return (status.steps[stepId] = status.steps[stepId] || { attempt: 1 });
}

function readRecordedCheckerResult(statusPath, loopPath, stepId) {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    let st;
    if (loopPath) st = status.steps?.[loopPath.loopId]?.iterations?.[loopPath.iter]?.[loopPath.subId];
    else st = status.steps?.[stepId];
    const detail = Array.isArray(st?.gate_detail) ? st.gate_detail : [];
    return detail.find((d) => d && d.checker === "instruction" && typeof d.passed === "boolean") ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a checker verdict. ZERO model calls on this live path: clean display
 * lines come from AUTHORING. The summary is, in order of preference:
 *   1. the checker's authored SUMMARY (parsed from evidence) or the --summary flag,
 *   2. the card's COMPOSER summary (the intent line on the workflow step def).
 * It is NEVER regenerated inline. `normalizeVerdictLines` is retained only as the
 * one-shot backfill tool (see `backfill-summaries`).
 */
export function recordCheckerResult(status, resolved, stepId, passed, evidence, extra = {}) {
  const st = statusEntry(status, resolved.loopPath, stepId);
  const checkedAt = new Date().toISOString();
  const parsed = parseCheckerEvidence(evidence);

  const authoredSummary = boundDisplayLine(
    extra.summary !== undefined ? extra.summary : parsed.summary,
  );
  // Composer fallback: a hand-authored gate-result with no summary borrows the
  // card's intent line from the compiled workflow step def.
  const composerSummary = boundDisplayLine(resolved.step?.summary);
  const summary = authoredSummary || composerSummary;
  const made_summary = boundDisplayLine(
    extra.made_summary !== undefined ? extra.made_summary : parsed.made_summary,
  );
  const checked_summary = boundDisplayLine(
    extra.checked_summary !== undefined ? extra.checked_summary : parsed.checked_summary,
  );

  st.gate = passed ? "passed" : "failed";
  st.gate_detail = [{
    criterion: resolved.step.instruction || resolved.step.title || stepId,
    name: resolved.step.title,
    checker: extra.checker || "instruction",
    passed,
    evidence: parsed.evidence,
    summary,
    made_summary,
    checked_summary,
    checked_at: checkedAt,
    check_id: `${checkedAt}-${Math.random().toString(36).slice(2, 8)}`,
    output_sources: extra.output_sources,
    artifact_paths: extra.artifact_paths,
    artifact_path: extra.artifact_path,
    receipt_path: extra.receipt_path,
  }];
}

// Lightweight, model-free clean-up for an authored display line: collapse
// whitespace, strip leading PASS/FAIL/label noise and trailing ellipsis. Does
// NOT truncate or fabricate — authored text stands as written.
function boundDisplayLine(value) {
  if (value === undefined || value === null) return undefined;
  let s = String(value).replace(/\s+/g, " ").trim();
  s = s.replace(/^(PASS|FAIL)\s*(?:[.\u2014:;-]\s*)?/i, "").trim();
  s = s.replace(/^(SUMMARY|MADE|CHECKED)\s*:\s*/i, "").trim();
  s = s.replace(/(?:\.\.\.|\u2026)\s*$/, "").trim();
  if (!s || !/[A-Za-z0-9\u00c5\u00c4\u00d6\u00e5\u00e4\u00f6]/.test(s)) return undefined;
  return s;
}

export function parseCheckerEvidence(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { evidence: undefined, summary: undefined };

  const labels = extractCheckerLabels(text);
  const summary = labels.summary;
  const made_summary = labels.made_summary;
  const checked_summary = labels.checked_summary;
  const evidence = labels.evidence || text;
  // No first-sentence/duplicate fallback here: normalizeVerdictLines is the
  // single authority for deriving the three display lines from evidence.
  return { evidence, summary, made_summary, checked_summary };
}

function extractCheckerLabels(text) {
  const labelRe = /\b(SUMMARY|MADE|CHECKED)\s*:\s*/gi;
  const matches = [...text.matchAll(labelRe)];
  if (!matches.length) return { evidence: text };

  const values = {};
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const label = match[1].toUpperCase();
    const valueStart = match.index + match[0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const value = text.slice(valueStart, valueEnd).trim();
    if (value && !values[label]) values[label] = value;
  }

  let evidence = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    evidence += text.slice(cursor, start);
    cursor = end;
  }
  evidence += text.slice(cursor);
  evidence = evidence
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    evidence,
    summary: cleanCheckerLabelValue(values.SUMMARY),
    made_summary: cleanCheckerLabelValue(values.MADE),
    checked_summary: cleanCheckerLabelValue(values.CHECKED),
  };
}

const VERDICT_LINE_MAX = 200;
const VERDICT_LINE_TARGET = 160;

// Bound a candidate display line to one complete sentence, <= ~160 chars, no
// trailing ellipsis, never cut mid-word. Returns undefined if nothing usable.
function boundVerdictLine(value) {
  if (value === undefined || value === null) return undefined;
  let s = String(value).replace(/\s+/g, " ").trim();
  // Strip any leading PASS/FAIL prefix and label noise.
  s = s.replace(/^(PASS|FAIL)\s*(?:[.\u2014:;-]\s*)?/i, "").trim();
  s = s.replace(/^(SUMMARY|MADE|CHECKED)\s*:\s*/i, "").trim();
  // Drop any trailing ellipsis the source may have added.
  s = s.replace(/(?:\.\.\.|\u2026)\s*$/, "").trim();
  if (!s || !/[A-Za-z0-9\u00c5\u00c4\u00d6\u00e5\u00e4\u00f6]/.test(s)) return undefined;
  // Keep only the first complete sentence.
  const firstSent = s.split(/(?<=[.!?])\s+/)[0] || s;
  s = firstSent.trim();
  if (s.length > VERDICT_LINE_MAX) {
    // Trim to the target length on a word boundary, then end the sentence cleanly.
    let cut = s.slice(0, VERDICT_LINE_TARGET);
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > 40) cut = cut.slice(0, lastSpace);
    cut = cut.replace(/[\s,;:.\u2014-]+$/, "").trim();
    s = cut.endsWith(".") ? cut : cut + ".";
  }
  return s || undefined;
}

function isCompleteSentence(s) {
  return typeof s === "string" && /[.!?]$/.test(s.trim());
}

// A line is VALID when present, complete, bounded, ellipsis-free and distinct
// from the other two (case-insensitive).
function verdictLineIsValid(line, others) {
  const v = boundVerdictLine(line);
  if (!v) return false;
  if (v.length > VERDICT_LINE_MAX) return false;
  if (/(?:\.\.\.|\u2026)\s*$/.test(String(line || ""))) return false;
  if (!isCompleteSentence(v)) return false;
  const norm = v.toLowerCase();
  for (const o of others) {
    if (o && boundVerdictLine(o) && boundVerdictLine(o).toLowerCase() === norm) return false;
  }
  return true;
}

function verdictGenerationPrompt(evidence) {
  return (
    "You normalize a verdict's evidence into exactly three short human display lines.\n" +
    "Read the EVIDENCE once and return a JSON object with three keys: \"summary\", \"made\", \"checked\".\n" +
    "- summary: one full sentence a non-technical person can scan, the gist of the result.\n" +
    "- made: one full sentence describing what the card produced.\n" +
    "- checked: one full sentence describing how it was verified (or why it failed).\n" +
    "Each value must be ONE complete self-contained sentence, roughly 120-160 characters, " +
    "no trailing ellipsis, never cut off mid-word, and the three must be DISTINCT from each other. " +
    "If the evidence only describes output, write the most honest distinct verification line for \"checked\" " +
    "rather than repeating the summary. Return JSON only.\n\n" +
    "EVIDENCE:\n" + String(evidence || "")
  );
}

/**
 * Single authority for a verdict's three display lines (summary/made/checked).
 * Keeps any provided line that is already valid (present, complete, bounded,
 * ellipsis-free, distinct). If any line is missing/malformed/duplicate, makes
 * ONE model call over `evidence` to mint distinct bounded sentences and uses the
 * generated values only for the invalid lines. Degrades gracefully: on a model
 * failure it stores whatever valid lines exist plus the full evidence, never an
 * old-style mid-word clamp.
 */
export async function normalizeVerdictLines({ summary, made_summary, checked_summary, evidence } = {}) {
  let s = boundVerdictLine(summary);
  let m = boundVerdictLine(made_summary);
  let c = boundVerdictLine(checked_summary);

  const sOk = verdictLineIsValid(s, [m, c]);
  const mOk = verdictLineIsValid(m, [s, c]);
  const cOk = verdictLineIsValid(c, [s, m]);

  if (sOk && mOk && cOk) {
    return { summary: s, made_summary: m, checked_summary: c };
  }

  const ev = typeof evidence === "string" ? evidence.trim() : "";
  if (ev) {
    try {
      const raw = await callModel(verdictGenerationPrompt(ev), { role: "verdict-normalizer", attempt: 1 });
      const gen = extractJson(raw) || {};
      const gs = boundVerdictLine(gen.summary);
      const gm = boundVerdictLine(gen.made);
      const gc = boundVerdictLine(gen.checked);
      if (!sOk && gs) s = gs;
      if (!mOk && gm) m = gm;
      if (!cOk && gc) c = gc;
    } catch {
      // Graceful degrade: keep whatever valid lines we have; never clamp.
    }
  }

  // Final pass: ensure mutual distinctness; drop a line that still duplicates
  // an earlier one so we never show one string three times.
  const norm = (x) => (x ? x.toLowerCase() : "");
  if (m && norm(m) === norm(s)) m = undefined;
  if (c && (norm(c) === norm(s) || norm(c) === norm(m))) c = undefined;

  return {
    summary: s || undefined,
    made_summary: m || undefined,
    checked_summary: c || undefined,
  };
}

function cleanCheckerLabelValue(value) {
  if (!value) return undefined;
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned && /[A-Za-z0-9ÅÄÖåäö]/.test(cleaned) ? cleaned : undefined;
}

function firstSentence(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  const withoutVerdict = cleaned.replace(/^(PASS|FAIL)\s*(?:[.—:;-]\s*)?/i, "").trim() || cleaned;
  const first = withoutVerdict.split(/(?<=[.!?])\s+/)[0] || withoutVerdict;
  const normalized = first.trim();
  if (!/[A-Za-z0-9ÅÄÖåäö]/.test(normalized)) return undefined;
  return normalized;
}

function maxAttemptsFor(doc) {
  const n = Number(doc?.max_attempts);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

function attemptsExhausted(st, max) {
  return st?.status === "failed" && Number(st?.last_failed_attempt || st?.attempt || 0) >= max;
}

function latestFailureEvidence(st) {
  const detail = Array.isArray(st?.gate_detail) ? st.gate_detail : [];
  const failed = [...detail].reverse().find((d) => d && d.passed === false);
  return failed?.evidence;
}

function allTopLevelStepsDone(doc, status) {
  const steps = Array.isArray(doc?.steps) ? doc.steps : [];
  if (!steps.length) return false;
  return steps.every((step, i) => {
    const byIndex = status.steps?.[String(i)];
    const byId = step?.id ? status.steps?.[step.id] : null;
    if (byIndex?.status === "done" || byId?.status === "done") return true;
    const st = byIndex || byId;
    return false;
  });
}

function feedbackMessage(attempt, max, reason) {
  if (attempt >= max) return `Attempt ${max}/${max}. No attempts remaining. Final checker failure: ${reason}`;
  if (attempt === 4 && max >= 5) return `Attempt 4/${max}. Final warning. One attempt remaining. Issues: ${reason}`;
  if (attempt === 3 && max >= 5) return `Attempt 3/${max}. This card has failed three times. Two attempts remaining before the run stops. Address every point: ${reason}`;
  return `Attempt ${attempt}/${max}. Checker found: ${reason}. Fix and retry.`;
}
