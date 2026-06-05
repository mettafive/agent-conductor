import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { discoverConductor, loadConductor, mergeKnowledge, saveConductor, SCOPES } from "./knowledge.js";

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

// ── SEQUENTIAL-ORDER guard ───────────────────────────────────────────────────
// loop-scope frontloads a loop's iterations in a defined order (the iterations-map
// key insertion order). For a SEQUENTIAL loop the agent must process them in that
// order — first pending first — so we refuse to advance iteration X's sub-step
// toward done while any EARLIER iteration still has an incomplete sub-step. (A live
// run once did iterations 1,2,5,6,10 and left 3,4,7,8,9 pending on a non-parallel
// loop; this stops exactly that.)
//
// Smart, not rigid:
//   • Parallel loops (conductor step `parallel: true` or `parallel: auto`) are NOT
//     guarded — out-of-order is intended there.
//   • Never blocks the genuine next-in-line iteration, nor re-touching an already
//     in-progress earlier iteration.
//   • If iterations aren't scoped yet (empty map), or the conductor/loop can't be
//     resolved, it doesn't block (fail-open — never a false positive).
//
// Returns { ok: true } to proceed, or { ok: false, message } to refuse.
export function sequentialOrderGuard(sp, loopId, item) {
  let doc;
  try {
    const conductorPath = discoverConductor(sp);
    if (!conductorPath) return { ok: true };
    doc = loadConductor(conductorPath);
  } catch {
    return { ok: true }; // can't read the conductor → fail open, don't block
  }
  const loopStep = (doc.steps || []).find((s) => s && s.id === loopId && s.type === "loop");
  if (!loopStep) return { ok: true }; // not a known loop → not our concern

  // Parallel detection: ONLY `parallel: true` or `parallel: auto` are parallel.
  if (loopStep.parallel === true || loopStep.parallel === "auto") return { ok: true };

  const s = load(sp);
  const iters = (s && s.steps && s.steps[loopId] && s.steps[loopId].iterations) || {};
  const order = Object.keys(iters);
  if (order.length === 0) return { ok: true }; // not scoped yet → nothing to order

  const idx = order.indexOf(item);
  if (idx <= 0) return { ok: true }; // first item, or an item not yet in the scoped map

  // An iteration is COMPLETE only when every declared sub-step cell is `done`.
  // Use the conductor's sub-step ids when available (so a half-done iteration with
  // some cells missing still counts as incomplete); else fall back to "has cells and
  // all done" (an empty {} iteration is NOT complete — it just hasn't started).
  const subIds = (loopStep.steps || []).map((st) => st && st.id).filter(Boolean);
  const isComplete = (cells) => {
    cells = cells || {};
    if (subIds.length) return subIds.every((sid) => cells[sid] && cells[sid].status === "done");
    const vals = Object.values(cells);
    return vals.length > 0 && vals.every((c) => c && c.status === "done");
  };

  // Find the first EARLIER iteration that isn't complete — that's what must be done first.
  for (let i = 0; i < idx; i++) {
    if (!isComplete(iters[order[i]])) {
      const blocker = order[i];
      return {
        ok: false,
        message:
          red(`✗ loop '${loopId}' is sequential — finish '${blocker}' before '${item}'.`) +
          `\n  ${dim(`Next up: ${blocker}. Process scoped iterations in order (first pending first), or mark the loop parallel in the conductor if out-of-order is intended.`)}`,
      };
    }
  }
  return { ok: true };
}

