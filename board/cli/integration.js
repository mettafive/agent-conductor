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

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function normalizeCards(payload) {
  const raw = Array.isArray(payload) ? payload : payload?.cards;
  if (!Array.isArray(raw)) throw new Error("integration JSON must include cards: [...]");
  return raw.map((card, index) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error(`card ${index} must be an object`);
    const unknown = Object.keys(card).filter((k) => !["title", "instruction"].includes(k));
    if (unknown.length) throw new Error(`card ${index} has unsupported field(s): ${unknown.join(", ")}`);
    const title = compact(card.title);
    const instruction = compact(card.instruction);
    if (!title) throw new Error(`card ${index} is missing title`);
    if (!instruction) throw new Error(`card ${index} is missing instruction`);
    return { title, instruction };
  });
}

function normalizeIntegration(payload) {
  const cards = normalizeCards(payload);
  const changes = Array.isArray(payload?.changes)
    ? payload.changes.map((change) => ({
        type: ["edit", "add", "remove"].includes(change?.type) ? change.type : "edit",
        card: Number.isInteger(Number(change?.card)) ? Number(change.card) : null,
        title: compact(change?.title),
        change: compact(change?.change || change?.summary || change?.what_changed),
        knowledge_id: compact(change?.knowledge_id || change?.knowledge || change?.id),
      })).filter((change) => change.change || change.knowledge_id)
    : [];
  const dismissed = Array.isArray(payload?.dismissed)
    ? payload.dismissed.map((item) => ({
        id: compact(item?.id || item?.knowledge_id),
        reason: compact(item?.reason || item?.why),
      })).filter((item) => item.id)
    : [];
  return { cards, changes, dismissed };
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

function integrationPrompt({ skill, cards, workflow, openItems, summary }) {
  return `Here is the skill file. Here are the current cards. Here are the open learning items.

For each learning item, edit the most relevant card's instruction to include this learning. Fold it in naturally — weave it into the instruction as if it was always there, do not append it as a footnote.

For learning items tagged "efficiency", preserve the card's original goal and fold the detail in as upfront context, a known path, a known command, or a known shortcut so the next run avoids rediscovery.

If a learning item doesn't apply to any existing card, create a new card for it with a clear title and instruction.

If a learning item is no longer relevant, mark it dismissed with a one-line reason.

Return JSON only:
{
  "cards": [
    { "title": "short title", "instruction": "full updated instruction" }
  ],
  "changes": [
    { "type": "edit", "card": 7, "title": "Validate title and meta", "change": "Added canonical HTTPS verification.", "knowledge_id": "K-001" }
  ],
  "dismissed": [
    { "id": "K-003", "reason": "Observational, not actionable." }
  ]
}

Do not include requires fields. Do not include ids. Do not include gate fields.

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

function words(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9åäö]+/g) || []);
}

function knowledgeStatus(item) {
  return String(item?.status || "open").trim().toLowerCase();
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

function fallbackIntegrate(cards, openItems) {
  const next = cards.map((card) => ({ ...card }));
  const changes = [];
  const dismissed = [];
  for (const item of openItems) {
    const needle = words(`${item.title} ${item.detail}`);
    let best = -1;
    let bestScore = 0;
    next.forEach((card, index) => {
      const hay = words(`${card.title} ${card.instruction}`);
      const score = [...needle].filter((word) => hay.has(word)).length;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best === -1 || bestScore === 0) {
      next.push({
        title: compact(item.title).slice(0, 40) || "Apply learning",
        instruction: compact(item.detail || item.title),
      });
      changes.push({
        type: "add",
        card: next.length - 1,
        title: next.at(-1).title,
        change: "Created a card for this learning item.",
        knowledge_id: item.id,
      });
      continue;
    }
    const addition = compact(item.detail || item.title);
    if (!next[best].instruction.toLowerCase().includes(addition.toLowerCase())) {
      next[best].instruction = `${next[best].instruction} Also ensure ${addition.charAt(0).toLowerCase()}${addition.slice(1)}`;
    }
    changes.push({
      type: "edit",
      card: best,
      title: next[best].title,
      change: `Integrated learning into card instruction: ${compact(item.title)}`,
      knowledge_id: item.id,
    });
  }
  return { cards: next, changes, dismissed };
}

function updateWorkflowCards(workflow, cards) {
  const current = Array.isArray(workflow.steps) ? workflow.steps : [];
  const steps = cards.map((card, index) => ({
    title: card.title,
    instruction: card.instruction,
    requires: Array.isArray(current[index]?.requires)
      ? current[index].requires.filter((dep) => Number.isInteger(dep) && dep >= 0 && dep < cards.length && dep !== index)
      : index > 0 ? [index - 1] : [],
  }));
  return { ...workflow, steps };
}

function renderArtifact({ runId, openItems, changes, dismissed }) {
  const applied = changes.filter((change) => change.type !== "remove");
  const added = changes.filter((change) => change.type === "add");
  const edited = changes.filter((change) => change.type === "edit");
  return [
    `# Integration — ${runId}`,
    "",
    "## Summary",
    `- ${openItems.length} open knowledge item${openItems.length === 1 ? "" : "s"} reviewed`,
    `- ${applied.length} applied`,
    `- ${edited.length} card edit${edited.length === 1 ? "" : "s"}`,
    `- ${added.length} new card${added.length === 1 ? "" : "s"} added`,
    `- ${dismissed.length} dismissed`,
    "- Dependency changes: existing edges preserved; new cards use fallback placement until targeted remap is implemented.",
    "",
    "## Applied",
    "",
    applied.length
      ? applied.map((change) => [
          `### ${change.knowledge_id || "knowledge"} → Card ${change.card}${change.title ? ` (${change.title})` : ""}`,
          `- **Change:** ${change.change || "Updated card instruction"}`,
          `- **Tier:** ${change.type === "add" ? "2 (insert card)" : "1 (instruction edit)"}`,
        ].join("\n")).join("\n\n")
      : "_none_",
    "",
    "## Dismissed",
    "",
    dismissed.length
      ? dismissed.map((item) => `### ${item.id}\n- **Reason:** ${item.reason || "No longer relevant"}`).join("\n\n")
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

  let result;
  const skill = skillPath && fs.existsSync(skillPath) ? fs.readFileSync(skillPath, "utf8") : "";
  const prompt = integrationPrompt({ skill, cards, workflow, openItems, summary: latestRunSummary(root) });
  try {
    const raw = await callModel(prompt, { role: "integration", attempt: 1 });
    result = normalizeIntegration(extractJson(raw));
  } catch (e) {
    if (args.includes("--strict")) {
      console.error(red(`✗ integration model failed: ${e.message}`));
      return false;
    }
    result = fallbackIntegrate(cards, openItems);
  }

  const nextWorkflow = updateWorkflowCards(workflow, result.cards);
  const errors = validateConductor(nextWorkflow);
  if (errors.length) {
    console.error(red(`✗ integration would create invalid workflow: ${errors[0]}`));
    return false;
  }

  writeJson(cardsPath, result.cards);
  writeJson(workflowPath, nextWorkflow);

  for (const change of result.changes) {
    const item = knowledge.items.find((candidate) => candidate.id === change.knowledge_id);
    if (!item) continue;
    item.status = "applied";
    item.applied_in = runId;
    item.applied_as = change.type === "add" ? `tier-2:insert-card-${change.card}` : `tier-1:edit-card-${change.card}`;
    for (const duplicate of duplicateKnowledgeItems(knowledge, item, openItems)) {
      duplicate.status = "applied";
      duplicate.applied_in = runId;
      duplicate.applied_as = `duplicate-of:${item.id}`;
      duplicate.resolved_by = item.id;
    }
  }
  for (const item of result.dismissed) {
    const found = knowledge.items.find((candidate) => candidate.id === item.id);
    if (!found) continue;
    found.status = "dismissed";
    found.dismissed_in = runId;
    found.dismissed_reason = item.reason;
  }
  writeJson(path.join(root, "knowledge.json"), knowledge);

  const artifactsDir = path.join(root, "runs", runId, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const artifact = renderArtifact({ runId, openItems, changes: result.changes, dismissed: result.dismissed });
  fs.writeFileSync(path.join(artifactsDir, "integration.md"), artifact);

  const summary = {
    run_id: runId,
    processed: openItems.length,
    applied: result.changes.length,
    edited: result.changes.filter((change) => change.type === "edit").length,
    added: result.changes.filter((change) => change.type === "add").length,
    dismissed: result.dismissed.length,
    changes: result.changes,
    dismissed_items: result.dismissed,
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
