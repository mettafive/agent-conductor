#!/usr/bin/env node
// Corpus generator for the gate-authoring stress test.
// Emits, per skill: a short skill description (.md) and a converted conductor (.yaml).
//
// IMPORTANT: this generator embodies the gate-authoring LOGIC under test. Each skill
// spec declares the grounding source and per-step gate intents; the generator renders
// them into conductor YAML. To compare the OLD (naive) vs IMPROVED authoring logic we
// expose a single switch: process.env.AUTHORING = "naive" | "improved" (default improved).
//
// naive    = the pre-fix behaviour: surface lints / step-restatements, no grounding cross-check,
//            no per-skill red-team, loops sometimes flattened. This is what we score to find the bug.
// improved = authored to the (improved) CONDUCTOR.md bar: every key gate cross-validates the
//            step output against the declared grounding source, hard where mechanical, red-teamable.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const AUTHORING = process.env.AUTHORING === "naive" ? "naive" : "improved";
const skillsDir = path.join(__dirname, "skills");
const condDir = path.join(__dirname, "conductors");
fs.mkdirSync(skillsDir, { recursive: true });
fs.mkdirSync(condDir, { recursive: true });

// ---------------------------------------------------------------------------
// Per-skill specs. Each declares:
//   intent      one-line goal (a green run must mean THIS happened)
//   loop        does it iterate over a list? (loop EXPECTED)
//   listName    the list variable a loop iterates (set by a discover step's output)
//   item        loop item variable
//   discover    the up-front step that produces the list + the grounding bundle
//   ground      label of the real data each gate cross-checks against (NOT the agent's own output)
//   steps       per-item (or flat) procedure: { id, does, gate:[...] }
//               each gate: { name, kind:'hard'|'soft', surface (naive form), substance (improved form),
//                            redteam: a plausible bad output the improved gate FAILS }
//   finalGate   a flat closing step's coverage gate
// ---------------------------------------------------------------------------

// Helper to build a grounding-checked hard gate that exercises a real fixture file.
// The check shells out to a generic verifier (verify.mjs) that compares an OUTPUT artifact
// against a GROUNDING artifact under a named rule — this is what makes the gate non-vacuous
// and red-teamable in the harness without needing each skill's real domain tooling.
const g = (name, rule, opts = {}) => ({ name, rule, ...opts });

import { SPECS } from "./specs.mjs";

function yamlQuote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function renderGate(gate, skillId, itemVar) {
  // gate.kind: 'hard' => emits a check: that calls verify.mjs against fixtures.
  //            'soft' => emits a judgment string.
  const slug = itemVar ? "<item>" : skillId;
  if (gate.kind === "soft") {
    const txt = AUTHORING === "naive" ? gate.surface : gate.substance;
    return `      - ${yamlQuote(txt)}`;
  }
  // hard gate
  if (AUTHORING === "naive") {
    // naive: a surface lint — just checks the output file exists / parses. Vacuous by design.
    return [
      `      - name: ${yamlQuote(gate.name + " (output present)")}`,
      `        check: ${yamlQuote(`node verify.mjs exists --out fixtures/${skillId}/${slug}.out.json`)}`,
    ].join("\n");
  }
  // improved: cross-validate the output against the grounding fixture under the named rule.
  return [
    `      - name: ${yamlQuote(gate.name)}`,
    `        check: ${yamlQuote(
      `node verify.mjs ${gate.rule} --out fixtures/${skillId}/${slug}.out.json --ground fixtures/${skillId}/${slug}.ground.json`,
    )}`,
  ].join("\n");
}

function renderStepGates(step, skillId, itemVar) {
  const lines = [];
  // board-sync first criterion (spec 2.0.0 convention)
  lines.push(`      - check: ${yamlQuote(`npx conductor-board check ${step.id}`)}`);
  for (const gate of step.gate) lines.push(renderGate(gate, skillId, itemVar));
  return lines.join("\n");
}

