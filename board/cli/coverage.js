import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

// `conductor-board coverage` — the independent check behind authoring-a-good-board §1
// ("Show every phase … never fold a phase into another card's instructions").
//
// The bootstrap's read-skill step emits a machine-readable WORK-UNIT LEDGER into
// .conductor/skill-analysis.md (every named phase the user would scan for, tagged
// gateable|divider). This command set-differences that ledger against the cards that
// actually exist in the conductor and FAILS if any work-unit has no card — so a folded
// phase (the classic "paid SEO recon hidden inside pick-batch") can't pass authoring.
//
// This is NOT a regex decomposition of the skill: the semantic decomposition is the
// agent's (read-skill). This only verifies the conductor honors the agent's OWN explicit
// ledger — a mechanical, independent observation, exactly the no-self-attestation bar the
// bootstrap demands of every other gate (principle #9).

const norm = (s) => String(s).trim().toLowerCase();

/** Parse the work-unit ledger lines from skill-analysis.md.
 *  Ledger line format (one per named work-unit):
 *      - id: <kebab-id>   kind: gateable|divider   [loop: <name>]
 *  We scan structured ledger lines anywhere in the file (robust to surrounding prose). */
export function parseLedger(md) {
  const units = [];
  const seen = new Set();
  for (const raw of md.split(/\r?\n/)) {
    const m = raw.match(/^\s*-\s*id:\s*([A-Za-z0-9][\w-]*)\s+kind:\s*(gateable|divider)\b/i);
    if (!m) continue;
    const id = norm(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const loop = raw.match(/\bloop:\s*([\w-]+)/i);
    units.push({ id, kind: m[2].toLowerCase(), loop: loop ? loop[1] : null });
  }
  return units;
}

/** Every step + loop sub-step id in a conductor doc (recursively), normalized. */
export function conductorCardIds(doc, acc = new Set()) {
  for (const s of doc?.steps ?? []) {
    if (s && s.id) acc.add(norm(s.id));
    if (s && s.type === "loop" && Array.isArray(s.steps)) {
      for (const sub of s.steps) if (sub && sub.id) acc.add(norm(sub.id));
    }
  }
  return acc;
}

/** A ledger id is covered if a card has the same id, or a card id ends with it
 *  (so a loop sub-step `polish-page` covers ledger `page-polish`-style suffix matches
 *  is intentionally NOT allowed — we keep it strict on exact id to force discipline). */
function isCovered(unitId, cardIds) {
  return cardIds.has(unitId);
}

export function computeCoverage(ledger, cardIds) {
  const orphans = ledger.filter((u) => !isCovered(u.id, cardIds));
  return { total: ledger.length, orphans };
}

export async function runCoverage(args) {
  const flag = (names) => {
    for (const n of names) {
      const i = args.indexOf(n);
      if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("-")) return args[i + 1];
    }
    return null;
  };
  const analysisPath = path.resolve(
    process.cwd(),
    flag(["--analysis", "-a"]) || ".conductor/skill-analysis.md",
  );
  const conductorPath = path.resolve(
    process.cwd(),
    flag(["--conductor", "-c"]) || ".conductor/conductor.yaml",
  );

  const fail = (msg) => {
    console.error(red(`✗ coverage ${msg}`));
    return false;
  };

  if (!fs.existsSync(analysisPath)) {
    return fail(
      `— no work-unit ledger at ${path.relative(process.cwd(), analysisPath)}. ` +
        `read-skill must list every work-unit as "- id: <id>  kind: gateable|divider".`,
    );
  }
  if (!fs.existsSync(conductorPath)) {
    return fail(`— no conductor at ${path.relative(process.cwd(), conductorPath)}.`);
  }

  const ledger = parseLedger(fs.readFileSync(analysisPath, "utf8"));
  if (ledger.length === 0) {
    return fail(
      `— the ledger in ${path.relative(process.cwd(), analysisPath)} has no work-units. ` +
        `List each as "- id: <id>  kind: gateable|divider" so coverage can verify a card exists for it.`,
    );
  }

  let doc;
  try {
    doc = yaml.load(fs.readFileSync(conductorPath, "utf8"));
  } catch (e) {
    return fail(`— could not parse conductor YAML: ${e.message}`);
  }

  const cardIds = conductorCardIds(doc);
  const { total, orphans } = computeCoverage(ledger, cardIds);

  console.log("");
  if (orphans.length === 0) {
    console.log(green(`✓ coverage: all ${total} work-units have a card`));
    console.log(dim(`  ledger ${path.relative(process.cwd(), analysisPath)} ↔ ${path.relative(process.cwd(), conductorPath)}`));
    console.log("");
    return true;
  }

  console.error(red(`✗ coverage: ${orphans.length} of ${total} work-unit(s) have NO card — a named phase was folded into another step, not surfaced.`));
  for (const u of orphans) {
    const hint = u.kind === "divider" ? "visibility-only — give it a gate-less / board-sync-only card" : "needs its own gated card";
    console.error(red(`    ✗ ${u.id}`) + dim(`  (${u.kind} — ${hint})`));
  }
  console.error(dim(`  every work-unit the skill names must be its own step/sub-step — see docs/authoring-a-good-board.md §1`));
  console.error("");
  return false;
}
