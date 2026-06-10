import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const DEFAULT_MODEL = process.env.CONDUCTOR_DECOMPOSE_MODEL || process.env.OPENAI_MODEL || "gpt-5";

export function compact(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function flag(args, names) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) {
      const v = args[i + 1];
      return v && !v.startsWith("-") ? v : true;
    }
  }
  return undefined;
}

export function extractJson(text) {
  const src = String(text || "").trim();
  if (!src) throw new Error("model returned empty output");
  try {
    return JSON.parse(src);
  } catch {
    const fenced = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const firstObj = src.indexOf("{");
    const lastObj = src.lastIndexOf("}");
    if (firstObj !== -1 && lastObj > firstObj) return JSON.parse(src.slice(firstObj, lastObj + 1));
    const firstArr = src.indexOf("[");
    const lastArr = src.lastIndexOf("]");
    if (firstArr !== -1 && lastArr > firstArr) return JSON.parse(src.slice(firstArr, lastArr + 1));
    throw new Error("model output was not JSON");
  }
}

export function normalizeCards(payload) {
  const raw = Array.isArray(payload) ? payload : payload?.cards;
  if (!Array.isArray(raw)) throw new Error("composer JSON must be an array or { cards: [...] }");
  return raw.map((card, index) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      throw new Error(`card ${index} must be an object`);
    }
    // kind/rationale are the parallel-sibling tag (kind:"parallel") + its one-line
    // self-documentation; carried through to the checker, workflow.json, and board.
    const allowed = new Set(["title", "instruction", "summary", "kind", "rationale"]);
    const unknown = Object.keys(card).filter((k) => !allowed.has(k));
    if (unknown.length) {
      throw new Error(`card ${index} has unsupported field(s): ${unknown.join(", ")}`);
    }
    const title = compact(card.title);
    const instruction = compact(card.instruction);
    const summary = compact(card.summary);
    if (!title) throw new Error(`card ${index} is missing title`);
    if (!instruction) throw new Error(`card ${index} is missing instruction`);
    if (!summary) throw new Error(`card ${index} is missing summary`);
    const kind = compact(card.kind);
    const rationale = compact(card.rationale);
    const out = { title, instruction, summary };
    if (kind) out.kind = kind;
    if (rationale) out.rationale = rationale;
    return out;
  });
}

function normalizeChecker(payload) {
  const verdict = compact(payload?.verdict || payload?.result || payload?.status).toUpperCase();
  if (verdict !== "PASS" && verdict !== "FAIL") {
    throw new Error("checker JSON must include verdict: PASS or FAIL");
  }
  const feedback = compact(payload?.feedback || payload?.reasoning || payload?.evidence || payload?.reason);
  const issues = Array.isArray(payload?.issues) ? payload.issues.map(compact).filter(Boolean) : [];
  const missing = Array.isArray(payload?.missing) ? payload.missing.map(compact).filter(Boolean) : [];
  const tooBroad = Array.isArray(payload?.too_broad) ? payload.too_broad.map(compact).filter(Boolean) : [];
  const tooTiny = Array.isArray(payload?.too_tiny) ? payload.too_tiny.map(compact).filter(Boolean) : [];
  const misplaced = Array.isArray(payload?.misplaced) ? payload.misplaced.map(compact).filter(Boolean) : [];
  const blockingIssues = Array.isArray(payload?.blocking_issues)
    ? payload.blocking_issues.map((issue) => {
        if (typeof issue === "string") return { type: "issue", problem: compact(issue), required_repair: compact(issue) };
        return {
          type: compact(issue?.type || "issue"),
          card: issue?.card,
          title: compact(issue?.title),
          skill_quote: compact(issue?.skill_quote),
          problem: compact(issue?.problem),
          required_repair: compact(issue?.required_repair),
        };
      }).filter((issue) => issue.problem || issue.required_repair)
    : [];
  const preserve = Array.isArray(payload?.preserve) ? payload.preserve.map(compact).filter(Boolean) : [];
  const repairPrompt = compact(payload?.repair_prompt);
  const passedCards = Array.isArray(payload?.passed)
    ? payload.passed.map((item) => {
        if (typeof item === "string") return { title: compact(item) };
        return {
          card: item?.card,
          title: compact(item?.title),
          reason: compact(item?.reason),
        };
      }).filter((item) => item.title || item.card !== undefined)
    : [];
  const unfinishedRaw = Array.isArray(payload?.unfinished) ? payload.unfinished : [];
  const unfinished = unfinishedRaw.map((item) => {
    if (typeof item === "string") return { title: compact(item), problem: compact(item), needed: "" };
    return {
      card: item?.card,
      title: compact(item?.title),
      problem: compact(item?.problem),
      needed: compact(item?.needed || item?.required_repair || item?.repair),
    };
  }).filter((item) => item.title || item.problem || item.needed || item.card !== undefined);

  return {
    verdict,
    passed: verdict === "PASS",
    feedback,
    blocking_issues: blockingIssues,
    passed_cards: passedCards,
    unfinished,
    preserve,
    repair_prompt: repairPrompt,
    issues,
    missing,
    too_broad: tooBroad,
    too_tiny: tooTiny,
    misplaced,
  };
}

