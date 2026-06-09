import fs from "node:fs";
import path from "node:path";
import { parseCardsJson } from "./cards.js";
import { callModel, compact, extractJson, flag } from "./decompose.js";
import { validateConductor } from "./validate.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const DEFAULT_MODEL = process.env.CONDUCTOR_DECOMPOSE_MODEL || process.env.OPENAI_MODEL || "gpt-5";

function workflowNameFromCardsPath(cardsPath) {
  const parent = path.basename(path.dirname(path.dirname(cardsPath)));
  return parent && parent !== "." ? parent : "workflow";
}

function normalizeWorkflow(payload, cards, { name, description, maxAttempts }) {
  const raw = payload?.steps || payload?.workflow?.steps || payload?.cards || payload;
  if (!Array.isArray(raw)) throw new Error("order composer JSON must include steps: [...]");
  if (raw.length !== cards.length) {
    throw new Error(`Rule 1 broken: order composer returned ${raw.length} step(s), expected ${cards.length}. Return one step for every accepted card, in the same array order.`);
  }
  const steps = raw.map((step, index) => {
    const requires = Array.isArray(step?.requires) ? step.requires : [];
    const normalizedRequires = requires.map((dep) => {
      const n = Number(dep);
      if (!Number.isInteger(n)) {
        throw new Error(`Rule 2 broken: card ${index} has non-integer dependency "${dep}". requires must contain integer card indexes only, for example [0, 2], never titles or ids.`);
      }
      return n;
    });
    return {
      title: cards[index].title,
      instruction: cards[index].instruction,
      summary: cards[index].summary,
      requires: normalizedRequires,
    };
  });
  return {
    conductor: "3.0.0",
    name,
    description,
    max_attempts: maxAttempts,
    steps,
  };
}

function normalizeCheck(payload) {
  const verdict = compact(payload?.verdict || payload?.result || payload?.status).toUpperCase();
  if (verdict !== "PASS" && verdict !== "FAIL") throw new Error("order checker JSON must include verdict: PASS or FAIL");
  const rawIssues = Array.isArray(payload?.violations) ? payload.violations : payload?.blocking_issues;
  const blocking = Array.isArray(rawIssues)
    ? rawIssues.map((issue) => {
        if (typeof issue === "string") return { problem: compact(issue), required_repair: compact(issue) };
        const implementation = Array.isArray(issue?.implementation)
          ? issue.implementation.map(compact).filter(Boolean).join("\n")
          : compact(issue?.implementation);
        return {
          rule: compact(issue?.rule),
          card: issue?.card,
          from: Number.isInteger(Number(issue?.from)) ? Number(issue.from) : undefined,
          to: Number.isInteger(Number(issue?.to)) ? Number(issue.to) : undefined,
          title: compact(issue?.title),
          problem: compact(issue?.what_happened || issue?.problem),
          reference: compact(issue?.reference),
          required_repair: compact(issue?.required_repair || issue?.needed || issue?.repair || implementation),
        };
      }).filter((issue) => issue.problem || issue.required_repair)
    : [];
  return {
    verdict,
    passed: verdict === "PASS",
    feedback: compact(payload?.feedback || payload?.reasoning || payload?.evidence || payload?.reason),
    blocking_issues: blocking,
    repair_prompt: compact(payload?.repair_prompt),
    approved_edges: Array.isArray(payload?.approved_edges)
      ? payload.approved_edges
          .map((edge) => ({
            from: Number(edge?.from),
            to: Number(edge?.to),
          }))
          .filter((edge) => Number.isInteger(edge.from) && Number.isInteger(edge.to))
      : [],
  };
}

