import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const now = () => new Date().toISOString();

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

function statusPathOf(args) {
  const p = flag(args, ["--path", "-p"]);
  if (typeof p === "string") return path.resolve(process.cwd(), p);
  const dir = flag(args, ["--dir"]);
  return path.resolve(process.cwd(), typeof dir === "string" ? dir : ".conductor", "status.json");
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      const v = args[i + 1];
      if (v && !v.startsWith("-")) i++; // skip flag value
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function load(sp) {
  try {
    return JSON.parse(fs.readFileSync(sp, "utf8"));
  } catch {
    return null;
  }
}
function save(sp, s) {
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
}
const fail = (msg) => {
  console.error(red(`✗ ${msg}`));
  return false;
};
const ok = (msg) => {
  console.log(green(`✓ ${msg}`));
  return true;
};

// conductor-board step <id> <pending|running|done|failed> [--goal "..."]
export async function runStep(args) {
  const sp = statusPathOf(args);
  const [id, status] = positionals(args);
  if (!id || !status) return fail("usage: conductor-board step <id> <running|done|failed>");
  const s = load(sp);
  if (!s) return fail(`no status.json at ${path.relative(process.cwd(), sp)} — run status-init first`);
  const step = (s.steps[id] = s.steps[id] || { attempt: 1 });
  step.status = status;
  if (status === "running") {
    step.started_at = step.started_at || now();
    step.gate = step.gate && step.gate !== "passed" ? step.gate : "pending";
    s.current_step = id;
    const g = flag(args, ["--goal"]);
    if (typeof g === "string") s.current_step_goal = g;
  } else if (status === "done") {
    step.completed_at = now();
    if (!step.gate || step.gate === "pending" || step.gate === "checking") step.gate = "passed";
  } else if (status === "failed") {
    step.completed_at = now();
    step.gate = "failed";
  }
  save(sp, s);
  return ok(`${id} → ${status}`);
}

// conductor-board gate <id> <checking|passed|failed>
export async function runGate(args) {
  const sp = statusPathOf(args);
  const [id, gate] = positionals(args);
  if (!id || !gate) return fail("usage: conductor-board gate <id> <checking|passed|failed>");
  const s = load(sp);
  if (!s || !s.steps[id]) return fail(`status.json has no step "${id}"`);
  s.steps[id].gate = gate;
  save(sp, s);
  return ok(`${id} gate → ${gate}`);
}

// conductor-board heartbeat <id> "note" [--iteration X --insight-type T --insight-seed S --final --to STEP]
export async function runHeartbeat(args) {
  const sp = statusPathOf(args);
  const [id, note] = positionals(args);
  if (!id || !note) return fail('usage: conductor-board heartbeat <id> "note" [flags]');
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  const step = (s.steps[id] = s.steps[id] || { attempt: 1 });
  const entry = { at: now(), note };
  const it = flag(args, ["--iteration"]);
  if (typeof it === "string") entry.iteration = it;
  const itype = flag(args, ["--insight-type"]);
  if (typeof itype === "string") {
    entry.insight = {
      type: itype,
      seed: typeof flag(args, ["--insight-seed"]) === "string" ? flag(args, ["--insight-seed"]) : note,
      step: id,
      confidence: typeof flag(args, ["--insight-confidence"]) === "string" ? flag(args, ["--insight-confidence"]) : "medium",
    };
  }
  if (args.includes("--final")) {
    entry.finalBeat = true;
    const to = flag(args, ["--to"]);
    if (typeof to === "string") entry.handoff = { to };
  }
  (step.heartbeat = step.heartbeat || []).push(entry);
  save(sp, s);
  return ok(`${id} ♥ ${note.length > 50 ? note.slice(0, 50) + "…" : note}`);
}

// conductor-board loop <loopId> <item> <subId> <status>
export async function runLoop(args) {
  const sp = statusPathOf(args);
  const [loopId, item, subId, status] = positionals(args);
  if (!loopId || !item || !subId || !status)
    return fail("usage: conductor-board loop <loopId> <item> <subId> <pending|running|done|failed>");
  const s = load(sp);
  if (!s) return fail("no status.json");
  const lp = (s.steps[loopId] = s.steps[loopId] || { type: "loop", iterations: {} });
  lp.type = "loop";
  lp.iterations = lp.iterations || {};
  const iter = (lp.iterations[item] = lp.iterations[item] || {});
  const cell = (iter[subId] = iter[subId] || { attempt: 1 });
  cell.status = status;
  if (status === "done") cell.gate = "passed";
  if (status === "running") {
    lp.current_item = item;
    lp.status = "running";
    s.current_step = loopId;
  }
  // recompute completed
  lp.completed = Object.values(lp.iterations).filter((sub) =>
    Object.values(sub).every((c) => c.status === "done"),
  ).length;
  if (lp.total && lp.completed >= lp.total) lp.status = "done";
  save(sp, s);
  return ok(`${loopId}/${item}/${subId} → ${status}`);
}

// conductor-board suggest "title" --type T --step S --confidence C --rationale R [--current X --proposed Y]
export async function runSuggest(args) {
  const sp = statusPathOf(args);
  const [title] = positionals(args);
  if (!title) return fail('usage: conductor-board suggest "title" --type instruction --step <id>');
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  const str = (names, def) => {
    const v = flag(args, names);
    return typeof v === "string" ? v : def;
  };
  s.suggestions = Array.isArray(s.suggestions) ? s.suggestions : [];
  s.suggestions.push({
    id: `sg-${s.suggestions.length + 1}`,
    title,
    type: str(["--type"], "instruction"),
    step: str(["--step"], undefined),
    confidence: str(["--confidence"], "medium"),
    rationale: str(["--rationale"], undefined),
    current: str(["--current"], undefined),
    proposed: str(["--proposed"], undefined),
    source_heartbeat: now(),
  });
  save(sp, s);
  return ok(`suggestion #${s.suggestions.length}: ${title.length > 50 ? title.slice(0, 50) + "…" : title}`);
}

// conductor-board status-init <conductor.yaml> [--run-id ID]
export async function runStatusInit(args) {
  const [conductorPath] = positionals(args);
  if (!conductorPath) return fail("usage: conductor-board status-init <conductor.yaml>");
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(path.resolve(process.cwd(), conductorPath), "utf8"));
  } catch (e) {
    return fail(`could not read conductor: ${e.message}`);
  }
  const sp = statusPathOf(args);
  const runId =
    (typeof flag(args, ["--run-id"]) === "string" && flag(args, ["--run-id"])) ||
    now().replace(/\.\d+Z$/, "").replace(/:/g, "-");
  const steps = {};
  for (const st of doc.steps || []) {
    if (!st || !st.id) continue;
    steps[st.id] =
      st.type === "loop"
        ? { status: "pending", type: "loop", total: 0, completed: 0, iterations: {} }
        : { status: "pending", gate: "pending", attempt: 1 };
  }
  const status = {
    workflow: doc.name || "workflow",
    run_id: runId,
    status: "running",
    goal: (doc.description || "").trim().replace(/\s+/g, " "),
    current_step: null,
    started_at: now(),
    steps,
  };
  save(sp, status);
  return ok(`status.json initialized at ${path.relative(process.cwd(), sp)} (${Object.keys(steps).length} steps)`);
}
