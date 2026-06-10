import fs from "node:fs";
import path from "node:path";
import { callModel, compact, extractJson, flag } from "./decompose.js";
import {
  conductorRootFromStatus,
  ensureKnowledge,
  readJsonMaybe,
  timestampRunId,
  writeJson,
} from "./learning.js";
import { validateConductor } from "./validate.js";
import { stampBeat } from "./status-store.js";
import { getHealth } from "./ensure-board.js";
import {
  applyLockedEdges,
  checkWorkflowWithDependencyGuard,
  listLockedEdges,
} from "./order.js";
import { receiptArtifactName } from "./artifacts.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

export function normalizeIntegration(payload) {
  const idsFrom = (change) => {
    const raw = Array.isArray(change?.knowledge_ids)
      ? change.knowledge_ids
      : [change?.knowledge_id || change?.knowledge || change?.id];
    return [...new Set(raw.map(compact).filter(Boolean))];
  };
  const normalizeRequiresDelta = (change) => {
    const raw = change?.requires || change?.delta || change?.requires_delta || {};
    const card = Number.isInteger(Number(raw?.card ?? change?.card)) ? Number(raw.card ?? change.card) : null;
    const nums = (value) => Array.isArray(value)
      ? [...new Set(value.map((n) => Number(n)).filter((n) => Number.isInteger(n)))]
      : [];
    return {
      card,
      add: nums(raw?.add),
      remove: nums(raw?.remove),
    };
  };
  const changes = Array.isArray(payload?.changes)
    ? payload.changes.map((change) => {
        const type = ["edit_instruction", "edit"].includes(change?.type)
          ? "edit_instruction"
          : compact(change?.type);
        return {
          type,
          card: Number.isInteger(Number(change?.card)) ? Number(change.card) : null,
          title: compact(change?.title),
          change: compact(change?.change || change?.summary || change?.what_changed),
          knowledge_ids: idsFrom(change),
          new_instruction: compact(change?.new_instruction || change?.instruction),
          new_card: type === "add_card" && change?.card && typeof change.card === "object" && !Array.isArray(change.card)
            ? {
                title: compact(change.card.title),
                instruction: compact(change.card.instruction),
              }
            : undefined,
          requires: type === "edit_order" ? normalizeRequiresDelta(change) : undefined,
          add_requires: type === "add_card" ? change?.requires : undefined,
        };
      }).filter((change) => change.knowledge_ids.length || change.new_instruction || change.change || change.requires || change.new_card)
    : [];
  const dismissed = Array.isArray(payload?.dismissed)
    ? payload.dismissed.map((item) => ({
        id: compact(item?.id || item?.knowledge_id),
        reason: compact(item?.reason || item?.why),
      })).filter((item) => item.id)
    : [];
  // Per-insight plain-English what/why — a near-free byproduct of the composer's
  // existing call (no extra round-trip). Used for the loop's closing heartbeat.
  const applied_notes = Array.isArray(payload?.applied_notes)
    ? payload.applied_notes.map((item) => ({
        knowledge_id: compact(item?.knowledge_id || item?.id),
        note: compact(item?.note || item?.what || item?.change),
      })).filter((item) => item.note)
    : [];
  return { changes, dismissed, applied_notes };
}

export function mergeLocked(result, locked) {
  const changes = [];
  const dismissed = [];
  const seenChanges = new Set();
  const seenDismissed = new Set();

  for (const item of locked.values()) {
    if (item.kind === "change") {
      changes.push({ ...item.value });
      for (const id of item.value.knowledge_ids || []) seenChanges.add(id);
    } else if (item.kind === "dismissed") {
      dismissed.push({ ...item.value });
      seenDismissed.add(item.value.id);
    }
  }
  for (const change of result.changes || []) {
    const ids = (change.knowledge_ids || []).filter((id) => !seenChanges.has(id) && !seenDismissed.has(id));
    if (!ids.length) continue;
    changes.push({ ...change, knowledge_ids: ids });
  }
  for (const item of result.dismissed || []) {
    if (seenDismissed.has(item.id) || seenChanges.has(item.id)) continue;
    dismissed.push(item);
  }
  // Carry the composer's per-insight notes through unchanged (the closing-beat
  // byproduct; not part of the lock machinery).
  return { changes, dismissed, applied_notes: result.applied_notes || [] };
}

function handledIds(result) {
  return new Set([
    ...(result.changes || []).flatMap((change) => change.knowledge_ids || []).filter(Boolean),
    ...(result.dismissed || []).map((item) => item.id).filter(Boolean),
  ]);
}

function unresolvedItems(openItems, result) {
  const handled = handledIds(result);
  return openItems.filter((item) => !handled.has(item.id));
}

function normalizeIntegrationCheck(payload) {
  const verdict = String(payload?.verdict || "").toUpperCase() === "PASS" ? "PASS" : "FAIL";
  const idsFrom = (item) => {
    const raw = Array.isArray(item?.knowledge_ids) ? item.knowledge_ids : [item?.knowledge_id || item?.id];
    return [...new Set(raw.map(compact).filter(Boolean))];
  };
  const passed = [
    ...(Array.isArray(payload?.passed_patches) ? payload.passed_patches : []),
    ...(Array.isArray(payload?.passed) ? payload.passed : []),
  ].map((item) => ({
    card: Number.isInteger(Number(item?.card)) ? Number(item.card) : null,
    knowledge_ids: idsFrom(item),
    kind: compact(item?.kind || item?.type),
    reason: compact(item?.reason),
  })).filter((item) => item.knowledge_ids.length);
  const failed = [
    ...(Array.isArray(payload?.failed_patches) ? payload.failed_patches : []),
    ...(Array.isArray(payload?.failed) ? payload.failed : []),
    ...(Array.isArray(payload?.unhandled) ? payload.unhandled : []),
  ].map((item) => ({
    card: Number.isInteger(Number(item?.card)) ? Number(item.card) : null,
    knowledge_ids: idsFrom(item),
    feedback: compact(item?.feedback || item?.reason || item?.problem),
    required_repair: compact(item?.required_repair || item?.repair || item?.needed),
  })).filter((item) => item.knowledge_ids.length || item.feedback || item.required_repair);
  return {
    verdict,
    passed: verdict === "PASS",
    feedback: compact(payload?.feedback),
    repair_prompt: compact(payload?.repair_prompt),
    passed_patches: passed,
    failed_patches: failed,
  };
}

function normalizeOrderCoverageCheck(payload) {
  const verdict = String(payload?.verdict || "").toUpperCase() === "PASS" ? "PASS" : "FAIL";
  const passed = Array.isArray(payload?.passed)
    ? payload.passed.map((item) => ({
        knowledge_id: compact(item?.knowledge_id || item?.id),
        reason: compact(item?.reason),
      })).filter((item) => item.knowledge_id)
    : [];
  const failed = Array.isArray(payload?.failed)
    ? payload.failed.map((item) => ({
        knowledge_id: compact(item?.knowledge_id || item?.id),
        problem: compact(item?.problem || item?.feedback),
        required_repair: compact(item?.required_repair || item?.repair || item?.needed),
      })).filter((item) => item.knowledge_id || item.problem || item.required_repair)
    : [];
  return {
    verdict,
    passed: verdict === "PASS",
    feedback: compact(payload?.feedback),
    passed_patches: passed.map((item) => ({ knowledge_ids: [item.knowledge_id], kind: "edit_order", reason: item.reason })),
    failed_patches: failed.map((item) => ({ knowledge_ids: [item.knowledge_id], feedback: item.problem, required_repair: item.required_repair })),
    repair_prompt: compact(payload?.repair_prompt),
  };
}

function normalizeRemovalSafetyCheck(payload) {
  const verdict = String(payload?.verdict || "").toUpperCase() === "SAFE" ? "SAFE" : "UNSAFE";
  const dependents = Array.isArray(payload?.dependents)
    ? payload.dependents.map((item) => ({
        card: Number.isInteger(Number(item?.card)) ? Number(item.card) : null,
        reference: compact(item?.reference || item?.reason || item?.feedback),
      })).filter((item) => Number.isInteger(item.card) || item.reference)
    : [];
  return {
    verdict,
    passed: verdict === "SAFE",
    feedback: compact(payload?.feedback),
    dependents,
    repair_prompt: compact(payload?.repair_prompt),
    failed_patches: verdict === "SAFE" ? [] : dependents.map((item) => ({
      card: item.card,
      feedback: item.reference || compact(payload?.feedback) || "A surviving card still depends on the removed card.",
      required_repair: compact(payload?.repair_prompt) || "Edit surviving dependencies/instructions before retiring this card.",
    })),
  };
}

function latestRunSummary(root) {
  const runs = path.join(root, "runs");
  if (!fs.existsSync(runs)) return null;
  const dirs = fs.readdirSync(runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of dirs.reverse()) {
    const summary = readJsonMaybe(path.join(runs, name, "summary.json"));
    if (summary) return summary;
  }
  return null;
}

const INTEGRATION_PHASES = [
  { key: "instruction", title: "Apply instruction insights", instruction: "Fold open instruction insights into the relevant card instructions while preserving existing requirements." },
  { key: "order", title: "Map order insights", instruction: "Apply approved dependency/order insights as requires deltas and validate the graph." },
  { key: "add", title: "Add cards", instruction: "Append any approved new cards and place them safely in the dependency graph." },
  { key: "remove", title: "Retire cards", instruction: "Neuter approved obsolete cards in place and hide them from board display." },
  { key: "validate", title: "Validate updated workflow", instruction: "Validate the updated cards and workflow before handing off to execution." },
];