function normalizeAudit(payload) {
  const verdict = compact(payload?.verdict || payload?.result || payload?.status).toUpperCase();
  if (verdict !== "PASS" && verdict !== "FAIL") throw new Error("order auditor JSON must include verdict: PASS or FAIL");
  const samples = Array.isArray(payload?.samples)
    ? payload.samples.map((sample) => ({
        type: compact(sample?.type),
        card: sample?.card,
        other_card: sample?.other_card,
        verdict: compact(sample?.verdict).toUpperCase(),
        reasoning: compact(sample?.reasoning || sample?.reason),
      })).filter((sample) => sample.reasoning || sample.verdict)
    : [];
  const issues = Array.isArray(payload?.issues)
    ? payload.issues.map((issue) => {
        if (typeof issue === "string") return { problem: compact(issue), required_repair: compact(issue) };
        return {
          card: issue?.card,
          other_card: issue?.other_card,
          problem: compact(issue?.problem),
          required_repair: compact(issue?.required_repair || issue?.needed || issue?.repair),
        };
      }).filter((issue) => issue.problem || issue.required_repair)
    : [];
  return {
    verdict,
    passed: verdict === "PASS",
    feedback: compact(payload?.feedback || payload?.reasoning || payload?.evidence || payload?.reason),
    samples,
    issues,
  };
}

function writeDebugFile(debugDir, name, value) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const file = path.join(debugDir, name);
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(file, body);
}

function edgeKey(edge) {
  return `${edge.from}->${edge.to}`;
}

function workflowEdges(workflow) {
  const out = [];
  for (const [to, step] of (workflow?.steps || []).entries()) {
    for (const from of step.requires || []) out.push({ from, to });
  }
  return out;
}

export function applyLockedEdges(workflow, lockedEdges) {
  if (!lockedEdges.size) return { workflow, restored: [] };
  const next = {
    ...workflow,
    steps: workflow.steps.map((step) => ({ ...step, requires: [...(step.requires || [])] })),
  };
  const restored = [];
  for (const edge of lockedEdges.values()) {
    const step = next.steps[edge.to];
    if (!step || !next.steps[edge.from]) continue;
    if (!step.requires.includes(edge.from)) {
      step.requires.push(edge.from);
      step.requires.sort((a, b) => a - b);
      restored.push(edge);
    }
  }
  return { workflow: next, restored };
}

function violationEdgeKeys(check, workflow) {
  const keys = new Set();
  for (const issue of check?.blocking_issues || []) {
    if (Number.isInteger(issue.from) && Number.isInteger(issue.to)) {
      keys.add(edgeKey(issue));
      continue;
    }
    const to = Number(issue.card);
    if (Number.isInteger(to) && workflow?.steps?.[to]) {
      for (const from of workflow.steps[to].requires || []) keys.add(edgeKey({ from, to }));
    }
  }
  return keys;
}

export function updateLockedEdges(lockedEdges, workflow, check, attempt) {
  const violated = violationEdgeKeys(check, workflow);
  for (const key of violated) lockedEdges.delete(key);
  const approved = check.approved_edges?.length
    ? check.approved_edges
    : workflowEdges(workflow).filter((edge) => !violated.has(edgeKey(edge)));
  for (const edge of approved) {
    if (!workflow.steps?.[edge.to] || !workflow.steps?.[edge.from]) continue;
    if (violated.has(edgeKey(edge))) continue;
    if (!workflow.steps[edge.to].requires.includes(edge.from)) continue;
    lockedEdges.set(edgeKey(edge), { ...edge, approved_at_attempt: attempt });
  }
}

function lockedEdgesList(lockedEdges) {
  return [...lockedEdges.values()].sort((a, b) => a.to - b.to || a.from - b.from);
}

export function listLockedEdges(lockedEdges) {
  return lockedEdgesList(lockedEdges);
}

