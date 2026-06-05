#!/usr/bin/env node
// Generic grounding verifier used by the IMPROVED hard gates.
// Usage: node verify.mjs <rule> --out <outFile> [--ground <groundFile>]
// Exits 0 if the OUTPUT is consistent with the GROUNDING under <rule>, non-zero otherwise.
//
// This is what makes the corpus's gates non-vacuous and red-teamable: each rule compares the
// agent's produced artifact against the real grounding artifact, mirroring the daily-enrichment
// pattern (price ↔ priceEvidence, anchor ↔ sources). The harness proves each rule by feeding it
// a crafted-good fixture (must exit 0) and a crafted-bad fixture (must exit non-zero).

import fs from "node:fs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function readJSON(p) {
  if (!p || !fs.existsSync(p)) return undefined;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return undefined; }
}
function fail(msg) { console.error("✗ " + msg); process.exit(1); }
function pass(msg) { console.log("✓ " + (msg || "ok")); process.exit(0); }

const rule = process.argv[2];
const out = readJSON(arg("--out"));
const ground = readJSON(arg("--ground"));

if (rule === "exists") {
  // The NAIVE gate: only checks the artifact exists. Deliberately vacuous — used to show the bug.
  if (out !== undefined) pass("output exists"); else fail("output missing");
}

if (out === undefined) fail(`output artifact missing or unparseable`);
// A gate is only grounded if it compares the agent's claim against an INDEPENDENT observation
// (a real probe / re-run / recomputation), never a boolean the agent self-asserts. The only rules
// that legitimately need no external ground are the ones that recompute purely from the output's
// OWN parts (e.g. percentages summing to 100, line items vs their own total) or check a numeric
// range — those are self-contained consistency checks, not self-attestations.
const SELF_CONTAINED = new Set(["pct-sums", "conf-valid", "total-reconciles"]);
const needsGround = !SELF_CONTAINED.has(rule);
if (needsGround && ground === undefined) fail(`grounding artifact missing — gate degrades to a self-attestation without it`);

// Helpers ------------------------------------------------------------------
const inText = (val, hay) => String(hay).includes(String(val));
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
// Compare a claim the agent made against an INDEPENDENT observation in the ground artifact.
// This is the anti-self-attestation core: the agent says X; the gate believes the observation, not X.
const attest = (claim, observed, label) => { if (claim !== observed) fail(`${label}: agent claimed ${JSON.stringify(claim)} but the independent observation was ${JSON.stringify(observed)}`); };

