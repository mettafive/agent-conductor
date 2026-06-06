/**
 * Work-unit COVERAGE smoke test — 40 cases.
 *
 * Catches the class of bug that hid the paid-SEO recon + findability steps from the
 * daily-enrichment board: a conductor that models a skill SILENTLY OMITS real
 * work-units of that skill — especially INPUTS (recon) and OUTPUTS (findability,
 * index, notify) that don't produce the central artifact, and especially ones
 * FOLDED INTO another step's instruction prose (mention != coverage).
 *
 * The rule under test: every work-unit in the source skill's inventory must map to
 * a dedicated conductor STEP (matched by step id/name — NOT instruction prose) or be
 * a LOGGED exclusion. Anything else is an uncovered work-unit and must be flagged.
 *
 * Run:  node tests/coverage.smoke.mjs   (from agent-conductor/)
 */

// ── canonical work-unit vocabulary → step-name alias tokens ──────────────────
// A work-unit is COVERED iff some step's id/name contains one of its alias tokens.
// Instruction prose is intentionally NOT consulted: a unit "mentioned" inside another
// step's instruction is NOT covered (that is exactly how the SEO recon got lost).
// Token-equality match (a step-id token EQUALS an alias) — kept strict so short aliases
// like "pr" can't false-match "prices". Domain verbs (extract/transform/load, scan,
// collect, rewrite…) are spelled out so real step names resolve to their canonical unit.
const ALIASES = {
  setup:       ["setup", "branch", "init", "bootstrap", "scaffold"],
  pick:        ["pick", "select", "queue", "choose", "candidates", "claim"],
  recon:       ["recon", "keyword", "keywords", "dataforseo", "serp", "volume"],
  research:    ["research", "crawl", "investigate", "gather", "scrape", "discover", "read", "extract", "collect", "fetch", "scan", "introspect"],
  write:       ["write", "author", "draft", "compose", "enrich", "generate", "content", "rewrite", "edit", "transform", "train", "translate", "bump"],
  check:        ["check", "validate", "verify", "audit", "qa", "lint", "proofread", "review"],
  stage:       ["stage", "patch", "package", "assemble"],
  findability: ["findability", "link", "links", "interlink", "linking", "match", "crossref"],
  index:       ["index", "indexing", "sitemap", "ping"],
  publish:     ["publish", "pr", "ship", "deploy", "release", "commit", "push", "apply", "merge", "load", "store", "schedule", "snapshot"],
  notify:      ["notify", "brief", "report", "summary", "email", "announce", "digest", "slack", "send"],
  rollback:    ["rollback", "revert", "backup", "restore"],
  test:        ["test", "tests", "smoke", "e2e", "regression"],
  review:      ["review", "approve", "approval", "signoff"],
  measure:     ["measure", "metrics", "track", "analytics", "monitor"],
};

const tok = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * coverageGaps — the prevention, as a pure function.
 * @param workUnits  canonical work-unit keys the SKILL actually performs (ground truth)
 * @param steps      conductor steps: array of {id, name?}  (prose is NOT passed in — by design)
 * @param exclusions work-units explicitly logged as out-of-scope (visible, deliberate)
 * @returns the work-units left UNCOVERED (no dedicated step, not excluded)
 */
function coverageGaps({ workUnits, steps, exclusions = [] }) {
  const stepTokens = new Set(steps.flatMap((s) => [...tok(s.id), ...tok(s.name || "")]));
  const excluded = new Set(exclusions);
  const missing = [];
  for (const wu of workUnits) {
    if (excluded.has(wu)) continue;
    const aliases = ALIASES[wu] || [wu];
    if (!aliases.some((a) => stepTokens.has(a))) missing.push(wu);
  }
  return missing;
}

// naive baseline: a purely structural "does it have steps + gates?" check has no notion
// of the source skill, so it flags ZERO missing work-units — exactly how the gap shipped.
const naiveMissing = () => [];

const S = (...ids) => ids.map((id) => ({ id }));

