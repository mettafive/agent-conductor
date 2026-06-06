/**
 * Skill → cards COVERAGE — the end-to-end test that was actually missing.
 *
 * Every other smoke test checks a downstream piece. THIS one starts from a REAL skill
 * file (SKILL.md + its runbook), extracts the work-units the skill actually performs
 * from its prose, reads the conductor that's supposed to model it, and reports which
 * work-units have NO card. It is the test that would have caught the paid-SEO recon +
 * findability omission from the real files — not a hand-authored inventory.
 *
 * Usage:
 *   node tests/skill-coverage.mjs                  # run the built-in real-skill corpus
 *   node tests/skill-coverage.mjs <conductor.json> <skillFile...>   # ad-hoc
 */
import fs from "node:fs";

// canonical work-unit ← trigger phrases that, if present in the SKILL TEXT, imply the unit does it
const TRIGGERS = {
  setup:       ["fresh branch", "checkout -b", "branch off origin", "git switch", "scratch dir"],
  pick:        ["pick ", "candidates from", "editorial queue", "build-enrichment-queue", "claim", "queue file", "pick-clinics", "next 5", "claim next"],
  recon:       ["dataforseo", "seo recon", "keyword volume", "search volume", "serp scrape", "pre-loop", "keyword research", "paid seo", "gsc"],
  research:    ["crawl", "multi-page", "om-oss", "scrape the", "research the", "read the site", "website crawl", "§4b", "current content"],
  write:       ["write the", "author", "compose", "rewrite", "enrich the", "de-jargon", "the description", "prose", "faq", "seo title", "lede"],
  check:        ["super-check", "check-enrich", "grounding check", "runallchecks", "preservation check", "the check", "qa check", "check-links"],
  stage:       ["dry-run", "stage the", "staged patch", "proposal json", "apply-clinic-enrichment", "before/after"],
  findability: ["clinic_treatment_matches", "findability", "link-existing", "internal link", "interlink", "searchable", "animal-correct link", "related treatment"],
  index:       ["indexing api", "index-treatments", "submit to google", "google indexing", "sitemap"],
  publish:     ["open a pr", "open the pr", "opens the pr", "pr opened", "commit and push", "apply to supabase", "patch supabase", "write the db", "write to db"],
  notify:      ["chat brief", "structured brief", "brief format", "final brief", "in-chat brief", "report "],
};

// canonical work-unit ← conductor step-id/name tokens (mention-in-prose does NOT count)
const STEP_ALIASES = {
  setup: ["setup","branch","init"], pick: ["pick","select","queue","claim"],
  recon: ["recon","keyword","dataforseo","serp"], research: ["research","crawl","gather","scrape","read"],
  write: ["write","author","enrich","rewrite","compose","generate","content"], check: ["check","validate","verify","audit","qa","check"],
  stage: ["stage","patch","package"], findability: ["findability","link","links","interlink","match","crossref"],
  index: ["index","indexing","sitemap"], publish: ["publish","pr","ship","deploy","commit","push","apply"],
  notify: ["notify","brief","report","summary","email","digest"],
};

const lower = (s) => s.toLowerCase();
const tok = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function skillUnits(text) {
  const hay = lower(text);
  return Object.entries(TRIGGERS).filter(([, ps]) => ps.some((p) => hay.includes(p))).map(([u]) => u);
}
function collectIds(steps, out = []) {
  for (const step of steps || []) {
    if (step?.id) out.push(step.id);
    if (Array.isArray(step?.steps)) collectIds(step.steps, out);
  }
  return out;
}
function conductorUnits(jsonText) {
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch {
    doc = {};
  }
  const ids = collectIds(doc.steps);
  const stepTokens = new Set(ids.flatMap(tok));
  return Object.entries(STEP_ALIASES).filter(([, al]) => al.some((a) => stepTokens.has(a))).map(([u]) => u);
}

// REAL skills shipped in this monorepo's sibling PrivatVet project.
const PV = "/Users/lukas/Documents/ClaudeCode/VetAndAdmin/PrivatVet";
const CORPUS = [
  { name: "daily-enrichment",
    conductor: `${PV}/.conductor/conductor.json`,
    skill: [`${PV}/.claude/skills/daily-enrichment/SKILL.md`, `${PV}/docs/clinic-enrichment-runbook.md`] },
  { name: "treatment-readability",
    conductor: `${PV}/.claude/skills/treatment-readability/treatment-readability.conductor.json`,
    skill: [`${PV}/.claude/skills/treatment-readability/SKILL.md`, `${PV}/docs/treatment-readability-runbook.md`] },
];

const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`,
  dim = (s) => `\x1b[2m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`, amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

function analyze(entry) {
  const skillText = entry.skill.map(read).filter(Boolean).join("\n\n");
  const jsonText = read(entry.conductor);
  if (!skillText || !jsonText) return { name: entry.name, error: `missing files (skill:${!!skillText} conductor:${!!jsonText})` };
  const sUnits = skillUnits(skillText);
  const cUnits = conductorUnits(jsonText);
  const gaps = sUnits.filter((u) => !cUnits.includes(u));
  return { name: entry.name, sUnits, cUnits, gaps };
}

const args = process.argv.slice(2);
const runs = args.length >= 2 ? [{ name: "ad-hoc", conductor: args[0], skill: args.slice(1) }] : CORPUS;

console.log(bold(`\n  Skill → cards coverage — does each conductor's cards cover the REAL skill?\n`));
let anyGap = false;
for (const entry of runs) {
  const r = analyze(entry);
  if (r.error) { console.log(`  ${red("ERR ")} ${r.name.padEnd(22)} ${dim(r.error)}`); continue; }
  const tag = r.gaps.length ? red("GAP ") : green("OK  ");
  if (r.gaps.length) anyGap = true;
  console.log(`  ${tag} ${bold(r.name)}`);
  console.log(`        skill does:   ${r.sUnits.join(", ")}`);
  console.log(`        conductor:    ${r.cUnits.join(", ")}`);
  if (r.gaps.length)
    console.log(`        ${amber(`UNCOVERED:    ${r.gaps.join(", ")}`)}  ${dim("→ each needs a card OR a logged exclusion")}`);
  console.log("");
}
// This is a REPORT, not a red/green pass — it surfaces gaps for the author to resolve.
console.log(dim(`  (uncovered = skill work-units with no conductor card. Resolve each: add a step, or log it as a deliberate exclusion.)\n`));
process.exit(anyGap ? 1 : 0);
