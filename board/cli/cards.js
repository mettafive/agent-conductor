import fs from "node:fs";
import path from "node:path";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ALLOWED = new Set(["id", "title", "instruction"]);

function lineFor(src, index) {
  const needle = `"id"`;
  const pos = src.indexOf(needle, index === 0 ? 0 : undefined);
  if (pos === -1) return "?";
  return src.slice(0, pos).split(/\r?\n/).length;
}

export function parseCardsJson(src) {
  const parsed = JSON.parse(src);
  if (!Array.isArray(parsed)) {
    const err = new Error("cards.json must be a JSON array");
    err.code = "CARDS_SHAPE";
    throw err;
  }
  return parsed.map((card, i) => ({ ...(card || {}), line: lineFor(src, i) }));
}

export function validateCardsJson(src) {
  let cards;
  try {
    cards = parseCardsJson(src);
  } catch (e) {
    return { cards: [], errors: [`could not parse cards.json: ${e.message}`] };
  }

  const errors = [];
  const seen = new Map();

  if (cards.length === 0) errors.push("cards.json has no card entries. Add objects with id, title, and instruction.");

  for (const [idx, card] of cards.entries()) {
    const line = card.line || idx + 1;
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      errors.push(`entry ${idx + 1}: card must be a JSON object`);
      continue;
    }

    for (const key of Object.keys(card)) {
      if (key === "line") continue;
      if (!ALLOWED.has(key)) {
        errors.push(`entry ${idx + 1}: forbidden field "${key}" present. Card design must include only id, title, and instruction.`);
      }
    }

    if (typeof card.id !== "string" || !card.id.trim()) errors.push(`entry ${idx + 1}: card is missing id`);
    else if (!ID_RE.test(card.id)) errors.push(`entry ${idx + 1}: id "${card.id}" must be kebab-case`);

    if (typeof card.title !== "string" || !card.title.trim()) errors.push(`entry ${idx + 1}: card "${card.id || "?"}" is missing title`);
    if (typeof card.instruction !== "string" || !card.instruction.trim()) {
      errors.push(`entry ${idx + 1}: card "${card.id || "?"}" is missing instruction`);
    }

    if (card.id) {
      const prior = seen.get(card.id);
      if (prior) errors.push(`entry ${idx + 1}: duplicate id "${card.id}" first used in entry ${prior}`);
      else seen.set(card.id, idx + 1);
    }
  }

  return { cards, errors };
}

function flag(args, names) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) {
      const v = args[i + 1];
      return v && !v.startsWith("-") ? v : true;
    }
  }
  return undefined;
}

export async function runCards(args) {
  const skill = flag(args, ["--skill", "-s"]);
  const fileArg = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "--skill" && args[i - 1] !== "-s");
  const cardsPath = path.resolve(process.cwd(), fileArg || ".conductor/cards.json");

  const fail = (msg) => {
    console.error(red(`✗ cards ${msg}`));
    return false;
  };

  if (typeof skill === "string") {
    const skillPath = path.resolve(process.cwd(), skill);
    if (!fs.existsSync(skillPath)) return fail(`— skill file not found at ${path.relative(process.cwd(), skillPath)}`);
  }

  if (!fs.existsSync(cardsPath)) {
    return fail(`— no cards.json at ${path.relative(process.cwd(), cardsPath)}`);
  }

  const { cards, errors } = validateCardsJson(fs.readFileSync(cardsPath, "utf8"));
  console.log("");
  if (errors.length) {
    for (const e of errors) console.error(red(`✗ ${e}`));
    console.error("");
    return false;
  }

  console.log(green(`✓ cards: ${cards.length} card${cards.length === 1 ? "" : "s"} valid`));
  console.log(dim(`  ${path.relative(process.cwd(), cardsPath)} has id/title/instruction; ids are unique kebab-case`));
  console.log("");
  return true;
}