function writeDebugFile(debugDir, name, value) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const file = path.join(debugDir, name);
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(file, body);
}

function pressureForAttempt(attempt, maxAttempts) {
  if (attempt >= maxAttempts) {
    return "LAST CHANCE: this is the final composition attempt. Address every blocking issue explicitly. Preserve good cards. Do not return until the cards would pass an independent decomposition check.";
  }
  if (attempt === maxAttempts - 1) {
    return "FINAL WARNING: one attempt remains after this. Make surgical repairs only: preserve good cards, fix every blocking issue, and do not rewrite stable cards unnecessarily.";
  }
  if (attempt >= 4) {
    return "RECOVERY ATTEMPT: prior decompositions failed. Use the checker feedback literally and repair each named issue.";
  }
  if (attempt === 3) {
    return "ATTEMPT 3: if this has failed before, stop making broad rewrites. Make concrete, surgical repairs from the checker feedback.";
  }
  return "";
}

function composerPrompt({ skill, previousCards, checkerFeedback, passedCards = [], attempt = 1, maxAttempts = 5 }) {
  const repair = previousCards
    ? `\n\nPrevious cards JSON:\n${JSON.stringify(previousCards, null, 2)}\n\nPassed cards that MUST stay done:\n${JSON.stringify(passedCards, null, 2)}\n\nIndependent checker feedback to repair:\n${checkerFeedback}`
    : "";
  const pressure = pressureForAttempt(attempt, maxAttempts);
  return `You are composing Agent Conductor v3 cards from a SKILL.md file.

Card model:
- title: clear human-readable action label, up to 40 characters
- instruction: detailed, concrete work instruction
- summary: a clear, complete TWO-SENTENCE summary of what this card WILL do, written for a non-technical user watching the board. State the intent and the concrete outcome the card aims to produce. Two full sentences, no ellipsis, never cut off mid-word.

Do not use condition fields. Conditionality belongs inside instruction text.

A good card is a concrete, independently verifiable unit of work.

When a step calls for a small, fixed set of distinctly named outputs — each its own
artifact, with no output feeding another — prefer one card per output over a single
card covering all of them. These are parallel siblings: they share the same upstream
and run concurrently, which is faster. Give each \`kind: "parallel"\` and a one-line
rationale (e.g. "parallel sibling — runs concurrently with its siblings, saves time").
Apply this only to a handful of explicitly named, independent deliverables — never to
open-ended or large collections (see the collection rule below). Write each sibling's
instruction self-contained, so no sibling references another.

Every card instruction must require one primary markdown receipt at
\`.conductor/artifacts/<card-index>-<slugified-card-title>.md\`:
- content/code/data/report/table/file work must be shown inside that markdown receipt
- action cards must write an action record in that markdown receipt, including command, return value, changed resource, and verification result
- supporting files such as images, JSON, CSV, screenshots, PDFs, uploads, or deploys must be referenced from that markdown receipt, not treated as standalone primary artifacts. Image-producing cards must require the receipt to embed every image from that card inline with markdown image syntax, while listing the supporting file paths and verification proof.

If work only applies in a certain situation, write the condition directly into
the instruction. The card always executes. Its artifact must prove one of:
- the condition was met and the work was performed
- the condition was not met and no action was needed, with evidence why

Both outcomes are valid passes. The checker will verify that the condition was
actually evaluated, not skipped. Situational cards are valid only when the
decision itself is valuable to record. Do not create cards for work that cannot
meaningfully run at execution time, such as measuring results in 30 days. If
work belongs to a future run, it does not belong in this deck.

Do not allow impossible cards. An impossible card asks for work that must happen
in two different moments, such as creating a file and also filling it with proof
that can only be produced by a later card. Split that into separate cards:
- one card for the earlier draft/setup artifact
- one card for the later proof/finalization artifact

Skills normally contain:
- workflow steps: become cards
- deliverables: become cards or required artifacts inside cards
- output formats: fold into relevant card instructions
- rules, constraints, standards, warnings, quality bars: attach to relevant card instructions
- examples: guidance, not cards unless the example itself is the requested work
- references/background/API notes: context, not cards
- situational work: real cards only when the decision itself is valuable to record; fold the situation and both valid outcomes into the instruction

When the skill repeats the same work across a generic, large, or open-ended
collection — per page, per record, for each item in a set whose members aren't
individually named — keep it as one card whose instruction and artifact cover every
item; do not create a card per item. (A small, fixed set of distinctly named,
independent outputs is the opposite case — split those into parallel siblings, per
the rule above.)

Do not create cards from generic rules, quality criteria, examples, references, or background.
Do not invent work not present in the skill.
Write titles for a user watching the board. Prefer clarity over brevity. Do not
use unexplained acronyms, internal shorthand, or vague labels. Expand jargon in
the title when possible: "Run SEO research" is better than "Recon DAG";
"Verify SEO database columns" is better than "Migration Check"; "Select treatment
family" is better than "Pick Family".
If a workflow step is vague or referential, search the rest of the skill for deliverables, output shape, criteria, examples, or warnings that clarify what concrete output must be produced, and fold that into the instruction.
On repair attempts, preserve the existing card altitude and good cards. Do not collapse the deck into broad umbrella cards unless the checker explicitly says a card is too tiny and must be merged.
Passed cards are done. Copy passed card title and instruction exactly. Do not rename, merge, delete, reorder for convenience, or rewrite passed cards. Finish only the unfinished work.
${pressure ? `\n${pressure}\n` : ""}
Return JSON only as:
{
  "cards": [
    { "title": "Clear action under 40 chars", "instruction": "Concrete verifiable instruction. If situational, say how to evaluate the situation and what artifact proves either action taken or no action needed.", "summary": "Two complete sentences describing what this card will do and the outcome it produces, for a user watching the board." },
    { "title": "One named parallel output", "instruction": "Self-contained instruction producing this output's own artifact; references no sibling.", "summary": "Two complete sentences for a user watching the board.", "kind": "parallel", "rationale": "parallel sibling — runs concurrently with its siblings, saves time" }
  ]
}
Only include "kind" and "rationale" on parallel siblings; ordinary cards omit them.

SKILL.md:
${skill}${repair}`;
}

