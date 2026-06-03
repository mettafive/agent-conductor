export interface Example {
  id: string;
  name: string;
  tagline: string;
  pattern: string;
  accent: "iris" | "cyan" | "mint";
  yaml: string;
}

export const BASIC_REPORT = `conductor: 2.0.0
name: basic-report
description: Research, outline, write, review.

inputs:
  - topic
  - audience

steps:
  - id: research
    instruction: |
      Research {topic} for {audience}.
      Gather at least five credible sources.
    gate:
      - "At least 5 sources, each with a URL and takeaway"
    output: sources

  - id: outline
    instruction: |
      Draft a structured outline from {sources}.
    requires: [research]
    gate:
      - "Clear narrative arc, not just a list of facts"
    output: outline

  - id: write
    instruction: |
      Write the report from {outline}, citing every claim.
    requires: [outline]
    gate:
      - "Every claim cites a source"
      - "No placeholder text remains"
      - check: "test -f report.md"

  - id: review
    instruction: |
      Critically review and finalize the report.
    requires: [write]
    gate:
      - "Reads naturally end to end for {audience}"
`;

export const TREATMENT_PAGE = `conductor: 2.0.0
name: treatment-page
description: Branching SEO page builder with an insurance detour.

inputs:
  - treatment
  - animal

steps:
  - id: research
    instruction: |
      Research the {treatment} for {animal}.
    gate:
      - "Covers what, when, cost, and owner concerns"
    output: research

  - id: insurance-relevant
    instruction: |
      Does pet insurance meaningfully affect {treatment}?
    type: condition
    if_true: compare-insurers
    if_false: write-page

  - id: compare-insurers
    instruction: |
      Compare how major insurers cover {treatment}.
    gate:
      - "At least 3 insurers compared on coverage and cost"
    output: insurance_table
    then: write-page

  - id: write-page
    instruction: |
      Write the {treatment} page for {animal} owners.
    gate:
      - "Answers the owner's top 3 questions first"
      - check: "test -f treatment-page.html"

  - id: seo-check
    instruction: |
      Audit the page for SEO and target keyword.
    requires: [write-page]
    gate:
      - "Title, meta, and headings are correct"
      - name: "HTML validates"
        check: "npx html-validate treatment-page.html"
`;

export const CODE_REVIEW = `conductor: 2.0.0
name: code-review
description: Gates-heavy PR review with a security branch.

inputs:
  - pr_number

steps:
  - id: read-pr
    instruction: |
      Read the full diff for PR #{pr_number}.
    gate:
      - "Every changed file accounted for"
    output: diff_summary

  - id: touches-security
    instruction: |
      Does this PR touch auth, secrets, or input handling?
    type: condition
    if_true: security-audit
    if_false: coverage-check

  - id: security-audit
    instruction: |
      Audit changed files against the OWASP top 10.
    gate:
      - "Each finding has a file:line and a fix"
      - name: "No secrets committed"
        check: "! git grep -nE 'secret|api_key'"
    then: coverage-check

  - id: coverage-check
    instruction: |
      Verify tests cover new behavior and pass.
    gate:
      - "New logic has tests"
      - name: "Suite passes"
        check: "npm test"

  - id: style-check
    instruction: |
      Check the diff against project style.
    requires: [coverage-check]
    gate:
      - name: "Lint clean"
        check: "eslint . --max-warnings 0"
      - name: "Types check"
        check: "tsc --noEmit"

  - id: write-review
    instruction: |
      Write the review with a verdict.
    requires: [style-check]
    gate:
      - "Verdict is explicit and justified"
      - check: "test -f review.md"
`;

export const DAILY_PRICE = `conductor: 2.0.0
name: daily-price
description: Scrape each clinic's prices in parallel, validate, snapshot.

inputs:
  - region

steps:
  - id: pick-clinics
    instruction: |
      List active clinics in {region} that have a website.
    gate:
      - "Every clinic has a name and a reachable URL"
    output: clinics

  - id: scrape-and-price
    type: loop
    over: clinics
    as: clinic
    parallel: true            # iterations run simultaneously
    steps:
      - id: discover-prices
        instruction: Scrape {clinic} via nav + sitemap.
        gate:
          - check: "npx conductor-board check scrape-and-price"
          - "Prices extracted verbatim with currency"
      - id: persist
        instruction: Write {clinic}'s prices to the database.
        gate:
          - check: "node verify-write.js {clinic}"

  - id: summarize
    instruction: Compare before/after; write the report.
    requires: [scrape-and-price]
    gate:
      - "Report flags anomalies per clinic"
`;

export const CONTENT_PIPELINE = `conductor: 2.0.0
name: content-pipeline
description: Polish a batch of pages, then a human approves before shipping.

inputs:
  - page_list

steps:
  - id: polish
    type: loop
    over: page_list
    as: page
    steps:
      - id: write-page
        instruction: Polish {page} to the bar.
        gate:
          - "Reads naturally; no placeholder text remains"
      - id: check-links
        instruction: Verify every link on {page} resolves.
        gate:
          - check: "node check-links.js {page}"

  - id: approve-batch
    type: approval            # pauses for a human decision
    instruction: Review the polished pages before they ship.
    requires: [polish]
    approval:
      prompt: "Ship these pages to production?"
      items:
        - "{page} — ready to ship"
      actions:
        approve: ship
        reject: revise

  - id: ship
    instruction: Ship the approved pages live.
    requires: [approve-batch]
    gate:
      - check: "node verify-deployment.js"

  - id: revise
    instruction: Take rejected pages back through polish.
    gate:
      - "Every rejected page has been addressed"
`;

// Ordered impressive → approachable: land on the real-world one, click down to simpler.
export const EXAMPLES: Example[] = [
  {
    id: "daily-price",
    name: "daily-price",
    tagline:
      "A real-world parallel loop — scrape each clinic at once, mixed soft + hard gates.",
    pattern: "Parallel loop",
    accent: "mint",
    yaml: DAILY_PRICE,
  },
  {
    id: "content-pipeline",
    name: "content-pipeline",
    tagline: "A polish loop held at a `type: approval` human gate before anything ships.",
    pattern: "Loop + approval",
    accent: "cyan",
    yaml: CONTENT_PIPELINE,
  },
  {
    id: "basic-report",
    name: "basic-report",
    tagline: "A linear pipeline — research, outline, write, review. One gate per step.",
    pattern: "Linear",
    accent: "iris",
    yaml: BASIC_REPORT,
  },
  {
    id: "treatment-page",
    name: "treatment-page",
    tagline:
      "Branches on whether insurance matters, then rejoins. Shows conditions and `then`.",
    pattern: "Branching",
    accent: "cyan",
    yaml: TREATMENT_PAGE,
  },
  {
    id: "code-review",
    name: "code-review",
    tagline:
      "A security branch plus strict coverage and style gates. Hard checks throughout.",
    pattern: "Gates-heavy",
    accent: "mint",
    yaml: CODE_REVIEW,
  },
];