function orderComposerPrompt({ cards, previousWorkflow, checkerFeedback, lockedEdges, attempt, maxAttempts }) {
  const repair = previousWorkflow
    ? `\n\nPrevious workflow.json:\n${JSON.stringify(previousWorkflow, null, 2)}\n\nIndependent order checker feedback:\n${checkerFeedback}`
    : "";
  const locks = lockedEdges?.length
    ? `\n\nApproved locked edges:\n${JSON.stringify(lockedEdges, null, 2)}\n\nApproved edges are locked. Copy them exactly into your output. Do not change, remove, or reorder locked edges. Only modify edges the checker flagged as violations. If you believe a locked edge is wrong, you may not change it — only the checker can unlock an edge by explicitly listing it as a violation with a reason.`
    : "";
  const pressure = attempt >= maxAttempts
    ? "\nLAST CHANCE: repair every dependency issue. Do not return until the dependency graph should pass.\n"
    : attempt >= 3
      ? "\nRepair surgically. Do not rewrite card text. Only change requires arrays.\n"
      : "";
  return `You are mapping Agent Conductor v3 card dependencies.

Input cards are already accepted. Do not rename, rewrite, delete, add, or reorder cards.
Return the same number of steps in the same order. Add requires arrays. Do not add condition fields.

Hard JSON contract:
- requires is an array of integer card indexes only.
- Never put card titles, ids, labels, strings, or objects inside requires.
- Correct: { "requires": [0, 2] }
- Wrong: { "requires": ["Read SEO runbooks", "Resolve treatment scope"] }
- The card identity is its array index. Card 0 is the first card below, card 1 is the second card, and so on.

Your job is to turn accepted cards into the safest shortest runnable order.

Build the route layer by layer:
1. Identify the cards that can start from the original input/context.
2. Freeze that layer unless later evidence proves it wrong.
3. Assume frozen layers are done, then identify the next cards that can start.
4. Continue until every card is placed.
5. Convert the layers into requires arrays. Do not make a card require a whole previous layer by default; require only the cards whose outputs it truly needs.

Pass rules to satisfy:
Rule 1: All work is still represented.
Rule 2: Cards wait only when they must.
Rule 3: Cards that can run together are not forced into a chain.
Rule 4: Situational cards are placed where their situation can be evaluated.

Treat every card as executable. There are no conditional cards at the system
level. Order situational cards at the point in the workflow where their
condition can be evaluated, after the cards whose outputs determine whether the
situation applies.
${pressure}
Return JSON only as:
{
  "steps": [
    { "requires": [] },
    { "requires": [0] },
    { "requires": [0, 1] }
  ]
}

Cards:
${JSON.stringify(cards, null, 2)}${locks}${repair}`;
}

function orderCheckerPrompt({ cards, workflow, lockedEdges = [], attempt = 1, maxAttempts = 5 }) {
  const repairMode = attempt >= 5
    ? `
Because this dependency loop has reached attempt ${attempt}/${maxAttempts}, the checker and composer must work together to get the workflow through.
If the graph fails, feedback must be concrete, worded, and operational.

For every violation, cite the rule number first, then give the concrete repair.
`
    : "";
  return `You are an independent dependency checker for Agent Conductor v3.

You receive accepted cards and a candidate workflow with requires arrays.
This is the only dependency judge. Do not say "looks good." Check whether the graph creates the safest shortest runnable order.

Stable pass rules:
Rule 1: All work is still represented.
Rule 2: Cards wait only when they must.
Rule 3: Cards that can run together are not forced into a chain.
Rule 4: Situational cards are placed where their situation can be evaluated.

Treat every card as executable. There are no conditional cards at the system
level. A situational card still runs and writes an artifact proving either the
work was needed and done, or no action was needed. It should be ordered after
the cards whose outputs let it evaluate that situation.

Fail only when one of the four rules is violated. The first words of every violation must name the rule, for example "Rule 2: Cards wait only when they must."

Reference edges by integer indexes only. An edge is { "from": dependencyCardIndex, "to": dependentCardIndex }.
Never identify edges by title. Titles may be included as explanation only.

Previously approved locked edges:
${JSON.stringify(lockedEdges, null, 2)}

If a locked edge is wrong, you MUST explicitly list that exact {from,to} edge
as a violation with a rule-numbered reason. No silent reversals.
${repairMode}

Return JSON only as:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short dependency guidance that starts with violated rule numbers when failing",
  "approved_edges": [
    { "from": 0, "to": 1 }
  ],
  "violations": [
    {
      "rule": "Rule 2: Cards wait only when they must.",
      "from": 0,
      "to": 1,
      "card": 0,
      "title": "card title if applicable",
      "what_happened": "specific dependency problem",
      "reference": "quote or paraphrase the card instruction/output need that proves this",
      "implementation": [
        "specific requires change"
      ]
    }
  ],
  "repair_prompt": "direct instructions for the next order composer attempt"
}

Cards:
${JSON.stringify(cards, null, 2)}

Candidate workflow:
${JSON.stringify(workflow, null, 2)}`;
}