function checkerPrompt({ skill, cards }) {
  return `You are an independent decomposition checker for Agent Conductor v3.

You receive the original SKILL.md and candidate cards.
The composer is not trusted. Check only the skill and the cards.

A good conductor card is a concrete, verifiable unit of work.
The instruction must require one primary markdown receipt at
\`.conductor/artifacts/<card-index>-<slugified-card-title>.md\`. The receipt is the single source of
truth for what the card did: work product, action record, or non-text support
reference list. Supporting files such as images, JSON, CSV, screenshots, PDFs, uploads,
or deploys must be referenced from the markdown receipt, not treated as
standalone primary artifacts. For image-producing cards, require the receipt to
embed every image from the card inline with markdown image syntax and list the
supporting image file paths.

FAIL if:
- any real work unit from the skill is missing
- any rule, criterion, warning, example, or background note became its own card
- a card is too broad to check honestly
- a card is too tiny and should be folded into another card
- a card mixes before/after work that cannot happen at one safe start point; request a split instead
- a card is impossible because it requires proof, results, or artifacts from a later action in the same card
- a card instruction only says to think/analyze/consider without producing an artifact or verifiable decision
- a card does not require the primary receipt to be \`.conductor/artifacts/<card-index>-<slugified-card-title>.md\`
- a title is unclear shorthand, unexplained jargon, an acronym-heavy label, or too vague for a user watching the board
- a title is longer than 40 characters unless shortening it would make it unclear
- output format, deliverables, constraints, warnings, or examples from the skill were lost
- a card collapses collection scope from the skill: if the skill says work applies
  "per page," "for each," "every," or across a family/batch/set, the card
  instruction must preserve that multiplicity. A card that says "create one image"
  when the skill says "create one image per page" has lost cardinality. Fail it
  and require the card to explicitly state the full scope.
- cards invent work not present in the skill
- a system-level condition field is present
- situational work is not folded into the instruction
- a situational instruction does not require evidence that the condition was evaluated

A card marked \`kind: "parallel"\` is a deliberate parallel sibling, not a too-tiny
card — do NOT fold it. Verify instead that it produces its own distinct named
artifact and shares its upstream with its siblings, with no sibling's output feeding
another. Fold or fail it only if it has no distinct output, duplicates a sibling, or
its siblings actually depend on one another. The too-tiny rule still applies to
unmarked small cards; the cardinality rule still fails a generic or large collection
that has lost its multiplicity.

PASS only if the cards faithfully compile the skill into verifiable work.

For cards with situational instructions, PASS if the instruction requires an
artifact proving the condition was checked against real evidence and either the
required work was completed or non-applicability was justified with concrete
evidence. FAIL if the condition is not evaluated, the card claims "not
applicable" without showing why, or the work was needed but not performed. A
card that correctly determines it has nothing to do and documents why is a valid
pass.

Inspect the whole skill and current card set. Give surgical feedback: name the
specific card to patch, add, merge, or delete. Prefer preserving correct cards
over rewriting the deck. If the current deck has reasonable altitude, say so in
preserve and do not encourage compression.

Return passed for cards whose title and instruction are already correct and
should stay done in later repair attempts. Return unfinished for the remaining
work. Do not list a card in passed if it appears in unfinished or blocking_issues.
Do not pass standalone rule/invariant cards that should be folded into executable
cards.

Return JSON only as:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short repair guidance",
  "passed": [
    {
      "card": 0,
      "title": "exact current card title",
      "reason": "why this card is done"
    }
  ],
  "unfinished": [
    {
      "card": 0,
      "title": "card title if applicable",
      "problem": "what is still wrong or missing",
      "needed": "what the composer should add, patch, merge, or delete"
    }
  ],
  "blocking_issues": [
    {
      "type": "missing_work_unit | misplaced_rule_card | too_broad | too_tiny | vague_output | impossible_card | lost_requirement | invented_work",
      "card": 0,
      "title": "card title if applicable",
      "skill_quote": "exact relevant quote from SKILL.md if applicable",
      "problem": "specific problem",
      "required_repair": "specific change the composer should make"
    }
  ],
  "preserve": ["cards or sequences that are already good and should not be rewritten"],
  "repair_prompt": "direct instructions for the next composer attempt",
  "issues": ["specific issue"],
  "missing": ["missing work unit"],
  "too_broad": ["card title or description"],
  "too_tiny": ["card title or description"],
  "misplaced": ["rule/criterion/background that became a card"]
}

SKILL.md:
${skill}

Candidate cards:
${JSON.stringify(cards, null, 2)}`;
}