// Declared sub-step ids of a loop, from the conductor (null if unresolvable).
// Used so loop completion is judged against the conductor's REAL sub-steps — not
// whatever cells happen to exist — keeping the board's "done" honest and matching
// complete.js's coverage guard. Fail-open (null) when the conductor can't be read.
function loopSubIds(sp, loopId) {
  try {
    const cp = discoverConductor(sp);
    if (!cp) return null;
    const doc = loadConductor(cp);
    const ls = (doc.steps || []).find((s) => s && s.id === loopId && s.type === "loop");
    if (!ls) return null;
    const ids = (ls.steps || []).map((s) => s && s.id).filter(Boolean);
    return ids.length ? ids : null;
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

// conductor-board heartbeat <id> "note" [--iteration X --sub Y --insight-type T
//   --insight-seed S --insight-scope SC --final --to STEP]
//
// For a loop sub-step (--iteration AND --sub), the beat is written to the
// sub-step cell AND bubbled up to the loop parent's heartbeat array (tagged with
// iteration + sub) so the monitor and freeball banner — which read top-level
// arrays — see every level of activity without the agent beating twice.
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
  const sub = flag(args, ["--sub"]);
  if (typeof sub === "string") entry.sub = sub;
  const itype = flag(args, ["--insight-type"]);
  if (typeof itype === "string") {
    entry.insight = {
      type: itype,
      seed: typeof flag(args, ["--insight-seed"]) === "string" ? flag(args, ["--insight-seed"]) : note,
      step: id,
      scope: typeof flag(args, ["--insight-scope"]) === "string" ? flag(args, ["--insight-scope"]) : "this-conductor",
      confidence: typeof flag(args, ["--insight-confidence"]) === "string" ? flag(args, ["--insight-confidence"]) : "medium",
    };
  }
  // --card opens a new activity card (a coherent unit of work: one intent, one target).
  // This beat's note is the card's title; following beats (no --card) are its detail.
  if (args.includes("--card")) entry.card = true;
  if (args.includes("--final")) {
    entry.finalBeat = true;
    const to = flag(args, ["--to"]);
    if (typeof to === "string") entry.handoff = { to };
  }

  if (typeof it === "string" && typeof sub === "string") {
    // Sub-step beat bubbled to the loop parent's array (tagged iteration + sub).
    // The board reads top-level arrays for the monitor and the freeball banner,
    // and the iteration cards filter this array by iteration/sub — so one write
    // lights up every level. (We write to the parent only, never also the cell,
    // to avoid double-counting since the readers aggregate the whole tree.)
    step.type = "loop";
    step.iterations = step.iterations || {};
    const iter = (step.iterations[it] = step.iterations[it] || {});
    iter[sub] = iter[sub] || { attempt: 1 };
    (step.heartbeat = step.heartbeat || []).push(entry);
  } else {
    (step.heartbeat = step.heartbeat || []).push(entry);
  }
  save(sp, s);
  // When this beat opens a card, surface its id so a parallel summarizer can target it later.
  const cardTag = entry.card ? ` [card ${entry.at}]` : "";
  return ok(`${id}${typeof sub === "string" ? `/${it}/${sub}` : ""} ♥ ${note.length > 50 ? note.slice(0, 50) + "…" : note}${cardTag}`);
}

// conductor-board overview <step> "summary" [--card <cardId>]
//
// Attach a synthesized OVERVIEW to an activity card — written by a parallel agent that
// summarizes the card's heartbeats once it closes. The board shows the overview by default
// with a toggle to the raw beats. Without --card, targets the most-recently CLOSED card
// (the second-to-last card opener; the last opener is the still-open card).
export async function runOverview(args) {
  const sp = statusPathOf(args);
  const [id, text] = positionals(args);
  if (!id || !text) return fail('usage: conductor-board overview <step> "summary" [--card <cardId>]');
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  const step = s.steps[id];
  if (!step) return fail(`no step "${id}"`);
  let cardId = flag(args, ["--card"]);
  if (typeof cardId !== "string") {
    const openers = (step.heartbeat || []).filter((h) => h && h.card).map((h) => h.at);
    cardId = openers.length >= 2 ? openers[openers.length - 2] : openers[openers.length - 1];
    if (!cardId) return fail(`no cards on step "${id}" to summarize`);
  }
  step.cardOverviews = step.cardOverviews || {};
  step.cardOverviews[cardId] = text;
  save(sp, s);
  return ok(`${id} ▸ overview saved for card ${cardId}`);
}

// ── developer notes / directives — the flow-manager feedback loop ────────────────
// A note the developer leaves on a card. Promoted with --directive it becomes a steering
// signal the next run's Phase 0 improve-pass MUST resolve (applied-with-how or deferred-with-why).

// conductor-board comment <step> "text" --card <cardId> [--card-title "…"] [--directive --scope SC]
// Appends a note (a card can hold several) with an audit history. Edits/removals are board-driven.
export async function runComment(args) {
  const sp = statusPathOf(args);
  const [id, text] = positionals(args);
  const cardId = flag(args, ["--card"]);
  if (!id || !text || typeof cardId !== "string")
    return fail('usage: conductor-board comment <step> "text" --card <cardId> [--card-title "…"] [--directive --scope SC]');
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  s.developer_notes = Array.isArray(s.developer_notes) ? s.developer_notes : [];
  const directive = args.includes("--directive");
  const scope = flag(args, ["--scope"]);
  const cardTitle = flag(args, ["--card-title"]);
  const at = now();
  s.developer_notes.push({
    id: `${cardId}:${Date.now()}`,
    at,
    updated_at: at,
    step: id,
    card: cardId,
    card_title: typeof cardTitle === "string" ? cardTitle : undefined,
    text,
    directive,
    scope: typeof scope === "string" ? scope : undefined,
    status: "open",
    history: [{ at, action: "created", to: text }],
  });
  save(sp, s);
  return ok(`${id} ▸ ${directive ? "directive" : "note"} on card ${cardId}: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`);
}

// conductor-board directives [--open] [--step <id>]  — list directives (for the Phase 0 ACK pass).
// Prints the card-title FOOTNOTE so the agent knows which activity each directive is about.
export async function runDirectives(args) {
  const sp = statusPathOf(args);
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  const openOnly = args.includes("--open");
  const stepF = flag(args, ["--step"]);
  let notes = (Array.isArray(s.developer_notes) ? s.developer_notes : []).filter(
    (n) => n && n.directive && n.status !== "removed",
  );
  if (openOnly) notes = notes.filter((n) => n.status === "open");
  if (typeof stepF === "string") notes = notes.filter((n) => n.step === stepF);
  if (notes.length === 0) {
    console.log(openOnly ? "No open directives." : "No directives.");
    return true;
  }
  for (const n of notes) {
    const tag = n.status === "open" ? "● open" : n.status === "applied" ? "✓ applied" : "– deferred";
    const where = n.card_title ? `“${n.card_title}”` : `card ${n.card}`;
    console.log(`${tag}  [${n.step}] ${where} (${n.scope || "this-conductor"})`);
    console.log(`        ${n.text}`);
    if (n.resolution) console.log(`        ↳ ${n.resolution}`);
    const edits = (n.history || []).filter((h) => h.action === "edited").length;
    console.log(`        id=${n.id}${edits ? ` · edited ${edits}×` : ""}`);
  }
  return true;
}

// conductor-board resolve <cardId> --applied "how" | --deferred "why"
export async function runResolve(args) {
  const sp = statusPathOf(args);
  const [cardId] = positionals(args);
  const applied = flag(args, ["--applied"]);
  const deferred = flag(args, ["--deferred"]);
  if (!cardId || (typeof applied !== "string" && typeof deferred !== "string"))
    return fail('usage: conductor-board resolve <cardId> --applied "how" | --deferred "why"');
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  const note = (Array.isArray(s.developer_notes) ? s.developer_notes : []).find((n) => n && n.id === cardId);
  if (!note) return fail(`no developer note on card "${cardId}"`);
  note.status = typeof applied === "string" ? "applied" : "deferred";
  note.resolution = typeof applied === "string" ? applied : deferred;
  note.resolved_at = now();
  if (typeof s.run_id === "string") note.resolved_run = s.run_id;
  save(sp, s);
  return ok(`${note.status} directive on card ${cardId}`);
}

// conductor-board loop-scope <loopId> <item...> [--note "..."]
//
// Frontload a loop's whole iteration list as pending the moment it's determined
// (§6.2): writes every item into the iterations map and sets total, so the board
// shows the full plan before any card moves. Also appends a "scope beat" naming
// the items, unless --note is given.
export async function runLoopScope(args) {
  const sp = statusPathOf(args);
  const [loopId, ...items] = positionals(args);
  if (!loopId || items.length === 0)
    return fail("usage: conductor-board loop-scope <loopId> <item1> <item2> … [--note \"...\"]");
  // Guard: a single item containing whitespace is almost always a mistakenly-quoted LIST —
  // `loop-scope <loop> "a b c"` instead of `loop-scope <loop> a b c` — which would scope the loop
  // as ONE weird iteration named after the whole list. Warn loudly (but proceed, so a genuinely
  // multi-word single item still works) so it's caught before the board renders the wrong shape.
  if (items.length === 1) {
    const toks = items[0].trim().split(/\s+/);
    if (toks.length >= 2) {
      console.error(red(`⚠ loop-scope got ONE item with ${toks.length} space-separated tokens — did you mean ${toks.length} separate iterations?`));
      console.error(dim(`    pass each as its own argument:  loop-scope ${loopId} ${toks.slice(0, 3).join(" ")} …  (NOT one quoted string)`));
      console.error(dim(`    proceeding as a SINGLE iteration — re-run with separate args if that's wrong.`));
    }
  }
  // Dedupe: a repeated item is always a mistake (an agent listing the same unit twice).
  // Counting dupes in `total` while the iterations map dedupes them leaves total >
  // iteration-count, so the loop can NEVER reach completion. Scope DISTINCT items only.
  const seenItems = new Set();
  const uniqueItems = items.filter((it) => (seenItems.has(it) ? false : (seenItems.add(it), true)));
  if (uniqueItems.length !== items.length) {
    console.error(
      red(`⚠ loop-scope got ${items.length - uniqueItems.length} duplicate item(s) — scoping ${uniqueItems.length} distinct iteration(s).`),
    );
  }
  const s = load(sp);
  if (!s) return fail("no status.json — run status-init first");
  const lp = (s.steps[loopId] = s.steps[loopId] || { type: "loop", iterations: {} });
  lp.type = "loop";
  lp.iterations = lp.iterations || {};
  for (const item of uniqueItems) {
    lp.iterations[item] = lp.iterations[item] || {}; // sub-steps materialize as work begins
  }
  // total tracks the DISTINCT scoped iterations actually in the map (re-scoping is additive,
  // so reconcile to the real key count rather than to this call's argument length).
  lp.total = Object.keys(lp.iterations).length;
  lp.completed = lp.completed || 0;
  if (lp.status !== "running") lp.status = lp.status || "pending";
  const noteFlag = flag(args, ["--note"]);
  const note =
    typeof noteFlag === "string"
      ? noteFlag
      : `${uniqueItems.length} scoped: ${uniqueItems.join(", ")}. All pending.`;
  (lp.heartbeat = lp.heartbeat || []).push({ at: now(), note });
  save(sp, s);
  return ok(`${loopId} scoped — ${uniqueItems.length} iterations frontloaded`);
}

// conductor-board loop <loopId> <item> <subId> <status>
export async function runLoop(args) {
  const sp = statusPathOf(args);
  const [loopId, item, subId, status] = positionals(args);
  if (!loopId || !item || !subId || !status)
    return fail("usage: conductor-board loop <loopId> <item> <subId> <pending|running|done|failed>");
  const s = load(sp);
  if (!s) return fail("no status.json");

  // SEQUENTIAL-ORDER guard: when advancing a sub-step toward done (running/done),
  // refuse if an earlier scoped iteration is still incomplete (sequential loops only).
  if (status === "running" || status === "done") {
    const g = sequentialOrderGuard(sp, loopId, item);
    if (!g.ok) {
      console.error(g.message);
      return false; // don't write — the agent must process iterations in order
    }
  }

  // Guard a typo'd sub-step id: if the conductor declares this loop's sub-steps and
  // subId isn't one of them, warn loudly (but still write — fail-open for back-compat).
  // Without this, `loop <item> <typo> done` writes a phantom cell that USED to satisfy
  // the loose "all present cells done" completion check and falsely turn the board green.
  const declaredSubs = loopSubIds(sp, loopId);
  if (declaredSubs && !declaredSubs.includes(subId)) {
    console.error(
      red(`⚠ '${subId}' is not a declared sub-step of loop '${loopId}' (declared: ${declaredSubs.join(", ")}).`),
    );
  }
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
  // Recompute completed against the conductor's DECLARED sub-steps when available, so an
  // iteration counts complete only when every real sub-step is done (matching complete.js's
  // coverage guard) — a phantom/typo'd cell can't falsely finish it. Fall back to the loose
  // "has cells and all done" check only when the conductor can't be resolved. Either way a
  // frontloaded-but-empty iteration ({}) must NOT count (that would flip the whole loop done
  // the instant the first iteration finishes).
  lp.completed = Object.values(lp.iterations).filter((sub) => {
    if (declaredSubs) return declaredSubs.every((sid) => sub[sid] && sub[sid].status === "done");
    const cells = Object.values(sub);
    return cells.length > 0 && cells.every((c) => c.status === "done");
  }).length;
  if (lp.total && lp.completed >= lp.total) lp.status = "done";
  save(sp, s);
  return ok(`${loopId}/${item}/${subId} → ${status}`);
}

// conductor-board suggest "title" --scope SC [--type T --step S --current X
//   --proposed Y --note Z --conductor <file>]
//
// Writes the learning straight into the conductor file's knowledge: section —
// the conductor IS the knowledge base (§10.5). --scope is REQUIRED and routes
// the insight: this-conductor (auto-appliable in Phase 0) | upstream | template |
// tooling | corpus. A repeat sighting bumps `observed` and escalates the status
// (emerging → proven at 3×). Structural types (new_step/remove_step/reorder)
// need human approval, so they never auto-apply.
export async function runSuggest(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      'usage: conductor-board suggest "title" --scope <scope> [--type <kind>] [--step <id>]\n' +
        "         [--current X] [--proposed Y] [--note Z] [--conductor <file>]\n" +
        `  --scope (required): ${SCOPES.join(" | ")}\n` +
        "  Appends to the conductor's knowledge: section. this-conductor insights with\n" +
        "  current/proposed auto-apply once proven; structural types need approval.",
    );
    return true;
  }
  const sp = statusPathOf(args);
  const [title] = positionals(args);
  if (!title) return fail('usage: conductor-board suggest "title" --scope this-conductor');
  const str = (names, def) => {
    const v = flag(args, names);
    return typeof v === "string" ? v : def;
  };
  const scope = str(["--scope"], undefined);
  if (!scope) return fail("--scope is required (this-conductor | upstream | template | tooling | corpus)");
  if (!SCOPES.includes(scope)) return fail(`--scope must be one of: ${SCOPES.join(", ")}`);

  const conductorPath = discoverConductor(sp, str(["--conductor", "-c"], undefined));
  if (!conductorPath) return fail("no conductor file found next to status.json or in cwd");
  let doc;
  try {
    doc = loadConductor(conductorPath);
  } catch (e) {
    return fail(`could not parse conductor: ${e.message}`);
  }
  const merged = mergeKnowledge(doc, {
    title,
    scope,
    step: str(["--step"], undefined),
    type: str(["--type"], undefined),
    current: str(["--current"], undefined),
    proposed: str(["--proposed"], undefined),
    note: str(["--note"], undefined),
  });
  const res = saveConductor(conductorPath, doc);
  if (!res.ok) return fail(`knowledge not written — ${res.error}`);
  // Surface the learning live: drop an insight-tagged heartbeat on the current (or --step) step so
  // it shows in the stream + the Insights tab. The knowledge store and the beat stream are separate
  // rails — without this the Insights tab stays empty even though we captured learnings.
  try {
    const status = JSON.parse(fs.readFileSync(sp, "utf8"));
    const stepId = str(["--step"], undefined) || status.current_step;
    const st = stepId && status.steps && status.steps[stepId];
    if (st) {
      if (!Array.isArray(st.heartbeat)) st.heartbeat = [];
      st.heartbeat.push({
        at: new Date().toISOString(),
        note: `learned: ${title}`,
        insight: { type: str(["--type"], undefined) || "learning", seed: title, scope },
      });
      fs.writeFileSync(sp, JSON.stringify(status, null, 2));
    }
  } catch {
    /* status not writable — the knowledge is still saved */
  }
  return ok(
    `knowledge [${scope}] "${title.length > 46 ? title.slice(0, 46) + "…" : title}" — ${merged.status} (observed ${merged.observed}×)`,
  );
}