export async function checkWorkflowWithDependencyGuard(workflow, {
  cards,
  lockedEdges = new Map(),
  attempt = 1,
  maxAttempts = 5,
  model = DEFAULT_MODEL,
  updateLocks = true,
} = {}) {
  const validationErrors = validateConductor(workflow);
  if (validationErrors.length) {
    return {
      check: {
        verdict: "FAIL",
        passed: false,
        feedback: "workflow failed structural validation",
        blocking_issues: validationErrors.map((e) => ({ problem: e, required_repair: e })),
        approved_edges: [],
      },
      lockedEdges,
    };
  }
  const checkPrompt = orderCheckerPrompt({
    cards,
    workflow,
    lockedEdges: lockedEdgesList(lockedEdges),
    attempt,
    maxAttempts,
  });
  const rawCheck = await callModel(checkPrompt, {
    role: "order-checker",
    attempt,
    model,
  });
  const check = normalizeCheck(extractJson(rawCheck));
  if (updateLocks) updateLockedEdges(lockedEdges, workflow, check, attempt);
  return { check, lockedEdges };
}

function sampleAuditItems(workflow, sampleSize) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  const byDepCount = steps.map((step, index) => ({ index, count: (step.requires || []).length }));
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const dep of steps[from]?.requires || []) {
      if (dep === target || reaches(dep, target, seen)) return true;
    }
    return false;
  };
  const roots = byDepCount.filter((x) => x.count === 0).slice(0, 2).map((x) => ({ type: "root", card: x.index }));
  const highDeps = [...byDepCount].sort((a, b) => b.count - a.count).filter((x) => x.count > 0).slice(0, 2)
    .map((x) => ({ type: "high-dependency", card: x.index }));
  const middle = byDepCount.filter((x) => x.count > 0 && x.count < Math.max(...byDepCount.map((y) => y.count), 0)).slice(0, 2)
    .map((x) => ({ type: "middle", card: x.index }));
  const pair = [];
  outer: for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      if (!reaches(i, j) && !reaches(j, i)) {
        pair.push({ type: "parallel-pair", card: i, other_card: j });
        break outer;
      }
    }
  }
  const seen = new Set();
  const combined = [...roots, ...highDeps, ...middle, ...pair].filter((item) => {
    const key = `${item.type}:${item.card}:${item.other_card ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return combined.slice(0, sampleSize);
}

function orderAuditPrompt({ workflow, samples }) {
  const stepSummary = workflow.steps.map((step, index) => ({
    card: index,
    title: step.title,
    instruction: step.instruction,
    requires: step.requires || [],
  }));
  return `You are spot-auditing an Agent Conductor dependency graph.

Do not say "looks good." For each sampled item, answer the concrete question
with evidence from the card instructions.

Audit rules:
- Root card: can this card truly start without any previous output?
- High-dependency card: are all dependencies necessary, and are any prerequisites missing?
- Middle card: are its dependencies sufficient but not excessive?
- Parallel pair: can these two cards really run independently once their own dependencies are satisfied?

Coarse cards are allowed. Judge earliest safe start, not whether the card should
be split. FAIL if any sampled dependency is unnecessary, missing, unclear, or if
a sampled card has impossible_order because no single start point can satisfy its
own contradictory before/after requirements.

Return JSON only as:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "short overall audit result",
  "samples": [
    {
      "type": "root | high-dependency | middle | parallel-pair",
      "card": 0,
      "other_card": 1,
      "verdict": "PASS" | "FAIL",
      "reasoning": "specific why, naming required artifacts or absence of dependency"
    }
  ],
  "issues": [
    {
      "card": 0,
      "other_card": 1,
      "problem": "specific sampled problem",
      "required_repair": "specific requires change"
    }
  ]
}

Workflow cards:
${JSON.stringify(stepSummary, null, 2)}

Samples to audit:
${JSON.stringify(samples, null, 2)}`;
}

function repairFeedback(check) {
  const lines = [];
  if (check.feedback) lines.push(`Checker summary: ${check.feedback}`);
  if (check.repair_prompt) lines.push(`Repair prompt: ${check.repair_prompt}`);
  for (const [i, issue] of (check.blocking_issues || []).entries()) {
    lines.push(`${i + 1}. ${issue.rule || "Rule violation"} — ${issue.title || (issue.card !== undefined ? `card ${issue.card}` : "issue")}`);
    if (issue.problem) lines.push(`   problem: ${issue.problem}`);
    if (issue.reference) lines.push(`   reference: ${issue.reference}`);
    if (issue.required_repair) lines.push(`   required repair: ${issue.required_repair}`);
  }
  return lines.join("\n");
}

export async function orderAndCheckCards(cards, {
  name = "workflow",
  description = "Generated Agent Conductor workflow",
  maxAttempts = 5,
  runMaxAttempts = 5,
  auditSample = 0,
  model = DEFAULT_MODEL,
  progress,
  debugDir,
} = {}) {
  let previousWorkflow = null;
  let checkerFeedback = "";
  const attempts = [];
  const lockedEdges = new Map();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    progress?.({ phase: "dependencies", event: "compose-start", attempt, maxAttempts, cards: cards.length });
    const composePrompt = orderComposerPrompt({
      cards,
      previousWorkflow,
      checkerFeedback,
      lockedEdges: lockedEdgesList(lockedEdges),
      attempt,
      maxAttempts,
    });
    writeDebugFile(debugDir, `attempt-${attempt}-compose-prompt.md`, composePrompt);
    const rawCompose = await callModel(composePrompt, { role: "order-composer", attempt, model });
    writeDebugFile(debugDir, `attempt-${attempt}-compose-raw.txt`, rawCompose);
    let workflow;
    try {
      workflow = normalizeWorkflow(extractJson(rawCompose), cards, { name, description, maxAttempts: runMaxAttempts });
      const locked = applyLockedEdges(workflow, lockedEdges);
      workflow = locked.workflow;
      if (locked.restored.length) {
        writeDebugFile(debugDir, `attempt-${attempt}-locked-restored.json`, locked.restored);
      }
      writeDebugFile(debugDir, `attempt-${attempt}-workflow.json`, workflow);
      progress?.({
        phase: "dependencies",
        event: "compose-end",
        attempt,
        maxAttempts,
        cards: cards.length,
        dependencies: workflow.steps.reduce((n, step) => n + step.requires.length, 0),
      });
    } catch (e) {
      const check = {
        verdict: "FAIL",
        passed: false,
        feedback: "Rule 2 broken: order composer returned an invalid workflow shape",
        blocking_issues: [{
          rule: "Rule 2: Cards wait only when they must.",
          problem: e.message,
          reference: "The workflow JSON contract uses array index identity. requires must be integer indexes only.",
          required_repair: `Return exactly ${cards.length} steps in the same order as cards.json. Replace every title/id/string dependency with the matching integer card index.`,
        }],
      };
      attempts.push({ attempt, workflow: null, check });
      writeDebugFile(debugDir, `attempt-${attempt}-check.json`, check);
      progress?.({
        phase: "dependencies",
        event: "check-end",
        attempt,
        maxAttempts,
        passed: false,
        feedback: repairFeedback(check) || check.feedback,
      });
      checkerFeedback = repairFeedback(check);
      continue;
    }

    const validationErrors = validateConductor(workflow);
    if (validationErrors.length) {
      const check = {
        verdict: "FAIL",
        passed: false,
        feedback: "workflow failed structural validation",
        blocking_issues: validationErrors.map((e) => ({ problem: e, required_repair: e })),
      };
      attempts.push({ attempt, workflow, check });
      writeDebugFile(debugDir, `attempt-${attempt}-check.json`, check);
      progress?.({
        phase: "dependencies",
        event: "check-end",
        attempt,
        maxAttempts,
        passed: false,
        feedback: repairFeedback(check) || check.feedback,
      });
      previousWorkflow = workflow;
      checkerFeedback = repairFeedback(check);
      continue;
    }

    progress?.({ phase: "dependencies", event: "check-start", attempt, maxAttempts, cards: cards.length });
    const checkPrompt = orderCheckerPrompt({ cards, workflow, lockedEdges: lockedEdgesList(lockedEdges), attempt, maxAttempts });
    writeDebugFile(debugDir, `attempt-${attempt}-check-prompt.md`, checkPrompt);
    const rawCheck = await callModel(checkPrompt, {
      role: "order-checker",
      attempt,
      model,
    });
    writeDebugFile(debugDir, `attempt-${attempt}-check-raw.txt`, rawCheck);
    const check = normalizeCheck(extractJson(rawCheck));
    writeDebugFile(debugDir, `attempt-${attempt}-check.json`, check);
    attempts.push({ attempt, workflow, check });
    updateLockedEdges(lockedEdges, workflow, check, attempt);
    progress?.({
      phase: "dependencies",
      event: "check-end",
      attempt,
      maxAttempts,
      cards: cards.length,
      passed: check.passed,
      feedback: repairFeedback(check) || check.feedback || check.repair_prompt,
    });
    if (check.passed && auditSample > 0) {
      const samples = sampleAuditItems(workflow, auditSample);
      progress?.({ phase: "audit", event: "audit-start", attempt, maxAttempts, cards: workflow.steps.length, samples: samples.length });
      const auditPrompt = orderAuditPrompt({ workflow, samples });
      writeDebugFile(debugDir, `attempt-${attempt}-audit-prompt.md`, auditPrompt);
      const rawAudit = await callModel(auditPrompt, {
        role: "order-auditor",
        attempt,
        model,
      });
      writeDebugFile(debugDir, `attempt-${attempt}-audit-raw.txt`, rawAudit);
      const audit = normalizeAudit(extractJson(rawAudit));
      writeDebugFile(debugDir, `attempt-${attempt}-audit.json`, { samples, audit });
      progress?.({
        phase: "audit",
        event: "audit-end",
        attempt,
        maxAttempts,
        cards: workflow.steps.length,
        samples: samples.length,
        passed: audit.passed,
        feedback: audit.feedback,
      });
      attempts.at(-1).audit = audit;
      attempts.at(-1).audit_samples = samples;
      if (audit.passed) return { workflow, report: { ok: true, attempts, final: check, audit } };

      const auditCheck = {
        verdict: "FAIL",
        passed: false,
        feedback: `dependency spot audit failed: ${audit.feedback}`,
        blocking_issues: (audit.issues || []).map((issue) => ({
          card: issue.card,
          title: workflow.steps?.[issue.card]?.title,
          problem: issue.problem,
          required_repair: issue.required_repair,
        })),
        repair_prompt: [
          "The dependency checker passed, but the spot audit found concrete ordering defects.",
          "Repair only the sampled dependency defects below.",
          ...(audit.issues || []).map((issue) => {
            const title = workflow.steps?.[issue.card]?.title || `card ${issue.card}`;
            return `- ${title}: ${issue.required_repair || issue.problem}`;
          }),
        ].join("\n"),
      };
      attempts.at(-1).check = auditCheck;
      previousWorkflow = workflow;
      checkerFeedback = repairFeedback(auditCheck);
      continue;
    }
    if (check.passed) return { workflow, report: { ok: true, attempts, final: check } };
    previousWorkflow = workflow;
    checkerFeedback = repairFeedback(check);
  }

  return {
    workflow: attempts.at(-1)?.workflow || normalizeWorkflow({ steps: cards.map(() => ({ requires: [] })) }, cards, {
      name,
      description,
      maxAttempts: runMaxAttempts,
    }),
    report: { ok: false, attempts, final: attempts.at(-1)?.check || null },
  };
}

export async function auditWorkflow(workflow, {
  sampleSize = 6,
  model = DEFAULT_MODEL,
  progress,
} = {}) {
  const errors = validateConductor(workflow);
  if (errors.length) {
    return {
      ok: false,
      samples: [],
      audit: {
        verdict: "FAIL",
        passed: false,
        feedback: "workflow failed structural validation",
        samples: [],
        issues: errors.map((e) => ({ problem: e, required_repair: e })),
      },
    };
  }

  const samples = sampleAuditItems(workflow, sampleSize);
  progress?.({ phase: "audit", event: "audit-start", attempt: 1, maxAttempts: 1, cards: workflow.steps.length, samples: samples.length });
  const raw = await callModel(orderAuditPrompt({ workflow, samples }), {
    role: "order-auditor",
    attempt: 1,
    model,
  });
  const audit = normalizeAudit(extractJson(raw));
  progress?.({
    phase: "audit",
    event: "audit-end",
    attempt: 1,
    maxAttempts: 1,
    cards: workflow.steps.length,
    samples: samples.length,
    passed: audit.passed,
    feedback: audit.feedback,
  });
  return { ok: audit.passed, samples, audit };
}

export async function runOrder(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board order [--cards .conductor/cards.json] [--out .conductor/workflow.json] [--max-attempts 5]\n\n" +
        "  Uses a composer model to add requires arrays to accepted cards, then an\n" +
        "  independent checker audits the dependency graph. The loop repeats until\n" +
        "  the graph is minimal, acyclic, and preserves parallelism.",
    );
    return true;
  }

  const cardsPath = path.resolve(process.cwd(), flag(args, ["--cards", "-c"]) || ".conductor/cards.json");
  if (!fs.existsSync(cardsPath)) {
    console.error(red(`✗ cards file not found: ${path.relative(process.cwd(), cardsPath)}`));
    return false;
  }

  let cards;
  try {
    cards = parseCardsJson(fs.readFileSync(cardsPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not parse cards.json: ${e.message}`));
    return false;
  }

  const out = path.resolve(process.cwd(), flag(args, ["--out", "-o"]) || path.join(path.dirname(cardsPath), "workflow.json"));
  const reportPath = path.join(path.dirname(out), "order-check.json");
  const maxAttempts = Number(flag(args, ["--max-attempts"], 5)) || 5;
  const runMaxAttempts = Number(flag(args, ["--run-max-attempts"], 5)) || 5;
  const name = compact(flag(args, ["--name", "-n"]) || workflowNameFromCardsPath(cardsPath));
  const description = compact(flag(args, ["--description", "-d"]) || `Workflow generated from ${path.basename(cardsPath)}`);

  let detail;
  try {
    detail = await orderAndCheckCards(cards, {
      name,
      description,
      maxAttempts,
      runMaxAttempts,
      model: String(flag(args, ["--model"], DEFAULT_MODEL)),
      debugDir: path.join(path.dirname(out), "debug", "dependencies"),
    });
  } catch (e) {
    console.error(red(`✗ order failed: ${e.message}`));
    return false;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(detail.workflow, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify(detail.report, null, 2));

  console.log("");
  console.log(green(`✓ ordered ${cards.length} card${cards.length === 1 ? "" : "s"} into ${path.relative(process.cwd(), out)}`));
  console.log(dim(`  attempts: ${detail.report.attempts.length}/${maxAttempts}`));
  console.log(dim(`  wrote ${path.relative(process.cwd(), reportPath)}`));
  for (const [i, step] of detail.workflow.steps.entries()) {
    console.log(dim(`  ${i}. ${step.title} requires [${step.requires.join(", ")}]`));
  }

  if (!detail.report.ok) {
    const feedback = detail.report.final?.feedback || "checker failed dependency graph";
    console.error(red(`✗ independent order checker failed: ${feedback}`));
    for (const issue of (detail.report.final?.blocking_issues || []).slice(0, 5)) {
      const label = issue.title || (issue.card !== undefined ? `card ${issue.card}` : "issue");
      const repair = issue.required_repair || issue.problem;
      if (repair) console.error(red(`  - ${label}: ${repair}`));
    }
    console.log("");
    return false;
  }

  console.log("");
  return true;
}