async function callOpenAI(prompt, { model = DEFAULT_MODEL } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for conductor-board decompose");
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI response ${response.status}: ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text);
  return json.output_text || json.output?.flatMap((o) => o.content || []).map((c) => c.text || "").join("") || "";
}

function commandExists(cmd) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", stdio: "ignore" });
  return r.status === 0;
}

function callCodexExec(prompt, { role, attempt }) {
  if (process.env.CONDUCTOR_DECOMPOSE_CODEX === "0") return null;
  if (!commandExists("codex")) return null;

  const outFile = path.join(os.tmpdir(), `conductor-decompose-${process.pid}-${role}-${attempt}-${Date.now()}.txt`);
  const args = [
    "exec",
    "-",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-last-message",
    outFile,
  ];
  const model = process.env.CONDUCTOR_DECOMPOSE_MODEL;
  if (model) args.splice(1, 0, "--model", model);

  const r = spawnSync("codex", args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      CONDUCTOR_DECOMPOSE_ROLE: role,
      CONDUCTOR_DECOMPOSE_ATTEMPT: String(attempt),
    },
  });
  const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : r.stdout;
  fs.rmSync(outFile, { force: true });
  if (r.status !== 0) {
    throw new Error(`codex exec failed (${r.status}): ${(r.stderr || r.stdout || "").trim().slice(0, 1200)}`);
  }
  return output;
}

