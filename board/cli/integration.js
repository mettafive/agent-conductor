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
import {
  applyLockedEdges,
  checkWorkflowWithDependencyGuard,
  listLockedEdges,
} from "./order.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function normalizeIntegration(payload) {
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
  return { changes, dismissed };
}

function mergeLocked(result, locked) {
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
  return { changes, dismissed };
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

function integrationPrompt({ skill, cards, workflow, openItems, summary, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 5 }) {
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

function orderIntegrationPrompt({ cards, workflow, orderItems, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 5 }) {
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

function addIntegrationPrompt({ cards, workflow, addItems, locked = [], checkerFeedback = "", attempt = 1, maxAttempts = 5 }) {
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

function isInstructionChangeItem(item) {
  const tags = knowledgeTags(item);
  if (tags.includes("instruction") || tags.includes("edit_instruction")) return true;
  return !isOrderChangeItem(item) && !isAddChangeItem(item);
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

async function composeCheckOrderIntegration({ cards, workflow, orderItems, maxAttempts = 5, strict = false }) {
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
      attempts.push({ attempt, result, workflow: candidate, check, guard: guard.check, locked_edges: listLockedEdges(lockedEdges) });
      checkerFeedback = orderRepairFeedback(check) || guard.check.feedback;
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
      return { result: mergeLockedOrder(result, locked), workflow: candidate, report: { ok: true, attempts, final: coverage, guard: guard.check, locked: [...locked.values()].map((item) => item.value) } };
    }
    checkerFeedback = orderRepairFeedback(coverage);
  }

  return {
    result: mergeLockedOrder(lastResult || { changes: [], dismissed: [] }, locked),
    workflow: lastWorkflow,
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: [...locked.values()].map((item) => item.value) },
  };
}

async function composeCheckAddIntegration({ cards, workflow, addItems, maxAttempts = 5, strict = false }) {
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
      const merged = mergeLockedOrder(result, locked);
      const applied = applyAddChanges({ cards, workflow, changes: merged.changes, addItems });
      return { result: { ...merged, changes: applied.applied }, cards: applied.cards, workflow: applied.workflow, report: { ok: true, attempts, final: check, guard: guard.check, locked: [...locked.values()].map((item) => item.value) } };
    }
    checkerFeedback = orderRepairFeedback(check);
  }

  return {
    result: mergeLockedOrder(lastResult || { changes: [], dismissed: [] }, locked),
    cards: lastCards,
    workflow: lastWorkflow,
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: [...locked.values()].map((item) => item.value) },
  };
}

async function composeCheckIntegration({ skill, cards, workflow, openItems, summary, maxAttempts = 5, strict = false }) {
  const locked = new Map();
  const attempts = [];
  let checkerFeedback = "";
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
      return { result: mergeLocked(result, locked), report: { ok: true, attempts, final: check, locked: lockedList(locked) } };
    }
    checkerFeedback = repairFeedback(check);
  }
  return {
    result: mergeLocked(lastResult || { changes: [], dismissed: [] }, locked),
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null, locked: lockedList(locked) },
  };
}

function applyInstructionPatches({ cards, workflow, changes, openItems }) {
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

  assertOnlyInstructionChanges({ beforeCards: cards, beforeWorkflow: workflow, afterCards: nextCards, afterWorkflow: nextWorkflow, changes });
  return { cards: nextCards, workflow: nextWorkflow };
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
  }
}

