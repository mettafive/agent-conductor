# Gate-authoring corpus & smoke harness

A re-runnable stress test for the part of agent-conductor that turns a **skill** into **gates**.
It proves the gate-authoring logic produces gates that are **intent-aligned** (a green run means the
skill's goal was met), **non-vacuous** (they actually fail bad work), **right-sized**, and
**general** — including 10 deliberately obscure domains we'd never normally test.

## What's here

- `manifest.json` — the 45 mock skills (35 common + 10 obscure). Each declares its INTENT, whether
  it iterates over a list (so a `type: loop` is EXPECTED), and the real GROUNDING source its gates
  must cross-check against.
- `specs.mjs` — the per-skill conversion specs. Each gate carries BOTH a `surface` (lint) and a
  `substance` (grounded) form, plus a `rule` and a one-line `redteam` (the bad output it must fail).
- `gen.mjs` — renders, per skill, `skills/<id>.md` (the skill description) and
  `conductors/<id>.conductor.yaml` (the converted workflow). `AUTHORING=naive|improved` switches
  between the pre-fix logic (surface lints) and the authored-to-bar logic (grounded gates).
- `verify.mjs` — the generic grounding verifier the improved hard gates call. It compares an OUTPUT
  artifact against an INDEPENDENT GROUNDING artifact under a named rule, exiting non-zero on a
  violation. This is what makes the gates non-vacuous and red-teamable.
- `redteam-fixtures.mjs` — a GOOD + BAD fixture pair for every rule. The harness asserts the rule
  passes GOOD and fails BAD; a rule whose BAD passes is a vacuous gate.
- `run.mjs` — the harness.
- `report.md` / `report.improved.json` / `report.naive.json` — generated assessments.

## Run it

```bash
# from the repo root
node tests/gate-authoring-corpus/run.mjs                 # improved logic — expects 45/45 perfect, exits 0
AUTHORING=naive node tests/gate-authoring-corpus/run.mjs # pre-fix logic — shows the vacuous-gate bug
```

The harness regenerates the corpus for the requested mode, then for each skill asserts:

1. **VALID** — `board/bin/cli.js validate` passes.
2. **LOOPS** — a `type: loop` exists iff the manifest says the skill iterates over a list.
3. **NON-VACUOUS** — every hard-gate rule is red-teamed: `verify(rule, good)` exits 0 AND
   `verify(rule, bad)` exits non-zero.
4. **GROUNDED** — at least one hard gate cross-checks the output against an independent `--ground`
   artifact (the anti-self-attestation proxy for intent-alignment).

`improved` must reach 45/45 perfect (the harness exits non-zero otherwise — wire it into CI to catch
regressions in the gate-authoring logic).

## The two systematic weaknesses this caught

1. **The "exists/parses" lint** — a gate that only checks the artifact rendered. `AUTHORING=naive`
   shows all 45 skills failing NON-VACUOUS because the bad output passes.
2. **The self-attestation trap** — a gate that reads a boolean the agent wrote about its own work
   (`testsPass: true`, `rollbackProven: true`). The first improved pass still left 21 skills vacuous
   here; the fix (ground against an INDEPENDENT observation the gate makes itself) is now encoded in
   CONDUCTOR.md principle #9 and the setup convert-to-conductor step.
