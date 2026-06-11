// Per-case specs for the substep-divider (visual-step coverage) corpus.
//
// This is the VISIBILITY counterpart to the gate-authoring corpus. Where that one
// asks "does the gate actually fail bad work?", this one asks "does the conversion
// surface a VISIBLE STEP for every distinct work-unit the skill names — including the
// pure-visibility 'divider' phases that need no hard gate?"
//
// THE MOTIVATING FAILURE: a daily-enrichment skill did real DataForSEO keyword research
// + akut/hembesök SEO polish, but the conversion FOLDED that work into other steps'
// instructions (research-clinic, write-fields) and never gave it its own card. The user
// scanned the board and thought the SEO step was skipped. The board must read as a
// COMPLETE STORY — no folded-away phases.
//
// Each case names K distinct, user-recognizable work-units. Each unit declares:
//   id       a stable kebab id (also the expected step/sub-step id stem)
//   kw       keyword tokens the user would scan the board for — the matcher looks for
//            ANY of these in a surfaced step's id/title/instruction (case-insensitive)
//   gate     'hard' | 'soft' | 'none'  — a DIVIDER may be 'soft' (light attestation) or
//            'none' (no gate at all). gate-less is GOOD here: visibility != gating.
//   divider  true  => a pure-visibility phase (no hard gate needed). The whole point.
//            false => a gateable phase (still must be its OWN visible step).
//   foldInto (naive only) when set, the NAIVE renderer hides this unit by folding its
//            prose into the named sibling unit's instruction — never giving it a card.
//            This encodes the exact bug: dividers (and some gateable phases) get
//            absorbed into a neighbour's instruction instead of becoming a step.
//
// A case is `loop:true` when the per-item units repeat over a list (the units become
// loop SUB-steps); else flat top-level steps.

const U = (id, kw, opts = {}) => ({
  id,
  kw: Array.isArray(kw) ? kw : [kw],
  gate: opts.gate ?? "hard",
  divider: !!opts.divider,
  foldInto: opts.foldInto, // naive folds this unit's prose into sibling <foldInto>
});

// Shorthand: a divider unit (visibility-only). Default gate-less; pass gate:'soft' for a
// light attestation divider. By default the naive renderer folds it into `into`.
const D = (id, kw, into, opts = {}) =>
  U(id, kw, { divider: true, gate: opts.gate ?? "none", foldInto: into });