function renderConductor(spec) {
  const L = [];
  L.push("conductor: 2.0.0");
  L.push(`name: ${spec.id}`);
  L.push(`description: >`);
  L.push(`  ${spec.intent}`);
  L.push("");
  if (spec.loop) {
    // discover step that sets the list + writes grounding bundles
    L.push("steps:");
    L.push(`  - id: ${spec.discover.id}`);
    L.push("    instruction: |");
    for (const ln of spec.discover.does.split("\n")) L.push(`      ${ln}`);
    L.push(`    output: ${spec.listName}`);
    L.push("    gate:");
    L.push(`      - check: ${yamlQuote(`npx conductor-board check ${spec.discover.id}`)}`);
    for (const gate of spec.discover.gate) L.push(renderGate(gate, spec.id, null));
    L.push("");
    // the loop
    L.push(`  - id: ${spec.id}-loop`);
    L.push("    type: loop");
    L.push(`    over: ${spec.listName}`);
    L.push(`    as: ${spec.item}`);
    L.push(`    requires: [${spec.discover.id}]`);
    L.push("    steps:");
    for (const step of spec.steps) {
      L.push(`      - id: ${step.id}`);
      L.push("        instruction: |");
      for (const ln of step.does.split("\n")) L.push(`          ${ln}`);
      L.push("        gate:");
      for (const ln of renderStepGates(step, spec.id, spec.item).split("\n"))
        L.push("    " + ln);
    }
    L.push("");
    // closing coverage step
    L.push(`  - id: ${spec.id}-finish`);
    L.push("    instruction: |");
    for (const ln of spec.finish.does.split("\n")) L.push(`      ${ln}`);
    L.push(`    requires: [${spec.id}-loop]`);
    L.push("    gate:");
    L.push(`      - check: ${yamlQuote(`npx conductor-board check ${spec.id}-finish`)}`);
    for (const gate of spec.finish.gate) L.push(renderGate(gate, spec.id, null));
  } else {
    L.push("steps:");
    let prev = null;
    for (const step of spec.steps) {
      L.push(`  - id: ${step.id}`);
      L.push("    instruction: |");
      for (const ln of step.does.split("\n")) L.push(`      ${ln}`);
      if (prev) L.push(`    requires: [${prev}]`);
      L.push("    gate:");
      L.push(`      - check: ${yamlQuote(`npx conductor-board check ${step.id}`)}`);
      for (const gate of step.gate) L.push(renderGate(gate, spec.id, null));
      prev = step.id;
    }
  }
  L.push("");
  return L.join("\n");
}

function renderSkillDoc(spec) {
  const L = [];
  L.push(`# Skill: ${spec.id}`);
  L.push("");
  L.push(`**Intent:** ${spec.intent}`);
  L.push("");
  L.push(`**Grounding source (truth the work is checked against):** ${spec.ground}`);
  L.push("");
  L.push(spec.loop ? "**Shape:** iterates over a list (per-item procedure)." : "**Shape:** single pass.");
  L.push("");
  L.push("## Procedure");
  if (spec.loop) {
    L.push(`1. ${spec.discover.does.split("\n")[0]}`);
    L.push(`2. For each ${spec.item} in the list:`);
    spec.steps.forEach((s, i) => L.push(`   ${String.fromCharCode(97 + i)}. ${s.does.split("\n")[0]}`));
    L.push(`3. ${spec.finish.does.split("\n")[0]}`);
  } else {
    spec.steps.forEach((s, i) => L.push(`${i + 1}. ${s.does.split("\n")[0]}`));
  }
  L.push("");
  return L.join("\n");
}

let count = 0;
for (const spec of SPECS) {
  fs.writeFileSync(path.join(skillsDir, `${spec.id}.md`), renderSkillDoc(spec));
  fs.writeFileSync(path.join(condDir, `${spec.id}.conductor.yaml`), renderConductor(spec));
  count++;
}
console.log(`Generated ${count} skills + conductors (AUTHORING=${AUTHORING}) into ${path.relative(process.cwd(), skillsDir)} and ${path.relative(process.cwd(), condDir)}`);