// ── 40 cases ─────────────────────────────────────────────────────────────────
// miss = the work-units the conductor fails to cover (ground-truth expectation).
const CASES = [
  // ── the real bug + its fix (headline) ──
  { name: "daily-enrichment AS BUILT — recon folded into prose, findability dropped",
    wu: ["setup","pick","recon","research","write","check","stage","findability"],
    steps: S("setup-branch","pick-clinics","research-clinic","write-fields","check-clinic","stage-patch","finish"),
    miss: ["recon","findability"] },
  { name: "daily-enrichment FIXED — seo-recon + link-treatments added",
    wu: ["setup","pick","recon","research","write","check","stage","findability"],
    steps: S("setup-branch","pick-clinics","seo-recon","research-clinic","write-fields","check-clinic","stage-patch","link-treatments","finish"),
    miss: [] },

  // ── omitted INPUT (recon / research) ──
  { name: "treatment-seo — keyword recon omitted",
    wu: ["pick","recon","write","check","publish"], steps: S("pick-pages","write-seo","validate-seo","apply-seo"), miss: ["recon"] },
  { name: "blog-pipeline — no research step (writes blind)",
    wu: ["recon","research","write","check","publish"], steps: S("keyword-recon","draft-post","qa-post","publish-post"), miss: ["research"] },
  { name: "lead-enrichment — recon present via alias 'serp'",
    wu: ["pick","recon","write","publish"], steps: S("pick-leads","serp-lookup","write-record","push-crm"), miss: [] },

  // ── omitted OUTPUT (findability / index / notify) ──
  { name: "treatment-readability — no index/submit step",
    wu: ["pick","research","write","check","publish","index"], steps: S("pick-page","read-page","rewrite","check-readability","commit-page"), miss: ["index"] },
  { name: "new-treatment-gen — findability + index dropped",
    wu: ["recon","write","check","publish","findability","index"], steps: S("keyword-recon","generate-article","validate-article","commit-article"), miss: ["findability","index"] },
  { name: "newsletter — no notify/send step",
    wu: ["pick","write","check","notify"], steps: S("pick-stories","compose-issue","proofread"), miss: ["notify"] },
  { name: "docs-site — covers everything incl interlink + report",
    wu: ["research","write","check","findability","publish","notify"], steps: S("gather-sources","author-docs","lint-docs","interlink-docs","deploy-docs","report-summary"), miss: [] },

  // ── prose-folded units (mentioned in another step's instruction, no own step) ──
  { name: "clinic-pricing — findability folded into 'materialize' prose, no own step",
    wu: ["pick","research","write","check","findability"], steps: S("pick-clinics","scrape-prices","write-prices","check-prices"), miss: ["findability"] },
  { name: "video-pipeline — captioning folded into edit prose (modeled as research miss)",
    wu: ["research","write","check","publish","measure"], steps: S("gather-footage","edit-video","qa-video","publish-video"), miss: ["measure"] },

  // ── well-covered (no false positives) ──
  { name: "code-review — full coverage",
    wu: ["setup","review","check","notify"], steps: S("setup-context","review-diff","check-findings","report-verdict"), miss: [] },
  { name: "ci-deploy — full coverage incl rollback + measure",
    wu: ["setup","test","check","publish","rollback","measure"], steps: S("setup-env","run-tests","check-quality","deploy-prod","backup-snapshot","monitor-health"), miss: [] },
  { name: "etl-pipeline — full coverage",
    wu: ["research","write","check","publish"], steps: S("extract-data","transform-data","validate-data","load-warehouse"), miss: [] },

  // ── deliberate, LOGGED exclusions (visible → not flagged) ──
  { name: "daily-price — index out-of-scope this run (logged)",
    wu: ["pick","research","write","check","publish","index"], steps: S("pick-batch","scrape-prices","write-prices","check-prices","apply-prices"), excl: ["index"], miss: [] },
  { name: "report-gen — notify excluded (delivered manually, logged)",
    wu: ["research","write","check","notify"], steps: S("gather-metrics","compose-report","verify-report"), excl: ["notify"], miss: [] },
  { name: "db-migration — rollback NOT excluded and missing (dangerous)",
    wu: ["setup","write","check","publish","rollback"], steps: S("setup-shadow","write-migration","verify-migration","apply-migration"), miss: ["rollback"] },

  // ── aliased coverage (differently-named step still covers) ──
  { name: "security-audit — 'lint' covers check, 'announce' covers notify",
    wu: ["research","check","notify"], steps: S("scan-deps","lint-findings","announce-results"), miss: [] },
  { name: "perf-audit — 'analytics' covers measure",
    wu: ["research","check","measure","notify"], steps: S("crawl-pages","audit-vitals","analytics-baseline","digest-report"), miss: [] },
  { name: "release — 'merge' covers publish, 'regression' covers test",
    wu: ["setup","test","check","publish","notify"], steps: S("cut-branch","regression-suite","check-release","merge-main","announce-release"), miss: [] },

  // ── multi-miss ──
  { name: "scraper — check + notify both missing",
    wu: ["setup","research","check","publish","notify"], steps: S("setup-job","crawl-targets","store-rows"), miss: ["check","notify"] },
  { name: "ml-training — measure + publish missing",
    wu: ["research","write","check","measure","publish"], steps: S("collect-dataset","train-model","validate-model"), miss: ["measure","publish"] },
  { name: "social-scheduler — recon + measure missing",
    wu: ["recon","write","check","publish","measure"], steps: S("compose-posts","review-posts","schedule-posts"), miss: ["recon","measure"] },

  // ── more domains ──
  { name: "jour-and-home-crawl — full coverage",
    wu: ["pick","research","check","publish"], steps: S("pick-clinics","crawl-subpages","check-classification","apply-badges"), miss: [] },
  { name: "index-treatments — full coverage",
    wu: ["pick","index","notify"], steps: S("pick-urls","submit-index","report-quota"), miss: [] },
  { name: "image-generation — no check (ships unreviewed)",
    wu: ["recon","write","check","publish"], steps: S("keyword-recon","generate-images","ship-images"), miss: ["check"] },
  { name: "dataset-curation — full coverage",
    wu: ["research","check","publish","measure"], steps: S("gather-samples","audit-quality","publish-set","track-drift"), miss: [] },
  { name: "incident-response — measure (postmortem) missing",
    wu: ["research","check","publish","notify","measure"], steps: S("investigate-alert","verify-fix","deploy-fix","announce-status"), miss: ["measure"] },
  { name: "dependency-upgrade — test + rollback covered",
    wu: ["setup","write","test","check","publish","rollback"], steps: S("setup-branch","bump-deps","smoke-suite","check-ci","merge-pr","backup-lockfile"), miss: [] },
  { name: "feature-flag-rollout — measure missing",
    wu: ["setup","publish","review","measure"], steps: S("setup-flag","ship-flag","approve-rollout"), miss: ["measure"] },
  { name: "localization — check (linguistic QA) missing",
    wu: ["research","write","check","publish"], steps: S("extract-strings","translate-strings","deploy-locales"), miss: ["check"] },
  { name: "api-gen — full coverage incl interlink (cross-ref docs)",
    wu: ["research","write","check","findability","publish"], steps: S("introspect-schema","generate-client","validate-client","crossref-docs","publish-pkg"), miss: [] },
  { name: "email-campaign — recon (segmentation) + measure missing",
    wu: ["recon","write","check","notify","measure"], steps: S("draft-campaign","review-campaign","send-campaign"), miss: ["recon","measure"] },
  { name: "survey-analysis — full coverage",
    wu: ["research","check","measure","notify"], steps: S("collect-responses","validate-responses","analytics-summary","report-findings"), miss: [] },
  { name: "moderation-queue — publish (action) missing",
    wu: ["pick","research","check","publish","notify"], steps: S("pick-reports","investigate-content","check-decision","notify-user"), miss: ["publish"] },
  { name: "inventory-sync — check missing (writes unchecked)",
    wu: ["research","write","check","publish"], steps: S("fetch-stock","write-records","push-store"), miss: ["check"] },
  { name: "pricing-sync — full coverage",
    wu: ["research","check","publish","notify"], steps: S("fetch-competitor","validate-deltas","apply-prices","digest-changes"), miss: [] },
  { name: "onboarding-flow — measure (activation) missing",
    wu: ["setup","write","check","notify","measure"], steps: S("setup-account","generate-welcome","verify-steps","email-welcome"), miss: ["measure"] },
  { name: "backup-job — check (verify) missing (untested backups)",
    wu: ["setup","publish","check","notify"], steps: S("setup-target","snapshot-data","report-status"), miss: ["check"] },
  { name: "a11y-audit — findability (skip-links/landmarks) excluded (logged)",
    wu: ["research","check","findability","notify"], steps: S("crawl-pages","audit-a11y","report-issues"), excl: ["findability"], miss: [] },
  { name: "seo-audit — recon + findability both missing",
    wu: ["recon","research","check","findability","notify"], steps: S("crawl-site","audit-meta","report-issues"), miss: ["recon","findability"] },
  { name: "content-refresh — index missing (no re-submit)",
    wu: ["pick","research","write","check","publish","index"], steps: S("pick-stale","research-updates","rewrite-content","check-content","commit-content"), miss: ["index"] },
  { name: "competitor-monitor — full coverage",
    wu: ["recon","research","check","measure","notify"], steps: S("keyword-recon","scrape-rivals","validate-data","track-changes","digest-alert"), miss: [] },
];

