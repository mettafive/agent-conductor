#!/usr/bin/env node
// Re-runnable smoke harness for the 120-case substep-divider (visual-step coverage) corpus.
//
// This is the VISIBILITY counterpart to the gate-authoring harness. Where that one scores
// "does every hard gate fail bad work?", this one scores "does the conversion surface a
// VISIBLE STEP/SUB-STEP for EVERY distinct work-unit the skill names — including the pure
// 'divider' phases that carry no hard gate?"
//
// For each case it asserts, per declared work-unit:
//   - VALID            the conductor passes `board/bin/cli.js validate`
//   - SURFACED         the unit has its OWN visual step/sub-step (a card on the board), not
//                      folded into a sibling step's instruction prose
//   - DIVIDERS KEPT    divider (visibility-only) units are surfaced too — gate-less is fine,
//                      hidden is NOT
// Score = visual-step coverage = surfaced units / declared units. A case is "complete" at 1.0.
//
// Switch COVERAGE=naive to score the pre-fix folding logic and watch coverage collapse —
// exactly the daily-enrichment failure (the SEO work folded into research/write, no card).
//
// Run:   node tests/substep-divider-corpus/run.mjs            (from repo root)
//        COVERAGE=naive node tests/substep-divider-corpus/run.mjs
// Output: console scoreboard + report.<coverage>.json + report.md

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";
import { SPECS } from "./specs.mjs";
import { coverageFor, loadConductor } from "./coverage.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const COVERAGE = process.env.COVERAGE === "naive" ? "naive" : "improved";
const cli = path.join(repoRoot, "board/bin/cli.js");
const VALIDATE = process.env.SKIP_VALIDATE !== "1";

// Regenerate the corpus for the requested mode so the harness always scores fresh files.
execFileSync(process.execPath, [path.join(__dirname, "gen.mjs")], {
  env: { ...process.env, COVERAGE }, stdio: "ignore",
});

const results = [];
for (const spec of SPECS) {
  const file = path.join(__dirname, "conductors", `${spec.id}.conductor.yaml`);
  const r = {
    id: spec.id, common: spec.common,
    valid: false,
    declared: spec.units.length,
    dividers: spec.units.filter((u) => u.divider).length,
    surfaced: 0, folded: [], missing: [], hiddenDividers: [],
  };

  if (VALIDATE) {
    try { execFileSync(process.execPath, [cli, "validate", file], { stdio: "ignore" }); r.valid = true; }
    catch { r.valid = false; }
  } else r.valid = true;

  const doc = loadConductor(file);
  const cov = coverageFor(spec, doc);
  for (const u of spec.units) {
    const c = cov[u.id];
    if (c.status === "surfaced") r.surfaced++;
    else if (c.status === "folded") {
      r.folded.push({ unit: u.id, into: c.foldedInto, divider: u.divider });
      if (u.divider) r.hiddenDividers.push(u.id);
    } else {
      r.missing.push({ unit: u.id, divider: u.divider });
      if (u.divider) r.hiddenDividers.push(u.id);
    }
  }
  r.coverage = r.surfaced / r.declared;
  r.complete = r.valid && r.coverage === 1;
  results.push(r);
}

// ---- report ----
const total = results.length;
const complete = results.filter((r) => r.complete).length;
const validC = results.filter((r) => r.valid).length;
const declaredTot = results.reduce((a, r) => a + r.declared, 0);
const surfacedTot = results.reduce((a, r) => a + r.surfaced, 0);
const dividerTot = results.reduce((a, r) => a + r.dividers, 0);
const hiddenDividerTot = results.reduce((a, r) => a + r.hiddenDividers.length, 0);
const foldedTot = results.reduce((a, r) => a + r.folded.length, 0);
const missingTot = results.reduce((a, r) => a + r.missing.length, 0);
const obscure = results.filter((r) => !r.common);
const obscureComplete = obscure.filter((r) => r.complete).length;
const casesWithHidden = results.filter((r) => r.folded.length || r.missing.length);

const C = (s) => `\x1b[36m${s}\x1b[0m`;
console.log(`\n=== Substep-divider visual-step coverage harness  (COVERAGE=${C(COVERAGE)}) ===\n`);
console.log(`Cases:                 ${total}  (${obscure.length} obscure)`);
console.log(`Valid conductors:      ${validC}/${total}`);
console.log(`Visual-step coverage:  ${surfacedTot}/${declaredTot} work-units surfaced  (${(100 * surfacedTot / declaredTot).toFixed(1)}%)`);
console.log(`Divider visibility:    ${dividerTot - hiddenDividerTot}/${dividerTot} divider phases surfaced  (${hiddenDividerTot} hidden)`);
console.log(`Folded / missing:      ${foldedTot} folded into a sibling, ${missingTot} missing entirely`);
console.log(`Complete cases (100%): ${complete}/${total}   |  obscure complete: ${obscureComplete}/${obscure.length}`);
if (casesWithHidden.length) {
  console.log(`\n${casesWithHidden.length} case(s) HIDING a named work-unit (no card — the daily-enrichment bug):`);
  for (const r of casesWithHidden.slice(0, 8)) {
    const hid = [...r.folded.map((f) => `${f.unit}${f.divider ? "*" : ""}→${f.into}`),
                 ...r.missing.map((m) => `${m.unit}${m.divider ? "*" : ""}(missing)`)].join(", ");
    console.log(`  - ${r.id}: ${hid}`);
  }
  if (casesWithHidden.length > 8) console.log(`  …and ${casesWithHidden.length - 8} more  (* = a visibility divider hidden)`);
}
console.log("");

fs.writeFileSync(path.join(__dirname, `report.${COVERAGE}.json`),
  JSON.stringify({ coverage: COVERAGE,
    summary: { total, validC, declaredTot, surfacedTot, dividerTot, hiddenDividerTot, foldedTot, missingTot, complete, obscureComplete, obscureTotal: obscure.length },
    results }, null, 2));

if (COVERAGE === "improved") {
  const L = ["# Substep-divider corpus — visual-step coverage (improved logic)", "",
    `${complete}/${total} cases surface a board card for **every** named work-unit.`,
    `Visual-step coverage: **${surfacedTot}/${declaredTot}** units (${(100 * surfacedTot / declaredTot).toFixed(1)}%).`,
    `Divider phases surfaced: **${dividerTot - hiddenDividerTot}/${dividerTot}** (gate-less dividers are GOOD — they still get a card).`,
    `Obscure cases complete: **${obscureComplete}/${obscure.length}** — the generalization test.`, "",
    "| case | obscure | valid | declared | surfaced | dividers kept | coverage |",
    "|---|---|---|---|---|---|---|"];
  for (const r of results) {
    L.push(`| ${r.id} | ${r.common ? "" : "★"} | ${r.valid ? "✓" : "✗"} | ${r.declared} | ${r.surfaced} | ${r.dividers - r.hiddenDividers.length}/${r.dividers} | ${(100 * r.coverage).toFixed(0)}% |`);
  }
  fs.writeFileSync(path.join(__dirname, "report.md"), L.join("\n") + "\n");
}

const ok = COVERAGE === "improved" ? complete === total : true;
process.exit(ok ? 0 : 1);
