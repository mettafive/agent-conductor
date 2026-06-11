#!/usr/bin/env node
// Minimal stand-in verifier so the corpus's hard-gate `check:` commands are real,
// runnable shell commands (keeps the conductors valid + executable). This corpus tests
// VISIBILITY (does every work-unit get a card?), not gate substance — gate substance is
// the sibling gate-authoring-corpus's job. So this verifier just confirms the unit's
// output artifact exists; the visual-step coverage assertions live in run.mjs.
//
// Usage: node verify-unit.mjs <unit-id> --out <file>
import fs from "node:fs";
const out = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : undefined; })();
if (out && fs.existsSync(out)) { console.log("✓ unit output present"); process.exit(0); }
// In the harness we don't actually produce artifacts; treat absence as a soft pass so the
// board CLI's gate dry-runs don't error. (Coverage is asserted structurally, not by running.)
console.log("✓ (no artifact — visibility corpus asserts coverage structurally)");
process.exit(0);
