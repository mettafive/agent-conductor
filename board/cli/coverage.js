import fs from "node:fs";
import path from "node:path";
import { parseCardsJson } from "./cards.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const norm = (s) => String(s).trim().toLowerCase();

/** Every step + loop sub-step id in a conductor doc, normalized. */
export function conductorCardIds(doc, acc = new Set()) {
  for (const s of doc?.steps ?? []) {
    if (s && s.id) acc.add(norm(s.id));
    if (s && s.type === "loop" && Array.isArray(s.steps)) {
      conductorCardIds({ steps: s.steps }, acc);
    }
  }
  return acc;
}

export function computeCoverage(cards, stepIds) {
  const missing = cards.filter((card) => card.id && !stepIds.has(norm(card.id)));
  return { total: cards.length, missing };
}

export async function runCoverage(args) {
  const flag = (names) => {
    for (const n of names) {
      const i = args.indexOf(n);
      if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("-")) return args[i + 1];
    }
    return null;
  };
  const cardsPath = path.resolve(process.cwd(), flag(["--cards"]) || ".conductor/cards.json");
  const conductorPath = path.resolve(
    process.cwd(),
    flag(["--conductor", "-c"]) || ".conductor/conductor.json",
  );

  const fail = (msg) => {
    console.error(red(`✗ coverage ${msg}`));
    return false;
  };

  if (!fs.existsSync(cardsPath)) {
    return fail(`— no cards.json at ${path.relative(process.cwd(), cardsPath)}.`);
  }
  if (!fs.existsSync(conductorPath)) {
    return fail(`— no conductor at ${path.relative(process.cwd(), conductorPath)}.`);
  }

  let cards;
  try {
    cards = parseCardsJson(fs.readFileSync(cardsPath, "utf8"));
  } catch (e) {
    return fail(`— could not parse cards.json: ${e.message}`);
  }
  if (cards.length === 0) {
    return fail(`— ${path.relative(process.cwd(), cardsPath)} has no cards.`);
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(conductorPath, "utf8"));
  } catch (e) {
    return fail(`— could not parse conductor JSON: ${e.message}`);
  }

  const stepIds = conductorCardIds(doc);
  const { total, missing } = computeCoverage(cards, stepIds);

  console.log("");
  if (missing.length === 0) {
    console.log(green(`✓ coverage: all ${total} cards are present in conductor.json`));
    console.log(dim(`  ${path.relative(process.cwd(), cardsPath)} ↔ ${path.relative(process.cwd(), conductorPath)}`));
    console.log("");
    return true;
  }

  console.error(red(`✗ coverage: ${missing.length} of ${total} card(s) are missing from conductor.json`));
  for (const card of missing) console.error(red(`    ✗ ${card.id}`));
  console.error(dim("  every card in cards.json must appear as a step or loop sub-step"));
  console.error("");
  return false;
}