function callCommand(prompt, { role, attempt }) {
  const cmd = process.env.CONDUCTOR_DECOMPOSE_COMMAND;
  if (!cmd) return null;
  const r = spawnSync(cmd, [], {
    input: prompt,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, CONDUCTOR_DECOMPOSE_ROLE: role, CONDUCTOR_DECOMPOSE_ATTEMPT: String(attempt) },
  });
  if (r.status !== 0) {
    throw new Error(`CONDUCTOR_DECOMPOSE_COMMAND failed (${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  return r.stdout;
}

function callFixture(_prompt, { role, attempt }) {
  const dir = process.env.CONDUCTOR_DECOMPOSE_FIXTURES;
  if (!dir) return null;
  const file = path.resolve(dir, `${role}-${attempt}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`missing decomposition fixture: ${file}`);
  }
  return fs.readFileSync(file, "utf8");
}

export async function callModel(prompt, meta) {
  const fixture = callFixture(prompt, meta);
  if (fixture !== null) return fixture;
  const command = callCommand(prompt, meta);
  if (command !== null) return command;
  const codex = callCodexExec(prompt, meta);
  if (codex !== null) return codex;
  return callOpenAI(prompt, meta);
}

function passedList(passedState) {
  return [...passedState.values()].map((item) => ({
    title: item.card.title,
    instruction: item.card.instruction,
    passed_at_attempt: item.passed_at_attempt,
    reason: item.reason,
  })).map((item) => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)));
}

function resolveCardRef(cards, ref) {
  const index = Number(ref?.card);
  if (Number.isInteger(index) && index >= 0 && index < cards.length) return { index, card: cards[index] };
  const title = compact(ref?.title || ref);
  if (!title) return null;
  const found = cards.findIndex((card) => card.title === title);
  if (found === -1) return null;
  return { index: found, card: cards[found] };
}

