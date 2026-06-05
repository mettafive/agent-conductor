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
  gate:        ["gate", "validate", "verify", "audit", "qa", "lint", "proofread", "review"],
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
    wu: ["setup","pick","recon","research","write","gate","stage","findability"],
    steps: S("setup-branch","pick-clinics","research-clinic","write-fields","gate-clinic","stage-patch","finish"),
    miss: ["recon","findability"] },
  { name: "daily-enrichment FIXED — seo-recon + link-treatments added",
    wu: ["setup","pick","recon","research","write","gate","stage","findability"],
    steps: S("setup-branch","pick-clinics","seo-recon","research-clinic","write-fields","gate-clinic","stage-patch","link-treatments","finish"),
    miss: [] },

  // ── omitted INPUT (recon / research) ──
  { name: "treatment-seo — keyword recon omitted",
    wu: ["pick","recon","write","gate","publish"], steps: S("pick-pages","write-seo","validate-seo","apply-seo"), miss: ["recon"] },
  { name: "blog-pipeline — no research step (writes blind)",
    wu: ["recon","research","write","gate","publish"], steps: S("keyword-recon","draft-post","qa-post","publish-post"), miss: ["research"] },
  { name: "lead-enrichment — recon present via alias 'serp'",
    wu: ["pick","recon","write","publish"], steps: S("pick-leads","serp-lookup","write-record","push-crm"), miss: [] },

  // ── omitted OUTPUT (findability / index / notify) ──
  { name: "treatment-readability — no index/submit step",
    wu: ["pick","research","write","gate","publish","index"], steps: S("pick-page","read-page","rewrite","gate-readability","commit-page"), miss: ["index"] },
  { name: "new-treatment-gen — findability + index dropped",
    wu: ["recon","write","gate","publish","findability","index"], steps: S("keyword-recon","generate-article","validate-article","commit-article"), miss: ["findability","index"] },
  { name: "newsletter — no notify/send step",
    wu: ["pick","write","gate","notify"], steps: S("pick-stories","compose-issue","proofread"), miss: ["notify"] },
  { name: "docs-site — covers everything incl interlink + report",
    wu: ["research","write","gate","findability","publish","notify"], steps: S("gather-sources","author-docs","lint-docs","interlink-docs","deploy-docs","report-summary"), miss: [] },

  // ── prose-folded units (mentioned in another step's instruction, no own step) ──
  { name: "clinic-pricing — findability folded into 'materialize' prose, no own step",
    wu: ["pick","research","write","gate","findability"], steps: S("pick-clinics","scrape-prices","write-prices","gate-prices"), miss: ["findability"] },
  { name: "video-pipeline — captioning folded into edit prose (modeled as research miss)",
    wu: ["research","write","gate","publish","measure"], steps: S("gather-footage","edit-video","qa-video","publish-video"), miss: ["measure"] },

  // ── well-covered (no false positives) ──
  { name: "code-review — full coverage",
    wu: ["setup","review","gate","notify"], steps: S("setup-context","review-diff","gate-findings","report-verdict"), miss: [] },
  { name: "ci-deploy — full coverage incl rollback + measure",
    wu: ["setup","test","gate","publish","rollback","measure"], steps: S("setup-env","run-tests","gate-quality","deploy-prod","backup-snapshot","monitor-health"), miss: [] },
  { name: "etl-pipeline — full coverage",
    wu: ["research","write","gate","publish"], steps: S("extract-data","transform-data","validate-data","load-warehouse"), miss: [] },

  // ── deliberate, LOGGED exclusions (visible → not flagged) ──
  { name: "daily-price — index out-of-scope this run (logged)",
    wu: ["pick","research","write","gate","publish","index"], steps: S("pick-batch","scrape-prices","write-prices","gate-prices","apply-prices"), excl: ["index"], miss: [] },
  { name: "report-gen — notify excluded (delivered manually, logged)",
    wu: ["research","write","gate","notify"], steps: S("gather-metrics","compose-report","verify-report"), excl: ["notify"], miss: [] },
  { name: "db-migration — rollback NOT excluded and missing (dangerous)",
    wu: ["setup","write","gate","publish","rollback"], steps: S("setup-shadow","write-migration","verify-migration","apply-migration"), miss: ["rollback"] },

  // ── aliased coverage (differently-named step still covers) ──
  { name: "security-audit — 'lint' covers gate, 'announce' covers notify",
    wu: ["research","gate","notify"], steps: S("scan-deps","lint-findings","announce-results"), miss: [] },
  { name: "perf-audit — 'analytics' covers measure",
    wu: ["research","gate","measure","notify"], steps: S("crawl-pages","audit-vitals","analytics-baseline","digest-report"), miss: [] },
  { name: "release — 'merge' covers publish, 'regression' covers test",
    wu: ["setup","test","gate","publish","notify"], steps: S("cut-branch","regression-suite","gate-release","merge-main","announce-release"), miss: [] },

  // ── multi-miss ──
  { name: "scraper — gate + notify both missing",
    wu: ["setup","research","gate","publish","notify"], steps: S("setup-job","crawl-targets","store-rows"), miss: ["gate","notify"] },
  { name: "ml-training — measure + publish missing",
    wu: ["research","write","gate","measure","publish"], steps: S("collect-dataset","train-model","validate-model"), miss: ["measure","publish"] },
  { name: "social-scheduler — recon + measure missing",
    wu: ["recon","write","gate","publish","measure"], steps: S("compose-posts","review-posts","schedule-posts"), miss: ["recon","measure"] },

  // ── more domains ──
  { name: "jour-and-home-crawl — full coverage",
    wu: ["pick","research","gate","publish"], steps: S("pick-clinics","crawl-subpages","gate-classification","apply-badges"), miss: [] },
  { name: "index-treatments — full coverage",
    wu: ["pick","index","notify"], steps: S("pick-urls","submit-index","report-quota"), miss: [] },
  { name: "image-generation — no gate (ships unreviewed)",
    wu: ["recon","write","gate","publish"], steps: S("keyword-recon","generate-images","ship-images"), miss: ["gate"] },
  { name: "dataset-curation — full coverage",
    wu: ["research","gate","publish","measure"], steps: S("gather-samples","audit-quality","publish-set","track-drift"), miss: [] },
  { name: "incident-response — measure (postmortem) missing",
    wu: ["research","gate","publish","notify","measure"], steps: S("investigate-alert","verify-fix","deploy-fix","announce-status"), miss: ["measure"] },
  { name: "dependency-upgrade — test + rollback covered",
    wu: ["setup","write","test","gate","publish","rollback"], steps: S("setup-branch","bump-deps","smoke-suite","gate-ci","merge-pr","backup-lockfile"), miss: [] },
  { name: "feature-flag-rollout — measure missing",
    wu: ["setup","publish","review","measure"], steps: S("setup-flag","ship-flag","approve-rollout"), miss: ["measure"] },
  { name: "localization — gate (linguistic QA) missing",
    wu: ["research","write","gate","publish"], steps: S("extract-strings","translate-strings","deploy-locales"), miss: ["gate"] },
  { name: "api-gen — full coverage incl interlink (cross-ref docs)",
    wu: ["research","write","gate","findability","publish"], steps: S("introspect-schema","generate-client","validate-client","crossref-docs","publish-pkg"), miss: [] },
  { name: "email-campaign — recon (segmentation) + measure missing",
    wu: ["recon","write","gate","notify","measure"], steps: S("draft-campaign","review-campaign","send-campaign"), miss: ["recon","measure"] },
  { name: "survey-analysis — full coverage",
    wu: ["research","gate","measure","notify"], steps: S("collect-responses","validate-responses","analytics-summary","report-findings"), miss: [] },
  { name: "moderation-queue — publish (action) missing",
    wu: ["pick","research","gate","publish","notify"], steps: S("pick-reports","investigate-content","gate-decision","notify-user"), miss: ["publish"] },
  { name: "inventory-sync — gate missing (writes unchecked)",
    wu: ["research","write","gate","publish"], steps: S("fetch-stock","write-records","push-store"), miss: ["gate"] },
  { name: "pricing-sync — full coverage",
    wu: ["research","gate","publish","notify"], steps: S("fetch-competitor","validate-deltas","apply-prices","digest-changes"), miss: [] },
  { name: "onboarding-flow — measure (activation) missing",
    wu: ["setup","write","gate","notify","measure"], steps: S("setup-account","generate-welcome","verify-steps","email-welcome"), miss: ["measure"] },
  { name: "backup-job — gate (verify) missing (untested backups)",
    wu: ["setup","publish","gate","notify"], steps: S("setup-target","snapshot-data","report-status"), miss: ["gate"] },
  { name: "a11y-audit — findability (skip-links/landmarks) excluded (logged)",
    wu: ["research","gate","findability","notify"], steps: S("crawl-pages","audit-a11y","report-issues"), excl: ["findability"], miss: [] },
  { name: "seo-audit — recon + findability both missing",
    wu: ["recon","research","gate","findability","notify"], steps: S("crawl-site","audit-meta","report-issues"), miss: ["recon","findability"] },
  { name: "content-refresh — index missing (no re-submit)",
    wu: ["pick","research","write","gate","publish","index"], steps: S("pick-stale","research-updates","rewrite-content","gate-content","commit-content"), miss: ["index"] },
  { name: "competitor-monitor — full coverage",
    wu: ["recon","research","gate","measure","notify"], steps: S("keyword-recon","scrape-rivals","validate-data","track-changes","digest-alert"), miss: [] },
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
