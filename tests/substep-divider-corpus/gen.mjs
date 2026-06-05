#!/usr/bin/env node
// Corpus generator for the substep-divider (visual-step coverage) stress test.
// Emits, per case: a skill description (.md naming every work-unit as a phase) and
// a converted conductor (.yaml).
//
// This generator embodies the CONVERSION LOGIC under test along the VISIBILITY axis.
// One switch selects the logic:
//   process.env.COVERAGE = "naive" | "improved"   (default improved)
//
// naive    = the pre-fix behaviour that caused the daily-enrichment failure: it only
//            creates a STEP when a unit needs a hard GATE, and FOLDS every gate-less
//            "divider" phase (and some gateable ones) into a sibling step's prose.
//            The board then hides those phases — the bug we hunt.
// improved = granular-by-default: EVERY distinct, user-named work-unit becomes its OWN
//            visual step/sub-step, even when it carries only a soft attestation or no
//            gate at all (a "substep divider"). The board reads as a complete story.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { SPECS } from "./specs.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const COVERAGE = process.env.COVERAGE === "naive" ? "naive" : "improved";
const skillsDir = path.join(__dirname, "skills");
const condDir = path.join(__dirname, "conductors");
fs.mkdirSync(skillsDir, { recursive: true });
fs.mkdirSync(condDir, { recursive: true });

function yamlQuote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
const titleOf = (u) => u.id.replace(/-/g, " ");
const phrase = (u) => `${titleOf(u)} (${u.kw[0]})`;

// ---------------------------------------------------------------------------
// Skill doc — names EVERY work-unit as a recognizable phase, regardless of gate.
// This is the user's mental model of the board: each phase here is something they
// will scan for. A divider phase is named just as prominently as a gateable one.
// ---------------------------------------------------------------------------
function renderSkillDoc(spec) {
  const L = [];
  L.push(`# Skill: ${spec.id}`);
  L.push("");
  L.push(`**Shape:** ${spec.loop ? `iterates over each ${spec.item} in ${spec.listName}` : "single pass"}.`);
  L.push("");
  L.push("**Distinct work-units this skill performs** (each is a phase the user will look for on the board):");
  L.push("");
  for (const u of spec.units) {
    const tag = u.divider ? "  _(visibility divider — no hard gate needed)_" : "";
    L.push(`- **${titleOf(u)}** — ${u.kw.join(", ")}.${tag}`);
  }
  L.push("");
  L.push("## Procedure");
  if (spec.loop) {
    L.push(`For each ${spec.item} in ${spec.listName}:`);
    spec.units.forEach((u, i) =>
      L.push(`  ${i + 1}. ${titleOf(u)} — ${u.kw.join(", ")}.`));
  } else {
    spec.units.forEach((u, i) => L.push(`${i + 1}. ${titleOf(u)} — ${u.kw.join(", ")}.`));
  }
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Conductor renderer.
//
// In NAIVE mode we compute a "fold map": any unit with foldInto is NOT emitted as a
// step; instead its prose is appended to the foldInto target's instruction (so the
// board never shows a card for it). This reproduces the exact failure mode.
//
// In IMPROVED mode every unit is emitted as its own step/sub-step. Divider units get
// a soft attestation gate (gate:'soft') or NO gate at all (gate:'none') — both are
// legitimate; visibility is orthogonal to gating.
// ---------------------------------------------------------------------------
function emittedUnits(spec) {
  if (COVERAGE === "improved") return { steps: spec.units, folds: {} };
  // naive: drop folded units, record their prose under the target
  const folds = {};
  const steps = [];
  for (const u of spec.units) {
    if (u.foldInto) {
      (folds[u.foldInto] ??= []).push(u);
    } else {
      steps.push(u);
    }
  }
  return { steps, folds };
}

// gate criteria, emitted at column `pad+2` (under the `gate:` key at `pad`).
function gateLines(u, stepId, pad) {
  const L = [`${pad}- check: ${yamlQuote(`npx conductor-board check ${stepId}`)}`];
  if (u.gate === "hard") {
    L.push(`${pad}- name: ${yamlQuote(`${titleOf(u)} is correct`)}`);
    L.push(`${pad}  check: ${yamlQuote(`node verify-unit.mjs ${u.id} --out out/${u.id}.json`)}`);
  } else if (u.gate === "soft") {
    L.push(`${pad}- ${yamlQuote(`${titleOf(u)} done and looks right (soft attestation — a visibility divider, not a hard gate)`)}`);
  } else {
    // gate:'none' — a pure divider. Still a visible step; its only criterion is
    // board-sync, which proves the card was opened and narrated (visibility, not gating).
    L.push(`${pad}# divider step: no substantive gate — exists purely so the board shows this phase`);
  }
  return L.join("\n");
}

function renderUnitStep(u, indent, stepId, extraProse) {
  const pad = " ".repeat(indent);
  const L = [];
  L.push(`${pad}- id: ${u.id}`);
  L.push(`${pad}  instruction: |`);
  L.push(`${pad}    ${titleOf(u)}: ${u.kw.join(", ")}.`);
  if (extraProse && extraProse.length) {
    // NAIVE fold: the hidden units' work crammed into this step's prose.
    for (const f of extraProse)
      L.push(`${pad}    Also handle ${titleOf(f)} (${f.kw.join(", ")}) as part of this step.`);
  }
  L.push(`${pad}  gate:`);
  L.push(gateLines(u, stepId, pad + "    "));
  return L.join("\n");
}

function renderConductor(spec) {
  const { steps, folds } = emittedUnits(spec);
  const L = [];
  L.push("conductor: 2.0.0");
  L.push(`name: ${spec.id}`);
  L.push("description: >");
  L.push(`  ${spec.id.replace(/-/g, " ")} — converted from a skill that names ${spec.units.length} distinct work-units.`);
  L.push("");
  L.push("steps:");

  if (spec.loop) {
    // discover step that produces the list
    L.push(`  - id: scope-${spec.listName}`);
    L.push("    instruction: |");
    L.push(`      Scope the ${spec.listName} to process. Frontload every ${spec.item} as a pending iteration.`);
    L.push(`    output: ${spec.listName}`);
    L.push("    gate:");
    L.push(`      - check: ${yamlQuote(`npx conductor-board check scope-${spec.listName}`)}`);
    L.push(`      - ${yamlQuote(`Every ${spec.item} captured before any work begins`)}`);
    L.push("");
    L.push(`  - id: ${spec.id}-loop`);
    L.push("    type: loop");
    L.push(`    over: ${spec.listName}`);
    L.push(`    as: ${spec.item}`);
    L.push(`    requires: [scope-${spec.listName}]`);
    L.push("    steps:");
    for (const u of steps) {
      L.push(renderUnitStep(u, 6, u.id, folds[u.id]));
    }
  } else {
    let prev = null;
    for (const u of steps) {
      // top-level flat step
      L.push(`  - id: ${u.id}`);
      L.push("    instruction: |");
      L.push(`      ${titleOf(u)}: ${u.kw.join(", ")}.`);
      for (const f of folds[u.id] ?? [])
        L.push(`      Also handle ${titleOf(f)} (${f.kw.join(", ")}) as part of this step.`);
      if (prev) L.push(`    requires: [${prev}]`);
      L.push("    gate:");
      L.push(gateLines(u, u.id, "      "));
      prev = u.id;
    }
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
console.log(`Generated ${count} skills + conductors (COVERAGE=${COVERAGE}).`);