function unfinishedTitles(check, cards) {
  const blocked = new Set();
  for (const item of check.unfinished || []) {
    const byTitle = compact(item.title);
    if (byTitle) blocked.add(byTitle);
    const index = Number(item.card);
    if (Number.isInteger(index) && index >= 0 && index < cards.length) blocked.add(cards[index].title);
  }
  for (const issue of check.blocking_issues || []) {
    const byTitle = compact(issue.title);
    if (byTitle) blocked.add(byTitle);
    const index = Number(issue.card);
    if (Number.isInteger(index) && index >= 0 && index < cards.length) blocked.add(cards[index].title);
  }
  return blocked;
}

function updatePassed(passedState, check, cards, attempt) {
  const unfinished = unfinishedTitles(check, cards);
  for (const title of unfinished) passedState.delete(title);

  const refs = [];
  for (const ref of check.passed_cards || []) refs.push(ref);
  for (const ref of refs) {
    const resolved = resolveCardRef(cards, ref);
    if (!resolved) continue;
    const key = resolved.card.title;
    if (unfinished.has(key)) continue;
    if (passedState.has(key)) continue;
    passedState.set(key, {
      key,
      original_index: resolved.index,
      card: { ...resolved.card },
      reason: compact(ref.reason) || "checker passed this card",
      passed_at_attempt: attempt,
    });
  }
}

function applyPassed(cards, passedState) {
  const next = cards.map((card) => ({ ...card }));
  const events = [];
  for (const passed of passedState.values()) {
    const index = next.findIndex((card) => card.title === passed.card.title);
    if (index !== -1) {
      const current = next[index];
      if (JSON.stringify(current) !== JSON.stringify(passed.card)) {
        next[index] = { ...passed.card };
        events.push({ type: "restored_changed_passed_card", title: passed.card.title });
      }
      continue;
    }

    const insertAt = Math.min(Math.max(passed.original_index, 0), next.length);
    next.splice(insertAt, 0, { ...passed.card });
    events.push({ type: "restored_deleted_passed_card", title: passed.card.title, index: insertAt });
  }
  return { cards: next, events };
}

export async function composeAndCheckSkill(skill, {
  maxAttempts = 5,
  model = DEFAULT_MODEL,
  initialAttempts = [],
  initialCards = null,
  initialPassedCards = [],
  initialFeedback = "",
  progress,
  debugDir,
} = {}) {
  const attempts = [...initialAttempts];
  let previousCards = initialCards;
  let checkerFeedback = initialFeedback;
  const passedState = new Map();
  for (const [index, item] of initialPassedCards.entries()) {
    if (!item?.title || !item?.instruction) continue;
    passedState.set(item.title, {
      key: item.title,
      original_index: index,
      card: { title: item.title, instruction: item.instruction },
      reason: compact(item.reason) || "passed in previous decomposition attempt",
      passed_at_attempt: item.passed_at_attempt || item.locked_at_attempt || attempts.length,
    });
  }

  for (let attempt = attempts.length + 1; attempt <= maxAttempts; attempt++) {
    progress?.({ phase: "cards", event: "compose-start", attempt, maxAttempts });
    const composePrompt = composerPrompt({
      skill,
      previousCards,
      checkerFeedback,
      passedCards: passedList(passedState),
      attempt,
      maxAttempts,
    });
    writeDebugFile(debugDir, `attempt-${attempt}-compose-prompt.md`, composePrompt);
    const rawCompose = await callModel(composePrompt, {
      role: "composer",
      attempt,
      model,
    });
    writeDebugFile(debugDir, `attempt-${attempt}-compose-raw.txt`, rawCompose);
    const candidateCards = normalizeCards(extractJson(rawCompose));
    const passedEnforcement = applyPassed(candidateCards, passedState);
    const cards = passedEnforcement.cards;
    writeDebugFile(debugDir, `attempt-${attempt}-cards.json`, cards);
    progress?.({
      phase: "cards",
      event: "compose-end",
      attempt,
      maxAttempts,
      cards: cards.length,
      locked: passedState.size,
    });

    progress?.({ phase: "cards", event: "check-start", attempt, maxAttempts, cards: cards.length });
    const checkPrompt = checkerPrompt({ skill, cards });
    writeDebugFile(debugDir, `attempt-${attempt}-check-prompt.md`, checkPrompt);
    const rawCheck = await callModel(checkPrompt, {
      role: "checker",
      attempt,
      model,
    });
    writeDebugFile(debugDir, `attempt-${attempt}-check-raw.txt`, rawCheck);
    const check = normalizeChecker(extractJson(rawCheck));
    writeDebugFile(debugDir, `attempt-${attempt}-check.json`, check);
    updatePassed(passedState, check, cards, attempt);
    progress?.({
      phase: "cards",
      event: "check-end",
      attempt,
      maxAttempts,
      cards: cards.length,
      locked: passedState.size,
      passed: check.passed,
      feedback: repairFeedback(check) || check.feedback || check.repair_prompt,
    });
    attempts.push({
      attempt,
      cards,
      check,
      passed_enforcement: passedEnforcement.events,
      passed_cards: passedList(passedState),
    });

    if (check.passed) return { cards, report: { ok: true, attempts, final: check, passed_cards: passedList(passedState) } };

    previousCards = cards;
    checkerFeedback = repairFeedback(check);
  }

  const final = attempts.at(-1)?.check || null;
  return { cards: attempts.at(-1)?.cards || [], report: { ok: false, attempts, final, passed_cards: passedList(passedState) } };
}