function renderArtifact({ runId, openItems, changes, dismissed, report }) {
  const applied = changes;
  const edited = changes.filter((change) => change.type === "edit_instruction");
  const reordered = changes.filter((change) => change.type === "edit_order");
  const added = changes.filter((change) => change.type === "add_card");
  return [
    `# Integration — ${runId}`,
    "",
    "## Summary",
    `- ${openItems.length} open knowledge item${openItems.length === 1 ? "" : "s"} reviewed`,
    `- ${applied.length} applied`,
    `- ${edited.length} card edit${edited.length === 1 ? "" : "s"}`,
    `- ${reordered.length} order edit${reordered.length === 1 ? "" : "s"}`,
    `- ${added.length} new card${added.length === 1 ? "" : "s"} added`,
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
          change.type === "edit_order"
            ? "- **Tier:** 2 (order edit)"
            : change.type === "add_card"
              ? "- **Tier:** 3 (add card)"
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

export async function runIntegration(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: conductor-board integrate --skill SKILL.md [--dir .conductor/<skill>] [--run-id ID]");
    return true;
  }
  const skillArg = flag(args, ["--skill", "-s"]);
  const dirArg = flag(args, ["--dir", "--out-dir"]);
  const root = path.resolve(process.cwd(), typeof dirArg === "string" ? dirArg : ".conductor");
  const skillPath = typeof skillArg === "string" ? path.resolve(process.cwd(), skillArg) : null;
  const cardsPath = path.join(root, "cards.json");
  const workflowPath = path.join(root, "workflow.json");
  const runId = String(flag(args, ["--run-id"]) || timestampRunId());

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

  const skill = skillPath && fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : "";
  let loop = { result: { changes: [], dismissed: [] }, report: { ok: true, attempts: [], final: null } };
  try {
    if (instructionItems.length) {
      loop = await composeCheckIntegration({
        skill,
        cards,
        workflow,
        openItems: instructionItems,
        summary: latestRunSummary(root),
        maxAttempts: Number(flag(args, ["--max-attempts"]) || 5),
        strict: args.includes("--strict"),
      });
    }
  } catch (e) {
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
    applied = applyInstructionPatches({ cards, workflow, changes: result.changes, openItems });
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
      orderLoop = await composeCheckOrderIntegration({
        cards: applied.cards,
        workflow: nextWorkflow,
        orderItems,
        maxAttempts: Number(flag(args, ["--max-attempts"]) || 5),
        strict: args.includes("--strict"),
      });
    } catch (e) {
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
      applied = applyInstructionPatches({ cards, workflow, changes: filteredChanges, openItems });
      result = { ...result, changes: filteredChanges };
      nextCards = applied.cards;
      nextWorkflow = applied.workflow;
    }
  }

  let addLoop = { result: { changes: [], dismissed: [] }, cards: nextCards, workflow: nextWorkflow, report: { ok: true, attempts: [], final: null } };
  if (addItems.length) {
    try {
      addLoop = await composeCheckAddIntegration({
        cards: nextCards,
        workflow: nextWorkflow,
        addItems,
        maxAttempts: Number(flag(args, ["--max-attempts"]) || 5),
        strict: args.includes("--strict"),
      });
    } catch (e) {
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
      applied = applyInstructionPatches({ cards, workflow, changes: filteredInstructionChanges, openItems });
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

  const finalResult = {
    changes: [...(result.changes || []), ...(orderLoop.result.changes || []), ...(addLoop.result.changes || [])],
    dismissed: [...(result.dismissed || []), ...(orderLoop.result.dismissed || []), ...(addLoop.result.dismissed || [])],
  };
  const unhandled = unresolvedItems(openItems, finalResult);
  if (unhandled.length) {
    console.error(red(`✗ integration left ${unhandled.length} open knowledge item(s) unhandled: ${unhandled.map((item) => item.id).join(", ")}`));
    return false;
  }

  try {
    assertLedgerConsistency({ cards: nextCards, workflow: nextWorkflow, changes: finalResult.changes, knowledge });
  } catch (e) {
    console.error(red(`✗ integration rejected by guard: ${e.message}`));
    return false;
  }

  const errors = validateConductor(nextWorkflow);
  if (errors.length) {
    console.error(red(`✗ integration would create invalid workflow: ${errors[0]}`));
    return false;
  }

  writeJson(cardsPath, nextCards);
  writeJson(workflowPath, nextWorkflow);

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
  writeJson(path.join(root, "knowledge.json"), knowledge);

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
      attempts: [...(loop.report.attempts || []), ...(orderLoop.report.attempts || []), ...(addLoop.report.attempts || [])],
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
    dismissed: finalResult.dismissed.length,
    attempts: (loop.report.attempts?.length || 0) + (orderLoop.report.attempts?.length || 0) + (addLoop.report.attempts?.length || 0),
    changes: finalResult.changes,
    dismissed_items: finalResult.dismissed,
    artifact: "integration.md",
  };
  writeJson(path.join(root, "runs", runId, "integration-summary.json"), summary);

  console.log(green(`✓ integration complete: ${summary.applied} applied, ${summary.dismissed} dismissed`));
  console.log(dim(`  artifact: ${path.relative(process.cwd(), path.join(artifactsDir, "integration.md"))}`));
  return true;
}

export async function integrateRoot({ root, skillPath, runId } = {}) {
  const args = ["--dir", root, "--run-id", runId || timestampRunId()];
  if (skillPath) args.push("--skill", skillPath);
  return runIntegration(args);
}