// ── runner ───────────────────────────────────────────────────────────────────
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`,
  dim = (s) => `\x1b[2m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`, amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;
const eq = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

console.log(bold(`\n  Work-unit coverage smoke — ${CASES.length} skill→conductor cases\n`));
let pass = 0, naiveCaught = 0, totalOmissions = 0;
for (const c of CASES) {
  const got = coverageGaps({ workUnits: c.wu, steps: c.steps, exclusions: c.excl || [] });
  const ok = eq(got, c.miss);
  if (ok) pass++;
  totalOmissions += c.miss.length;
  if (naiveMissing().length) naiveCaught += c.miss.length; // naive never flags anything
  const tag = ok ? green("PASS") : red("FAIL");
  const detail = c.miss.length ? amber(`missing: ${c.miss.join(", ")}`) : dim("fully covered");
  console.log(`  ${tag}  ${c.name.padEnd(64)}  ${ok ? detail : red(`got [${got}] expected [${c.miss}]`)}`);
}
const failed = CASES.length - pass;
console.log("");
console.log(`  ${bold("Summary:")} ${green(`${pass} passed`)}${failed ? `, ${red(`${failed} failed`)}` : ""} / ${CASES.length}`);
console.log(`  ${dim(`coverage check flagged ${totalOmissions} omitted work-units across the corpus that a naive structural check (no source-skill inventory) catches: ${naiveCaught}.`)}`);
console.log("");
process.exit(failed ? 1 : 0);