function repairFeedback(check) {
  const lines = [];
  if (check.feedback) lines.push(`Checker summary: ${check.feedback}`);
  if (check.repair_prompt) lines.push(`Repair prompt: ${check.repair_prompt}`);
  if (check.passed_cards?.length) {
    lines.push("Passed cards are done. Keep them unchanged:");
    for (const item of check.passed_cards) {
      const label = item.title || (item.card !== undefined ? `card ${item.card}` : "");
      if (label) lines.push(`- ${label}${item.reason ? `: ${item.reason}` : ""}`);
    }
  } else if (check.preserve?.length) {
    lines.push("Preserve these good parts:");
    for (const item of check.preserve) lines.push(`- ${item}`);
  }
  if (check.unfinished?.length) {
    lines.push("Finish these unfinished cards or work units:");
    for (const [i, item] of check.unfinished.entries()) {
      const label = item.title || (item.card !== undefined ? `card ${item.card}` : `item ${i + 1}`);
      lines.push(`${i + 1}. ${label}`);
      if (item.problem) lines.push(`   problem: ${item.problem}`);
      if (item.needed) lines.push(`   needed: ${item.needed}`);
    }
  }
  if (check.blocking_issues?.length) {
    lines.push("Blocking details. Preserve passed cards and current altitude:");
    for (const [i, issue] of check.blocking_issues.entries()) {
      lines.push(`${i + 1}. ${issue.type}${issue.title ? ` (${issue.title})` : ""}`);
      if (issue.card !== undefined && issue.card !== null && issue.card !== "") lines.push(`   card: ${issue.card}`);
      if (issue.skill_quote) lines.push(`   skill quote: ${issue.skill_quote}`);
      if (issue.problem) lines.push(`   problem: ${issue.problem}`);
      if (issue.required_repair) lines.push(`   required repair: ${issue.required_repair}`);
    }
  }
  for (const issue of check.issues) lines.push(`issue: ${issue}`);
  for (const missing of check.missing) lines.push(`missing: ${missing}`);
  for (const item of check.too_broad) lines.push(`too broad: ${item}`);
  for (const item of check.too_tiny) lines.push(`too tiny: ${item}`);
  for (const item of check.misplaced) lines.push(`misplaced: ${item}`);
  return lines.filter(Boolean).join("\n");
}

