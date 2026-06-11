// Visual-step coverage matcher.
//
// Given a converted conductor and a case's declared work-units, decide for EACH unit:
//   "surfaced" — the board would render a dedicated card for this phase (the unit has its
//                OWN visual step/sub-step), OR
//   "folded"   — the unit's work is buried inside ANOTHER step's instruction prose, with
//                no card of its own (the daily-enrichment SEO-step bug), OR
//   "missing"  — the unit appears nowhere at all.
//
// The matcher deliberately does NOT assume the step id equals the unit id (that would make
// coverage trivially true). It works from the human-visible signal a board reader sees: each
// step's title + instruction text. A unit is "surfaced" only when SOME step is PRIMARILY
// about that unit — i.e. that step matches this unit's keywords and isn't already claimed as
// the home of a different unit. Folded units show up only as a secondary mention inside a
// step whose primary subject is another unit.

import fs from "node:fs";
import yaml from "../../node_modules/js-yaml/dist/js-yaml.mjs";

// Flatten a conductor's steps into the cards a board reader would see.
// Loop sub-steps ARE cards (the per-iteration kanban). The discover/scope step and the loop
// container itself are structural, not work-unit cards — but we keep all text for fold-scan.
export function collectCards(steps, acc = [], inLoop = false) {
  for (const s of steps ?? []) {
    if (s.type === "loop") {
      collectCards(s.steps, acc, true);
    } else {
      acc.push({ id: s.id ?? "", text: `${s.id ?? ""}\n${s.instruction ?? ""}`.toLowerCase() });
    }
  }
  return acc;
}

const norm = (s) => String(s).toLowerCase();
// does this card's text contain ANY of the unit's keyword tokens (or its id-as-words)?
function matchScore(unit, cardText) {
  const needles = [unit.id.replace(/-/g, " "), ...unit.kw].map(norm);
  let hits = 0;
  for (const n of needles) if (cardText.includes(n)) hits++;
  return hits;
}

// Assign each unit a "home card" — the card most about it — then classify.
export function coverageFor(spec, doc) {
  const cards = collectCards(doc.steps);
  const units = spec.units;

  // For each card, find which unit it is PRIMARILY about (highest match score on the card's
  // OWN id/first line, not buried mentions). We use the card id + first instruction line as the
  // "primary subject" signal — that's the card's hero on the board.
  const primaryLine = (c) => c.text.split("\n").slice(0, 2).join(" ");
  const cardPrimary = cards.map((c) => {
    let best = null, bestScore = 0;
    for (const u of units) {
      const sc = matchScore(u, primaryLine(c));
      if (sc > bestScore) { bestScore = sc; best = u.id; }
    }
    return bestScore > 0 ? best : null;
  });

  const result = {};
  for (const u of units) {
    // surfaced iff some card's PRIMARY subject is this unit.
    const ownCardIdx = cardPrimary.findIndex((p) => p === u.id);
    if (ownCardIdx >= 0) {
      result[u.id] = { status: "surfaced", divider: u.divider, gate: u.gate, cardId: cards[ownCardIdx].id };
      continue;
    }
    // not a primary subject anywhere — is it at least mentioned (folded) or fully missing?
    const mentionedIn = cards.find((c) => matchScore(u, c.text) > 0);
    result[u.id] = {
      status: mentionedIn ? "folded" : "missing",
      divider: u.divider,
      gate: u.gate,
      foldedInto: mentionedIn ? mentionedIn.id : null,
    };
  }
  return result;
}

export function loadConductor(file) {
  return yaml.load(fs.readFileSync(file, "utf8"));
}
