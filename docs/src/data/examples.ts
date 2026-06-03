export interface Example {
  id: string;
  name: string;
  tagline: string;
  pattern: string;
  accent: "iris" | "cyan" | "mint";
  yaml: string;
}

export const BASIC_REPORT = `conductor: 1.0.0
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

export const TREATMENT_PAGE = `conductor: 1.0.0
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

export const CODE_REVIEW = `conductor: 1.0.0
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

export const EXAMPLES: Example[] = [
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