export async function runDecompose(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board decompose --skill <path> [--out .conductor/cards.json] [--max-attempts 5] [--resume report.json]\n\n" +
        "  Uses a composer model to convert SKILL.md into cards.json, then an\n" +
        "  independent checker model audits the decomposition. On FAIL, the composer\n" +
        "  repairs the cards and the loop repeats. There is no heuristic fallback.\n\n" +
        "  Uses local `codex exec` by default. Override with CONDUCTOR_DECOMPOSE_COMMAND\n" +
        "  or disable Codex with CONDUCTOR_DECOMPOSE_CODEX=0 and use OPENAI_API_KEY.",
    );
    return true;
  }

  const skill = flag(args, ["--skill", "-s"]);
  if (typeof skill !== "string") {
    console.error(red("usage: conductor-board decompose --skill <path> [--out .conductor/cards.json]"));
    return false;
  }

  const skillPath = path.resolve(process.cwd(), skill);
  if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) {
    console.error(red(`✗ skill file not found: ${path.relative(process.cwd(), skillPath)}`));
    return false;
  }

  const maxAttempts = Number(flag(args, ["--max-attempts"], 5)) || 5;
  const out = path.resolve(process.cwd(), flag(args, ["--out", "-o"]) || ".conductor/cards.json");
  const reportPath = path.join(path.dirname(out), "decomposition-check.json");
  const debugDir = path.join(path.dirname(out), "debug", "cards");
  const resumeArg = flag(args, ["--resume"]);
  let resume = {};
  if (typeof resumeArg === "string") {
    const resumePath = path.resolve(process.cwd(), resumeArg);
    try {
      const prior = JSON.parse(fs.readFileSync(resumePath, "utf8"));
      const priorCardsPath = path.join(path.dirname(resumePath), "cards.json");
      resume = {
        initialAttempts: Array.isArray(prior.attempts) ? prior.attempts : [],
        initialCards: fs.existsSync(priorCardsPath) ? normalizeCards(JSON.parse(fs.readFileSync(priorCardsPath, "utf8"))) : null,
        initialPassedCards: Array.isArray(prior.passed_cards) ? prior.passed_cards : [],
        initialFeedback: repairFeedback(normalizeChecker(prior.final || { verdict: "FAIL", feedback: "continue decomposition" })),
      };
      if (resume.initialAttempts.length >= maxAttempts) {
        console.error(red(`✗ resume report already has ${resume.initialAttempts.length} attempts; set --max-attempts higher`));
        return false;
      }
    } catch (e) {
      console.error(red(`✗ could not resume decomposition: ${e.message}`));
      return false;
    }
  }

  let detail;
  try {
    detail = await composeAndCheckSkill(fs.readFileSync(skillPath, "utf8"), {
      maxAttempts,
      model: String(flag(args, ["--model"], DEFAULT_MODEL)),
      debugDir,
      ...resume,
    });
  } catch (e) {
    console.error(red(`✗ decompose failed: ${e.message}`));
    return false;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(detail.cards, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(detail.report, null, 2));

  console.log("");
  console.log(green(`✓ composed ${path.basename(skillPath)} into ${detail.cards.length} card${detail.cards.length === 1 ? "" : "s"}`));
  console.log(dim(`  attempts: ${detail.report.attempts.length}/${maxAttempts}`));
  console.log(dim(`  wrote ${path.relative(process.cwd(), out)}`));
  console.log(dim(`  wrote ${path.relative(process.cwd(), reportPath)}`));
  for (const card of detail.cards) console.log(dim(`  - ${card.title}`));

  if (!detail.report.ok) {
    const feedback = detail.report.final?.feedback || "checker failed decomposition";
    console.error(red(`✗ independent decomposition checker failed: ${feedback}`));
    const blocking = detail.report.final?.blocking_issues || [];
    for (const issue of blocking.slice(0, 5)) {
      const label = issue.title || issue.type || "issue";
      const repair = issue.required_repair || issue.problem;
      if (repair) console.error(red(`  - ${label}: ${repair}`));
    }
    console.log("");
    return false;
  }

  console.log("");
  return true;
}
