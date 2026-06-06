import fs from "node:fs";
import path from "node:path";
import { sequentialOrderGuard } from "./writer.js";

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
  for (const c of ["conductor.json"]) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  for (const c of ["conductor.json"]) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) return p;
  }
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
        "  PASS moves the card to done. FAIL stores checker feedback, increments the\n" +
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

  const conductorPath = discoverConductor(statusPath, flag(args, ["--conductor", "-c"]));
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
  // resolve the step — either a top-level id, or a loop sub-step "loop::iter::sub"
  const parts = stepId.split("::");
  let step;
  let loopPath = null;
  if (parts.length === 3) {
    const [loopId, iter, subId] = parts;
    const loopStep = (doc.steps || []).find((s) => s && s.id === loopId && s.type === "loop");
    if (!loopStep) {
      console.error(red(`✗ conductor has no loop "${loopId}"`));
      return false;
    }
    step = (loopStep.steps || []).find((s) => s && s.id === subId);
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
    step = (doc.steps || []).find((s) => s && s.id === stepId);
    if (!step) {
      console.error(red(`✗ conductor has no step "${stepId}"`));
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
      const subIds = (step.steps || []).map((s) => s && s.id).filter(Boolean);
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
      st.status = "done";
      st.gate = "passed";
      st.gate_detail = detail;
      st.last_feedback = undefined;
      st.last_failed_attempt = undefined;
      st.completed_at = new Date().toISOString();
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    } catch (e) {
      console.error(red(`✗ checker passed but could not update status.json: ${e.message}`));
      return false;
    }
    console.log(green(`  ✓ Checker passed. Step ${stepId} -> done.`));
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
    if (failedAttempt >= maxAttempts) {
      st.status = "failed";
      st.attempt = maxAttempts;
      status.status = "failed";
      status.failed_step = stepId;
      status.failed_reason = st.last_feedback;
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
      console.log(red(`  ✕ Checker failed on attempt ${maxAttempts}/${maxAttempts}. Card and run failed.`));
      console.log(dim("  Run `conductor-board feedback " + stepId + "` for the final failure reason."));
      console.log("");
      return false;
    }
    st.status = "running";
    st.attempt = failedAttempt + 1;
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
      "usage: conductor-board gate-result <step-id>[::iter::sub] --passed|--failed [--evidence \"...\"]\n\n" +
        "  Records an independent checker verdict for a card instruction. `complete` consumes\n" +
        "  this result before moving the card to done.",
    );
    return true;
  }

  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const stepId = args.find((a) => !a.startsWith("-"));
  const passed = args.includes("--passed");
  const failed = args.includes("--failed");
  const evidence = flag(args, ["--evidence", "-e"]);

  if (!stepId || passed === failed) {
    console.error(red("usage: conductor-board gate-result <step-id>[::iter::sub] --passed|--failed [--evidence \"...\"]"));
    return false;
  }

  const conductorPath = discoverConductor(statusPath, flag(args, ["--conductor", "-c"]));
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

  recordCheckerResult(status, resolved, stepId, passed, typeof evidence === "string" ? evidence : undefined);
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  console.log("");
  console.log(green(`✓ checker result recorded for ${stepId}: ${passed ? "passed" : "failed"}`));
  if (typeof evidence === "string") console.log(dim(`  evidence: ${evidence}`));
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
  const conductorPath = discoverConductor(statusPath, flag(args, ["--conductor", "-c"]));
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
    const loopStep = (doc.steps || []).find((s) => s && s.id === loopId && s.type === "loop");
    if (!loopStep) return { ok: false, error: `✗ conductor has no loop "${loopId}"` };
    const step = (loopStep.steps || []).find((s) => s && s.id === subId);
    if (!step) return { ok: false, error: `✗ loop "${loopId}" has no sub-step "${subId}"` };
    return { ok: true, step, loopPath: { loopId, iter, subId } };
  }
  const step = (doc.steps || []).find((s) => s && s.id === stepId);
  if (!step) return { ok: false, error: `✗ conductor has no step "${stepId}"` };
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
    return detail.find((d) => d && (d.checker === "instruction" || d.checker === "heuristic") && typeof d.passed === "boolean") ?? null;
  } catch {
    return null;
  }
}

export function recordCheckerResult(status, resolved, stepId, passed, evidence, extra = {}) {
  const st = statusEntry(status, resolved.loopPath, stepId);
  const checkedAt = new Date().toISOString();
  st.gate = passed ? "passed" : "failed";
  st.gate_detail = [{
    criterion: resolved.step.instruction || resolved.step.title || stepId,
    name: resolved.step.title,
    checker: extra.checker || "instruction",
    passed,
    evidence,
    checked_at: checkedAt,
    check_id: `${checkedAt}-${Math.random().toString(36).slice(2, 8)}`,
    output_sources: extra.output_sources,
  }];
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

function feedbackMessage(attempt, max, reason) {
  if (attempt >= max) return `Attempt ${max}/${max}. No attempts remaining. Final checker failure: ${reason}`;
  if (attempt === 4 && max >= 5) return `Attempt 4/${max}. Final warning. One attempt remaining. Issues: ${reason}`;
  if (attempt === 3 && max >= 5) return `Attempt 3/${max}. This card has failed three times. Two attempts remaining before the run stops. Address every point: ${reason}`;
  return `Attempt ${attempt}/${max}. Checker found: ${reason}. Fix and retry.`;
}