function integrationWorkflow(openItems) {
  const needed = new Set(["validate"]);
  if (openItems.some(isInstructionChangeItem)) needed.add("instruction");
  if (openItems.some(isOrderChangeItem)) needed.add("order");
  if (openItems.some(isAddChangeItem)) needed.add("add");
  if (openItems.some(isRemoveChangeItem)) needed.add("remove");
  const selected = INTEGRATION_PHASES.filter((phase) => needed.has(phase.key));
  return {
    conductor: "3.0.0",
    name: "Integrating insights",
    description: "Apply open knowledge items before starting the next run.",
    max_attempts: 10,
    steps: selected.map((phase, index) => ({
      title: phase.title,
      instruction: phase.instruction,
      requires: index === 0 ? [] : [index - 1],
      phase_key: phase.key,
      // These cards SHAPE the plan (rewrite the card list) rather than do work.
      // The board reads `kind` into phase "shaping" and renders them distinct.
      kind: "shaping",
    })),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function writeIntegrationStatus(statusPath, status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

async function initIntegrationBoard(root, openItems, port = 3042) {
  const workflow = integrationWorkflow(openItems);
  const workflowPath = path.join(root, "integration.workflow.json");
  const statusPath = path.join(root, "integration.status.json");
  writeJson(workflowPath, workflow);
  const steps = {};
  for (const [index] of workflow.steps.entries()) {
    steps[String(index)] = { status: "pending", gate: "pending", attempt: 1 };
  }
  writeIntegrationStatus(statusPath, {
    workflow: workflow.name,
    run_id: `integration-${nowIso().replace(/\.\d+Z$/, "").replace(/:/g, "-")}`,
    status: "running",
    goal: workflow.description,
    current_step: null,
    started_at: nowIso(),
    steps,
  });
  // SURFACE ON SERVED — integration gets the same served check compile and run have.
  // Wait until /health.workflows includes this integration feed before proceeding, so we
  // never assume the board is already showing it. (Bounded; no board ⇒ returns false and
  // proceeds — the wait never blocks the integration run.)
  await waitIntegrationServed(port, `${path.basename(root)} (integration)`);
  const phaseToStep = new Map(workflow.steps.map((step, index) => [step.phase_key, index]));
  return { workflowPath, statusPath, phaseToStep };
}

async function waitIntegrationServed(port, key, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await getHealth(port);
    if (h?.workflows && Object.prototype.hasOwnProperty.call(h.workflows, key)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// The loop's closing summary — ONE multi-line note (never one beat per insight):
// a lead line, then one plain-English what/why per applied insight. Prefers the
// composer's per-insight applied_notes; falls back to the per-edit change summaries
// (also real applications, not stock text). Returns null when nothing was applied,
// so the beat stays the quiet generic "passed." rather than a bare "Applied 0".
export function buildAppliedSummary(result) {
  const notes = Array.isArray(result?.applied_notes)
    ? result.applied_notes.filter((n) => n && n.note && n.note.trim())
    : [];
  const lines = notes.length
    ? notes.map((n) => `- ${n.knowledge_id ? `${n.knowledge_id}: ` : ""}${n.note.trim()}`)
    : (result?.changes || [])
        .filter((c) => c && c.change && c.change.trim())
        .map((c) => {
          const ids = (c.knowledge_ids || []).join(", ");
          return `- ${ids ? `${ids}: ` : ""}${c.change.trim()}`;
        });
  if (!lines.length) return null;
  const count =
    notes.length || new Set((result?.changes || []).flatMap((c) => c.knowledge_ids || [])).size || lines.length;
  return `Applied ${count} insight${count === 1 ? "" : "s"}.\n${lines.join("\n")}`;
}

export function integrationProgressNote(evt) {
  const label = evt.maxAttempts ? `${evt.attempt}/${evt.maxAttempts}` : "";
  const phase = INTEGRATION_PHASES.find((item) => item.key === evt.phase)?.title || evt.phase;
  if (evt.event === "phase-start") return `${phase}: started.`;
  if (evt.event === "phase-end") {
    // The closing beat: the multi-line applied summary rides the phase-end note
    // (one beat, marks the card done) when the pass applied something.
    if (evt.passed && evt.summaryNote) return evt.summaryNote;
    return evt.passed ? `${phase}: passed.` : `${phase}: failed. ${compact(evt.feedback)}`;
  }
  if (evt.event === "attempt-start") return `${phase}: attempt ${label} started.`;
  if (evt.event === "check-start") return `${phase}: checker attempt ${label} started.`;
  if (evt.event === "check-end") return evt.passed ? `${phase}: checker attempt ${label} passed.` : `${phase} feedback: ${compact(evt.feedback)}`;
  return `${phase}: ${evt.event}`;
}

export function makeIntegrationProgress({ statusPath, phaseToStep }) {
  return (evt) => {
    const step = phaseToStep.get(evt.phase);
    if (!Number.isInteger(step)) return;
    const status = readJsonMaybe(statusPath) || {};
    status.steps = status.steps && typeof status.steps === "object" ? status.steps : {};
    const key = String(step);
    const cell = status.steps[key] || { status: "pending", gate: "pending", attempt: 1 };
    if (!cell.started_at) cell.started_at = nowIso();
    if (evt.attempt) cell.attempt = evt.attempt;
    const checking = evt.event === "check-start" || (evt.event === "check-end" && evt.passed === false);
    const done = evt.event === "phase-end" && evt.passed !== false;
    const failed = evt.event === "phase-end" && evt.passed === false;
    cell.status = failed ? "failed" : done ? "done" : "running";
    cell.gate = failed ? "failed" : done ? "passed" : checking ? "checking" : "pending";
    cell.heartbeat = Array.isArray(cell.heartbeat) ? cell.heartbeat : [];
    const note = integrationProgressNote(evt);
    if (note) {
      // Stamp seq + event_at so integration beats sort by work-order in the terminal
      // alongside the run's beats (integration is single-threaded, so seq is naturally
      // monotonic here — the lock isn't needed, but the fields keep sorting consistent).
      cell.heartbeat.push(
        stampBeat(status, {
          at: nowIso(),
          note,
          ...(evt.tone ? { tone: evt.tone } : {}),
        }),
      );
    }
    if (done || failed) cell.completed_at = nowIso();
    status.steps[key] = cell;
    status.current_step = done ? null : key;
    status.status = failed ? "failed" : evt.phase === "validate" && done ? "done" : "running";
    if (status.status === "done" || status.status === "failed") status.completed_at = nowIso();
    writeIntegrationStatus(statusPath, status);
  };
}

function integrationPrompt({ skill, cards, workflow, openItems, summary, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 10 }) {
  return `Here is the skill file. Here are the current cards. Here are the open learning items.

For each learning item, edit the most relevant existing card's instruction to include this learning. Fold it in naturally — weave it into the instruction as if it was always there, do not append it as a footnote.

If multiple learning items apply to the same card, return exactly one combined edit for that card. The patch lists every handled item in knowledge_ids and provides one final new_instruction that preserves the original instruction and integrates all listed insights. Never return competing full-text patches for the same card.

For learning items tagged "efficiency", preserve the card's original goal and fold the detail in as upfront context, a known path, a known command, or a known shortcut so the next run avoids rediscovery.

If a learning item doesn't apply to any existing card, dismiss it with a one-line reason. Do not create cards in this integration pass.

If a learning item is no longer relevant, mark it dismissed with a one-line reason.

If two insights on one card genuinely conflict, merge them as sensibly as possible in the single combined instruction. Do not add special machinery and do not split the card.

You are returning patches only. Do not return a full cards array or workflow.
Allowed change type for this version: "edit_instruction" only.
Do not add cards. Do not remove cards. Do not rename cards. Do not reorder cards. Do not change dependencies.

For each knowledge item you apply, also emit a one-sentence plain-English note of what you changed and why — the concrete application to THIS workflow, not a restatement of the insight's own text. Example: "Added synonym expansion to the research card so the next run won't miss keyword variants." Return these as applied_notes: a list of { knowledge_id, note }, one entry per applied insight.

Return JSON only:
{
  "changes": [
    {
      "type": "edit_instruction",
      "card": 7,
      "title": "Validate title and meta",
      "knowledge_ids": ["K-001", "K-002"],
      "new_instruction": "The complete revised instruction for this existing card.",
      "change": "Added canonical HTTPS verification and synonym checks."
    }
  ],
  "dismissed": [
    { "id": "K-003", "reason": "Observational, not actionable." }
  ],
  "applied_notes": [
    { "knowledge_id": "K-001", "note": "Added canonical HTTPS verification to the validate card so the next run proves the redirect, not just the page." }
  ]
}

Do not include cards. Do not include workflow. Do not include requires fields. Do not include ids. Do not include gate fields.

Attempt: ${attempt}/${maxAttempts}

Locked patches that already passed the independent integration checker:
${JSON.stringify(locked, null, 2)}

Locked patches are final. Copy them exactly into your output. Do not change, remove, reinterpret, or replace locked patches. Only repair unhandled or failed learning items. If an unhandled item belongs to a card that is already locked, report it in your change summary but do not mutate the locked patch in this tier.

Checker feedback to repair:
${checkerFeedback || "(none)"}

SKILL.md:
${skill}

Current cards.json:
${JSON.stringify(cards, null, 2)}

Current workflow.json:
${JSON.stringify(workflow, null, 2)}

Open knowledge items:
${JSON.stringify(openItems, null, 2)}

Most recent run summary:
${JSON.stringify(summary || null, null, 2)}`;
}

function integrationCheckerPrompt({ cards, openItems, result }) {
  return `You are an independent integration checker for Agent Conductor v3.

You receive the original cards, the open knowledge items, and the proposed
integration patches. Each patch edits one card's instruction and lists the
knowledge_ids it is meant to integrate. The composer is not trusted. Judge
only the original cards, the open items, and the proposed instruction text —
never the composer's own description of its change.

Your one job is preservation. For each edited card, the new instruction must
equal the original instruction PLUS exactly the assigned insights — and nothing
else. The card keeps everything it already required; the listed insights are the
only additions; nothing unrelated is altered, weakened, or dropped.

Read every proposed new_instruction cold, as if seeing it for the first time.
Do not say "looks good." Do not trust that an insight was integrated because the
patch claims so — verify the behavior is actually present in the text.

PASS a card's patch only if ALL hold:
- Every knowledge_id listed for the card is genuinely present in the new
  instruction as real, actionable work — woven in naturally, not appended as a
  footnote.
- Everything the original instruction required still stands — every constraint,
  output format, deliverable, warning, and example — UNLESS one of the listed
  insights explicitly directs its removal.
- Nothing outside the listed insights changed. No silent edits, no scope creep,
  no rewording that quietly drops a requirement.
- The edit stays an instruction edit. It does not require adding, removing, or
  reordering cards, and it does not change the card's cardinality or scope
  (e.g. "do this once" must not become "do this per page"). An edit whose meaning
  demands a structural change is a FAIL — flag it, do not apply it.

For every open item NOT applied to a card, PASS only if it is dismissed with a
concrete, specific reason — never "not relevant" or any generic justification.

FAIL a card's patch if:
- A listed insight is missing from the new instruction, or only gestured at
  without becoming real work.
- Any prior requirement was lost, weakened, or contradicted without a listed
  insight directing it.
- Anything beyond the listed insights changed.
- The edit smuggles in a structural or cardinality change.
- An open item was neither applied nor dismissed with a concrete reason.

If two insights on the same card genuinely conflict, the instruction should merge
them as sensibly as it can; accept a reasonable best-effort merge rather than
failing over an unavoidable tension. This is rare.

Return JSON only:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short summary",
  "passed_patches": [
    {
      "card": 4,
      "knowledge_ids": ["K-001", "K-002"],
      "reason": "why this card's instruction integrates exactly these insights and nothing else"
    }
  ],
  "failed_patches": [
    {
      "card": 4,
      "knowledge_ids": ["K-003"],
      "problem": "what is wrong",
      "required_repair": "what the composer must do next"
    }
  ],
  "repair_prompt": "direct instructions for the next integration composer attempt"
}

A card must not appear in both passed_patches and failed_patches. Return
passed_patches for cards already correct so they stay locked in later attempts;
return failed_patches for the rest.

Original cards:
${JSON.stringify(cards, null, 2)}

Open knowledge items:
${JSON.stringify(openItems, null, 2)}

Proposed patches:
${JSON.stringify(result, null, 2)}`;
}

function orderIntegrationPrompt({ cards, workflow, orderItems, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 10 }) {
  return `You are the Agent Conductor integration order composer.

Instruction edits have already passed. You may only propose requires deltas for
open knowledge items that are explicitly flagged as order/dependency changes.

Return one edit_order patch per knowledge item or one patch carrying multiple
knowledge_ids only when the same requires delta satisfies all of them.

Allowed change type for this phase: "edit_order" only.
Do not edit card instructions. Do not add cards. Do not remove cards. Do not
rename cards. Card count and card indexes are fixed.

Each edit_order patch is a delta against the current workflow:
{
  "type": "edit_order",
  "knowledge_ids": ["K-007"],
  "requires": { "card": 3, "add": [5], "remove": [] },
  "change": "Make card 3 wait for card 5."
}

The delta means:
- add: dependency card indexes to add to requires for requires.card
- remove: dependency card indexes to remove from requires for requires.card

If an order item is impossible to express by moving edges only, dismiss it with a
concrete reason. Do not attempt structural edits.

Locked order patches that already passed order coverage:
${JSON.stringify(locked, null, 2)}

Locked patches are final. Copy them exactly into your output. Only repair failed
or unhandled order items.

Feedback to repair:
${checkerFeedback || "(none)"}

Attempt: ${attempt}/${maxAttempts}

Cards:
${JSON.stringify(cards, null, 2)}

Current workflow:
${JSON.stringify(workflow, null, 2)}

Open order insights:
${JSON.stringify(orderItems, null, 2)}

Return JSON only:
{
  "changes": [
    {
      "type": "edit_order",
      "knowledge_ids": ["K-007"],
      "requires": { "card": 3, "add": [5], "remove": [] },
      "change": "Make card 3 wait for card 5."
    }
  ],
  "dismissed": []
}`;
}

function orderCoverageCheckerPrompt({ orderItems, orderChanges }) {
  return `You are an independent order-coverage checker for Agent Conductor v3.

You receive the open knowledge items flagged as order changes and the proposed
requires deltas (edit_order changes). The composer is not trusted. Your only job:
does each proposed requires delta express what its insight actually asked for?

You do NOT judge whether the order is safe or coherent — cycles, waits, and
ordering rules are the dependency guard's job, not yours. Judge only intent match.

Read each delta cold against its insight.
- PASS a delta if the edges it adds/removes are the edges the insight asked for.
- FAIL if the delta touches different cards than the insight intended, or does not
  reflect the insight's requested ordering, even if the delta would be a valid graph.

Return JSON only:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short summary",
  "passed": [ { "knowledge_id": "K-007", "reason": "delta matches the insight's requested order" } ],
  "failed": [ { "knowledge_id": "K-008", "problem": "what is wrong", "required_repair": "what the composer must do next" } ],
  "repair_prompt": "direct instructions for the next attempt"
}

Open order insights:
${JSON.stringify(orderItems, null, 2)}

Proposed requires deltas:
${JSON.stringify(orderChanges, null, 2)}`;
}

function addIntegrationPrompt({ cards, workflow, addItems, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 10 }) {
  return `You are the Agent Conductor integration add-card composer.

Instruction edits and order edits have already passed. You may only propose new
cards for open knowledge items explicitly flagged as add-card changes.

Allowed change type for this phase: "add_card" only.
Do not edit existing card instructions. Do not remove cards. Do not insert cards.
Do not rename existing cards. Existing card indexes are permanent.

Append-only rule:
- The new card will be appended at index N = current cards.length.
- Array position is identity. Execution order comes only from requires.
- Never ask to insert into the middle.

Each add_card patch is:
{
  "type": "add_card",
  "knowledge_ids": ["K-011"],
  "card": {
    "title": "Compress images before upload",
    "instruction": "Compress images before upload and write .conductor/artifacts/<card-index>-<slugified-card-title>.md with commands, files changed, and verification proof."
  },
  "requires": {
    "self": [4],
    "dependents": [
      { "card": 6, "add_requires": ["N"] }
    ]
  },
  "change": "Added image compression as its own executable card."
}

requires.self is what the new card depends on.
requires.dependents lists existing cards that should wait for the new card.
Use "N" in add_requires to mean the appended card's assigned index.

If an add item cannot be handled by appending one card and wiring edges, dismiss
it with a concrete reason. Do not attempt structural edits beyond append-only.

Locked add-card patches that already passed:
${JSON.stringify(locked, null, 2)}

Locked patches are final. Copy them exactly into your output. Only repair failed
or unhandled add items.

Feedback to repair:
${checkerFeedback || "(none)"}

Attempt: ${attempt}/${maxAttempts}

Current cards:
${JSON.stringify(cards, null, 2)}

Current workflow:
${JSON.stringify(workflow, null, 2)}

Open add insights:
${JSON.stringify(addItems, null, 2)}

Return JSON only:
{
  "changes": [
    {
      "type": "add_card",
      "knowledge_ids": ["K-011"],
      "card": { "title": "Compress images", "instruction": "Concrete verifiable instruction requiring .conductor/artifacts/<card-index>-<slugified-card-title>.md." },
      "requires": { "self": [4], "dependents": [ { "card": 6, "add_requires": ["N"] } ] },
      "change": "Added missing image compression card."
    }
  ],
  "dismissed": []
}`;
}

function addQualityCheckerPrompt({ addChanges, nextIndex }) {
  return `You are an independent card-quality checker for Agent Conductor v3.

You receive proposed new cards from the integration loop. There is no SKILL.md
coverage question here. Check only whether each proposed card is a good
standalone Agent Conductor card.

A good card:
- is a concrete, independently verifiable unit of work
- has a clear title of 40 characters or fewer
- has a detailed instruction
- requires one primary markdown receipt at .conductor/artifacts/<card-index>-<slugified-card-title>.md
- produces an artifact or action record; it is not just "think", "consider", or "review" with no output
- is not a standalone rule, criterion, warning, invariant, or background note
- is not too broad to check honestly and not too tiny to be useful
- does not add a condition field, gate field, id, or dependency field inside the card object

For these proposed additions, the first appended card index is ${nextIndex}. If
the instruction uses the literal placeholder <card-index>, accept that as the
required receipt convention.

Return JSON only:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short summary",
  "passed": [ { "knowledge_id": "K-011", "reason": "card is concrete and verifiable" } ],
  "failed": [ { "knowledge_id": "K-012", "problem": "what is wrong", "required_repair": "what the composer must do next" } ],
  "repair_prompt": "direct instructions for the next attempt"
}

Proposed new cards:
${JSON.stringify(addChanges, null, 2)}`;
}

function addCoverageCheckerPrompt({ addItems, addChanges }) {
  return `You are an independent add-coverage checker for Agent Conductor v3.

You receive the open knowledge items flagged as add-card changes and the proposed
new cards. The composer is not trusted. Your only job: does each proposed new card
do what its insight asked for?

You do NOT judge card quality or placement — well-formedness is the card-quality
guard's job, and ordering/cycles are the dependency guard's job. Judge only intent
match.

Read each new card cold against its insight.
- PASS if the card's title and instruction carry out what the insight asked to add.
- FAIL if the card does something different from, or narrower/broader than, what the
  insight requested — even if it would be a perfectly good card.

Return JSON only:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short summary",
  "passed": [ { "knowledge_id": "K-011", "reason": "new card carries out the requested addition" } ],
  "failed": [ { "knowledge_id": "K-012", "problem": "what is wrong", "required_repair": "what the composer must do next" } ],
  "repair_prompt": "direct instructions for the next attempt"
}

Open add insights:
${JSON.stringify(addItems, null, 2)}

Proposed new cards:
${JSON.stringify(addChanges, null, 2)}`;
}

function removeIntegrationPrompt({ cards, workflow, removeItems, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 10 }) {
  return `You are the Agent Conductor integration remove-card composer.

Instruction, order, and add-card changes have already passed. You may only
propose card removals for open knowledge items explicitly flagged as remove or
retire-card changes.

Allowed change type for this phase: "remove_card" only.
Do not edit instructions directly. Do not delete cards. Do not renumber cards.
Do not remove dependencies. Do not add a skipped state.

Remove means: identify an existing card that should be retired. Runtime will
neuter it into a documented no-op and set a display-only retired flag on the
workflow step. The card still executes trivially so dependents do not break.

Each remove_card patch is:
{
  "type": "remove_card",
  "knowledge_ids": ["K-014"],
  "card": 4,
  "change": "Retire the obsolete image upload card."
}

If a remove item cannot be handled by retiring one existing card, dismiss it with
a concrete reason. Do not attempt structural edits beyond remove_card.

Locked remove-card patches that already passed:
${JSON.stringify(locked, null, 2)}

Locked patches are final. Copy them exactly into your output. Only repair failed
or unhandled remove items.

Feedback to repair:
${checkerFeedback || "(none)"}

Attempt: ${attempt}/${maxAttempts}

Current cards:
${JSON.stringify(cards, null, 2)}

Current workflow:
${JSON.stringify(workflow, null, 2)}

Open remove insights:
${JSON.stringify(removeItems, null, 2)}

Return JSON only:
{
  "changes": [
    {
      "type": "remove_card",
      "knowledge_ids": ["K-014"],
      "card": 4,
      "change": "Retired obsolete card."
    }
  ],
  "dismissed": []
}`;
}

function removeCoverageCheckerPrompt({ removeItems, removeChanges, cards }) {
  return `You are an independent remove-coverage checker for Agent Conductor v3.

You receive the open knowledge items flagged as remove-card changes and the
proposed remove_card patches. The composer is not trusted. Your only job: does
each patch target the card the insight actually meant, for the reason given?

You do NOT judge orphan safety — whether other cards still need the removed
card's output is a separate safety check. Judge only intent match.

Read each patch cold against its insight and the current card list.
- PASS if the targeted card is the one the insight asks to remove/retire.
- FAIL if the patch targets a different card, or the insight is not really a
  remove-card request.

Return JSON only:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short summary",
  "passed": [ { "knowledge_id": "K-014", "reason": "patch targets the obsolete card requested by the insight" } ],
  "failed": [ { "knowledge_id": "K-015", "problem": "what is wrong", "required_repair": "what the composer must do next" } ],
  "repair_prompt": "direct instructions for the next attempt"
}

Current cards:
${JSON.stringify(cards, null, 2)}

Open remove insights:
${JSON.stringify(removeItems, null, 2)}

Proposed remove patches:
${JSON.stringify(removeChanges, null, 2)}`;
}

function removalSafetyCheckerPrompt({ removeTarget, survivingCards }) {
  return `You are an independent removal-safety checker for Agent Conductor v3.

You receive the card proposed for removal and the instructions of every other
non-retired card. The composer is not trusted. Your only job: does any surviving
card still depend on the card being removed?

A surviving card depends on it if its instruction references, consumes, or builds
on the removed card's output or artifact — by name, by path, or by description.
Read each surviving instruction cold.

- SAFE only if NO surviving instruction depends on the removed card's output.
- UNSAFE if any surviving card still needs it. Name every dependent.

Return JSON only:
{
  "verdict": "SAFE" | "UNSAFE",
  "feedback": "short summary",
  "dependents": [ { "card": 6, "reference": "what in card 6's instruction still needs the removed card's output" } ],
  "repair_prompt": "if unsafe, what must change before this card can be removed"
}

Card to remove:
${JSON.stringify(removeTarget, null, 2)}

Surviving (non-retired) card instructions:
${JSON.stringify(survivingCards, null, 2)}`;
}

function words(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9åäö]+/g) || []);
}

function knowledgeStatus(item) {
  return String(item?.status || "open").trim().toLowerCase();
}

function arrayOfStrings(value) {
  if (Array.isArray(value)) return value.map(compact).filter(Boolean);
  const single = compact(value);
  return single ? [single] : [];
}

function knowledgeTags(item) {
  return [
    ...arrayOfStrings(item?.tag),
    ...arrayOfStrings(item?.tags),
    ...arrayOfStrings(item?.type),
    ...arrayOfStrings(item?.change_type),
    ...arrayOfStrings(item?.facet),
    ...arrayOfStrings(item?.facets),
  ].map((value) => value.toLowerCase());
}

function isOrderChangeItem(item) {
  const tags = knowledgeTags(item);
  return Boolean(
    item?.order_change ||
    item?.edit_order ||
    tags.includes("order") ||
    tags.includes("dependency") ||
    tags.includes("dependencies") ||
    tags.includes("edit_order") ||
    tags.includes("order-change") ||
    tags.includes("dependency-change"),
  );
}

function isAddChangeItem(item) {
  const tags = knowledgeTags(item);
  return Boolean(
    item?.add_card ||
    item?.card_add ||
    item?.new_card ||
    tags.includes("add") ||
    tags.includes("add_card") ||
    tags.includes("add-card") ||
    tags.includes("new-card") ||
    tags.includes("card-add"),
  );
}

function isRemoveChangeItem(item) {
  const tags = knowledgeTags(item);
  return Boolean(
    item?.remove_card ||
    item?.card_remove ||
    item?.retire_card ||
    item?.retired_card ||
    tags.includes("remove") ||
    tags.includes("remove_card") ||
    tags.includes("remove-card") ||
    tags.includes("card-remove") ||
    tags.includes("retire") ||
    tags.includes("retired") ||
    tags.includes("retire-card"),
  );
}

function isInstructionChangeItem(item) {
  const tags = knowledgeTags(item);
  if (tags.includes("instruction") || tags.includes("edit_instruction")) return true;
  return !isOrderChangeItem(item) && !isAddChangeItem(item) && !isRemoveChangeItem(item);
}

function hasInstructionFacet(id, instructionItems) {
  return instructionItems.some((item) => item.id === id);
}

function hasOrderFacet(id, orderItems) {
  return orderItems.some((item) => item.id === id);
}

function hasAddFacet(id, addItems) {
  return addItems.some((item) => item.id === id);
}

function hasRemoveFacet(id, removeItems) {
  return removeItems.some((item) => item.id === id);
}

function sourceCardKey(item) {
  if (item?.source_card === undefined || item?.source_card === null) return "";
  return String(item.source_card);
}

function semanticOverlap(a, b) {
  const left = words(`${a?.title || ""} ${a?.detail || ""}`);
  const right = words(`${b?.title || ""} ${b?.detail || ""}`);
  const usefulLeft = [...left].filter((word) => word.length > 3);
  const usefulRight = new Set([...right].filter((word) => word.length > 3));
  if (!usefulLeft.length || !usefulRight.size) return 0;
  const shared = usefulLeft.filter((word) => usefulRight.has(word)).length;
  return shared / Math.min(usefulLeft.length, usefulRight.size);
}

function duplicateKnowledgeItems(knowledge, appliedItem, openItems) {
  const card = sourceCardKey(appliedItem);
  if (!card) return [];
  return openItems.filter((candidate) => (
    candidate &&
    candidate.id !== appliedItem.id &&
    knowledgeStatus(candidate) === "open" &&
    sourceCardKey(candidate) === card &&
    semanticOverlap(candidate, appliedItem) >= 0.45
  ));
}

function unresolvedItemsAfterDuplicateResolution(knowledge, openItems, result) {
  const handled = handledIds(result);
  for (const change of result.changes || []) {
    for (const id of change.knowledge_ids || []) {
      const item = knowledge.items.find((candidate) => candidate.id === id);
      if (!item) continue;
      for (const duplicate of duplicateKnowledgeItems(knowledge, item, openItems)) {
        handled.add(duplicate.id);
      }
    }
  }
  return openItems.filter((item) => !handled.has(item.id));
}

function expandDuplicateKnowledgeIds(openItems, result) {
  const handled = handledIds(result);
  const pseudoKnowledge = { items: openItems };
  const changes = (result.changes || []).map((change) => {
    const ids = new Set(change.knowledge_ids || []);
    for (const id of change.knowledge_ids || []) {
      const item = openItems.find((candidate) => candidate.id === id);
      if (!item) continue;
      for (const duplicate of duplicateKnowledgeItems(pseudoKnowledge, item, openItems)) {
        if (!handled.has(duplicate.id)) ids.add(duplicate.id);
      }
    }
    return { ...change, knowledge_ids: [...ids] };
  });
  return { ...result, changes };
}

function fallbackIntegrate(cards, openItems) {
  const byCard = new Map();
  const dismissed = [];
  for (const item of openItems) {
    const needle = words(`${item.title} ${item.detail}`);
    let best = -1;
    let bestScore = 0;
    cards.forEach((card, index) => {
      const hay = words(`${card.title} ${card.instruction}`);
      const score = [...needle].filter((word) => hay.has(word)).length;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best === -1 || bestScore === 0) {
      dismissed.push({
        id: item.id,
        reason: "No existing card matched this learning item in instruction-only integration.",
      });
      continue;
    }
    const addition = compact(item.detail || item.title);
    const current = byCard.get(best) || {
      type: "edit_instruction",
      card: best,
      title: cards[best].title,
      change: "Integrated learning into card instruction.",
      knowledge_ids: [],
      additions: [],
      new_instruction: cards[best].instruction,
    };
    current.knowledge_ids.push(item.id);
    if (addition && !current.new_instruction.toLowerCase().includes(addition.toLowerCase())) {
      current.additions.push(`${addition.charAt(0).toLowerCase()}${addition.slice(1)}`);
      current.new_instruction = `${cards[best].instruction} Also ensure ${current.additions.join("; ")}.`;
    }
    current.change = `Integrated ${current.knowledge_ids.length} learning item${current.knowledge_ids.length === 1 ? "" : "s"} into card instruction.`;
    byCard.set(best, current);
  }
  return {
    changes: [...byCard.values()].map(({ additions, ...change }) => change),
    dismissed,
  };
}

function localIntegrationCheck({ cards, openItems, result }) {
  const failed = [];
  const passed = [];
  const byId = new Map(openItems.map((item) => [item.id, item]));
  const seen = handledIds(result);
  for (const item of openItems) {
    if (!seen.has(item.id)) {
      failed.push({
        knowledge_id: item.id,
        feedback: "Open knowledge item was not addressed.",
        required_repair: "Apply this item to the most relevant existing card instruction or dismiss it with a concrete reason.",
      });
    }
  }
  for (const change of result.changes || []) {
    const instruction = compact(change.new_instruction).toLowerCase();
    const original = compact(cards[change.card]?.instruction).toLowerCase();
    const missing = [];
    for (const id of change.knowledge_ids || []) {
      const item = byId.get(id);
      if (!item) continue;
      const detail = compact(item.detail || item.title).toLowerCase();
      const signalWords = [...words(detail)].filter((word) => word.length > 4);
      const shared = signalWords.filter((word) => instruction.includes(word)).length;
      if (!change.new_instruction || (signalWords.length && shared === 0)) missing.push(id);
    }
    const originalWords = [...words(original)].filter((word) => word.length > 5);
    const retained = originalWords.length ? originalWords.filter((word) => instruction.includes(word)).length / originalWords.length : 1;
    if (missing.length || retained < 0.4) {
      failed.push({
        card: change.card,
        knowledge_ids: missing.length ? missing : change.knowledge_ids,
        feedback: missing.length
          ? "Patch does not visibly incorporate every listed learning into the instruction."
          : "Patch appears to drop too much of the original instruction.",
        required_repair: "Rewrite new_instruction so it preserves the original instruction and naturally includes every listed learning.",
      });
    } else {
      passed.push({ card: change.card, knowledge_ids: change.knowledge_ids, kind: "edit_instruction", reason: "Original instruction is preserved and listed learnings appear in the revised instruction." });
    }
  }
  for (const item of result.dismissed || []) {
    if (!item.reason || item.reason.length < 12 || /^not relevant\.?$/i.test(item.reason)) {
      failed.push({
        knowledge_ids: [item.id],
        feedback: "Dismissed item has a vague reason.",
        required_repair: "Explain concretely why this learning item does not apply to any existing card.",
      });
    } else {
      passed.push({ knowledge_ids: [item.id], kind: "dismissed", reason: "Dismissal has a concrete reason." });
    }
  }
  return {
    verdict: failed.length ? "FAIL" : "PASS",
    passed: failed.length === 0,
    feedback: failed.length ? `${failed.length} integration patch issue(s) remain.` : "All open learning items are handled.",
    passed_patches: passed,
    failed_patches: failed,
    repair_prompt: failed.map((item) => `${item.knowledge_id}: ${item.required_repair || item.feedback}`).join("\n"),
  };
}

function repairFeedback(check) {
  const labelIds = (item) => (item.knowledge_ids?.length ? item.knowledge_ids.join(", ") : item.knowledge_id || "unknown");
  const lines = [];
  if (check.feedback) lines.push(`Checker summary: ${check.feedback}`);
  if (check.repair_prompt) lines.push(`Repair prompt: ${check.repair_prompt}`);
  if (check.failed_patches?.length) {
    lines.push("Failed or unhandled patches:");
    for (const item of check.failed_patches) {
      lines.push(`- ${labelIds(item)}: ${item.feedback || "needs repair"}${item.required_repair ? ` Repair: ${item.required_repair}` : ""}`);
    }
  }
  if (check.passed_patches?.length) {
    lines.push("Passed patches are locked. Copy them exactly:");
    for (const item of check.passed_patches) {
      lines.push(`- ${labelIds(item)}: ${item.reason || "passed"}`);
    }
  }
  return lines.join("\n");
}

function lockedList(locked) {
  return [...locked.values()].map((item) => item.value);
}

function lockPassedPatches(locked, result, check) {
  const byCard = new Map((result.changes || []).map((change) => [change.card, change]));
  const byKnowledge = new Map();
  for (const change of result.changes || []) {
    for (const id of change.knowledge_ids || []) byKnowledge.set(id, change);
  }
  const byDismissed = new Map((result.dismissed || []).map((item) => [item.id, item]));
  for (const item of check.passed_patches || []) {
    const ids = item.knowledge_ids || [];
    const change = Number.isInteger(item.card) ? byCard.get(item.card) : byKnowledge.get(ids[0]);
    if (change) {
      locked.set(`card:${change.card}`, { kind: "change", value: { ...change, knowledge_ids: [...(change.knowledge_ids || [])] } });
      continue;
    }
    for (const id of ids) {
      if (byDismissed.has(id)) locked.set(`dismissed:${id}`, { kind: "dismissed", value: { ...byDismissed.get(id) } });
    }
  }
}

function orderChangeIds(result) {
  return new Set((result.changes || [])
    .filter((change) => change.type === "edit_order")
    .flatMap((change) => change.knowledge_ids || []));
}

function addChangeIds(result) {
  return new Set((result.changes || [])
    .filter((change) => change.type === "add_card")
    .flatMap((change) => change.knowledge_ids || []));
}

function removeChangeIds(result) {
  return new Set((result.changes || [])
    .filter((change) => change.type === "remove_card")
    .flatMap((change) => change.knowledge_ids || []));
}

function orderRepairFeedback(check) {
  const lines = [];
  if (check.feedback) lines.push(`Checker summary: ${check.feedback}`);
  if (check.repair_prompt) lines.push(`Repair prompt: ${check.repair_prompt}`);
  for (const item of check.failed_patches || []) {
    lines.push(`- ${(item.knowledge_ids || []).join(", ") || "unknown"}: ${item.feedback || item.problem || "needs repair"}${item.required_repair ? ` Repair: ${item.required_repair}` : ""}`);
  }
  return lines.join("\n");
}

function lockPassedOrderPatches(locked, result, check) {
  const byKnowledge = new Map();
  for (const change of result.changes || []) {
    if (change.type !== "edit_order") continue;
    for (const id of change.knowledge_ids || []) byKnowledge.set(id, change);
  }
  const byDismissed = new Map((result.dismissed || []).map((item) => [item.id, item]));
  for (const item of check.passed_patches || []) {
    for (const id of item.knowledge_ids || []) {
      const change = byKnowledge.get(id);
      if (change) locked.set(`order:${id}`, { kind: "change", value: { ...change, knowledge_ids: [...(change.knowledge_ids || [])] } });
      else if (byDismissed.has(id)) locked.set(`dismissed:${id}`, { kind: "dismissed", value: { ...byDismissed.get(id) } });
    }
  }
}

function lockPassedAddPatches(locked, result, check) {
  const byKnowledge = new Map();
  for (const change of result.changes || []) {
    if (change.type !== "add_card") continue;
    for (const id of change.knowledge_ids || []) byKnowledge.set(id, change);
  }
  const byDismissed = new Map((result.dismissed || []).map((item) => [item.id, item]));
  for (const item of check.passed_patches || []) {
    for (const id of item.knowledge_ids || []) {
      const change = byKnowledge.get(id);
      if (change) locked.set(`add:${id}`, { kind: "change", value: { ...change, knowledge_ids: [...(change.knowledge_ids || [])] } });
      else if (byDismissed.has(id)) locked.set(`dismissed:${id}`, { kind: "dismissed", value: { ...byDismissed.get(id) } });
    }
  }
}

function lockPassedRemovePatches(locked, result, check) {
  const byKnowledge = new Map();
  for (const change of result.changes || []) {
    if (change.type !== "remove_card") continue;
    for (const id of change.knowledge_ids || []) byKnowledge.set(id, change);
  }
  const byDismissed = new Map((result.dismissed || []).map((item) => [item.id, item]));
  for (const item of check.passed_patches || []) {
    for (const id of item.knowledge_ids || []) {
      const change = byKnowledge.get(id);
      if (change) locked.set(`remove:${id}`, { kind: "change", value: { ...change, knowledge_ids: [...(change.knowledge_ids || [])] } });
      else if (byDismissed.has(id)) locked.set(`dismissed:${id}`, { kind: "dismissed", value: { ...byDismissed.get(id) } });
    }
  }
}

function mergeLockedOrder(result, locked) {
  const changes = [];
  const dismissed = [];
  const seen = new Set();
  for (const item of locked.values()) {
    if (item.kind === "change") {
      changes.push({ ...item.value });
      for (const id of item.value.knowledge_ids || []) seen.add(id);
    } else if (item.kind === "dismissed") {
      dismissed.push({ ...item.value });
      seen.add(item.value.id);
    }
  }
  for (const change of result.changes || []) {
    const ids = (change.knowledge_ids || []).filter((id) => !seen.has(id));
    if (ids.length) changes.push({ ...change, knowledge_ids: ids });
  }
  for (const item of result.dismissed || []) {
    if (!seen.has(item.id)) dismissed.push(item);
  }
  return { changes, dismissed };
}

function parseNewIndexRef(value, newIndex) {
  if (value === "N" || value === "<N>" || value === "new" || value === "NEW") return newIndex;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizeAddRequires(raw, newIndex, oldLength) {
  const selfRaw = Array.isArray(raw?.self) ? raw.self : [];
  const self = [...new Set(selfRaw.map((dep) => Number(dep)).filter((dep) => Number.isInteger(dep)))];
  const dependents = Array.isArray(raw?.dependents)
    ? raw.dependents.map((item) => {
        const card = Number(item?.card);
        const addRequires = Array.isArray(item?.add_requires)
          ? item.add_requires.map((dep) => parseNewIndexRef(dep, newIndex)).filter((dep) => Number.isInteger(dep))
          : [];
        return { card, add_requires: [...new Set(addRequires)] };
      }).filter((item) => Number.isInteger(item.card) && item.card >= 0 && item.card < oldLength && item.add_requires.length)
    : [];
  return { self, dependents };
}

function validateNewCard(card, index) {
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error(`add_card ${index} card must be an object`);
  if (!compact(card.title)) throw new Error(`add_card ${index} is missing title`);
  if (compact(card.title).length > 40) throw new Error(`add_card ${index} title must be 40 characters or fewer`);
  if (!compact(card.instruction)) throw new Error(`add_card ${index} is missing instruction`);
}

function applyAddChanges({ cards, workflow, changes, addItems }) {
  const allowed = new Set(addItems.map((item) => item.id));
  const nextCards = cards.map((card) => ({ ...card }));
  const nextWorkflow = {
    ...workflow,
    steps: (workflow.steps || []).map((step) => ({ ...step, requires: [...(step.requires || [])] })),
  };
  const oldLength = nextCards.length;
  const applied = [];

  for (const [offset, change] of (changes || []).entries()) {
    if (change.type !== "add_card") {
      throw new Error(`unsupported add integration change type "${change.type || "(missing)"}"; only add_card is enabled`);
    }
    if (!change.knowledge_ids?.length) throw new Error("add_card change is missing knowledge_ids");
    for (const id of change.knowledge_ids) {
      if (!allowed.has(id)) throw new Error(`add_card references non-add knowledge item ${id}`);
    }
    validateNewCard(change.new_card, offset);
    const newIndex = nextCards.length;
    const addRequires = normalizeAddRequires(change.add_requires || {}, newIndex, oldLength);
    for (const dep of addRequires.self) {
      if (dep < 0 || dep >= newIndex) throw new Error(`add_card self dependency ${dep} is not an existing card`);
    }
    nextCards.push({
      title: change.new_card.title,
      instruction: change.new_card.instruction,
    });
    nextWorkflow.steps.push({
      title: change.new_card.title,
      instruction: change.new_card.instruction,
      requires: [...addRequires.self].sort((a, b) => a - b),
    });
    for (const dependent of addRequires.dependents) {
      const current = new Set(nextWorkflow.steps[dependent.card].requires || []);
      for (const dep of dependent.add_requires) {
        if (dep !== newIndex) throw new Error(`add_card dependent edge must reference appended card N (${newIndex})`);
        current.add(dep);
      }
      nextWorkflow.steps[dependent.card].requires = [...current].sort((a, b) => a - b);
    }
    applied.push({
      ...change,
      card_index: newIndex,
      card: { title: change.new_card.title, instruction: change.new_card.instruction },
      requires: addRequires,
    });
  }
  return { cards: nextCards, workflow: nextWorkflow, applied };
}

function retiredInstruction({ index, step, knowledgeIds }) {
  const idLabel = knowledgeIds.join(", ");
  const receipt = `.conductor/artifacts/${receiptArtifactName(index, step)}`;
  return `This step has been retired by ${idLabel}. Produce an empty markdown receipt at ${receipt} documenting that the step is retired and no work is required, then take no other action.`;
}

function applyRemoveChanges({ cards, workflow, changes, removeItems }) {
  const allowed = new Set(removeItems.map((item) => item.id));
  const nextCards = cards.map((card) => ({ ...card }));
  const nextWorkflow = {
    ...workflow,
    steps: (workflow.steps || []).map((step) => ({ ...step, requires: [...(step.requires || [])] })),
  };
  const applied = [];

  for (const change of changes || []) {
    if (change.type !== "remove_card") {
      throw new Error(`unsupported remove integration change type "${change.type || "(missing)"}"; only remove_card is enabled`);
    }
    if (!change.knowledge_ids?.length) throw new Error("remove_card change is missing knowledge_ids");
    for (const id of change.knowledge_ids) {
      if (!allowed.has(id)) throw new Error(`remove_card references non-remove knowledge item ${id}`);
    }
    const card = Number(change.card);
    if (!Number.isInteger(card) || card < 0 || card >= nextCards.length || !nextWorkflow.steps?.[card]) {
      throw new Error(`remove_card references invalid card ${change.card}`);
    }
    const instruction = retiredInstruction({ index: card, step: nextWorkflow.steps[card], knowledgeIds: change.knowledge_ids });
    nextCards[card].instruction = instruction;
    nextWorkflow.steps[card].instruction = instruction;
    nextWorkflow.steps[card].retired = true;
    nextWorkflow.steps[card].retired_by = change.knowledge_ids.join(",");
    applied.push({
      ...change,
      card,
      title: nextWorkflow.steps[card].title || nextCards[card].title,
      retired_by: change.knowledge_ids.join(","),
      new_instruction: instruction,
    });
  }

  if (nextCards.length !== cards.length || nextWorkflow.steps.length !== workflow.steps.length) {
    throw new Error("remove_card attempted to change card or workflow length");
  }
  return { cards: nextCards, workflow: nextWorkflow, applied };
}

function localAddQualityCheck({ addChanges }) {
  const failed = [];
  const passed = [];
  for (const change of addChanges || []) {
    const instruction = compact(change.new_card?.instruction || change.card?.instruction);
    const title = compact(change.new_card?.title || change.card?.title);
    const ids = change.knowledge_ids || [];
    const bad = [];
    if (!title || title.length > 40) bad.push("title must be clear and 40 characters or fewer");
    if (!instruction) bad.push("instruction is missing");
    if (!/\.conductor\/artifacts\/<card-index>-<slugified-card-title>\.md/.test(instruction)) {
      bad.push("instruction must require the primary markdown receipt path");
    }
    if (!/(artifact|receipt|record|report|proof|output|write|produce|create|verify|document)/i.test(instruction)) {
      bad.push("instruction must produce a verifiable artifact or action record");
    }
    if (bad.length) {
      failed.push({ knowledge_ids: ids, feedback: bad.join("; "), required_repair: "Rewrite the new card as concrete, verifiable work with the required markdown receipt." });
    } else {
      passed.push({ knowledge_ids: ids, kind: "add_card", reason: "New card is concrete and requires the primary receipt." });
    }
  }
  return {
    verdict: failed.length ? "FAIL" : "PASS",
    passed: failed.length === 0,
    feedback: failed.length ? `${failed.length} add-card quality issue(s) remain.` : "All added cards pass quality.",
    passed_patches: passed,
    failed_patches: failed,
    repair_prompt: failed.map((item) => `${item.knowledge_ids?.join(", ")}: ${item.required_repair || item.feedback}`).join("\n"),
  };
}

function localAddCoverageCheck({ addItems, addChanges }) {
  const handled = addChangeIds({ changes: addChanges });
  const failed = [];
  const passed = [];
  const byId = new Map(addItems.map((item) => [item.id, item]));
  for (const item of addItems) {
    if (!handled.has(item.id)) {
      failed.push({
        knowledge_ids: [item.id],
        feedback: "Open add-card item was not addressed.",
        required_repair: "Return an add_card patch for this item or dismiss it with a concrete reason.",
      });
    }
  }
  for (const change of addChanges || []) {
    const text = `${change.new_card?.title || ""} ${change.new_card?.instruction || ""}`.toLowerCase();
    for (const id of change.knowledge_ids || []) {
      const item = byId.get(id);
      const signalWords = [...words(`${item?.title || ""} ${item?.detail || ""}`)].filter((word) => word.length > 4);
      const shared = signalWords.filter((word) => text.includes(word.toLowerCase())).length;
      if (signalWords.length && shared === 0) {
        failed.push({
          knowledge_ids: [id],
          feedback: "New card does not visibly match the requested insight.",
          required_repair: "Rewrite the new card so its title/instruction directly carry out this insight.",
        });
      } else {
        passed.push({ knowledge_ids: [id], kind: "add_card", reason: "New card matches the requested addition." });
      }
    }
  }
  return {
    verdict: failed.length ? "FAIL" : "PASS",
    passed: failed.length === 0,
    feedback: failed.length ? `${failed.length} add-card coverage issue(s) remain.` : "All add-card items are covered.",
    passed_patches: passed,
    failed_patches: failed,
    repair_prompt: failed.map((item) => `${item.knowledge_ids?.join(", ")}: ${item.required_repair || item.feedback}`).join("\n"),
  };
}

function localRemoveCoverageCheck({ removeItems, removeChanges }) {
  const handled = removeChangeIds({ changes: removeChanges });
  const failed = [];
  const passed = [];
  for (const item of removeItems) {
    if (!handled.has(item.id)) {
      failed.push({
        knowledge_ids: [item.id],
        feedback: "Open remove-card item was not addressed.",
        required_repair: "Return a remove_card patch for this item or dismiss it with a concrete reason.",
      });
    }
  }
  for (const change of removeChanges || []) {
    const ids = change.knowledge_ids || [];
    if (!Number.isInteger(change.card)) {
      failed.push({
        knowledge_ids: ids,
        feedback: "remove_card patch does not name a numeric card index.",
        required_repair: "Return the exact card index to retire.",
      });
      continue;
    }
    for (const id of ids) {
      passed.push({ knowledge_ids: [id], kind: "remove_card", reason: "Patch names a concrete card to retire." });
    }
  }
  return {
    verdict: failed.length ? "FAIL" : "PASS",
    passed: failed.length === 0,
    feedback: failed.length ? `${failed.length} remove-card coverage issue(s) remain.` : "All remove-card items are covered.",
    passed_patches: passed,
    failed_patches: failed,
    repair_prompt: failed.map((item) => `${item.knowledge_ids?.join(", ")}: ${item.required_repair || item.feedback}`).join("\n"),
  };
}

function localRemovalSafetyCheck({ removeTarget, survivingCards }) {
  const titleWords = [...words(removeTarget?.title || "")].filter((word) => word.length > 4);
  const instructionWords = [...words(removeTarget?.instruction || "")].filter((word) => word.length > 6);
  const signals = new Set([...titleWords, ...instructionWords].slice(0, 12));
  const dependents = [];
  if (signals.size) {
    for (const card of survivingCards || []) {
      const text = `${card.title || ""} ${card.instruction || ""}`.toLowerCase();
      const hit = [...signals].find((word) => text.includes(word.toLowerCase()));
      if (hit) {
        dependents.push({ card: card.card, reference: `Instruction appears to reference removed-card signal "${hit}".` });
      }
    }
  }
  return {
    verdict: dependents.length ? "UNSAFE" : "SAFE",
    passed: dependents.length === 0,
    feedback: dependents.length ? `${dependents.length} surviving card(s) may still depend on the retired card.` : "No surviving card appears to depend on the retired card.",
    dependents,
    failed_patches: dependents.map((item) => ({
      card: item.card,
      feedback: item.reference,
      required_repair: "Remove or rewrite surviving references before retiring this card.",
    })),
    repair_prompt: dependents.length ? "Do not retire this card until surviving references to its output are removed or redirected." : "",
  };
}

function applyOrderDeltas({ workflow, changes, orderItems }) {
  const allowed = new Set(orderItems.map((item) => item.id));
  const nextWorkflow = {
    ...workflow,
    steps: (workflow.steps || []).map((step) => ({ ...step, requires: [...(step.requires || [])] })),
  };
  const applied = [];
  for (const change of changes || []) {
    if (change.type !== "edit_order") {
      throw new Error(`unsupported order integration change type "${change.type || "(missing)"}"; only edit_order is enabled`);
    }
    if (!change.knowledge_ids?.length) throw new Error("edit_order change is missing knowledge_ids");
    for (const id of change.knowledge_ids) {
      if (!allowed.has(id)) throw new Error(`edit_order references non-order knowledge item ${id}`);
    }
    const delta = change.requires || {};
    const card = Number(delta.card);
    if (!Number.isInteger(card) || card < 0 || card >= nextWorkflow.steps.length) {
      throw new Error(`edit_order references invalid card ${delta.card}`);
    }
    const current = new Set(nextWorkflow.steps[card].requires || []);
    for (const dep of delta.remove || []) {
      if (!Number.isInteger(dep) || dep < 0 || dep >= nextWorkflow.steps.length) throw new Error(`edit_order remove has invalid dependency ${dep}`);
      current.delete(dep);
    }
    for (const dep of delta.add || []) {
      if (!Number.isInteger(dep) || dep < 0 || dep >= nextWorkflow.steps.length) throw new Error(`edit_order add has invalid dependency ${dep}`);
      if (dep === card) throw new Error(`edit_order cannot make card ${card} require itself`);
      current.add(dep);
    }
    nextWorkflow.steps[card].requires = [...current].sort((a, b) => a - b);
    applied.push({ ...change, requires: { card, add: [...(delta.add || [])], remove: [...(delta.remove || [])] } });
  }
  return { workflow: nextWorkflow, applied };
}

function localOrderCoverageCheck({ orderItems, orderChanges }) {
  const handled = orderChangeIds({ changes: orderChanges });
  const failed = [];
  const passed = [];
  for (const item of orderItems) {
    if (!handled.has(item.id)) {
      failed.push({
        knowledge_ids: [item.id],
        feedback: "Open order item was not addressed.",
        required_repair: "Return an edit_order delta for this item or dismiss it with a concrete reason.",
      });
    }
  }
  for (const change of orderChanges) {
    for (const id of change.knowledge_ids || []) {
      const delta = change.requires || {};
      if (!Number.isInteger(delta.card) || (!delta.add?.length && !delta.remove?.length)) {
        failed.push({
          knowledge_ids: [id],
          feedback: "Order patch has no concrete edge delta.",
          required_repair: "Specify requires.card and at least one integer dependency to add or remove.",
        });
      } else {
        passed.push({ knowledge_ids: [id], kind: "edit_order", reason: "Order patch contains a concrete requires delta." });
      }
    }
  }
  return {
    verdict: failed.length ? "FAIL" : "PASS",
    passed: failed.length === 0,
    feedback: failed.length ? `${failed.length} order coverage issue(s) remain.` : "All order items are covered by deltas.",
    passed_patches: passed,
    failed_patches: failed,
    repair_prompt: failed.map((item) => `${item.knowledge_ids?.join(", ")}: ${item.required_repair || item.feedback}`).join("\n"),
  };
}

async function composeCheckOrderIntegration({ cards, workflow, orderItems, maxAttempts = 10, strict = false, progress } = {}) {
  if (!orderItems.length) {
    return { result: { changes: [], dismissed: [] }, workflow, report: { ok: true, attempts: [], final: null, locked: [] } };
  }
  const locked = new Map();
  const lockedEdges = new Map();
  const attempts = [];
  let checkerFeedback = "";
  let lastResult = null;
  let lastWorkflow = workflow;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    progress?.({ phase: "order", event: "attempt-start", attempt, maxAttempts });
    let result;
    const prompt = orderIntegrationPrompt({
      cards,
      workflow,
      orderItems,
      locked: [...locked.values()].map((item) => item.value),
      checkerFeedback,
      attempt,
      maxAttempts,
    });
    try {
      const raw = await callModel(prompt, { role: "integration-order", attempt });
      result = normalizeIntegration(extractJson(raw));
    } catch (e) {
      if (strict) throw new Error(`integration order model failed: ${e.message}`);
      result = { changes: [], dismissed: [] };
    }
    result = mergeLockedOrder(result, locked);
    lastResult = result;

    let candidate;
    try {
      candidate = applyOrderDeltas({ workflow, changes: result.changes, orderItems }).workflow;
      const restored = applyLockedEdges(candidate, lockedEdges);
      candidate = restored.workflow;
    } catch (e) {
      const check = {
        verdict: "FAIL",
        passed: false,
        feedback: e.message,
        failed_patches: (result.changes || []).map((change) => ({
          knowledge_ids: change.knowledge_ids || [],
          feedback: e.message,
          required_repair: "Return legal edit_order deltas only for order-flagged knowledge items.",
        })),
      };
      attempts.push({ attempt, result, workflow: null, check });
      checkerFeedback = orderRepairFeedback(check);
      continue;
    }
    lastWorkflow = candidate;

    progress?.({ phase: "order", event: "check-start", attempt, maxAttempts });
    const guard = await checkWorkflowWithDependencyGuard(candidate, {
      cards,
      lockedEdges,
      attempt,
      maxAttempts,
      updateLocks: false,
    });
    if (!guard.check.passed) {
      const check = {
        verdict: "FAIL",
        passed: false,
        feedback: guard.check.feedback,
        failed_patches: (result.changes || []).map((change) => ({
          knowledge_ids: change.knowledge_ids || [],
          feedback: guard.check.feedback,
          required_repair: (guard.check.blocking_issues || []).map((issue) => issue.required_repair || issue.problem).filter(Boolean).join("\n"),
        })),
        repair_prompt: (guard.check.blocking_issues || []).map((issue) => issue.required_repair || issue.problem).filter(Boolean).join("\n"),
        guard: guard.check,
      };
      checkerFeedback = orderRepairFeedback(check) || guard.check.feedback;
      attempts.push({ attempt, result, workflow: candidate, check, guard: guard.check, locked_edges: listLockedEdges(lockedEdges) });
      progress?.({ phase: "order", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
      continue;
    }

    let coverage;
    try {
      const rawCoverage = await callModel(orderCoverageCheckerPrompt({ orderItems, orderChanges: result.changes }), {
        role: "integration-order-checker",
        attempt,
      });
      coverage = normalizeOrderCoverageCheck(extractJson(rawCoverage));
    } catch (e) {
      if (strict) throw new Error(`integration order coverage checker failed: ${e.message}`);
      coverage = localOrderCoverageCheck({ orderItems, orderChanges: result.changes || [] });
    }

    lockPassedOrderPatches(locked, result, coverage);
    attempts.push({ attempt, result, workflow: candidate, check: coverage, guard: guard.check, locked: [...locked.values()].map((item) => item.value) });
    if (coverage.passed) {
      progress?.({ phase: "order", event: "check-end", attempt, maxAttempts, passed: true });
      return { result: mergeLockedOrder(result, locked), workflow: candidate, report: { ok: true, attempts, final: coverage, guard: guard.check, locked: [...locked.values()].map((item) => item.value) } };
    }
    checkerFeedback = orderRepairFeedback(coverage);
    progress?.({ phase: "order", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
  }

  return {
    result: mergeLockedOrder(lastResult || { changes: [], dismissed: [] }, locked),
    workflow: lastWorkflow,
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: [...locked.values()].map((item) => item.value) },
  };
}

async function composeCheckAddIntegration({ cards, workflow, addItems, maxAttempts = 10, strict = false, progress } = {}) {
  if (!addItems.length) {
    return { result: { changes: [], dismissed: [] }, cards, workflow, report: { ok: true, attempts: [], final: null, locked: [] } };
  }
  const locked = new Map();
  const lockedEdges = new Map();
  const attempts = [];
  let checkerFeedback = "";
  let lastResult = null;
  let lastCards = cards;
  let lastWorkflow = workflow;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    progress?.({ phase: "add", event: "attempt-start", attempt, maxAttempts });
    let result;
    const prompt = addIntegrationPrompt({
      cards,
      workflow,
      addItems,
      locked: [...locked.values()].map((item) => item.value),
      checkerFeedback,
      attempt,
      maxAttempts,
    });
    try {
      const raw = await callModel(prompt, { role: "integration-add", attempt });
      result = normalizeIntegration(extractJson(raw));
    } catch (e) {
      if (strict) throw new Error(`integration add model failed: ${e.message}`);
      result = { changes: [], dismissed: [] };
    }
    result = mergeLockedOrder(result, locked);
    lastResult = result;

    let check;
    progress?.({ phase: "add", event: "check-start", attempt, maxAttempts });
    try {
      const rawQuality = await callModel(addQualityCheckerPrompt({ addChanges: result.changes || [], nextIndex: cards.length }), {
        role: "integration-add-quality",
        attempt,
      });
      check = normalizeOrderCoverageCheck(extractJson(rawQuality));
    } catch (e) {
      if (strict) throw new Error(`integration add quality checker failed: ${e.message}`);
      check = localAddQualityCheck({ addChanges: result.changes || [] });
    }
    if (!check.passed) {
      attempts.push({ attempt, result, workflow: null, check, phase: "quality" });
      checkerFeedback = orderRepairFeedback(check);
      progress?.({ phase: "add", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
      continue;
    }

    let candidate;
    try {
      candidate = applyAddChanges({ cards, workflow, changes: result.changes, addItems });
      const restored = applyLockedEdges(candidate.workflow, lockedEdges);
      candidate.workflow = restored.workflow;
    } catch (e) {
      check = {
        verdict: "FAIL",
        passed: false,
        feedback: e.message,
        failed_patches: (result.changes || []).map((change) => ({
          knowledge_ids: change.knowledge_ids || [],
          feedback: e.message,
          required_repair: "Return legal add_card patches only for add-flagged knowledge items.",
        })),
      };
      attempts.push({ attempt, result, workflow: null, check, phase: "mechanical" });
      checkerFeedback = orderRepairFeedback(check);
      progress?.({ phase: "add", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
      continue;
    }
    lastCards = candidate.cards;
    lastWorkflow = candidate.workflow;

    const guard = await checkWorkflowWithDependencyGuard(candidate.workflow, {
      cards: candidate.cards,
      lockedEdges,
      attempt,
      maxAttempts,
      updateLocks: false,
    });
    if (!guard.check.passed) {
      check = {
        verdict: "FAIL",
        passed: false,
        feedback: guard.check.feedback,
        failed_patches: (result.changes || []).map((change) => ({
          knowledge_ids: change.knowledge_ids || [],
          feedback: guard.check.feedback,
          required_repair: (guard.check.blocking_issues || []).map((issue) => issue.required_repair || issue.problem).filter(Boolean).join("\n"),
        })),
        repair_prompt: (guard.check.blocking_issues || []).map((issue) => issue.required_repair || issue.problem).filter(Boolean).join("\n"),
        guard: guard.check,
      };
      attempts.push({ attempt, result, cards: candidate.cards, workflow: candidate.workflow, check, guard: guard.check, phase: "placement" });
      checkerFeedback = orderRepairFeedback(check) || guard.check.feedback;
      progress?.({ phase: "add", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
      continue;
    }

    try {
      const rawCoverage = await callModel(addCoverageCheckerPrompt({ addItems, addChanges: result.changes || [] }), {
        role: "integration-add-checker",
        attempt,
      });
      check = normalizeOrderCoverageCheck(extractJson(rawCoverage));
    } catch (e) {
      if (strict) throw new Error(`integration add coverage checker failed: ${e.message}`);
      check = localAddCoverageCheck({ addItems, addChanges: result.changes || [] });
    }

    lockPassedAddPatches(locked, result, check);
    attempts.push({ attempt, result, cards: candidate.cards, workflow: candidate.workflow, check, guard: guard.check, phase: "coverage", locked: [...locked.values()].map((item) => item.value) });
    if (check.passed) {
      progress?.({ phase: "add", event: "check-end", attempt, maxAttempts, passed: true });
      const merged = mergeLockedOrder(result, locked);
      const applied = applyAddChanges({ cards, workflow, changes: merged.changes, addItems });
      return { result: { ...merged, changes: applied.applied }, cards: applied.cards, workflow: applied.workflow, report: { ok: true, attempts, final: check, guard: guard.check, locked: [...locked.values()].map((item) => item.value) } };
    }
    checkerFeedback = orderRepairFeedback(check);
    progress?.({ phase: "add", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
  }

  return {
    result: mergeLockedOrder(lastResult || { changes: [], dismissed: [] }, locked),
    cards: lastCards,
    workflow: lastWorkflow,
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: [...locked.values()].map((item) => item.value) },
  };
}

async function composeCheckRemoveIntegration({ cards, workflow, removeItems, maxAttempts = 10, strict = false, progress } = {}) {
  if (!removeItems.length) {
    return { result: { changes: [], dismissed: [] }, cards, workflow, report: { ok: true, attempts: [], final: null, locked: [] } };
  }
  const locked = new Map();
  const attempts = [];
  let checkerFeedback = "";
  let lastResult = null;
  let lastCards = cards;
  let lastWorkflow = workflow;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    progress?.({ phase: "remove", event: "attempt-start", attempt, maxAttempts });
    let result;
    const prompt = removeIntegrationPrompt({
      cards,
      workflow,
      removeItems,
      locked: [...locked.values()].map((item) => item.value),
      checkerFeedback,
      attempt,
      maxAttempts,
    });
    try {
      const raw = await callModel(prompt, { role: "integration-remove", attempt });
      result = normalizeIntegration(extractJson(raw));
    } catch (e) {
      if (strict) throw new Error(`integration remove model failed: ${e.message}`);
      result = { changes: [], dismissed: [] };
    }
    result = mergeLockedOrder(result, locked);
    lastResult = result;

    let check;
    progress?.({ phase: "remove", event: "check-start", attempt, maxAttempts });
    try {
      const rawCoverage = await callModel(removeCoverageCheckerPrompt({ removeItems, removeChanges: result.changes || [], cards }), {
        role: "integration-remove-checker",
        attempt,
      });
      check = normalizeOrderCoverageCheck(extractJson(rawCoverage));
    } catch (e) {
      if (strict) throw new Error(`integration remove coverage checker failed: ${e.message}`);
      check = localRemoveCoverageCheck({ removeItems, removeChanges: result.changes || [] });
    }
    if (!check.passed) {
      attempts.push({ attempt, result, cards: null, workflow: null, check, phase: "coverage" });
      checkerFeedback = orderRepairFeedback(check);
      progress?.({ phase: "remove", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
      continue;
    }

    let safetyFailed = false;
    for (const change of result.changes || []) {
      const target = Number(change.card);
      const removeTarget = {
        card: target,
        title: cards[target]?.title || workflow.steps?.[target]?.title,
        instruction: cards[target]?.instruction || workflow.steps?.[target]?.instruction,
      };
      const survivingCards = cards
        .map((card, index) => ({
          card: index,
          title: card.title || workflow.steps?.[index]?.title,
          instruction: card.instruction || workflow.steps?.[index]?.instruction,
          retired: workflow.steps?.[index]?.retired === true,
        }))
        .filter((card) => card.card !== target && !card.retired);
      let safety;
      try {
        const rawSafety = await callModel(removalSafetyCheckerPrompt({ removeTarget, survivingCards }), {
          role: "integration-remove-safety",
          attempt,
        });
        safety = normalizeRemovalSafetyCheck(extractJson(rawSafety));
      } catch (e) {
        if (strict) throw new Error(`integration remove safety checker failed: ${e.message}`);
        safety = localRemovalSafetyCheck({ removeTarget, survivingCards });
      }
      if (!safety.passed) {
        check = {
          verdict: "FAIL",
          passed: false,
          feedback: safety.feedback || `Card ${target} cannot be retired safely.`,
          failed_patches: (change.knowledge_ids || []).map((id) => ({
            knowledge_ids: [id],
            card: target,
            feedback: safety.feedback,
            required_repair: safety.repair_prompt || "Rewrite surviving cards so none consume the removed card's output, then retry.",
          })),
          repair_prompt: safety.repair_prompt,
          safety,
        };
        attempts.push({ attempt, result, cards: null, workflow: null, check, phase: "orphan-safety" });
        checkerFeedback = orderRepairFeedback(check) || safety.feedback;
        progress?.({ phase: "remove", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
        safetyFailed = true;
        break;
      }
    }
    if (safetyFailed) continue;

    let candidate;
    try {
      candidate = applyRemoveChanges({ cards, workflow, changes: result.changes, removeItems });
    } catch (e) {
      check = {
        verdict: "FAIL",
        passed: false,
        feedback: e.message,
        failed_patches: (result.changes || []).map((change) => ({
          knowledge_ids: change.knowledge_ids || [],
          feedback: e.message,
          required_repair: "Return legal remove_card patches only for remove-flagged knowledge items.",
        })),
      };
      attempts.push({ attempt, result, cards: null, workflow: null, check, phase: "mechanical" });
      checkerFeedback = orderRepairFeedback(check);
      progress?.({ phase: "remove", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
      continue;
    }
    lastCards = candidate.cards;
    lastWorkflow = candidate.workflow;

    lockPassedRemovePatches(locked, result, check);
    attempts.push({ attempt, result, cards: candidate.cards, workflow: candidate.workflow, check, phase: "coverage+safety", locked: [...locked.values()].map((item) => item.value) });
    if (check.passed) {
      progress?.({ phase: "remove", event: "check-end", attempt, maxAttempts, passed: true });
      const merged = mergeLockedOrder(result, locked);
      const applied = applyRemoveChanges({ cards, workflow, changes: merged.changes, removeItems });
      return { result: { ...merged, changes: applied.applied }, cards: applied.cards, workflow: applied.workflow, report: { ok: true, attempts, final: check, locked: [...locked.values()].map((item) => item.value) } };
    }
    checkerFeedback = orderRepairFeedback(check);
    progress?.({ phase: "remove", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
  }

  return {
    result: mergeLockedOrder(lastResult || { changes: [], dismissed: [] }, locked),
    cards: lastCards,
    workflow: lastWorkflow,
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: [...locked.values()].map((item) => item.value) },
  };
}

async function composeCheckIntegration({ skill, cards, workflow, openItems, summary, maxAttempts = 10, strict = false, progress } = {}) {
  const locked = new Map();
  const attempts = [];
  let checkerFeedback = "";
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    progress?.({ phase: "instruction", event: "attempt-start", attempt, maxAttempts });
    let result;
    const prompt = integrationPrompt({
      skill,
      cards,
      workflow,
      openItems,
      summary,
      locked: lockedList(locked),
      checkerFeedback,
      attempt,
      maxAttempts,
    });
    try {
      const raw = await callModel(prompt, { role: "integration", attempt });
      result = normalizeIntegration(extractJson(raw));
    } catch (e) {
      if (strict) throw new Error(`integration model failed: ${e.message}`);
      result = fallbackIntegrate(cards, unresolvedItems(openItems, { changes: lockedList(locked).filter((item) => item.type === "edit_instruction"), dismissed: lockedList(locked).filter((item) => item.id) }));
    }
    result = expandDuplicateKnowledgeIds(openItems, mergeLocked(result, locked));
    lastResult = result;

    let check;
    progress?.({ phase: "instruction", event: "check-start", attempt, maxAttempts });
    try {
      const checkPrompt = integrationCheckerPrompt({ cards, openItems, result });
      const rawCheck = await callModel(checkPrompt, { role: "integration-checker", attempt });
      check = normalizeIntegrationCheck(extractJson(rawCheck));
    } catch (e) {
      if (strict) throw new Error(`integration checker failed: ${e.message}`);
      check = localIntegrationCheck({ cards, openItems, result });
    }
    lockPassedPatches(locked, result, check);
    attempts.push({ attempt, result, check, locked: lockedList(locked) });

    if (check.passed) {
      progress?.({ phase: "instruction", event: "check-end", attempt, maxAttempts, passed: true });
      return { result: mergeLocked(result, locked), report: { ok: true, attempts, final: check, locked: lockedList(locked) } };
    }
    checkerFeedback = repairFeedback(check);
    progress?.({ phase: "instruction", event: "check-end", attempt, maxAttempts, passed: false, feedback: checkerFeedback, tone: "feedback" });
  }
  return {
    result: mergeLocked(lastResult || { changes: [], dismissed: [] }, locked),
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: lockedList(locked) },
  };
}

async function applyInstructionPatches({ cards, workflow, changes, openItems }) {
  const nextCards = cards.map((card) => ({ ...card }));
  const nextWorkflow = {
    ...workflow,
    steps: (workflow.steps || []).map((step) => ({ ...step, requires: [...(step.requires || [])] })),
  };
  const knowledgeIds = new Set(openItems.map((item) => item.id).filter(Boolean));
  const byCard = new Map();

  for (const change of changes) {
    if (change.type !== "edit_instruction") {
      throw new Error(`unsupported integration change type "${change.type || "(missing)"}"; only edit_instruction is enabled`);
    }
    if (!Number.isInteger(change.card) || change.card < 0 || change.card >= nextCards.length) {
      throw new Error(`integration change ${change.knowledge_id || ""} references invalid card ${change.card}`);
    }
    if (!change.knowledge_ids?.length) {
      throw new Error(`integration change for card ${change.card} is missing knowledge_ids`);
    }
    for (const id of change.knowledge_ids) {
      if (!knowledgeIds.has(id)) throw new Error(`integration change for card ${change.card} references invalid open knowledge_id ${id}`);
    }
    if (!change.new_instruction) {
      throw new Error(`integration change for card ${change.card} must include new_instruction`);
    }
    const cardTitle = nextCards[change.card].title;
    const stepTitle = nextWorkflow.steps?.[change.card]?.title;
    if (change.title && change.title !== cardTitle && change.title !== stepTitle) {
      throw new Error(`integration change ${change.knowledge_ids.join(",")} title mismatch for card ${change.card}`);
    }
    if (byCard.has(change.card)) {
      throw new Error(`integration produced multiple instruction patches for card ${change.card}; combine knowledge_ids into one patch`);
    }
    byCard.set(change.card, change);
  }

  for (const change of byCard.values()) {
    nextCards[change.card].instruction = change.new_instruction;
    nextWorkflow.steps[change.card].instruction = change.new_instruction;
  }

  // Authoring, not record-time generation: when a card's instruction is folded
  // with new knowledge, its composer summary (the board's intent line) is now
  // stale. Regenerate that two-sentence summary for ONLY the patched cards so it
  // matches the updated instruction. One callModel per patched card; on failure,
  // keep the existing summary rather than leaving a mismatch unguarded.
  for (const change of byCard.values()) {
    const idx = change.card;
    const refreshed = await regenerateCardSummary({
      title: nextCards[idx].title,
      instruction: nextCards[idx].instruction,
      previousSummary: cards[idx]?.summary,
    });
    if (refreshed) {
      nextCards[idx].summary = refreshed;
      if (nextWorkflow.steps[idx]) nextWorkflow.steps[idx].summary = refreshed;
    }
  }

  assertOnlyInstructionChanges({ beforeCards: cards, beforeWorkflow: workflow, afterCards: nextCards, afterWorkflow: nextWorkflow, changes });
  return { cards: nextCards, workflow: nextWorkflow };
}

// Regenerate a card's two-sentence composer summary to match an updated
// instruction. Returns a clean string, or undefined on any failure so the
// caller keeps the existing summary.
async function regenerateCardSummary({ title, instruction, previousSummary }) {
  const prompt =
    "Write a clear, complete TWO-SENTENCE summary of what this Agent Conductor card will do, " +
    "for a non-technical user watching the board. State the intent and the concrete outcome " +
    "the card produces. Exactly two full sentences, no ellipsis, never cut off mid-word. " +
    "Return JSON only as {\"summary\": \"...\"}.\n\n" +
    `CARD TITLE: ${title}\n\nCARD INSTRUCTION:\n${instruction}` +
    (previousSummary ? `\n\nPREVIOUS SUMMARY (now possibly stale):\n${previousSummary}` : "");
  try {
    const raw = await callModel(prompt, { role: "integration-summary", attempt: 1 });
    const gen = extractJson(raw) || {};
    const summary = compact(gen.summary || gen.text);
    return summary || undefined;
  } catch {
    return undefined;
  }
}

function assertLedgerConsistency({ cards, workflow, changes, knowledge }) {
  const byId = new Map((knowledge.items || []).map((item) => [item.id, item]));
  for (const change of changes || []) {
    if (change.type === "edit_order") {
      const delta = change.requires || {};
      const requires = workflow?.steps?.[delta.card]?.requires || [];
      for (const dep of delta.add || []) {
        if (!requires.includes(dep)) {
          throw new Error(`ledger check failed: ${change.knowledge_ids?.join(",") || "order item"} claims edge ${dep}->${delta.card}, but workflow.json does not contain it`);
        }
      }
      for (const dep of delta.remove || []) {
        if (requires.includes(dep)) {
          throw new Error(`ledger check failed: ${change.knowledge_ids?.join(",") || "order item"} claims removed edge ${dep}->${delta.card}, but workflow.json still contains it`);
        }
      }
      continue;
    }
    if (change.type === "add_card") {
      const index = change.card_index;
      if (!Number.isInteger(index)) throw new Error(`ledger check failed: add_card missing shipped card index`);
      const card = cards[index];
      const step = workflow?.steps?.[index];
      if (!card || !step) throw new Error(`ledger check failed: added card ${index} is missing from cards.json or workflow.json`);
      if (card.title !== change.card?.title || step.title !== change.card?.title) {
        throw new Error(`ledger check failed: added card ${index} title does not match shipped card`);
      }
      if (card.instruction !== change.card?.instruction || step.instruction !== change.card?.instruction) {
        throw new Error(`ledger check failed: added card ${index} instruction does not match shipped card`);
      }
      const self = change.requires?.self || [];
      const requires = step.requires || [];
      for (const dep of self) {
        if (!requires.includes(dep)) {
          throw new Error(`ledger check failed: added card ${index} should require ${dep}, but workflow.json does not contain it`);
        }
      }
      for (const dependent of change.requires?.dependents || []) {
        const depRequires = workflow?.steps?.[dependent.card]?.requires || [];
        for (const dep of dependent.add_requires || []) {
          if (!depRequires.includes(dep)) {
            throw new Error(`ledger check failed: card ${dependent.card} should require added card ${dep}, but workflow.json does not contain it`);
          }
        }
      }
      continue;
    }
    if (change.type === "remove_card") {
      const index = change.card;
      if (!Number.isInteger(index)) throw new Error(`ledger check failed: remove_card missing retired card index`);
      const card = cards[index];
      const step = workflow?.steps?.[index];
      if (!card || !step) throw new Error(`ledger check failed: retired card ${index} is missing from cards.json or workflow.json`);
      if (step.retired !== true) {
        throw new Error(`ledger check failed: card ${index} is marked applied as removed, but workflow.json does not set retired: true`);
      }
      const retiredBy = compact(step.retired_by);
      for (const id of change.knowledge_ids || []) {
        if (!retiredBy.includes(id)) {
          throw new Error(`ledger check failed: card ${index} retired_by does not include ${id}`);
        }
      }
      const instruction = compact(step.instruction || card.instruction).toLowerCase();
      if (!instruction.includes("retired") || !instruction.includes("no work is required")) {
        throw new Error(`ledger check failed: retired card ${index} instruction is not a documented no-op`);
      }
      if (card.instruction !== step.instruction) {
        throw new Error(`ledger check failed: retired card ${index} cards.json and workflow.json instructions diverge`);
      }
      continue;
    }
    if (change.type === "edit_instruction") {
      const instruction = compact(cards[change.card]?.instruction).toLowerCase();
      if (!instruction) throw new Error(`ledger check failed: card ${change.card} has no shipped instruction`);
      for (const id of change.knowledge_ids || []) {
        const item = byId.get(id);
        if (!item) throw new Error(`ledger check failed: unknown knowledge item ${id}`);
        const detail = compact(item.detail || item.title);
        const signalWords = [...words(detail)].filter((word) => word.length > 4);
        const shared = signalWords.filter((word) => instruction.includes(word.toLowerCase())).length;
        if (signalWords.length && shared === 0) {
          throw new Error(`ledger check failed: ${id} is marked for card ${change.card} but its learning is not detectable in the shipped instruction`);
        }
      }
    }
  }
}

function sameArray(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function assertOnlyInstructionChanges({ beforeCards, beforeWorkflow, afterCards, afterWorkflow, changes }) {
  if (!Array.isArray(beforeWorkflow.steps) || !Array.isArray(afterWorkflow.steps)) {
    throw new Error("workflow steps missing during integration guard");
  }
  if (afterCards.length !== beforeCards.length) {
    throw new Error(`integration attempted to change card count ${beforeCards.length} -> ${afterCards.length}`);
  }
  if (afterWorkflow.steps.length !== beforeWorkflow.steps.length) {
    throw new Error(`integration attempted to change workflow step count ${beforeWorkflow.steps.length} -> ${afterWorkflow.steps.length}`);
  }

  const allowedInstructionIndexes = new Set(changes.map((change) => change.card));
  for (let index = 0; index < beforeCards.length; index += 1) {
    if (afterCards[index].title !== beforeCards[index].title) {
      throw new Error(`integration attempted to change card ${index} title`);
    }
    if (afterWorkflow.steps[index].title !== beforeWorkflow.steps[index].title) {
      throw new Error(`integration attempted to change workflow step ${index} title`);
    }
    if (!sameArray(afterWorkflow.steps[index].requires, beforeWorkflow.steps[index].requires)) {
      throw new Error(`integration attempted to change dependencies for card ${index}`);
    }
    if (!allowedInstructionIndexes.has(index) && afterCards[index].instruction !== beforeCards[index].instruction) {
      throw new Error(`integration changed card ${index} instruction without a declared patch`);
    }
    if (!allowedInstructionIndexes.has(index) && afterWorkflow.steps[index].instruction !== beforeWorkflow.steps[index].instruction) {
      throw new Error(`integration changed workflow step ${index} instruction without a declared patch`);
    }
    // Summary may only be refreshed for cards that received a declared instruction patch.
    if (!allowedInstructionIndexes.has(index) && afterCards[index].summary !== beforeCards[index].summary) {
      throw new Error(`integration changed card ${index} summary without a declared patch`);
    }
  }
}

function renderArtifact({ runId, openItems, changes, dismissed, report }) {
  const applied = changes;
  const edited = changes.filter((change) => change.type === "edit_instruction");
  const reordered = changes.filter((change) => change.type === "edit_order");
  const added = changes.filter((change) => change.type === "add_card");
  const removed = changes.filter((change) => change.type === "remove_card");
  return [
    `# Integration — ${runId}`,
    "",
    "## Summary",
    `- ${openItems.length} open knowledge item${openItems.length === 1 ? "" : "s"} reviewed`,
    `- ${applied.length} applied`,
    `- ${edited.length} card edit${edited.length === 1 ? "" : "s"}`,
    `- ${reordered.length} order edit${reordered.length === 1 ? "" : "s"}`,
    `- ${added.length} new card${added.length === 1 ? "" : "s"} added`,
    `- ${removed.length} card${removed.length === 1 ? "" : "s"} retired`,
    `- ${dismissed.length} dismissed`,
    `- Passed on attempt ${report?.attempts?.length || 1} of 5`,
    reordered.length
      ? `- Dependency changes: ${reordered.length} requires delta${reordered.length === 1 ? "" : "s"} validated by the dependency guard.`
      : "- Dependency changes: none; instruction-only integration guard preserved card order and requires arrays.",
    "",
    "## Applied",
    "",
    applied.length
      ? applied.map((change) => [
          `### ${(change.knowledge_ids || []).join(", ") || "knowledge"} → Card ${change.card}${change.title ? ` (${change.title})` : ""}`,
          `- **Change:** ${change.change || "Updated card instruction"}`,
          `- **Knowledge IDs:** ${(change.knowledge_ids || []).join(", ") || "none"}`,
          change.type === "edit_order"
            ? `- **Requires delta:** ${JSON.stringify(change.requires || {})}`
            : "",
          change.type === "add_card"
            ? `- **New card:** ${change.card_index}. ${change.card?.title || ""}`
            : "",
          change.type === "add_card"
            ? `- **Requires:** ${JSON.stringify(change.requires || {})}`
            : "",
          change.type === "remove_card"
            ? `- **Retired card:** ${change.card}. ${change.title || ""}`
            : "",
          change.type === "edit_order"
            ? "- **Tier:** 2 (order edit)"
            : change.type === "add_card"
              ? "- **Tier:** 3 (add card)"
              : change.type === "remove_card"
                ? "- **Tier:** 4 (retire card)"
                : "- **Tier:** 1 (instruction edit)",
        ].join("\n")).join("\n\n")
      : "_none_",
    "",
    "## Dismissed",
    "",
    dismissed.length
      ? dismissed.map((item) => `### ${item.id}\n- **Reason:** ${item.reason || "No longer relevant"}`).join("\n\n")
      : "_none_",
    "",
    "## Checker Attempts",
    "",
    report?.attempts?.length
      ? report.attempts.map((attempt) => [
          `### Attempt ${attempt.attempt}`,
          `- Verdict: ${attempt.check?.passed ? "PASS" : "FAIL"}`,
          `- Feedback: ${attempt.check?.feedback || "none"}`,
          `- Locked patches: ${attempt.locked?.length || 0}`,
        ].join("\n")).join("\n\n")
      : "_none_",
    "",
  ].join("\n");
}

// ----- crash-safe apply (audit 3a): a write-ahead marker that makes the whole
// cards+workflow+knowledge commit atomic across a crash. -----
const PENDING_APPLY = "pending-apply.json";

/**
 * Commit the integration result as one crash-safe unit. The marker holds the
 * COMPLETE intended end-state (cards + workflow + knowledge); it is written
 * BEFORE any live file and cleared only AFTER all three are durable. A crash at
 * any point is recovered by reconcilePendingApply replaying this exact state.
 */
function commitIntegration(root, { runId, cards, workflow, knowledge }) {
  const marker = path.join(root, PENDING_APPLY);
  writeJson(marker, { run_id: runId, cards, workflow, knowledge });
  writeJson(path.join(root, "cards.json"), cards);
  writeJson(path.join(root, "workflow.json"), workflow);
  writeJson(path.join(root, "knowledge.json"), knowledge);
  try { fs.unlinkSync(marker); } catch { /* already gone */ }
}

/**
 * Replay a surviving marker (prior crash mid-commit). Idempotent: writing the
 * same bytes again is harmless. After this, the knowledge items are APPLIED, so
 * the open-items filter drops them and they are never re-integrated. Returns
 * true if a marker was reconciled.
 */
function reconcilePendingApply(root) {
  const marker = path.join(root, PENDING_APPLY);
  const pending = readJsonMaybe(marker);
  if (!pending) return false;
  try {
    if (pending.cards) writeJson(path.join(root, "cards.json"), pending.cards);
    if (pending.workflow) writeJson(path.join(root, "workflow.json"), pending.workflow);
    if (pending.knowledge) writeJson(path.join(root, "knowledge.json"), pending.knowledge);
    console.log(dim(`  reconciled a crashed integration (replayed pending-apply marker, run ${pending.run_id || "?"}) — insights already applied, not re-integrating.`));
  } finally {
    try { fs.unlinkSync(marker); } catch { /* already gone */ }
  }
  return true;
}

export async function runIntegration(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: conductor-board integrate --skill SKILL.md [--dir .conductor/<skill>] [--run-id ID]");
    return true;
  }
  const skillArg = flag(args, ["--skill", "-s"]);
  const dirArg = flag(args, ["--dir", "--out-dir"]);
  const root = path.resolve(process.cwd(), typeof dirArg === "string" ? dirArg : ".conductor");
  const skillPath = typeof skillArg === "string" ? path.resolve(process.cwd(), skillArg) : null;
  const port = Number(flag(args, ["--port"], 3042)) || 3042;
  const cardsPath = path.join(root, "cards.json");
  const workflowPath = path.join(root, "workflow.json");
  const runId = String(flag(args, ["--run-id"]) || timestampRunId());

  // CRASH RECOVERY (audit 3a): a surviving pending-apply marker means a prior
  // integration wrote its intended final state but crashed before clearing.
  // Replay it (idempotent — same bytes) so those insights end APPLIED and are
  // NOT re-integrated. Done BEFORE reading knowledge so the reconciled (applied)
  // items drop out of the open filter below.
  reconcilePendingApply(root);

  if (!fs.existsSync(cardsPath)) return console.error(red(`✗ missing ${cardsPath}`)), false;
  if (!fs.existsSync(workflowPath)) return console.error(red(`✗ missing ${workflowPath}`)), false;
  const cards = readJsonMaybe(cardsPath);
  const workflow = readJsonMaybe(workflowPath);
  const knowledge = ensureKnowledge(root);
  const openItems = knowledge.items.filter((item) => item && knowledgeStatus(item) === "open");
  if (openItems.length === 0) {
    console.log(green("✓ no open knowledge items; integration skipped"));
    return true;
  }
  const instructionItems = openItems.filter(isInstructionChangeItem);
  const orderItems = openItems.filter(isOrderChangeItem);
  const addItems = openItems.filter(isAddChangeItem);
  const removeItems = openItems.filter(isRemoveChangeItem);
  const maxAttempts = Number(flag(args, ["--max-attempts"]) || 10);
  const integrationBoard = await initIntegrationBoard(root, openItems, port);
  const progress = makeIntegrationProgress(integrationBoard);

  const skill = skillPath && fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : "";
  let loop = { result: { changes: [], dismissed: [] }, report: { ok: true, attempts: [], final: null } };
  try {
    if (instructionItems.length) {
      progress({ phase: "instruction", event: "phase-start" });
      loop = await composeCheckIntegration({
        skill,
        cards,
        workflow,
        openItems: instructionItems,
        summary: latestRunSummary(root),
        maxAttempts,
        strict: args.includes("--strict"),
        progress,
      });
      // The loop narrates what it just taught itself: ONE multi-line closing beat
      // on the instruction card (where the work happened), built from the composer's
      // existing output — no extra model call.
      progress({
        phase: "instruction",
        event: "phase-end",
        passed: loop.report.ok,
        feedback: repairFeedback(loop.report.final || {}),
        summaryNote: loop.report.ok ? buildAppliedSummary(loop.result) : null,
      });
    }
  } catch (e) {
    progress({ phase: "instruction", event: "phase-end", passed: false, feedback: e.message, tone: "feedback" });
    console.error(red(`✗ integration failed: ${e.message}`));
    return false;
  }
  let result = loop.result;
  if (!loop.report.ok) {
    console.error(red("✗ integration checker did not pass within max attempts"));
    const feedback = repairFeedback(loop.report.final || {});
    if (feedback) console.error(dim(feedback));
    return false;
  }

  let applied;
  try {
    applied = await applyInstructionPatches({ cards, workflow, changes: result.changes, openItems });
    assertLedgerConsistency({ cards: applied.cards, changes: result.changes, knowledge });
  } catch (e) {
    console.error(red(`✗ integration rejected by guard: ${e.message}`));
    return false;
  }
  let nextCards = applied.cards;
  let nextWorkflow = applied.workflow;

  let orderLoop = { result: { changes: [], dismissed: [] }, workflow: nextWorkflow, report: { ok: true, attempts: [], final: null } };
  if (orderItems.length) {
    try {
      progress({ phase: "order", event: "phase-start" });
      orderLoop = await composeCheckOrderIntegration({
        cards: applied.cards,
        workflow: nextWorkflow,
        orderItems,
        maxAttempts,
        strict: args.includes("--strict"),
        progress,
      });
      progress({ phase: "order", event: "phase-end", passed: true });
    } catch (e) {
      progress({ phase: "order", event: "phase-end", passed: false, feedback: e.message, tone: "feedback" });
      console.error(red(`✗ order integration failed: ${e.message}`));
      return false;
    }
    if (orderLoop.report.ok) {
      nextWorkflow = orderLoop.workflow;
    } else {
      const reason = orderRepairFeedback(orderLoop.report.final || {}) || "can't reorder: dependency guard did not approve the requested order change";
      orderLoop.result = {
        changes: [],
        dismissed: orderItems.map((item) => ({
          id: item.id,
          reason: reason.startsWith("can't reorder") ? reason : `can't reorder: ${reason}`,
        })),
      };
    }
  }

  const orderDismissedIds = new Set((orderLoop.result.dismissed || []).map((item) => item.id));
  if (orderDismissedIds.size) {
    const filteredChanges = [];
    for (const change of result.changes || []) {
      if ((change.knowledge_ids || []).some((id) => orderDismissedIds.has(id))) continue;
      filteredChanges.push(change);
    }
    if (filteredChanges.length !== (result.changes || []).length) {
      applied = await applyInstructionPatches({ cards, workflow, changes: filteredChanges, openItems });
      result = { ...result, changes: filteredChanges };
      nextCards = applied.cards;
      nextWorkflow = applied.workflow;
    }
  }

  let addLoop = { result: { changes: [], dismissed: [] }, cards: nextCards, workflow: nextWorkflow, report: { ok: true, attempts: [], final: null } };
  if (addItems.length) {
    try {
      progress({ phase: "add", event: "phase-start" });
      addLoop = await composeCheckAddIntegration({
        cards: nextCards,
        workflow: nextWorkflow,
        addItems,
        maxAttempts,
        strict: args.includes("--strict"),
        progress,
      });
      progress({ phase: "add", event: "phase-end", passed: true });
    } catch (e) {
      progress({ phase: "add", event: "phase-end", passed: false, feedback: e.message, tone: "feedback" });
      console.error(red(`✗ add-card integration failed: ${e.message}`));
      return false;
    }
    if (addLoop.report.ok) {
      nextCards = addLoop.cards;
      nextWorkflow = addLoop.workflow;
    } else {
      const reason = orderRepairFeedback(addLoop.report.final || {}) || "can't add card: card quality, placement, or coverage guard did not approve the requested addition";
      addLoop.result = {
        changes: [],
        dismissed: addItems.map((item) => ({
          id: item.id,
          reason: reason.startsWith("can't add card") ? reason : `can't add card: ${reason}`,
        })),
      };
    }
  }

  const addDismissedIds = new Set((addLoop.result.dismissed || []).map((item) => item.id));
  if (addDismissedIds.size) {
    const filteredInstructionChanges = [];
    for (const change of result.changes || []) {
      if ((change.knowledge_ids || []).some((id) => addDismissedIds.has(id))) continue;
      filteredInstructionChanges.push(change);
    }
    const filteredOrderChanges = [];
    for (const change of orderLoop.result.changes || []) {
      if ((change.knowledge_ids || []).some((id) => addDismissedIds.has(id))) continue;
      filteredOrderChanges.push(change);
    }
    if (
      filteredInstructionChanges.length !== (result.changes || []).length ||
      filteredOrderChanges.length !== (orderLoop.result.changes || []).length
    ) {
      applied = await applyInstructionPatches({ cards, workflow, changes: filteredInstructionChanges, openItems });
      result = { ...result, changes: filteredInstructionChanges };
      nextCards = applied.cards;
      nextWorkflow = applied.workflow;
      const orderApplied = applyOrderDeltas({ workflow: nextWorkflow, changes: filteredOrderChanges, orderItems });
      orderLoop.result = { ...orderLoop.result, changes: orderApplied.applied };
      nextWorkflow = orderApplied.workflow;
      addLoop.cards = nextCards;
      addLoop.workflow = nextWorkflow;
    }
  }

  let removeLoop = { result: { changes: [], dismissed: [] }, cards: nextCards, workflow: nextWorkflow, report: { ok: true, attempts: [], final: null } };
  if (removeItems.length) {
    try {
      progress({ phase: "remove", event: "phase-start" });
      removeLoop = await composeCheckRemoveIntegration({
        cards: nextCards,
        workflow: nextWorkflow,
        removeItems,
        maxAttempts,
        strict: args.includes("--strict"),
        progress,
      });
      progress({ phase: "remove", event: "phase-end", passed: true });
    } catch (e) {
      progress({ phase: "remove", event: "phase-end", passed: false, feedback: e.message, tone: "feedback" });
      console.error(red(`✗ remove-card integration failed: ${e.message}`));
      return false;
    }
    if (removeLoop.report.ok) {
      nextCards = removeLoop.cards;
      nextWorkflow = removeLoop.workflow;
    } else {
      const reason = orderRepairFeedback(removeLoop.report.final || {}) || "can't remove card: coverage or orphan-safety guard did not approve the requested removal";
      removeLoop.result = {
        changes: [],
        dismissed: removeItems.map((item) => ({
          id: item.id,
          reason: reason.startsWith("can't remove card") ? reason : `can't remove card: ${reason}`,
        })),
      };
    }
  }

  const removeDismissedIds = new Set((removeLoop.result.dismissed || []).map((item) => item.id));
  if (removeDismissedIds.size) {
    const filteredInstructionChanges = (result.changes || []).filter((change) => !(change.knowledge_ids || []).some((id) => removeDismissedIds.has(id)));
    const filteredOrderChanges = (orderLoop.result.changes || []).filter((change) => !(change.knowledge_ids || []).some((id) => removeDismissedIds.has(id)));
    const filteredAddChanges = (addLoop.result.changes || []).filter((change) => !(change.knowledge_ids || []).some((id) => removeDismissedIds.has(id)));
    if (
      filteredInstructionChanges.length !== (result.changes || []).length ||
      filteredOrderChanges.length !== (orderLoop.result.changes || []).length ||
      filteredAddChanges.length !== (addLoop.result.changes || []).length
    ) {
      applied = await applyInstructionPatches({ cards, workflow, changes: filteredInstructionChanges, openItems });
      result = { ...result, changes: filteredInstructionChanges };
      nextCards = applied.cards;
      nextWorkflow = applied.workflow;
      const orderApplied = applyOrderDeltas({ workflow: nextWorkflow, changes: filteredOrderChanges, orderItems });
      orderLoop.result = { ...orderLoop.result, changes: orderApplied.applied };
      nextWorkflow = orderApplied.workflow;
      const addApplied = applyAddChanges({ cards: nextCards, workflow: nextWorkflow, changes: filteredAddChanges, addItems });
      addLoop.result = { ...addLoop.result, changes: addApplied.applied };
      nextCards = addApplied.cards;
      nextWorkflow = addApplied.workflow;
      removeLoop.cards = nextCards;
      removeLoop.workflow = nextWorkflow;
    }
  }

  const finalResult = {
    changes: [...(result.changes || []), ...(orderLoop.result.changes || []), ...(addLoop.result.changes || []), ...(removeLoop.result.changes || [])],
    dismissed: [...(result.dismissed || []), ...(orderLoop.result.dismissed || []), ...(addLoop.result.dismissed || []), ...(removeLoop.result.dismissed || [])],
  };
  const unhandled = unresolvedItems(openItems, finalResult);
  if (unhandled.length) {
    console.error(red(`✗ integration left ${unhandled.length} open knowledge item(s) unhandled: ${unhandled.map((item) => item.id).join(", ")}`));
    return false;
  }

  try {
    progress({ phase: "validate", event: "phase-start" });
    assertLedgerConsistency({ cards: nextCards, workflow: nextWorkflow, changes: finalResult.changes, knowledge });
  } catch (e) {
    progress({ phase: "validate", event: "phase-end", passed: false, feedback: e.message, tone: "feedback" });
    console.error(red(`✗ integration rejected by guard: ${e.message}`));
    return false;
  }

  const errors = validateConductor(nextWorkflow);
  if (errors.length) {
    progress({ phase: "validate", event: "phase-end", passed: false, feedback: errors[0], tone: "feedback" });
    console.error(red(`✗ integration would create invalid workflow: ${errors[0]}`));
    return false;
  }
  progress({ phase: "validate", event: "phase-end", passed: true });

  // Build the FINAL knowledge state in memory first (mark applied/dismissed),
  // then commit cards + workflow + knowledge as one crash-safe unit below — so
  // the live files are never touched until the complete intended end-state is
  // durable in the marker (audit 3a).
  for (const change of finalResult.changes) {
    for (const id of change.knowledge_ids || []) {
      const item = knowledge.items.find((candidate) => candidate.id === id);
      if (!item) continue;
      item.status = "applied";
      item.applied_in = runId;
      if (change.type === "edit_order") {
        item.applied_as = `tier-2:edit-order-card-${change.requires?.card}`;
        item.applied_order = change.requires;
      } else if (change.type === "add_card") {
        item.applied_as = `tier-3:add-card-${change.card_index}`;
        item.applied_card = change.card_index;
        item.applied_order = change.requires;
      } else if (change.type === "remove_card") {
        item.applied_as = hasInstructionFacet(id, instructionItems)
          ? `tier-1+4:edit-card-${change.card}+remove-card`
          : `tier-4:remove-card-${change.card}`;
        item.applied_card = change.card;
        item.applied_remove = { card: change.card, retired_by: change.retired_by };
      } else if (hasRemoveFacet(id, removeItems) && hasInstructionFacet(id, instructionItems)) {
        item.applied_as = `tier-1+4:edit-card-${change.card}+remove-card`;
      } else if (hasOrderFacet(id, orderItems) && hasInstructionFacet(id, instructionItems)) {
        item.applied_as = `tier-1+2:edit-card-${change.card}+edit-order`;
      } else if (hasAddFacet(id, addItems) && hasInstructionFacet(id, instructionItems)) {
        item.applied_as = `tier-1+3:edit-card-${change.card}+add-card`;
      } else {
        item.applied_as = `tier-1:edit-card-${change.card}`;
      }
    }
  }
  for (const item of finalResult.dismissed) {
    const found = knowledge.items.find((candidate) => candidate.id === item.id);
    if (!found) continue;
    found.status = "dismissed";
    found.dismissed_in = runId;
    found.dismissed_reason = item.reason;
  }

  // CRASH-SAFE COMMIT (audit 3a): write-ahead the COMPLETE intended final state
  // (cards + workflow + knowledge) to a marker BEFORE touching any live file.
  // A crash anywhere from here on is recovered by reconcilePendingApply replaying
  // the marker (idempotent), so the dangerous window between the workflow-write
  // and the knowledge-mark can never cause a re-apply. Clear the marker only
  // after all three live files are durable.
  commitIntegration(root, { runId, cards: nextCards, workflow: nextWorkflow, knowledge });

  const artifactsDir = path.join(root, "runs", runId, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const artifact = renderArtifact({
    runId,
    openItems,
    changes: finalResult.changes,
    dismissed: finalResult.dismissed,
    report: {
      ...loop.report,
      order_attempts: orderLoop.report.attempts || [],
      add_attempts: addLoop.report.attempts || [],
      remove_attempts: removeLoop.report.attempts || [],
      attempts: [...(loop.report.attempts || []), ...(orderLoop.report.attempts || []), ...(addLoop.report.attempts || []), ...(removeLoop.report.attempts || [])],
    },
  });
  fs.writeFileSync(path.join(artifactsDir, "integration.md"), artifact);

  const summary = {
    run_id: runId,
    processed: openItems.length,
    applied: finalResult.changes.reduce((count, change) => count + (change.knowledge_ids?.length || 0), 0),
    edited: finalResult.changes.filter((change) => change.type === "edit_instruction").length,
    reordered: finalResult.changes.filter((change) => change.type === "edit_order").length,
    added: finalResult.changes.filter((change) => change.type === "add_card").length,
    retired: finalResult.changes.filter((change) => change.type === "remove_card").length,
    dismissed: finalResult.dismissed.length,
    attempts: (loop.report.attempts?.length || 0) + (orderLoop.report.attempts?.length || 0) + (addLoop.report.attempts?.length || 0) + (removeLoop.report.attempts?.length || 0),
    changes: finalResult.changes,
    dismissed_items: finalResult.dismissed,
    artifact: "integration.md",
  };
  writeJson(path.join(root, "runs", runId, "integration-summary.json"), summary);

  console.log(green(`✓ integration complete: ${summary.applied} applied, ${summary.dismissed} dismissed`));
  console.log(dim(`  artifact: ${path.relative(process.cwd(), path.join(artifactsDir, "integration.md"))}`));
  return true;
}

export async function integrateRoot({ root, skillPath, runId, port } = {}) {
  const args = ["--dir", root, "--run-id", runId || timestampRunId()];
  if (skillPath) args.push("--skill", skillPath);
  if (port) args.push("--port", String(port));
  return runIntegration(args);
}