// conductor-board knowledge [list] [--min N] [--scope SC] [--status ST] [--conductor file]
//
// With --min, exits 0 when the conductor holds at least N knowledge entries
// (use as the final-step "captured learnings" gate). With `list`, prints them.
export async function runKnowledge(args) {
  const sp = statusPathOf(args);
  const str = (names) => {
    const v = flag(args, names);
    return typeof v === "string" ? v : undefined;
  };
  const conductorPath = discoverConductor(sp, str(["--conductor", "-c"]));
  if (!conductorPath) return fail("no conductor file found");
  let doc;
  try {
    doc = loadConductor(conductorPath);
  } catch (e) {
    return fail(`could not parse conductor: ${e.message}`);
  }
  const all = (Array.isArray(doc.knowledge) ? doc.knowledge : []).filter(
    (k) => k && typeof k === "object" && k.title,
  );
  const scope = str(["--scope"]);
  const st = str(["--status"]);
  const filtered = all.filter(
    (k) =>
      (!scope || (k.scope || "this-conductor") === scope) &&
      (!st || (k.status || "emerging") === st),
  );
  // Quality gate (§3.5): enforce captured learnings by VALUE, not count.
  //   --min N         at least N knowledge entries
  //   --min-scopes M  entries span at least M distinct scopes (forces the
  //                   cross-cutting reflection — the highest-leverage insights)
  const min = str(["--min"]);
  const minScopes = str(["--min-scopes"]);
  if (min !== undefined || minScopes !== undefined) {
    const n = min !== undefined ? Number(min) || 0 : 0;
    const distinctScopes = new Set(filtered.map((k) => k.scope || "this-conductor")).size;
    const m = minScopes !== undefined ? Number(minScopes) || 0 : 0;
    const countOk = filtered.length >= n;
    const scopesOk = distinctScopes >= m;
    if (countOk && scopesOk)
      return ok(`knowledge: ${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}, ${distinctScopes} scope${distinctScopes === 1 ? "" : "s"} (ok)`);
    const why = [];
    if (!countOk) why.push(`need ≥ ${n} entries (have ${filtered.length})`);
    if (!scopesOk) why.push(`need ≥ ${m} scopes (have ${distinctScopes})`);
    return fail(
      `knowledge gate: ${why.join(", ")} — capture what you learned, including cross-cutting:\n` +
        '    conductor-board suggest "…" --scope upstream|template|tooling|corpus',
    );
  }
  if (filtered.length === 0) console.log(dim("  (no knowledge yet)"));
  for (const k of filtered) {
    console.log(`  ${k.status || "emerging"} · ${k.scope || "this-conductor"} · ${k.observed || 1}× — ${k.title}`);
  }
  return true;
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
  const wfName = doc.name || "workflow";

  // §6.2 — every run gets a human name: {workflow}-run-{N}-{timestamp}. N is the
  // count of archived runs + 1; the timestamp is the run id trimmed to minutes.
  const nameSlug = String(wfName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const historyDir = path.join(path.dirname(sp), "history");
  let priorRuns = 0;
  try {
    priorRuns = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).length;
  } catch {
    /* no history yet */
  }
  const tsShort = runId.replace(/-\d{2}$/, ""); // 2026-06-04T12-30-00 → 2026-06-04T12-30
  const runName =
    (typeof flag(args, ["--run-name"]) === "string" && flag(args, ["--run-name"])) ||
    `${nameSlug}-run-${priorRuns + 1}-${tsShort}`;

  // §6.1 — auto_improve (default on). When off, the Phase 0 self-improvement
  // pass is fully disabled: no improvement cards injected at all.
  const autoImprove = doc.auto_improve !== false;

  const steps = {};
  let improvements = 0;

  if (autoImprove) {
    // Phase 0 (§10.2): auto-inject improvement cards from PROVEN this-conductor
    // knowledge BEFORE the workflow steps. Entries with current/proposed apply
    // automatically; structural ones (new_step/remove_step/reorder) are flagged
    // for human approval. A _validate card closes the phase.
    const STRUCTURAL = new Set(["new_step", "remove_step", "reorder"]);
    const knowledge = (Array.isArray(doc.knowledge) ? doc.knowledge : []).filter(
      (k) => k && typeof k === "object" && k.title,
    );
    const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const seen = new Set();

    // _improve::read-knowledge leads the phase: read + categorize the knowledge.
    if (knowledge.length > 0) {
      const cat = (s) => knowledge.filter((k) => (k.status || "emerging") === s).length;
      const cross = knowledge.filter((k) => (k.scope || "this-conductor") !== "this-conductor").length;
      steps["_improve::read-knowledge"] = {
        status: "pending",
        gate: "pending",
        attempt: 1,
        improve: {
          title: "Read knowledge",
          kind: "read-knowledge",
          note:
            `${cat("proven")} proven · ${cat("emerging")} emerging · ${cat("applied")} applied · ` +
            `${cross} cross-cutting`,
        },
      };
    }

    for (const k of knowledge) {
      if ((k.status || "emerging") !== "proven") continue;
      if ((k.scope || "this-conductor") !== "this-conductor") continue;
      const structural = STRUCTURAL.has(k.type);
      const textChange = k.current && k.proposed;
      if (!structural && !textChange) continue; // proven but nothing actionable
      let id = `_improve::${slug(k.title)}`;
      while (seen.has(id)) id += "-x";
      seen.add(id);
      steps[id] = {
        status: "pending",
        gate: "pending",
        attempt: 1,
        improve: {
          step: k.step,
          title: k.title,
          current: k.current,
          proposed: k.proposed,
          note: k.note,
          observed: k.observed || 1,
          scope: k.scope || "this-conductor",
          structural,
          kind: k.type || "instruction",
        },
      };
      improvements += 1;
    }
    if (improvements > 0) {
      steps["_improve::validate"] = {
        status: "pending",
        gate: "pending",
        attempt: 1,
        improve: { title: "Validate conductor", kind: "validate" },
      };
    }
  }

  for (const st of doc.steps || []) {
    if (!st || !st.id) continue;
    steps[st.id] =
      st.type === "loop"
        ? { status: "pending", type: "loop", total: 0, completed: 0, iterations: {} }
        : { status: "pending", gate: "pending", attempt: 1 };
  }
  const status = {
    workflow: wfName,
    run_id: runId,
    run_name: runName,
    auto_improve: autoImprove,
    status: "running",
    goal: (doc.description || "").trim().replace(/\s+/g, " "),
    current_step: null,
    started_at: now(),
    steps,
  };
  save(sp, status);
  const workflowCount = (doc.steps || []).filter((s) => s && s.id).length;
  return ok(
    `status.json initialized (${workflowCount} steps` +
      (improvements ? `, ${improvements} Phase 0 improvement${improvements === 1 ? "" : "s"}` : "") +
      `)`,
  );
}