export async function runOrderAudit(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board order-audit [--workflow .conductor/workflow.json] [--sample 6]\n\n" +
        "  Spot-samples dependency decisions after order. The auditor must explain\n" +
        "  roots, high-dependency cards, middle cards, and parallel pairs with\n" +
        "  concrete evidence from the card instructions.",
    );
    return true;
  }

  const workflowPath = path.resolve(process.cwd(), flag(args, ["--workflow", "-w"]) || ".conductor/workflow.json");
  if (!fs.existsSync(workflowPath)) {
    console.error(red(`✗ workflow file not found: ${path.relative(process.cwd(), workflowPath)}`));
    return false;
  }

  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not parse workflow.json: ${e.message}`));
    return false;
  }

  const errors = validateConductor(workflow);
  if (errors.length) {
    for (const e of errors) console.error(red(`✗ ${e}`));
    return false;
  }

  const sampleSize = Number(flag(args, ["--sample", "-s"], 6)) || 6;
  const samples = sampleAuditItems(workflow, sampleSize);
  const reportPath = path.join(path.dirname(workflowPath), "order-audit.json");

  let report;
  try {
    report = await auditWorkflow(workflow, {
      sampleSize,
      model: String(flag(args, ["--model"], DEFAULT_MODEL)),
    });
  } catch (e) {
    console.error(red(`✗ order audit failed: ${e.message}`));
    return false;
  }

  const audit = report.audit;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("");
  console.log(`${audit.passed ? green("✓") : red("✗")} order audit ${audit.verdict.toLowerCase()}`);
  if (audit.feedback) console.log(dim(`  ${audit.feedback}`));
  console.log(dim(`  sampled ${samples.length} item${samples.length === 1 ? "" : "s"}`));
  for (const sample of audit.samples) {
    const label = sample.other_card !== undefined
      ? `${sample.type}: ${sample.card} ↔ ${sample.other_card}`
      : `${sample.type}: ${sample.card}`;
    console.log(dim(`  - ${label}: ${sample.verdict || "?"} ${sample.reasoning || ""}`.trimEnd()));
  }
  console.log(dim(`  wrote ${path.relative(process.cwd(), reportPath)}`));
  console.log("");

  if (!audit.passed) {
    for (const issue of audit.issues.slice(0, 5)) {
      const label = issue.other_card !== undefined ? `${issue.card} ↔ ${issue.other_card}` : `card ${issue.card ?? "?"}`;
      console.error(red(`  - ${label}: ${issue.required_repair || issue.problem}`));
    }
    console.log("");
    return false;
  }
  return true;
}
