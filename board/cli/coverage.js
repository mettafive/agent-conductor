import fs from "node:fs";
import path from "node:path";
import { parseCardsJson } from "./cards.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

export function computeCoverage(cards, steps) {
  const missing = cards
    .map((card, index) => ({ card, index }))
    .filter(({ index }) => !steps[index]);
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
  const workflowPath = path.resolve(process.cwd(), flag(["--workflow", "--conductor", "-c"]) || ".conductor/workflow.json");

  const fail = (msg) => {
    console.error(red(`✗ coverage ${msg}`));
    return false;
  };

  if (!fs.existsSync(cardsPath)) return fail(`— no cards.json at ${path.relative(process.cwd(), cardsPath)}.`);
  if (!fs.existsSync(workflowPath)) return fail(`— no workflow at ${path.relative(process.cwd(), workflowPath)}.`);

  let cards;
  try {
    cards = parseCardsJson(fs.readFileSync(cardsPath, "utf8"));
  } catch (e) {
    return fail(`— could not parse cards.json: ${e.message}`);
  }
  if (cards.length === 0) return fail(`— ${path.relative(process.cwd(), cardsPath)} has no cards.`);

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  } catch (e) {
    return fail(`— could not parse workflow JSON: ${e.message}`);
  }

  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  const { total, missing } = computeCoverage(cards, steps);

  console.log("");
  if (missing.length === 0 && steps.length === cards.length) {
    console.log(green(`✓ coverage: all ${total} cards are present in workflow.json`));
    console.log(dim(`  ${path.relative(process.cwd(), cardsPath)} ↔ ${path.relative(process.cwd(), workflowPath)}`));
    console.log("");
    return true;
  }

  const extra = Math.max(0, steps.length - cards.length);
  console.error(red(`✗ coverage: ${missing.length} missing card(s), ${extra} extra workflow step(s)`));
  for (const { index, card } of missing) console.error(red(`    ✗ card ${index}: ${card.title || "Untitled"}`));
  console.error(dim("  every cards.json array entry must appear at the same index in workflow.json"));
  console.error("");
  return false;
}