export const SPECS = [
  // ============================================================ 100 COMMON
  // The motivating case itself, reconstructed.
  { id: "daily-enrichment", common: true, loop: true, listName: "clinics", item: "clinic",
    units: [
      U("research-clinic", ["research", "crawl", "gather data"]),
      D("keyword-research", ["dataforseo", "keyword research", "search volume"], "research-clinic"),
      U("write-fields", ["write", "description", "story"]),
      D("seo-polish", ["seo polish", "akut", "hembesök", "meta"], "write-fields"),
      U("save-clinic", ["save", "patch", "supabase", "update db"]),
      U("open-pr", ["pull request", "open pr", "ship"]),
    ] },

  // --- content / writing pipelines ---
  { id: "blog-pipeline", common: true, loop: true, listName: "topics", item: "topic",
    units: [
      U("outline", ["outline", "structure"]),
      U("draft", ["draft", "write body"]),
      D("seo-titles", ["seo title", "meta description", "slug"], "draft"),
      D("internal-links", ["internal link", "interlink", "related posts"], "draft"),
      U("publish", ["publish", "ship", "cms"]),
    ] },
  { id: "newsletter", common: true, loop: false,
    units: [
      U("curate", ["curate", "select stories"]),
      U("write-issue", ["write", "compose issue"]),
      D("subject-line", ["subject line", "preview text"], "write-issue"),
      D("ab-variants", ["a/b", "variant", "split test"], "write-issue"),
      U("schedule-send", ["schedule", "send", "dispatch"]),
    ] },
  { id: "doc-rewrite", common: true, loop: true, listName: "pages", item: "page",
    units: [
      U("read-current", ["read current", "load page"]),
      U("rewrite", ["rewrite", "clarify"]),
      D("add-examples", ["code example", "add example", "snippet"], "rewrite"),
      D("add-diagrams", ["diagram", "mermaid", "figure"], "rewrite"),
      U("commit", ["commit", "push"]),
    ] },
  { id: "product-copy", common: true, loop: true, listName: "products", item: "product",
    units: [
      U("gather-specs", ["gather specs", "spec sheet"]),
      U("write-copy", ["write copy", "marketing copy"]),
      D("tone-pass", ["tone", "brand voice"], "write-copy"),
      D("localize", ["localize", "translation", "locale"], "write-copy"),
      U("upload", ["upload", "save to catalog"]),
    ] },
  { id: "release-notes", common: true, loop: false,
    units: [
      U("collect-prs", ["collect prs", "merged commits", "git log"]),
      U("categorize", ["categorize", "group by type"]),
      U("write-notes", ["write notes", "draft changelog"]),
      D("highlight-breaking", ["breaking change", "migration note"], "write-notes"),
      U("publish-notes", ["publish", "tag release"]),
    ] },

  // --- data / ETL pipelines ---
  { id: "etl-load", common: true, loop: true, listName: "tables", item: "table",
    units: [
      U("extract", ["extract", "pull rows"]),
      U("transform", ["transform", "map columns"]),
      D("type-coerce", ["type coerce", "cast types"], "transform"),
      D("dedupe", ["dedupe", "deduplicate"], "transform"),
      U("load", ["load", "insert into warehouse"]),
      U("reconcile", ["reconcile", "row count check"]),
    ] },
  { id: "csv-clean", common: true, loop: false,
    units: [
      U("profile", ["profile", "inspect dataset"]),
      U("clean", ["clean", "fix values"]),
      D("normalize-dates", ["normalize date", "date format"], "clean"),
      D("trim-whitespace", ["trim whitespace", "strip spaces"], "clean"),
      U("export", ["export", "write csv"]),
    ] },
  { id: "db-migrate", common: true, loop: true, listName: "migrations", item: "migration",
    units: [
      U("backup", ["backup", "snapshot"]),
      U("apply-migration", ["apply migration", "run migration"]),
      D("verify-indexes", ["verify index", "reindex"], "apply-migration"),
      U("smoke-test", ["smoke test", "query check"]),
    ] },
  { id: "api-sync", common: true, loop: true, listName: "records", item: "record",
    units: [
      U("fetch-local", ["fetch local", "load desired"]),
      U("push-remote", ["push", "sync to api"]),
      D("rate-limit", ["rate limit", "throttle", "backoff"], "push-remote"),
      U("readback", ["read back", "verify remote"]),
    ] },
  { id: "geo-encode", common: true, loop: true, listName: "addresses", item: "address",
    units: [
      U("parse-address", ["parse address", "normalize address"]),
      U("geocode", ["geocode", "lat lng", "coordinates"]),
      D("confidence-flag", ["confidence", "flag low match"], "geocode"),
      U("store", ["store", "save coordinates"]),
    ] },

  // --- code / engineering pipelines ---
  { id: "pr-review", common: true, loop: true, listName: "files", item: "file",
    units: [
      U("read-diff", ["read diff", "load changes"]),
      U("review", ["review", "find defects"]),
      D("style-check", ["style", "lint", "formatting"], "review"),
      D("security-scan", ["security", "vuln", "injection"], "review"),
      U("comment", ["comment", "post review"]),
    ] },
  { id: "dep-bump", common: true, loop: true, listName: "deps", item: "dep",
    units: [
      U("check-version", ["check version", "latest release"]),
      U("upgrade", ["upgrade", "bump version"]),
      D("cve-scan", ["cve", "advisory", "audit"], "upgrade"),
      D("changelog-read", ["read changelog", "migration guide"], "upgrade"),
      U("build", ["build", "run tests"]),
    ] },
  { id: "test-gen", common: true, loop: true, listName: "modules", item: "module",
    units: [
      U("analyze-module", ["analyze", "read module"]),
      U("write-tests", ["write tests", "add cases"]),
      D("edge-cases", ["edge case", "boundary", "error path"], "write-tests"),
      U("run-suite", ["run suite", "coverage"]),
    ] },
  { id: "refactor-pass", common: true, loop: true, listName: "files", item: "file",
    units: [
      U("baseline", ["baseline", "snapshot tests"]),
      U("refactor", ["refactor", "restructure"]),
      D("rename-symbols", ["rename", "symbol cleanup"], "refactor"),
      U("verify-green", ["verify green", "tests pass"]),
    ] },
  { id: "ci-pipeline", common: true, loop: false,
    units: [
      U("install", ["install deps", "npm ci"]),
      U("lint", ["lint", "eslint"]),
      U("test", ["test", "unit tests"]),
      D("coverage-report", ["coverage report", "coverage threshold"], "test"),
      U("build-artifact", ["build artifact", "bundle"]),
      U("deploy", ["deploy", "ship"]),
    ] },
  { id: "incident-response", common: true, loop: false,
    units: [
      U("triage", ["triage", "assess severity"]),
      U("mitigate", ["mitigate", "stop bleeding"]),
      U("root-cause", ["root cause", "rca"]),
      D("write-postmortem", ["postmortem", "writeup"], "root-cause"),
      D("action-items", ["action items", "follow-ups"], "root-cause"),
    ] },

  // --- research / analysis ---
  { id: "market-research", common: true, loop: true, listName: "competitors", item: "competitor",
    units: [
      U("collect-data", ["collect", "scrape competitor"]),
      U("analyze", ["analyze", "compare features"]),
      D("pricing-table", ["pricing table", "price compare"], "analyze"),
      D("swot", ["swot", "strengths weaknesses"], "analyze"),
      U("report", ["report", "writeup"]),
    ] },
  { id: "literature-review", common: true, loop: true, listName: "papers", item: "paper",
    units: [
      U("fetch-paper", ["fetch", "download paper"]),
      U("summarize", ["summarize", "extract findings"]),
      D("cite-extract", ["citation", "bibtex", "reference"], "summarize"),
      U("synthesize", ["synthesize", "combine findings"]),
    ] },
  { id: "survey-readout", common: true, loop: false,
    units: [
      U("load-responses", ["load responses", "raw data"]),
      U("compute-stats", ["compute stats", "percentages"]),
      D("segment", ["segment", "by cohort"], "compute-stats"),
      D("theme-freetext", ["free text themes", "open responses"], "compute-stats"),
      U("write-summary", ["write summary", "report"]),
    ] },
  { id: "ab-analysis", common: true, loop: false,
    units: [
      U("pull-events", ["pull events", "raw counts"]),
      U("significance", ["significance", "p-value"]),
      D("guardrail-metrics", ["guardrail", "secondary metric"], "significance"),
      U("recommend", ["recommend", "ship decision"]),
    ] },
  { id: "log-forensics", common: true, loop: false,
    units: [
      U("ingest-logs", ["ingest logs", "load logs"]),
      U("correlate", ["correlate", "timeline"]),
      D("error-cluster", ["error cluster", "group errors"], "correlate"),
      U("diagnose", ["diagnose", "root cause"]),
    ] },

  // --- ops / infra ---
  { id: "deploy-flow", common: true, loop: false,
    units: [
      U("record-baseline", ["record baseline", "current version"]),
      U("deploy", ["deploy", "rollout"]),
      D("smoke-flows", ["smoke flow", "user journey"], "deploy"),
      U("health-check", ["health check", "probe endpoint"]),
      U("rollback-ready", ["rollback", "revert path"]),
    ] },
  { id: "backup-verify", common: true, loop: true, listName: "backups", item: "backup",
    units: [
      U("locate-backup", ["locate", "find backup"]),
      U("restore-test", ["restore test", "restore"]),
      D("checksum", ["checksum", "hash compare"], "restore-test"),
      U("report-status", ["report", "verdict"]),
    ] },
  { id: "cert-renew", common: true, loop: true, listName: "domains", item: "domain",
    units: [
      U("check-expiry", ["check expiry", "expiration"]),
      U("renew", ["renew", "issue cert"]),
      D("reload-server", ["reload", "restart nginx"], "renew"),
      U("verify-chain", ["verify chain", "ssl check"]),
    ] },
  { id: "scaling-audit", common: true, loop: true, listName: "services", item: "service",
    units: [
      U("collect-metrics", ["collect metrics", "cpu memory"]),
      U("analyze-load", ["analyze load", "saturation"]),
      D("cost-estimate", ["cost estimate", "spend"], "analyze-load"),
      U("recommend-size", ["recommend", "right-size"]),
    ] },

  // --- support / ops content ---
  { id: "support-triage", common: true, loop: true, listName: "tickets", item: "ticket",
    units: [
      U("read-ticket", ["read ticket", "load ticket"]),
      U("classify", ["classify", "categorize"]),
      D("sentiment", ["sentiment", "urgency"], "classify"),
      U("route", ["route", "assign queue"]),
      U("draft-reply", ["draft reply", "respond"]),
    ] },
  { id: "kb-refresh", common: true, loop: true, listName: "articles", item: "article",
    units: [
      U("audit-article", ["audit", "check staleness"]),
      U("update", ["update", "rewrite"]),
      D("screenshot-refresh", ["screenshot", "refresh image"], "update"),
      U("republish", ["republish", "save"]),
    ] },
  { id: "onboarding-emails", common: true, loop: true, listName: "stages", item: "stage",
    units: [
      U("define-stage", ["define stage", "trigger"]),
      U("write-email", ["write email", "compose"]),
      D("personalize", ["personalize", "merge tags"], "write-email"),
      U("queue", ["queue", "schedule"]),
    ] },

  // --- media / asset pipelines ---
  { id: "image-pipeline", common: true, loop: true, listName: "articles", item: "article",
    units: [
      U("prompt-build", ["build prompt", "image prompt"]),
      U("generate", ["generate", "render image"]),
      D("alt-text", ["alt text", "accessibility caption"], "generate"),
      D("compress", ["compress", "optimize size"], "generate"),
      U("upload-cdn", ["upload", "cdn", "storage"]),
    ] },
  { id: "video-transcode", common: true, loop: true, listName: "clips", item: "clip",
    units: [
      U("probe", ["probe", "inspect clip"]),
      U("transcode", ["transcode", "encode"]),
      D("thumbnail", ["thumbnail", "poster frame"], "transcode"),
      D("subtitle", ["subtitle", "caption track"], "transcode"),
      U("store-asset", ["store", "save asset"]),
    ] },
  { id: "podcast-publish", common: true, loop: true, listName: "episodes", item: "episode",
    units: [
      U("transcribe", ["transcribe", "transcript"]),
      U("show-notes", ["show notes", "episode notes"]),
      D("chapter-marks", ["chapter", "timestamps"], "show-notes"),
      U("publish-feed", ["publish", "rss feed"]),
    ] },

  // --- e-commerce / catalog ---
  { id: "price-monitor", common: true, loop: true, listName: "products", item: "product",
    units: [
      U("fetch-listing", ["fetch listing", "live page"]),
      U("record-price", ["record price", "current price"]),
      D("change-flag", ["change flag", "price delta"], "record-price"),
      U("store-history", ["store history", "log price"]),
    ] },
  { id: "inventory-sync", common: true, loop: true, listName: "skus", item: "sku",
    units: [
      U("read-stock", ["read stock", "warehouse count"]),
      U("update-listing", ["update listing", "set quantity"]),
      D("low-stock-alert", ["low stock", "reorder alert"], "update-listing"),
      U("confirm", ["confirm", "verify count"]),
    ] },
  { id: "review-moderation", common: true, loop: true, listName: "reviews", item: "review",
    units: [
      U("read-review", ["read review", "load review"]),
      U("moderate", ["moderate", "approve reject"]),
      D("spam-check", ["spam", "fake review"], "moderate"),
      U("publish-review", ["publish", "post review"]),
    ] },

  // --- compliance / legal ---
  { id: "license-audit", common: true, loop: true, listName: "packages", item: "package",
    units: [
      U("read-license", ["read license", "license file"]),
      U("classify-license", ["classify", "spdx"]),
      D("allowlist-check", ["allowlist", "policy check"], "classify-license"),
      U("report-verdict", ["report", "verdict"]),
    ] },
  { id: "gdpr-export", common: true, loop: true, listName: "subjects", item: "subject",
    units: [
      U("gather-data", ["gather data", "collect records"]),
      U("redact", ["redact", "mask pii"]),
      D("format-package", ["format package", "machine readable"], "redact"),
      U("deliver", ["deliver", "send export"]),
    ] },
  { id: "accessibility-sweep", common: true, loop: true, listName: "views", item: "view",
    units: [
      U("render-view", ["render", "load view"]),
      U("audit-wcag", ["audit", "wcag"]),
      D("contrast-check", ["contrast", "color ratio"], "audit-wcag"),
      D("aria-check", ["aria", "screen reader"], "audit-wcag"),
      U("file-issues", ["file issues", "log violations"]),
    ] },

  // --- finance / accounting ---
  { id: "invoice-process", common: true, loop: true, listName: "invoices", item: "invoice",
    units: [
      U("ocr-extract", ["ocr", "extract fields"]),
      U("reconcile-total", ["reconcile", "line items sum"]),
      D("tax-lines", ["tax line", "vat"], "reconcile-total"),
      U("enter-system", ["enter system", "post to ledger"]),
    ] },
  { id: "expense-report", common: true, loop: false,
    units: [
      U("collect-receipts", ["collect receipts", "gather"]),
      U("categorize-spend", ["categorize", "expense category"]),
      D("policy-flag", ["policy flag", "over limit"], "categorize-spend"),
      U("submit", ["submit", "file report"]),
    ] },
  { id: "payroll-run", common: true, loop: true, listName: "employees", item: "employee",
    units: [
      U("compute-gross", ["compute gross", "hours pay"]),
      U("apply-deductions", ["deductions", "withholding"]),
      D("benefits", ["benefits", "401k", "pension"], "apply-deductions"),
      U("issue-payment", ["issue payment", "pay"]),
    ] },

  // --- marketing / growth ---
  { id: "seo-audit", common: true, loop: true, listName: "pages", item: "page",
    units: [
      U("crawl-page", ["crawl", "fetch page"]),
      U("audit-meta", ["audit meta", "title description"]),
      D("schema-check", ["schema", "json-ld", "structured data"], "audit-meta"),
      D("speed-check", ["speed", "core web vitals", "lcp"], "audit-meta"),
      U("recommend-fixes", ["recommend", "fixes"]),
    ] },
  { id: "ad-campaign", common: true, loop: true, listName: "audiences", item: "audience",
    units: [
      U("define-audience", ["define audience", "targeting"]),
      U("write-creative", ["write creative", "ad copy"]),
      D("budget-split", ["budget", "spend allocation"], "write-creative"),
      U("launch", ["launch", "publish campaign"]),
    ] },
  { id: "social-schedule", common: true, loop: true, listName: "posts", item: "post",
    units: [
      U("draft-post", ["draft post", "compose"]),
      U("attach-media", ["attach media", "image video"]),
      D("hashtag", ["hashtag", "tags"], "attach-media"),
      D("best-time", ["best time", "optimal slot"], "attach-media"),
      U("schedule-post", ["schedule", "queue post"]),
    ] },
  { id: "lead-enrich", common: true, loop: true, listName: "leads", item: "lead",
    units: [
      U("lookup-company", ["lookup", "firmographics"]),
      U("score-lead", ["score", "lead score"]),
      D("intent-signals", ["intent signal", "buying signal"], "score-lead"),
      U("sync-crm", ["sync crm", "save to crm"]),
    ] },

  // --- HR / recruiting ---
  { id: "resume-screen", common: true, loop: true, listName: "candidates", item: "candidate",
    units: [
      U("parse-resume", ["parse resume", "extract"]),
      U("match-criteria", ["match", "rubric"]),
      D("bias-check", ["bias check", "fairness"], "match-criteria"),
      U("rank", ["rank", "shortlist"]),
    ] },
  { id: "interview-kit", common: true, loop: false,
    units: [
      U("define-role", ["define role", "competencies"]),
      U("write-questions", ["write questions", "interview questions"]),
      D("scoring-rubric", ["scoring rubric", "evaluation guide"], "write-questions"),
      U("assemble-kit", ["assemble", "package kit"]),
    ] },

  // --- design / qa ---
  { id: "design-handoff", common: true, loop: true, listName: "screens", item: "screen",
    units: [
      U("export-assets", ["export assets", "slice"]),
      U("spec-redlines", ["redline", "spacing spec"]),
      D("token-map", ["design token", "variable map"], "spec-redlines"),
      U("publish-handoff", ["publish handoff", "share"]),
    ] },
  { id: "qa-regression", common: true, loop: true, listName: "flows", item: "flow",
    units: [
      U("setup-fixture", ["setup fixture", "test data"]),
      U("run-flow", ["run flow", "execute test"]),
      D("screenshot-diff", ["screenshot diff", "visual regression"], "run-flow"),
      U("report-result", ["report", "pass fail"]),
    ] },

  // --- misc common (to round toward 100) ---
  { id: "translation-batch", common: true, loop: true, listName: "segments", item: "segment",
    units: [
      U("load-segment", ["load segment", "source text"]),
      U("translate", ["translate", "render target"]),
      D("glossary-enforce", ["glossary", "do not translate"], "translate"),
      D("number-preserve", ["number preserve", "units"], "translate"),
      U("save-translation", ["save", "write output"]),
    ] },
  { id: "data-labeling", common: true, loop: true, listName: "items", item: "item",
    units: [
      U("load-item", ["load item", "fetch sample"]),
      U("label", ["label", "annotate"]),
      D("confidence-mark", ["confidence", "uncertain flag"], "label"),
      U("save-label", ["save label", "store annotation"]),
    ] },
  { id: "email-campaign-qa", common: true, loop: true, listName: "emails", item: "email",
    units: [
      U("render-email", ["render", "preview email"]),
      U("link-check", ["link check", "verify links"]),
      D("spam-score", ["spam score", "deliverability"], "link-check"),
      U("approve", ["approve", "sign off"]),
    ] },
  { id: "menu-engineering", common: true, loop: true, listName: "dishes", item: "dish",
    units: [
      U("cost-recipe", ["cost recipe", "ingredient cost"]),
      U("price-dish", ["price dish", "set price"]),
      D("margin-flag", ["margin", "profitability"], "price-dish"),
      U("update-menu", ["update menu", "publish"]),
    ] },
  { id: "course-build", common: true, loop: true, listName: "lessons", item: "lesson",
    units: [
      U("outline-lesson", ["outline lesson", "learning objectives"]),
      U("write-content", ["write content", "lesson body"]),
      D("quiz", ["quiz", "assessment"], "write-content"),
      D("transcript", ["transcript", "captions"], "write-content"),
      U("publish-lesson", ["publish", "lms"]),
    ] },
  { id: "grant-application", common: true, loop: false,
    units: [
      U("read-rfp", ["read rfp", "requirements"]),
      U("draft-proposal", ["draft proposal", "narrative"]),
      D("budget-justify", ["budget justification", "cost narrative"], "draft-proposal"),
      D("impact-metrics", ["impact metrics", "outcomes"], "draft-proposal"),
      U("submit-grant", ["submit", "file application"]),
    ] },
  { id: "contract-review", common: true, loop: true, listName: "contracts", item: "contract",
    units: [
      U("extract-clauses", ["extract clauses", "parse terms"]),
      U("flag-risks", ["flag risk", "risky clause"]),
      D("redline-suggest", ["redline", "suggested edit"], "flag-risks"),
      U("summarize-contract", ["summarize", "brief"]),
    ] },
  { id: "menu-translation", common: true, loop: true, listName: "items", item: "item",
    units: [
      U("translate-name", ["translate name", "dish name"]),
      U("describe", ["describe", "description"]),
      D("allergen-note", ["allergen", "dietary"], "describe"),
      U("save-menu-item", ["save", "store item"]),
    ] },
  { id: "ticket-dedup", common: true, loop: true, listName: "clusters", item: "cluster",
    units: [
      U("cluster", ["cluster", "group tickets"]),
      U("merge", ["merge", "dedupe tickets"]),
      D("link-context", ["link context", "preserve links"], "merge"),
      U("close-dupes", ["close", "resolve duplicates"]),
    ] },
  { id: "feature-flag-cleanup", common: true, loop: true, listName: "flags", item: "flag",
    units: [
      U("find-usages", ["find usages", "grep flag"]),
      U("remove-flag", ["remove flag", "delete branch"]),
      D("update-config", ["update config", "remove definition"], "remove-flag"),
      U("test-build", ["test", "build check"]),
    ] },
  { id: "sitemap-gen", common: true, loop: false,
    units: [
      U("crawl-site", ["crawl site", "discover urls"]),
      U("build-sitemap", ["build sitemap", "generate xml"]),
      D("priority-weights", ["priority", "changefreq"], "build-sitemap"),
      U("submit-sitemap", ["submit", "ping search console"]),
    ] },
  { id: "schema-validate", common: true, loop: true, listName: "configs", item: "config",
    units: [
      U("load-config", ["load config", "parse file"]),
      U("validate-schema", ["validate schema", "conform"]),
      D("cross-ref", ["cross reference", "resolve refs"], "validate-schema"),
      U("report-config", ["report", "verdict"]),
    ] },
  { id: "pentest-recon", common: true, loop: true, listName: "hosts", item: "host",
    units: [
      U("port-scan", ["port scan", "enumerate ports"]),
      U("service-fingerprint", ["fingerprint", "identify service"]),
      D("cve-match", ["cve match", "known vuln"], "service-fingerprint"),
      U("report-findings", ["report", "writeup"]),
    ] },
  { id: "model-eval", common: true, loop: true, listName: "checkpoints", item: "checkpoint",
    units: [
      U("load-checkpoint", ["load checkpoint", "model weights"]),
      U("run-benchmark", ["run benchmark", "eval suite"]),
      D("per-category", ["per category", "breakdown"], "run-benchmark"),
      D("regression-flag", ["regression", "compare baseline"], "run-benchmark"),
      U("record-scores", ["record scores", "leaderboard"]),
    ] },
  { id: "rag-index", common: true, loop: true, listName: "docs", item: "doc",
    units: [
      U("chunk-doc", ["chunk", "split document"]),
      U("embed", ["embed", "vectorize"]),
      D("metadata-tag", ["metadata", "tag chunk"], "embed"),
      U("upsert-vectors", ["upsert", "store vectors"]),
    ] },
  { id: "feature-store", common: true, loop: true, listName: "features", item: "feature",
    units: [
      U("compute-feature", ["compute feature", "transform"]),
      U("validate-feature", ["validate", "drift check"]),
      D("backfill", ["backfill", "historical"], "validate-feature"),
      U("publish-feature", ["publish", "register feature"]),
    ] },
  { id: "alert-tuning", common: true, loop: true, listName: "alerts", item: "alert",
    units: [
      U("analyze-history", ["analyze history", "alert noise"]),
      U("tune-threshold", ["tune threshold", "adjust"]),
      D("test-replay", ["replay", "backtest alert"], "tune-threshold"),
      U("deploy-alert", ["deploy", "apply rule"]),
    ] },
  { id: "data-quality", common: true, loop: true, listName: "datasets", item: "dataset",
    units: [
      U("profile-data", ["profile", "describe dataset"]),
      U("run-checks", ["run checks", "quality rules"]),
      D("anomaly-flag", ["anomaly", "outlier"], "run-checks"),
      U("report-quality", ["report", "scorecard"]),
    ] },
  { id: "api-doc-gen", common: true, loop: true, listName: "endpoints", item: "endpoint",
    units: [
      U("introspect", ["introspect", "parse route"]),
      U("write-doc", ["write doc", "document endpoint"]),
      D("example-requests", ["example request", "curl sample"], "write-doc"),
      U("publish-doc", ["publish", "openapi"]),
    ] },
  { id: "churn-outreach", common: true, loop: true, listName: "accounts", item: "account",
    units: [
      U("score-risk", ["score risk", "churn score"]),
      U("draft-outreach", ["draft outreach", "win-back email"]),
      D("offer-pick", ["offer", "incentive"], "draft-outreach"),
      U("queue-send", ["queue", "schedule send"]),
    ] },
  { id: "warehouse-pick", common: true, loop: true, listName: "orders", item: "order",
    units: [
      U("read-order", ["read order", "line items"]),
      U("plan-route", ["plan route", "pick path"]),
      D("batch-merge", ["batch", "wave pick"], "plan-route"),
      U("confirm-pick", ["confirm pick", "mark fulfilled"]),
    ] },
  { id: "fleet-maintenance", common: true, loop: true, listName: "vehicles", item: "vehicle",
    units: [
      U("read-telemetry", ["read telemetry", "diagnostics"]),
      U("assess-wear", ["assess wear", "maintenance need"]),
      D("schedule-service", ["schedule service", "book slot"], "assess-wear"),
      U("log-record", ["log", "maintenance record"]),
    ] },
  { id: "menu-photo-shoot", common: true, loop: true, listName: "dishes", item: "dish",
    units: [
      U("plate", ["plate", "styling"]),
      U("shoot", ["shoot", "capture photo"]),
      D("retouch", ["retouch", "color grade"], "shoot"),
      U("upload-photo", ["upload", "save photo"]),
    ] },
  { id: "tax-prep", common: true, loop: false,
    units: [
      U("gather-docs", ["gather docs", "collect forms"]),
      U("categorize-income", ["categorize income", "income sources"]),
      U("compute-deductions", ["deductions", "write-offs"]),
      D("credit-check", ["tax credit", "credits"], "compute-deductions"),
      U("file-return", ["file return", "submit"]),
    ] },
  { id: "event-planning", common: true, loop: false,
    units: [
      U("book-venue", ["book venue", "reserve space"]),
      U("invite-list", ["invite list", "guest list"]),
      U("schedule-program", ["schedule program", "agenda"]),
      D("catering", ["catering", "menu order"], "schedule-program"),
      D("av-setup", ["av setup", "audio visual"], "schedule-program"),
      U("send-invites", ["send invites", "rsvp"]),
    ] },
  { id: "recipe-scaling", common: true, loop: true, listName: "recipes", item: "recipe",
    units: [
      U("read-recipe", ["read recipe", "ingredients"]),
      U("scale", ["scale", "adjust quantities"]),
      D("unit-convert", ["unit convert", "metric imperial"], "scale"),
      U("save-recipe", ["save", "store recipe"]),
    ] },
  { id: "playlist-curate", common: true, loop: true, listName: "moods", item: "mood",
    units: [
      U("seed-tracks", ["seed tracks", "starting songs"]),
      U("expand", ["expand", "recommend tracks"]),
      D("flow-order", ["flow order", "sequence", "transitions"], "expand"),
      U("save-playlist", ["save playlist", "publish"]),
    ] },
  { id: "garden-plan", common: true, loop: true, listName: "beds", item: "bed",
    units: [
      U("assess-soil", ["assess soil", "ph test"]),
      U("select-plants", ["select plants", "companion"]),
      D("spacing-layout", ["spacing", "layout"], "select-plants"),
      U("schedule-planting", ["schedule planting", "calendar"]),
    ] },
  { id: "meal-prep", common: true, loop: false,
    units: [
      U("plan-meals", ["plan meals", "weekly menu"]),
      U("build-shopping", ["build shopping", "grocery list"]),
      D("macro-balance", ["macros", "nutrition balance"], "plan-meals"),
      U("prep-batch", ["prep batch", "cook ahead"]),
    ] },
  { id: "wardrobe-capsule", common: true, loop: false,
    units: [
      U("inventory-closet", ["inventory", "audit closet"]),
      U("select-capsule", ["select capsule", "core pieces"]),
      D("color-palette", ["color palette", "coordinate"], "select-capsule"),
      U("gap-list", ["gap list", "shopping gaps"]),
    ] },
  { id: "study-plan", common: true, loop: true, listName: "subjects", item: "subject",
    units: [
      U("assess-level", ["assess level", "diagnostic"]),
      U("build-schedule", ["build schedule", "study plan"]),
      D("spaced-repetition", ["spaced repetition", "review intervals"], "build-schedule"),
      U("track-progress", ["track progress", "log sessions"]),
    ] },
  { id: "trip-itinerary", common: true, loop: true, listName: "cities", item: "city",
    units: [
      U("research-city", ["research", "attractions"]),
      U("build-day-plan", ["day plan", "itinerary"]),
      D("book-logistics", ["book", "transport hotel"], "build-day-plan"),
      D("budget-day", ["budget", "daily spend"], "build-day-plan"),
      U("finalize", ["finalize", "confirm itinerary"]),
    ] },
  { id: "home-inspection", common: true, loop: true, listName: "rooms", item: "room",
    units: [
      U("inspect-room", ["inspect", "walkthrough"]),
      U("document-issues", ["document issues", "defects"]),
      D("photo-evidence", ["photo evidence", "capture"], "document-issues"),
      U("compile-report", ["compile report", "summary"]),
    ] },
  { id: "warranty-claim", common: true, loop: true, listName: "claims", item: "claim",
    units: [
      U("verify-coverage", ["verify coverage", "policy check"]),
      U("assess-damage", ["assess damage", "evaluate"]),
      D("cost-estimate", ["cost estimate", "repair quote"], "assess-damage"),
      U("decide-claim", ["decide", "approve deny"]),
    ] },
  { id: "loan-underwrite", common: true, loop: true, listName: "applications", item: "application",
    units: [
      U("pull-credit", ["pull credit", "credit report"]),
      U("assess-risk", ["assess risk", "underwrite"]),
      D("dti-compute", ["debt to income", "dti ratio"], "assess-risk"),
      U("decision", ["decision", "approve decline"]),
    ] },
  { id: "fraud-review", common: true, loop: true, listName: "transactions", item: "transaction",
    units: [
      U("score-transaction", ["score", "fraud score"]),
      U("investigate", ["investigate", "review flags"]),
      D("velocity-check", ["velocity", "rapid transactions"], "investigate"),
      U("decide-action", ["decide", "block allow"]),
    ] },
  { id: "supply-forecast", common: true, loop: true, listName: "products", item: "product",
    units: [
      U("pull-demand", ["pull demand", "sales history"]),
      U("forecast", ["forecast", "predict demand"]),
      D("seasonality", ["seasonality", "seasonal adjust"], "forecast"),
      U("recommend-order", ["recommend order", "reorder qty"]),
    ] },
  { id: "clinical-coding", common: true, loop: true, listName: "encounters", item: "encounter",
    units: [
      U("read-chart", ["read chart", "clinical note"]),
      U("assign-codes", ["assign codes", "icd cpt"]),
      D("modifier-check", ["modifier", "code modifier"], "assign-codes"),
      U("submit-claim", ["submit claim", "billing"]),
    ] },
  { id: "lab-result-review", common: true, loop: true, listName: "panels", item: "panel",
    units: [
      U("ingest-results", ["ingest results", "lab values"]),
      U("flag-abnormal", ["flag abnormal", "out of range"]),
      D("trend-compare", ["trend", "compare prior"], "flag-abnormal"),
      U("notify", ["notify", "alert clinician"]),
    ] },
  { id: "syllabus-build", common: true, loop: false,
    units: [
      U("define-outcomes", ["learning outcomes", "objectives"]),
      U("sequence-units", ["sequence units", "weekly plan"]),
      D("assessment-plan", ["assessment", "grading"], "sequence-units"),
      D("reading-list", ["reading list", "resources"], "sequence-units"),
      U("publish-syllabus", ["publish", "share syllabus"]),
    ] },
  { id: "moderation-queue", common: true, loop: true, listName: "posts", item: "post",
    units: [
      U("read-post", ["read post", "load content"]),
      U("classify-policy", ["classify", "policy match"]),
      D("context-check", ["context", "nuance"], "classify-policy"),
      U("action-post", ["action", "remove keep"]),
    ] },
  { id: "ab-image-test", common: true, loop: true, listName: "creatives", item: "creative",
    units: [
      U("prepare-variant", ["prepare variant", "creative version"]),
      U("launch-test", ["launch test", "serve"]),
      D("track-ctr", ["ctr", "click rate"], "launch-test"),
      U("pick-winner", ["pick winner", "declare"]),
    ] },
  { id: "compliance-training", common: true, loop: true, listName: "modules", item: "module",
    units: [
      U("build-module", ["build module", "content"]),
      U("add-quiz", ["add quiz", "knowledge check"]),
      D("track-completion", ["track completion", "attestation"], "add-quiz"),
      U("publish-module", ["publish", "assign"]),
    ] },
  { id: "vendor-onboard", common: true, loop: true, listName: "vendors", item: "vendor",
    units: [
      U("collect-docs", ["collect docs", "w9 insurance"]),
      U("verify-vendor", ["verify", "background check"]),
      D("risk-tier", ["risk tier", "classify risk"], "verify-vendor"),
      U("activate", ["activate", "approve vendor"]),
    ] },
  { id: "menu-nutrition", common: true, loop: true, listName: "items", item: "item",
    units: [
      U("lookup-ingredients", ["lookup ingredients", "components"]),
      U("compute-nutrition", ["compute nutrition", "calories macros"]),
      D("allergen-label", ["allergen", "label"], "compute-nutrition"),
      U("publish-nutrition", ["publish", "save label"]),
    ] },
  { id: "ad-compliance", common: true, loop: true, listName: "ads", item: "ad",
    units: [
      U("scan-ad", ["scan ad", "read creative"]),
      U("check-claims", ["check claims", "substantiation"]),
      D("disclosure-check", ["disclosure", "fine print"], "check-claims"),
      U("approve-ad", ["approve", "verdict"]),
    ] },
  { id: "patch-rollout", common: true, loop: true, listName: "cohorts", item: "cohort",
    units: [
      U("select-cohort", ["select cohort", "canary group"]),
      U("deploy-patch", ["deploy patch", "rollout"]),
      D("monitor-errors", ["monitor errors", "error rate"], "deploy-patch"),
      U("promote-or-halt", ["promote", "halt rollback"]),
    ] },
  { id: "transcription-qa", common: true, loop: true, listName: "files", item: "file",
    units: [
      U("auto-transcribe", ["auto transcribe", "asr"]),
      U("human-correct", ["human correct", "proofread"]),
      D("speaker-label", ["speaker label", "diarization"], "human-correct"),
      U("finalize-transcript", ["finalize", "publish transcript"]),
    ] },
  { id: "social-listening", common: true, loop: true, listName: "queries", item: "query",
    units: [
      U("collect-mentions", ["collect mentions", "scrape"]),
      U("analyze-sentiment", ["analyze sentiment", "classify"]),
      D("influencer-flag", ["influencer", "high reach"], "analyze-sentiment"),
      U("brief", ["brief", "summary report"]),
    ] },
  { id: "form-builder", common: true, loop: false,
    units: [
      U("define-fields", ["define fields", "form schema"]),
      U("add-validation", ["add validation", "rules"]),
      D("conditional-logic", ["conditional logic", "branching"], "add-validation"),
      U("publish-form", ["publish form", "deploy"]),
    ] },
  { id: "store-locator-import", common: true, loop: true, listName: "stores", item: "store",
    units: [
      U("normalize-store", ["normalize", "clean record"]),
      U("geocode-store", ["geocode", "coordinates"]),
      D("hours-parse", ["hours", "opening times"], "geocode-store"),
      U("save-store", ["save", "store record"]),
    ] },

  // ============================================================ 20 OBSCURE
  // deliberately exotic domains — the conversion must STILL surface every named
  // work-unit as a step (generalize, not pattern-match familiar pipelines).
  { id: "bell-ringing-peal", common: false, loop: false,
    units: [
      U("choose-method", ["choose method", "ringing method"]),
      U("compose-peal", ["compose peal", "extent"]),
      D("prove-truth", ["prove truth", "no repeated row"], "compose-peal"),
      D("assign-bells", ["assign bells", "ringer order"], "compose-peal"),
      U("notate", ["notate", "write call sheet"]),
    ] },
  { id: "falconry-weight", common: false, loop: true, listName: "birds", item: "bird",
    units: [
      U("weigh-bird", ["weigh", "flying weight"]),
      U("assess-condition", ["assess condition", "mews check"]),
      D("ration-plan", ["ration", "casting"], "assess-condition"),
      U("log-bird", ["log", "weight record"]),
    ] },
  { id: "lutherie-setup", common: false, loop: true, listName: "instruments", item: "instrument",
    units: [
      U("measure-action", ["measure action", "string height"]),
      U("adjust-truss", ["adjust truss", "neck relief"]),
      D("intonation", ["intonation", "saddle"], "adjust-truss"),
      D("nut-slots", ["nut slot", "file nut"], "adjust-truss"),
      U("final-tune", ["final tune", "string up"]),
    ] },
  { id: "cuneiform-edit", common: false, loop: true, listName: "tablets", item: "tablet",
    units: [
      U("transliterate", ["transliterate", "sign reading"]),
      U("normalize-akkadian", ["normalize", "grammatical"]),
      D("mark-breaks", ["mark breaks", "lacuna"], "transliterate"),
      D("sign-list-ref", ["sign list", "borger"], "transliterate"),
      U("publish-edition", ["publish edition", "translation"]),
    ] },
  { id: "perfume-accord", common: false, loop: true, listName: "accords", item: "accord",
    units: [
      U("select-notes", ["select notes", "ingredients"]),
      U("balance-pyramid", ["balance", "top heart base"]),
      D("ifra-check", ["ifra", "regulatory limit"], "balance-pyramid"),
      U("record-formula", ["record formula", "percentages"]),
    ] },
  { id: "tide-mill-schedule", common: false, loop: true, listName: "tides", item: "tide",
    units: [
      U("predict-tide", ["predict tide", "tidal table"]),
      U("plan-grind", ["plan grind", "milling window"]),
      D("sluice-set", ["sluice", "pond level"], "plan-grind"),
      U("log-output", ["log output", "flour yield"]),
    ] },
  { id: "fresco-restoration", common: false, loop: true, listName: "panels", item: "panel",
    units: [
      U("survey-damage", ["survey damage", "condition map"]),
      U("consolidate", ["consolidate", "stabilize plaster"]),
      D("retouch-tratteggio", ["tratteggio", "in-painting"], "consolidate"),
      D("uv-document", ["uv", "document layers"], "consolidate"),
      U("final-varnish", ["varnish", "protective coat"]),
    ] },
  { id: "orienteering-course", common: false, loop: true, listName: "controls", item: "control",
    units: [
      U("place-control", ["place control", "feature pick"]),
      U("set-difficulty", ["set difficulty", "leg length"]),
      D("legality-check", ["legality", "out of bounds"], "set-difficulty"),
      U("print-control-desc", ["control description", "clue sheet"]),
    ] },
  { id: "raku-firing", common: false, loop: true, listName: "pieces", item: "piece",
    units: [
      U("bisque-load", ["bisque", "load kiln"]),
      U("glaze", ["glaze", "apply glaze"]),
      D("reduction-plan", ["reduction", "post-fire"], "glaze"),
      U("fire-quench", ["fire", "quench"]),
    ] },
  { id: "scrimshaw-engrave", common: false, loop: true, listName: "pieces", item: "piece",
    units: [
      U("design-transfer", ["design transfer", "trace pattern"]),
      U("engrave", ["engrave", "scribe lines"]),
      D("ink-rub", ["ink", "pigment rub"], "engrave"),
      U("seal-piece", ["seal", "finish"]),
    ] },
  { id: "dressage-test", common: false, loop: true, listName: "movements", item: "movement",
    units: [
      U("read-movement", ["read movement", "test sheet"]),
      U("score-movement", ["score", "mark"]),
      D("collective-marks", ["collective marks", "impulsion"], "score-movement"),
      U("tally", ["tally", "final percentage"]),
    ] },
  { id: "sourdough-cycle", common: false, loop: true, listName: "loaves", item: "loaf",
    units: [
      U("levain-build", ["levain", "starter feed"]),
      U("autolyse-mix", ["autolyse", "mix dough"]),
      D("fold-schedule", ["fold", "stretch and fold"], "autolyse-mix"),
      D("retard", ["retard", "cold proof"], "autolyse-mix"),
      U("bake", ["bake", "score and bake"]),
    ] },
  { id: "lighthouse-log", common: false, loop: false,
    units: [
      U("check-lamp", ["check lamp", "lantern"]),
      U("clean-optic", ["clean optic", "fresnel"]),
      D("fog-signal-test", ["fog signal", "horn"], "clean-optic"),
      U("log-watch", ["log watch", "keeper journal"]),
    ] },
  { id: "ikebana-arrange", common: false, loop: true, listName: "arrangements", item: "arrangement",
    units: [
      U("select-material", ["select material", "branches flowers"]),
      U("set-structure", ["set structure", "shin soe hikae"]),
      D("kenzan-fix", ["kenzan", "pin holder"], "set-structure"),
      U("finalize-arrangement", ["finalize", "display"]),
    ] },
  { id: "glassblowing-vessel", common: false, loop: true, listName: "vessels", item: "vessel",
    units: [
      U("gather-gob", ["gather", "gob"]),
      U("shape-form", ["shape", "marver block"]),
      D("color-apply", ["color", "frit roll"], "shape-form"),
      U("anneal", ["anneal", "lehr"]),
    ] },
  { id: "campanology-tower", common: false, loop: true, listName: "bells", item: "bell",
    units: [
      U("inspect-bell", ["inspect", "headstock"]),
      U("tune-bell", ["tune", "shave harmonic"]),
      D("clapper-set", ["clapper", "flight adjust"], "tune-bell"),
      U("rehang", ["rehang", "install"]),
    ] },
  { id: "marquetry-panel", common: false, loop: true, listName: "panels", item: "panel",
    units: [
      U("cut-veneer", ["cut veneer", "fret saw"]),
      U("assemble-pattern", ["assemble", "fit pieces"]),
      D("sand-shade", ["sand shade", "hot sand"], "assemble-pattern"),
      U("glue-press", ["glue", "press panel"]),
    ] },
  { id: "kombucha-batch", common: false, loop: true, listName: "batches", item: "batch",
    units: [
      U("brew-tea", ["brew tea", "sweet tea base"]),
      U("first-ferment", ["first ferment", "scoby"]),
      D("ph-monitor", ["ph", "acidity check"], "first-ferment"),
      D("flavor-second", ["flavor", "second ferment"], "first-ferment"),
      U("bottle", ["bottle", "carbonate"]),
    ] },
  { id: "astro-imaging", common: false, loop: true, listName: "targets", item: "target",
    units: [
      U("plan-session", ["plan session", "target altitude"]),
      U("capture-subs", ["capture", "sub frames"]),
      D("calibration-frames", ["calibration", "darks flats"], "capture-subs"),
      D("guiding", ["guiding", "autoguide"], "capture-subs"),
      U("stack-process", ["stack", "process image"]),
    ] },
  { id: "knot-tying-guide", common: false, loop: true, listName: "knots", item: "knot",
    units: [
      U("describe-use", ["describe use", "purpose"]),
      U("write-steps", ["write steps", "tying sequence"]),
      D("strength-note", ["strength", "breaking load"], "write-steps"),
      U("add-diagram", ["add diagram", "illustration"]),
    ] },
];