switch (rule) {
  // ---- count / coverage equality ----
  case "rowcount-match": {
    if (out.destCount !== ground.srcCount) fail(`dest ${out.destCount} != src ${ground.srcCount} (row loss)`);
    if (out.checksum !== ground.checksum) fail(`checksum mismatch (corruption)`);
    pass("rowcount + checksum match");
  }
  case "no-new-nulls":
    // independent: a re-query of the destination for nulls in required cols (ground.observedNulls)
    if ((ground.observedNulls ?? 0) > 0) fail(`${ground.observedNulls} new NULLs found by re-querying the destination`);
    pass();
  case "coverage-complete": {
    const scoped = arr(ground.expected);
    const done = new Set(arr(out.covered));
    const missing = scoped.filter((x) => !done.has(x));
    if (missing.length) fail(`incomplete coverage, missing: ${missing.join(", ")}`);
    if ((out.lost ?? 0) > 0) fail(`${out.lost} items lost`);
    pass("full coverage");
  }
  // ---- membership / presence in grounding ----
  case "links-preserved": {
    const orig = new Set(arr(ground.links));
    const kept = new Set(arr(out.links));
    const dropped = [...orig].filter((l) => !kept.has(l));
    if (dropped.length) fail(`dropped links: ${dropped.join(", ")}`);
    pass("all links preserved");
  }
  case "facts-preserved": {
    const supported = arr(ground.facts).map(String);
    for (const c of arr(out.claims)) {
      if (c.contradicts) fail(`claim contradicts original: "${c.text}"`);
      if (c.novelNumber && !supported.some((f) => inText(c.text, f))) fail(`invented figure not in original: "${c.text}"`);
    }
    pass("facts grounded");
  }
  case "source-backed":
    for (const c of arr(out.claims)) {
      const src = arr(ground.sources).find((s) => s.id === c.sourceId);
      if (!src) fail(`claim cites missing source ${c.sourceId}`);
      if (!inText(c.fact, src.text)) fail(`claim fact "${c.fact}" not found in cited source text`);
    }
    pass("claims source-backed");
  case "lines-in-diff": {
    const ranges = arr(ground.ranges); // [{start,end}]
    for (const f of arr(out.findings)) {
      const ok = ranges.some((r) => f.line >= r.start && f.line <= r.end);
      if (!ok) fail(`finding cites line ${f.line} not in the diff`);
    }
    pass("findings on changed lines");
  }
  case "fix-compiles": {
    // independent: ground.buildResults[fixId] = real build exit recorded by actually applying the fix
    const builds = ground.buildResults || {};
    for (const f of arr(out.findings)) if (builds[f.id] !== "pass") fail(`applying fix ${f.id} did not build (independent build: ${builds[f.id]})`);
    pass();
  }
  case "remote-matches": {
    const want = ground.desired || {};
    const got = out.readback || {};
    for (const k of Object.keys(want)) if (want[k] !== got[k]) fail(`remote field ${k}: got ${got[k]} want ${want[k]}`);
    pass("remote matches desired");
  }
  case "idempotent":
    // independent: ground.remoteCountAfterRerun = a real COUNT(*) on the remote after running twice
    if ((ground.remoteCountAfterRerun ?? 1) !== 1) fail(`${ground.remoteCountAfterRerun} remote records after a real double-run (not idempotent)`);
    pass();
  case "numbers-trace": {
    const known = new Set(arr(ground.values).map(String));
    for (const n of arr(out.numbers)) if (!known.has(String(n))) fail(`report figure ${n} not in query results`);
    pass("numbers trace to data");
  }
  case "fields-on-page":
  case "cells-on-page":
  case "price-on-listing": {
    const html = String(ground.html ?? ground.text ?? ground.listing ?? "");
    for (const v of arr(out.values)) if (!inText(v, html)) fail(`extracted value "${v}" not present in source`);
    pass("values present in source");
  }
  case "test-meaningful":
    // independent: ground.mutationKilled = real result of running the test against a mutated target
    if (ground.mutationKilled !== true) fail(`mutation survived — the test does NOT fail when the target is broken (vacuous test)`);
    pass();
  case "covers-target":
    // independent: ground.coveredLines = real coverage-tool output for the target's lines
    if ((ground.coveredLines ?? 0) <= 0) fail(`coverage tool shows the target's lines were never executed`);
    pass();
  case "behavior-preserved":
    // independent: ground.suiteExit = real exit code of re-running the same suite after the change
    if (ground.suiteExit !== 0) fail(`re-running the suite after the change exits ${ground.suiteExit} (behaviour changed)`);
    pass();
  case "api-stable": {
    const base = new Set(arr(ground.api));
    const now = new Set(arr(out.api));
    const removed = [...base].filter((s) => !now.has(s));
    if (removed.length) fail(`removed exported symbols: ${removed.join(", ")}`);
    pass();
  }
  case "health-green":
    // independent: ground.probedHealth = result of the gate itself curling the LIVE endpoint
    if (ground.probedHealth !== "green") fail(`probing the live health endpoint returned ${ground.probedHealth}`);
    pass();
  case "rollback-ready":
    // independent: ground.dryRunRestoreExit = exit of an actual dry-run restore of the prior version
    if (ground.dryRunRestoreExit !== 0) fail(`dry-run restore of the prior version exits ${ground.dryRunRestoreExit} — rollback NOT proven`);
    pass();
  case "label-valid":
  case "class-valid":
  case "route-valid":
  case "scale-valid": {
    const allowed = new Set(arr(ground?.allowed));
    const v = out.label ?? out.class ?? out.queue ?? out.score;
    if (rule === "scale-valid") {
      const [lo, hi] = ground ? [ground.min, ground.max] : [out.min, out.max];
      if (out.score < lo || out.score > hi) fail(`score ${out.score} outside [${lo},${hi}]`);
      pass();
    }
    if (!allowed.has(v)) fail(`value "${v}" not in allowed set`);
    pass("valid member");
  }
  case "label-grounded":
  case "route-grounded":
  case "sentiment-grounded": {
    // the chosen label's evidence must appear in the item text
    if (!inText(out.evidence ?? "", ground.itemText ?? ground.text ?? "")) fail(`label/route evidence not found in item content`);
    if (out.polarityConsistent === false) fail(`label contradicts item sentiment`);
    pass("label grounded in content");
  }
  case "claims-cite-logs": {
    const logs = String(ground.logs ?? "");
    for (const c of arr(out.claims)) if (!inText(c, logs)) fail(`analysis claim not in raw logs: "${c}"`);
    pass("claims cite real logs");
  }
  case "conf-valid":
    if (out.confidence < 0 || out.confidence > 1) fail(`confidence ${out.confidence} outside [0,1]`);
    pass();
  case "total-reconciles": {
    // self-contained consistency: the output's OWN line items must sum to its OWN total (no external ground)
    const sum = arr(out.lineItems).reduce((a, b) => a + Number(b), 0);
    if (Math.abs(sum - Number(out.total)) > 0.01) fail(`line items sum ${sum} != total ${out.total}`);
    pass();
  }
  case "total-on-doc":
    if (!inText(out.total, String(ground.text ?? ""))) fail(`extracted total ${out.total} not on document`);
    pass();
  case "nums-preserved": {
    const srcNums = arr(ground.numbers).map(String);
    const outNums = new Set(arr(out.numbers).map(String));
    const missing = srcNums.filter((n) => !outNums.has(n));
    if (missing.length) fail(`numbers altered/dropped: ${missing.join(", ")}`);
    pass();
  }
  case "glossary-kept": {
    const t = String(out.translation ?? "");
    for (const term of arr(ground.protected)) if (!inText(term, t)) fail(`protected term "${term}" missing from translation`);
    pass();
  }
  case "finding-on-page": {
    const meta = ground.meta || {};
    for (const f of arr(out.findings)) {
      if (f.field && meta[f.field] !== undefined && f.assertedValue !== meta[f.field]) fail(`finding asserts ${f.field}=${f.assertedValue} but page meta is ${meta[f.field]}`);
    }
    pass();
  }
  case "build-green-after":
    // independent: ground.buildExit = exit code of really running the build after the upgrade
    if (ground.buildExit !== 0) fail(`build exits ${ground.buildExit} after upgrade (independent run)`);
    pass();
  case "no-known-cve": {
    const advisories = new Set(arr(ground.cveVersions));
    if (advisories.has(out.version)) fail(`chosen version ${out.version} has a known advisory`);
    pass();
  }
  case "entry-maps-commit": {
    const commits = new Set(arr(ground.commits));
    for (const e of arr(out.entries)) if (!commits.has(e.commit)) fail(`changelog entry has no real commit: ${e.commit}`);
    pass();
  }
  case "stat-recomputes":
  case "stats-correct": {
    // independent: ground.recomputed[name] = the value the GATE recomputes from the raw data itself,
    // not a 'recomputed' field the agent wrote next to its own claim.
    const truth = ground.recomputed || {};
    for (const s of arr(out.stats)) {
      if (!(s.name in truth)) fail(`stat "${s.name}" has no independent recomputation`);
      if (Math.abs(Number(s.reported) - Number(truth[s.name])) > 0.01) fail(`stat "${s.name}" reported ${s.reported} but independent recompute = ${truth[s.name]}`);
    }
    pass();
  }
  case "merge-justified": {
    // independent: ground.sharedSignals = overlapping concrete signals (error code/stack) the gate extracted
    if (!(arr(ground.sharedSignals).length > 0)) fail(`no overlapping concrete signal — merge not justified (keyword-only)`);
    pass();
  }
  case "schema-valid": {
    // independent: ground.schemaErrors = output of a real schema validator run against the config
    if (arr(ground.schemaErrors).length > 0) fail(`schema validator reported: ${arr(ground.schemaErrors).join("; ")}`);
    pass();
  }
  case "refs-resolve": {
    const targets = new Set(arr(ground.targets));
    for (const r of arr(out.refs)) if (!targets.has(r)) fail(`dangling reference: ${r}`);
    pass();
  }
  case "result-equal":
    // independent: ground.diffRows = real row-diff count between the rewrite's and baseline's result sets
    if ((ground.diffRows ?? 0) !== 0) fail(`rewrite result set differs from baseline by ${ground.diffRows} rows`);
    pass();
  case "cheaper-plan":
    if (!(out.newCost < ground.baseCost)) fail(`rewrite cost ${out.newCost} >= baseline ${ground.baseCost}`);
    pass();
  case "sig-matches": {
    const real = arr(ground.signatures);
    for (const d of arr(out.documented)) {
      const m = real.find((s) => s.name === d.name);
      if (!m) fail(`documented symbol ${d.name} not in source`);
      if (m.sig !== d.sig) fail(`doc sig for ${d.name} (${d.sig}) != real (${m.sig})`);
    }
    pass();
  }
  case "ts-monotonic": {
    const dur = Number(ground.duration);
    let prev = -1;
    for (const t of arr(out.timestamps)) {
      if (t <= prev) fail(`timestamps not monotonic at ${t}`);
      if (t > dur) fail(`timestamp ${t} exceeds clip duration ${dur}`);
      prev = t;
    }
    pass();
  }
  case "change-correct": {
    const actual = Number(out.price) === Number(ground.lastPrice) ? "none" : "changed";
    if (out.flag !== actual) fail(`flag "${out.flag}" inconsistent with actual delta (${actual})`);
    pass();
  }
  case "license-correct":
    if (out.detected !== ground.realLicense) fail(`detected ${out.detected} but real license is ${ground.realLicense}`);
    pass();
  case "verdict-consistent": {
    const allowed = new Set(arr(ground.allowlist));
    const expected = allowed.has(out.detected) ? "pass" : "fail";
    if (out.verdict !== expected) fail(`verdict ${out.verdict} inconsistent with allowlist (expected ${expected})`);
    pass();
  }
  case "restore-matches":
    if (out.restoredChecksum !== ground.sourceChecksum) fail(`restored checksum != source (corrupt backup)`);
    pass();
  case "stored-matches": {
    const src = ground.form || {};
    const got = out.stored || {};
    for (const k of Object.keys(src)) if (src[k] !== got[k]) fail(`stored ${k}=${got[k]} != form ${src[k]}`);
    pass();
  }
  case "no-stale-claims": {
    // independent: ground.reality = current-reality facts; a claim contradicting them is stale.
    const reality = String(ground.reality ?? "");
    for (const c of arr(out.claims)) {
      // a claim asserting an absolute ("only", "no longer") that the reality snapshot contradicts
      if (c.assertsAbsence && inText(c.subject, reality)) fail(`stale claim survives: "${c.text}" — reality shows ${c.subject} exists`);
    }
    pass();
  }
  // ---- obscure ----
  case "meaning-grounded": {
    // independent: the canonical keyword for the drawn card must appear in the interpretation text;
    // and the interpretation must not assert the card's antonym (ground.antonyms).
    const canon = ground.canonical || {};
    const antonyms = ground.antonyms || {};
    for (const p of arr(out.positions)) {
      const kw = canon[p.card];
      if (!kw) fail(`card "${p.card}" has no canonical meaning loaded`);
      if (!inText(kw, p.text ?? "")) fail(`interpretation of ${p.card} never reflects its canonical meaning "${kw}"`);
      const anti = antonyms[p.card];
      if (anti && inText(anti, p.text ?? "")) fail(`interpretation of ${p.card} asserts the antonym "${anti}" of its canonical meaning`);
    }
    pass();
  }
  case "role-addressed": {
    // independent: the position's role keyword must actually appear in the interpretation text.
    const roleText = ground.roleText || {}; // role -> the interpretation prose the gate reads
    for (const p of arr(out.positions)) {
      const txt = roleText[p.role] ?? "";
      if (!inText(p.role, txt)) fail(`interpretation for "${p.role}" never references that role`);
    }
    pass();
  }
  case "score-sums": {
    const sum = arr(out.criteria).reduce((a, c) => a + Number(c.score), 0);
    if (Math.abs(sum - Number(out.total)) > 0.01) fail(`criteria sum ${sum} != total ${out.total}`);
    for (const c of arr(out.criteria)) {
      const max = (ground.maxima || {})[c.name];
      if (max !== undefined && c.score > max) fail(`criterion ${c.name} score ${c.score} > max ${max}`);
    }
    pass();
  }
  case "score-grounded": {
    // independent: ground.traits[name] = the measured trait band; a high score on a poor trait reds.
    const traits = ground.traits || {};
    for (const c of arr(out.criteria)) {
      const t = traits[c.name];
      if (t === "poor" && c.score >= (c.max ?? 100) * 0.7) fail(`${c.name} scored ${c.score} but measured trait is poor`);
    }
    pass();
  }
  case "expansion-grounded": {
    const ref = ground.abbrev || {};
    for (const e of arr(out.expansions)) {
      if (!e.marked) fail(`expansion "${e.sigla}" not marked`);
      if (ref[e.sigla] !== e.expansion) fail(`expansion of "${e.sigla}" (${e.expansion}) != reference (${ref[e.sigla]})`);
    }
    pass();
  }
  case "uncertainty-marked": {
    // independent: ground.damagedRegions = regions the image analysis flagged as damaged; each must be marked.
    const marked = new Set(arr(out.markedRegions));
    for (const r of arr(ground.damagedRegions)) if (!marked.has(r)) fail(`damaged region "${r}" read as confident, not flagged`);
    pass();
  }
  case "value-grounded": {
    if (out.usedScoring !== ground.scoring) fail(`used scoring "${out.usedScoring}" but league is "${ground.scoring}"`);
    if (out.valueFromProjections !== true) fail(`value not computed from projections`);
    pass();
  }
  case "pct-sums": {
    const sum = arr(out.percentages).reduce((a, b) => a + Number(b), 0);
    if (Math.abs(sum - 100) > 0.01) fail(`percentages sum to ${sum}, not 100`);
    pass();
  }
  case "ifra-respected": {
    const limits = ground.limits || {};
    for (const ing of arr(out.ingredients)) {
      const lim = limits[ing.name];
      if (lim !== undefined && ing.pct > lim) fail(`${ing.name} at ${ing.pct}% exceeds IFRA limit ${lim}%`);
    }
    pass();
  }
  case "id-in-region": {
    const regional = new Set(arr(ground.regionalSpecies));
    if (!regional.has(out.species)) fail(`species "${out.species}" not plausible for this region/season`);
    pass();
  }
  case "id-grounded": {
    const feats = new Set(arr(ground.features));
    for (const f of arr(out.citedFeatures)) if (!feats.has(f)) fail(`cited feature "${f}" not in recording`);
    pass();
  }
  case "order-canonical": {
    const canon = arr(ground.order);
    const got = arr(out.steps);
    // every canonical core step must appear, in order
    let ci = 0;
    for (const s of got) { if (s === canon[ci]) ci++; }
    if (ci !== canon.length) fail(`steps deviate from canonical order (matched ${ci}/${canon.length})`);
    pass();
  }
  case "utensil-valid": {
    const ok = new Set(arr(ground.utensils));
    for (const u of arr(out.utensils)) if (!ok.has(u)) fail(`utensil "${u}" not in this style's set`);
    pass();
  }
  case "solvable-from-clues": {
    // independent: ground.solverReached = whether a solver run from the clue set alone reached the solution.
    if (ground.solverReached !== true) fail(`a solver from the provided clues alone could NOT reach the solution`);
    pass();
  }
  case "unique-solution": {
    // independent: ground.solverSolutionCount = number of distinct inputs a solver found that satisfy the clues.
    if ((ground.solverSolutionCount ?? 1) !== 1) fail(`solver found ${ground.solverSolutionCount} solutions (ambiguous)`);
    pass();
  }
  case "features-preserved": {
    const inv = arr(ground.features);
    const kept = new Set(arr(out.preservedFeatures));
    const lost = inv.filter((f) => !kept.has(f));
    if (lost.length) fail(`dialect features normalized away: ${lost.join(", ")}`);
    pass();
  }
  case "ipa-valid": {
    // independent: the gate checks each IPA char against the real IPA character set (ground.ipaChars).
    const ok = new Set(arr(ground.ipaChars));
    for (const ch of arr(out.ipaSymbols)) if (!ok.has(ch)) fail(`"${ch}" is not a valid IPA symbol`);
    pass();
  }
  case "tincture-rule": {
    // independent: the gate classifies each adjacency using ground.tinctureClass (colour/metal) and reds on a clash.
    const cls = ground.tinctureClass || {};
    for (const a of arr(out.adjacencies)) {
      if (cls[a.upper] && cls[a.upper] === cls[a.lower]) fail(`${a.upper} on ${a.lower}: ${cls[a.upper]}-on-${cls[a.lower]} violates the rule of tincture`);
    }
    pass();
  }
  case "grammar-valid": {
    // independent: every term used must be in the real heraldic vocabulary (ground.vocab).
    const vocab = new Set(arr(ground.vocab));
    for (const t of arr(out.terms)) if (!vocab.has(t)) fail(`term "${t}" not in heraldic vocabulary — blazon will not render`);
    pass();
  }

  default:
    fail(`unknown rule "${rule}"`);
}
