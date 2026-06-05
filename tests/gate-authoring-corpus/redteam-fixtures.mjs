// GOOD + BAD fixture pairs for every verify.mjs rule.
// The harness asserts: verify(rule, good) exits 0 AND verify(rule, bad) exits non-zero.
// A rule whose BAD fixture passes is a VACUOUS gate — the exact failure mode we hunt.
// (The naive "exists" gate is deliberately listed with a BAD that it CANNOT reject — proving the bug.)

export const FIXTURES = {
  // rule: { good: {out, ground}, bad: {out, ground} }
  "exists": {
    good: { out: { anything: 1 } },
    // A wrong-but-present output: exists() passes it anyway. That's the vacuity we expose.
    bad: { out: { wrong: "everything is fabricated but the file is here" }, vacuousOnPurpose: true },
  },
  "rowcount-match": {
    good: { out: { destCount: 100, checksum: "abc" }, ground: { srcCount: 100, checksum: "abc" } },
    bad: { out: { destCount: 96, checksum: "abc" }, ground: { srcCount: 100, checksum: "abc" } },
  },
  "no-new-nulls": { good: { out: {}, ground: { observedNulls: 0 } }, bad: { out: {}, ground: { observedNulls: 3 } } },
  "coverage-complete": {
    good: { out: { covered: ["a", "b", "c"], lost: 0 }, ground: { expected: ["a", "b", "c"] } },
    bad: { out: { covered: ["a", "b"], lost: 0 }, ground: { expected: ["a", "b", "c"] } },
  },
  "links-preserved": {
    good: { out: { links: ["/x", "/y"] }, ground: { links: ["/x", "/y"] } },
    bad: { out: { links: ["/x"] }, ground: { links: ["/x", "/y"] } },
  },
  "facts-preserved": {
    good: { out: { claims: [{ text: "revenue grew", novelNumber: false }] }, ground: { facts: ["revenue grew last year"] } },
    bad: { out: { claims: [{ text: "revenue grew 42%", novelNumber: true }] }, ground: { facts: ["revenue grew last year"] } },
  },
  "source-backed": {
    good: { out: { claims: [{ sourceId: "s1", fact: "sky is blue" }] }, ground: { sources: [{ id: "s1", text: "the sky is blue at noon" }] } },
    bad: { out: { claims: [{ sourceId: "s1", fact: "grass is purple" }] }, ground: { sources: [{ id: "s1", text: "the sky is blue at noon" }] } },
  },
  "lines-in-diff": {
    good: { out: { findings: [{ line: 15 }] }, ground: { ranges: [{ start: 10, end: 30 }] } },
    bad: { out: { findings: [{ line: 412 }] }, ground: { ranges: [{ start: 10, end: 30 }] } },
  },
  "fix-compiles": { good: { out: { findings: [{ id: "f1" }] }, ground: { buildResults: { f1: "pass" } } }, bad: { out: { findings: [{ id: "f1" }] }, ground: { buildResults: { f1: "fail" } } } },
  "remote-matches": {
    good: { out: { readback: { name: "x", n: 5 } }, ground: { desired: { name: "x", n: 5 } } },
    bad: { out: { readback: { name: "x", n: 4 } }, ground: { desired: { name: "x", n: 5 } } },
  },
  "idempotent": { good: { out: {}, ground: { remoteCountAfterRerun: 1 } }, bad: { out: {}, ground: { remoteCountAfterRerun: 2 } } },
  "numbers-trace": {
    good: { out: { numbers: [8, 100] }, ground: { values: [8, 100, 42] } },
    bad: { out: { numbers: [18] }, ground: { values: [8, 100, 42] } },
  },
  "fields-on-page": {
    good: { out: { values: ["249 kr"] }, ground: { html: "<p>Price: 249 kr</p>" } },
    bad: { out: { values: ["499 kr"] }, ground: { html: "<p>Price: 249 kr</p>" } },
  },
  "cells-on-page": {
    good: { out: { values: ["12,340"] }, ground: { text: "Total 12,340 SEK" } },
    bad: { out: { values: ["99,999"] }, ground: { text: "Total 12,340 SEK" } },
  },
  "price-on-listing": {
    good: { out: { values: ["249"] }, ground: { listing: "Now 249 kr" } },
    bad: { out: { values: ["199"] }, ground: { listing: "Now 249 kr" } },
  },
  "test-meaningful": { good: { out: {}, ground: { mutationKilled: true } }, bad: { out: {}, ground: { mutationKilled: false } } },
  "covers-target": { good: { out: {}, ground: { coveredLines: 12 } }, bad: { out: {}, ground: { coveredLines: 0 } } },
  "behavior-preserved": { good: { out: {}, ground: { suiteExit: 0 } }, bad: { out: {}, ground: { suiteExit: 1 } } },
  "api-stable": {
    good: { out: { api: ["foo", "bar"] }, ground: { api: ["foo", "bar"] } },
    bad: { out: { api: ["foo"] }, ground: { api: ["foo", "bar"] } },
  },
  "health-green": { good: { out: {}, ground: { probedHealth: "green" } }, bad: { out: {}, ground: { probedHealth: "503" } } },
  "rollback-ready": { good: { out: {}, ground: { dryRunRestoreExit: 0 } }, bad: { out: {}, ground: { dryRunRestoreExit: 1 } } },
  "label-valid": {
    good: { out: { label: "spam" }, ground: { allowed: ["spam", "ham"] } },
    bad: { out: { label: "maybe-ish" }, ground: { allowed: ["spam", "ham"] } },
  },
  "class-valid": {
    good: { out: { class: "cat" }, ground: { allowed: ["cat", "dog"] } },
    bad: { out: { class: "spaceship" }, ground: { allowed: ["cat", "dog"] } },
  },
  "route-valid": {
    good: { out: { queue: "billing" }, ground: { allowed: ["billing", "support"] } },
    bad: { out: { queue: "misc-stuff" }, ground: { allowed: ["billing", "support"] } },
  },
  "scale-valid": {
    good: { out: { score: 4, min: 1, max: 5 }, ground: { min: 1, max: 5 } },
    bad: { out: { score: 7, min: 1, max: 5 }, ground: { min: 1, max: 5 } },
  },
  "label-grounded": {
    good: { out: { evidence: "refund", polarityConsistent: true }, ground: { itemText: "please process my refund" } },
    bad: { out: { evidence: "refund", polarityConsistent: true }, ground: { itemText: "thanks for the great service" } },
  },
  "route-grounded": {
    good: { out: { evidence: "invoice", polarityConsistent: true }, ground: { text: "my invoice is wrong" } },
    bad: { out: { evidence: "invoice", polarityConsistent: true }, ground: { text: "how do I reset my password" } },
  },
  "sentiment-grounded": {
    good: { out: { evidence: "terrible", polarityConsistent: true }, ground: { text: "this was terrible" } },
    bad: { out: { evidence: "terrible", polarityConsistent: false }, ground: { text: "this was terrible" } },
  },
  "claims-cite-logs": {
    good: { out: { claims: ["14:02 OOM"] }, ground: { logs: "14:02 OOM killed process" } },
    bad: { out: { claims: ["14:02 OOM"] }, ground: { logs: "14:05 disk full" } },
  },
  "conf-valid": { good: { out: { confidence: 0.8 } }, bad: { out: { confidence: 1.7 } } },
  "total-reconciles": { good: { out: { lineItems: [40, 60], total: 100 } }, bad: { out: { lineItems: [40, 60], total: 140 } } },
  "total-on-doc": { good: { out: { total: "1040" }, ground: { text: "Total: 1040" } }, bad: { out: { total: "1400" }, ground: { text: "Total: 1040" } } },
  "nums-preserved": { good: { out: { numbers: ["3.5 mg"] }, ground: { numbers: ["3.5 mg"] } }, bad: { out: { numbers: ["35 mg"] }, ground: { numbers: ["3.5 mg"] } } },
  "glossary-kept": { good: { out: { translation: "use Acme Pro now" }, ground: { protected: ["Acme Pro"] } }, bad: { out: { translation: "use the pro thing" }, ground: { protected: ["Acme Pro"] } } },
  "finding-on-page": {
    good: { out: { findings: [{ field: "titleLen", assertedValue: 70 }] }, ground: { meta: { titleLen: 70 } } },
    bad: { out: { findings: [{ field: "titleLen", assertedValue: 70 }] }, ground: { meta: { titleLen: 48 } } },
  },
  "build-green-after": { good: { out: {}, ground: { buildExit: 0 } }, bad: { out: {}, ground: { buildExit: 1 } } },
  "no-known-cve": { good: { out: { version: "2.1.0" }, ground: { cveVersions: ["1.9.0"] } }, bad: { out: { version: "1.9.0" }, ground: { cveVersions: ["1.9.0"] } } },
  "entry-maps-commit": {
    good: { out: { entries: [{ commit: "abc123" }] }, ground: { commits: ["abc123"] } },
    bad: { out: { entries: [{ commit: "deadbeef" }] }, ground: { commits: ["abc123"] } },
  },
  "stat-recomputes": { good: { out: { stats: [{ name: "sat", reported: 61 }] }, ground: { recomputed: { sat: 61 } } }, bad: { out: { stats: [{ name: "sat", reported: 72 }] }, ground: { recomputed: { sat: 61 } } } },
  "stats-correct": { good: { out: { stats: [{ name: "p", reported: 0.21 }] }, ground: { recomputed: { p: 0.21 } } }, bad: { out: { stats: [{ name: "p", reported: 0.04 }] }, ground: { recomputed: { p: 0.21 } } } },
  "merge-justified": { good: { out: {}, ground: { sharedSignals: ["E_AUTH_401"] } }, bad: { out: {}, ground: { sharedSignals: [] } } },
  "schema-valid": { good: { out: {}, ground: { schemaErrors: [] } }, bad: { out: {}, ground: { schemaErrors: ["missing required key 'name'"] } } },
  "refs-resolve": { good: { out: { refs: ["auth"] }, ground: { targets: ["auth", "db"] } }, bad: { out: { refs: ["auth-v2"] }, ground: { targets: ["auth", "db"] } } },
  "result-equal": { good: { out: {}, ground: { diffRows: 0 } }, bad: { out: {}, ground: { diffRows: 14 } } },
  "cheaper-plan": { good: { out: { newCost: 50 }, ground: { baseCost: 100 } }, bad: { out: { newCost: 120 }, ground: { baseCost: 100 } } },
  "sig-matches": {
    good: { out: { documented: [{ name: "f", sig: "f(a,b)" }] }, ground: { signatures: [{ name: "f", sig: "f(a,b)" }] } },
    bad: { out: { documented: [{ name: "f", sig: "f(a,b)" }] }, ground: { signatures: [{ name: "f", sig: "f(a,b,c)" }] } },
  },
  "ts-monotonic": { good: { out: { timestamps: [1, 5, 10] }, ground: { duration: 45 } }, bad: { out: { timestamps: [1, 58], duration: 45 }, ground: { duration: 45 } } },
  "change-correct": { good: { out: { price: 249, flag: "none" }, ground: { lastPrice: 249 } }, bad: { out: { price: 200, flag: "none" }, ground: { lastPrice: 249 } } },
  "license-correct": { good: { out: { detected: "MIT" }, ground: { realLicense: "MIT" } }, bad: { out: { detected: "MIT" }, ground: { realLicense: "GPL-3.0" } } },
  "verdict-consistent": { good: { out: { detected: "GPL-3.0", verdict: "fail" }, ground: { allowlist: ["MIT"] } }, bad: { out: { detected: "GPL-3.0", verdict: "pass" }, ground: { allowlist: ["MIT"] } } },
  "restore-matches": { good: { out: { restoredChecksum: "z9" }, ground: { sourceChecksum: "z9" } }, bad: { out: { restoredChecksum: "x1" }, ground: { sourceChecksum: "z9" } } },
  "stored-matches": { good: { out: { stored: { year: "1980" } }, ground: { form: { year: "1980" } } }, bad: { out: { stored: { year: "1990" } }, ground: { form: { year: "1980" } } } },
  "no-stale-claims": { good: { out: { claims: [{ text: "exports CSV and JSON", assertsAbsence: false }] }, ground: { reality: "exports CSV, JSON" } }, bad: { out: { claims: [{ text: "CSV only", assertsAbsence: true, subject: "JSON" }] }, ground: { reality: "exports CSV, JSON" } } },
  // obscure
  "meaning-grounded": {
    good: { out: { positions: [{ card: "Tower", text: "sudden upheaval shakes the foundation" }] }, ground: { canonical: { Tower: "upheaval" }, antonyms: { Tower: "stable comfort" } } },
    bad: { out: { positions: [{ card: "Tower", text: "a time of stable comfort and ease" }] }, ground: { canonical: { Tower: "upheaval" }, antonyms: { Tower: "stable comfort" } } },
  },
  "role-addressed": { good: { out: { positions: [{ role: "past" }] }, ground: { roleText: { past: "in your past this card shows..." } } }, bad: { out: { positions: [{ role: "past" }] }, ground: { roleText: { past: "a generic card description with no anchor" } } } },
  "score-sums": {
    good: { out: { criteria: [{ name: "nebari", score: 20 }, { name: "taper", score: 30 }], total: 50 }, ground: { maxima: { nebari: 25, taper: 35 } } },
    bad: { out: { criteria: [{ name: "nebari", score: 20 }, { name: "taper", score: 30 }], total: 88 }, ground: { maxima: { nebari: 25, taper: 35 } } },
  },
  "score-grounded": { good: { out: { criteria: [{ name: "nebari", score: 5, max: 25 }] }, ground: { traits: { nebari: "poor" } } }, bad: { out: { criteria: [{ name: "nebari", score: 24, max: 25 }] }, ground: { traits: { nebari: "poor" } } } },
  "expansion-grounded": {
    good: { out: { expansions: [{ sigla: "⁊", expansion: "et", marked: true }] }, ground: { abbrev: { "⁊": "et" } } },
    bad: { out: { expansions: [{ sigla: "⁊", expansion: "and", marked: false }] }, ground: { abbrev: { "⁊": "et" } } },
  },
  "uncertainty-marked": { good: { out: { markedRegions: ["r3", "r7"] }, ground: { damagedRegions: ["r3", "r7"] } }, bad: { out: { markedRegions: ["r3"] }, ground: { damagedRegions: ["r3", "r7"] } } },
  "value-grounded": {
    good: { out: { usedScoring: "PPR", valueFromProjections: true }, ground: { scoring: "PPR" } },
    bad: { out: { usedScoring: "standard", valueFromProjections: true }, ground: { scoring: "PPR" } },
  },
  "pct-sums": { good: { out: { percentages: [50, 30, 20] } }, bad: { out: { percentages: [50, 30, 13] } } },
  "ifra-respected": {
    good: { out: { ingredients: [{ name: "oakmoss", pct: 0.1 }] }, ground: { limits: { oakmoss: 0.1 } } },
    bad: { out: { ingredients: [{ name: "oakmoss", pct: 5 }] }, ground: { limits: { oakmoss: 0.1 } } },
  },
  "id-in-region": {
    good: { out: { species: "Eurasian Wren" }, ground: { regionalSpecies: ["Eurasian Wren", "Robin"] } },
    bad: { out: { species: "Resplendent Quetzal" }, ground: { regionalSpecies: ["Eurasian Wren", "Robin"] } },
  },
  "id-grounded": {
    good: { out: { citedFeatures: ["trill"] }, ground: { features: ["trill", "whistle"] } },
    bad: { out: { citedFeatures: ["descending-trill"] }, ground: { features: ["trill", "whistle"] } },
  },
  "order-canonical": {
    good: { out: { steps: ["warm-bowl", "whisk", "serve"] }, ground: { order: ["warm-bowl", "whisk", "serve"] } },
    bad: { out: { steps: ["whisk", "warm-bowl", "serve"] }, ground: { order: ["warm-bowl", "whisk", "serve"] } },
  },
  "utensil-valid": {
    good: { out: { utensils: ["chasen"] }, ground: { utensils: ["chasen", "chawan"] } },
    bad: { out: { utensils: ["espresso-tamper"] }, ground: { utensils: ["chasen", "chawan"] } },
  },
  "solvable-from-clues": { good: { out: {}, ground: { solverReached: true } }, bad: { out: {}, ground: { solverReached: false } } },
  "unique-solution": { good: { out: {}, ground: { solverSolutionCount: 1 } }, bad: { out: {}, ground: { solverSolutionCount: 2 } } },
  "features-preserved": {
    good: { out: { preservedFeatures: ["rhotic-r", "double-negative"] }, ground: { features: ["rhotic-r", "double-negative"] } },
    bad: { out: { preservedFeatures: [] }, ground: { features: ["rhotic-r", "double-negative"] } },
  },
  "ipa-valid": { good: { out: { ipaSymbols: ["ʃ", "ə"] }, ground: { ipaChars: ["ʃ", "ə", "θ"] } }, bad: { out: { ipaSymbols: ["x9"] }, ground: { ipaChars: ["ʃ", "ə", "θ"] } } },
  "tincture-rule": {
    good: { out: { adjacencies: [{ upper: "argent", lower: "gules" }] }, ground: { tinctureClass: { argent: "metal", gules: "colour", azure: "colour" } } },
    bad: { out: { adjacencies: [{ upper: "azure", lower: "gules" }] }, ground: { tinctureClass: { argent: "metal", gules: "colour", azure: "colour" } } },
  },
  "grammar-valid": { good: { out: { terms: ["chevron", "gules"] }, ground: { vocab: ["chevron", "gules", "argent"] } }, bad: { out: { terms: ["flooberon"] }, ground: { vocab: ["chevron", "gules", "argent"] } } },
};
