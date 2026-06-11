#!/usr/bin/env node
// Re-runnable smoke harness for the 45-skill gate-authoring corpus.
//
// For each skill it asserts FOUR things and scores them:
//   1. VALID        — node board/bin/cli.js validate passes
//   2. LOOPS        — a `type: loop` exists iff the manifest says the skill iterates over a list
//   3. NON-VACUOUS  — every hard-gate RULE the conductor uses can be RED-TEAMED:
//                     verify(rule, good) exits 0 AND verify(rule, bad) exits non-zero.
//                     A rule whose BAD fixture passes is a vacuous gate (the bug we hunt).
//   4. GROUNDED     — at least one hard gate cross-checks output against a --ground artifact
//                     (intent-alignment proxy: the gate compares to real data, not the agent's own output)
//
// Switch AUTHORING=naive to score the pre-fix logic and watch NON-VACUOUS + GROUNDED collapse.
//
// Run:   node tests/gate-authoring-corpus/run.mjs            (from repo root)
//        AUTHORING=naive node tests/gate-authoring-corpus/run.mjs
// Output: console summary + report.<authoring>.json  + report.md

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";
import yaml from "../../node_modules/js-yaml/dist/js-yaml.mjs";
import { FIXTURES } from "./redteam-fixtures.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const AUTHORING = process.env.AUTHORING === "naive" ? "naive" : "improved";
const cli = path.join(repoRoot, "board/bin/cli.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));

// Regenerate corpus for the requested authoring mode so the harness always scores fresh files.
execFileSync(process.execPath, [path.join(__dirname, "gen.mjs")], { env: { ...process.env, AUTHORING }, stdio: "ignore" });

const tmp = fs.mkdtempSync(path.join(__dirname, ".rt-"));
function writeFixture(obj) {
  const outP = path.join(tmp, "o.json");
  const grP = path.join(tmp, "g.json");
  fs.writeFileSync(outP, JSON.stringify(obj.out ?? {}));
  if (obj.ground !== undefined) fs.writeFileSync(grP, JSON.stringify(obj.ground));
  else fs.rmSync(grP, { force: true });
  return { outP, grP: obj.ground !== undefined ? grP : undefined };
}
function verify(rule, fixture) {
  const { outP, grP } = writeFixture(fixture);
  const args = [path.join(__dirname, "verify.mjs"), rule, "--out", outP];
  if (grP) args.push("--ground", grP);
  try {
    execFileSync(process.execPath, args, { stdio: "ignore" });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

// Walk a conductor's steps (incl. loop sub-steps), collecting hard-gate checks.
function collectChecks(steps, acc) {
  for (const s of steps ?? []) {
    for (const g of s.gate ?? []) {
      if (g && typeof g === "object" && typeof g.check === "string") acc.push(g.check);
    }
    if (s.type === "loop") collectChecks(s.steps, acc);
  }
}
function hasLoop(steps) {
  return (steps ?? []).some((s) => s.type === "loop");
}

// Parse "node verify.mjs <rule> --out ... --ground ..." → { rule, grounded }
function parseCheck(check) {
  const m = check.match(/verify\.mjs\s+(\S+)/);
  if (!m) return null; // board-sync / npx checks — not a grounding gate
  return { rule: m[1], grounded: /--ground/.test(check) };
}

const results = [];
for (const skill of manifest.skills) {
  const file = path.join(__dirname, "conductors", `${skill.id}.conductor.yaml`);
  const r = { id: skill.id, common: skill.common, valid: false, loopOk: false, expectLoop: skill.loop,
    rules: [], vacuous: [], proven: [], hasGroundedGate: false, errors: [] };

  // 1. VALID
  try { execFileSync(process.execPath, [cli, "validate", file], { stdio: "ignore" }); r.valid = true; }
  catch { r.errors.push("validation failed"); }

  const doc = yaml.load(fs.readFileSync(file, "utf8"));
  // 2. LOOPS
  r.loopOk = hasLoop(doc.steps) === skill.loop;
  if (!r.loopOk) r.errors.push(skill.loop ? "expected a loop, none found" : "unexpected loop");

  // 3 + 4. gather checks
  const checks = [];
  collectChecks(doc.steps, checks);
  const seenRules = new Set();
  for (const c of checks) {
    const p = parseCheck(c);
    if (!p) continue;
    if (p.grounded) r.hasGroundedGate = true;
    if (seenRules.has(p.rule)) continue;
    seenRules.add(p.rule);
    r.rules.push(p.rule);
    const fx = FIXTURES[p.rule];
    if (!fx) { r.errors.push(`no red-team fixture for rule ${p.rule}`); continue; }
    const goodExit = verify(p.rule, fx.good);
    const badExit = verify(p.rule, fx.bad);
    const provesIt = goodExit === 0 && badExit !== 0;
    if (provesIt) r.proven.push(p.rule);
    else r.vacuous.push({ rule: p.rule, goodExit, badExit, vacuousOnPurpose: !!fx.bad.vacuousOnPurpose });
  }

  // SCORE (0-4): valid, loopOk, all-rules-proven (no vacuous), has a grounded gate
  const allProven = r.rules.length > 0 && r.vacuous.length === 0;
  r.score = [r.valid, r.loopOk, allProven, r.hasGroundedGate].filter(Boolean).length;
  r.intentAligned = allProven && r.hasGroundedGate;
  results.push(r);
}

fs.rmSync(tmp, { recursive: true, force: true });

// ---- report ----
const total = results.length;
const perfect = results.filter((r) => r.score === 4).length;
const validC = results.filter((r) => r.valid).length;
const loopC = results.filter((r) => r.loopOk).length;
const intentC = results.filter((r) => r.intentAligned).length;
const groundC = results.filter((r) => r.hasGroundedGate).length;
const vacuousSkills = results.filter((r) => r.vacuous.length > 0);
const obscure = results.filter((r) => !r.common);
const obscurePerfect = obscure.filter((r) => r.score === 4).length;

const C = (s) => `\x1b[36m${s}\x1b[0m`;
console.log(`\n=== Gate-authoring smoke harness  (AUTHORING=${C(AUTHORING)}) ===\n`);
console.log(`Skills:            ${total}  (${obscure.length} obscure)`);
console.log(`Valid:             ${validC}/${total}`);
console.log(`Loops-as-expected: ${loopC}/${total}`);
console.log(`Has grounded gate: ${groundC}/${total}`);
console.log(`Intent-aligned*:   ${intentC}/${total}   (*all hard gates red-teamable + cross-checks real data)`);
console.log(`Perfect (4/4):     ${perfect}/${total}   |  obscure perfect: ${obscurePerfect}/${obscure.length}`);
if (vacuousSkills.length) {
  console.log(`\n${vacuousSkills.length} skill(s) with VACUOUS gates (bad output passes the gate):`);
  for (const r of vacuousSkills.slice(0, 6)) {
    console.log(`  - ${r.id}: ${r.vacuous.map((v) => `${v.rule}[good=${v.goodExit},bad=${v.badExit}]`).join(", ")}`);
  }
  if (vacuousSkills.length > 6) console.log(`  …and ${vacuousSkills.length - 6} more`);
}
console.log("");

fs.writeFileSync(path.join(__dirname, `report.${AUTHORING}.json`),
  JSON.stringify({ authoring: AUTHORING, summary: { total, valid: validC, loopC, intentC, groundC, perfect, obscurePerfect, obscureTotal: obscure.length }, results }, null, 2));

// human-readable md (only rewrite for improved, the canonical run)
if (AUTHORING === "improved") {
  const L = ["# Gate-authoring corpus — assessment (improved logic)", "",
    `${perfect}/${total} skills score 4/4 (valid + loop-as-expected + every hard gate red-teamable + cross-checks real data).`,
    `Obscure skills perfect: **${obscurePerfect}/${obscure.length}** — the generalization test.`, "",
    "| skill | obscure | valid | loop✓ | grounded | intent-aligned | rules proven |", "|---|---|---|---|---|---|---|"];
  for (const r of results) {
    L.push(`| ${r.id} | ${r.common ? "" : "★"} | ${r.valid ? "✓" : "✗"} | ${r.loopOk ? "✓" : "✗"} | ${r.hasGroundedGate ? "✓" : "✗"} | ${r.intentAligned ? "✓" : "✗"} | ${r.proven.length}/${r.rules.length} |`);
  }
  fs.writeFileSync(path.join(__dirname, "report.md"), L.join("\n") + "\n");
}

const ok = AUTHORING === "improved" ? perfect === total : true;
process.exit(ok ? 0 : 1);
