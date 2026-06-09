import fs from "node:fs";
import path from "node:path";
import { normalizeVerdictLines } from "./complete.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      const v = args[i + 1];
      if (v && !v.startsWith("-")) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

// Collect every stored gate_detail entry across top-level steps and loop
// iteration sub-steps. Operates on STORED data only — never the live record path.
function collectGateDetails(status) {
  const targets = [];
  const steps = status?.steps || {};
  for (const [stepId, entry] of Object.entries(steps)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "loop" && entry.iterations && typeof entry.iterations === "object") {
      for (const [iter, subs] of Object.entries(entry.iterations)) {
        if (!subs || typeof subs !== "object") continue;
        for (const [subId, sub] of Object.entries(subs)) {
          if (Array.isArray(sub?.gate_detail)) {
            targets.push({ label: `${stepId}::${iter}::${subId}`, detail: sub.gate_detail });
          }
        }
      }
    }
    if (Array.isArray(entry.gate_detail)) {
      targets.push({ label: stepId, detail: entry.gate_detail });
    }
  }
  return targets;
}

/**
 * conductor-board backfill-summaries <status-path>
 *
 * One-shot backfill of clean two-sentence verdict summaries into a run's STORED
 * gate_detail. Uses the RETAINED `normalizeVerdictLines` generator (the only
 * place it still runs) to derive distinct, bounded summary/made/checked lines
 * from each stored evidence string. Idempotent — already-clean lines are kept.
 * Never touches the live record path; PASS/FAIL and raw evidence are untouched.
 *
 * --dry-run prints what would change without writing.
 */
export async function runBackfillSummaries(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board backfill-summaries <status-path> [--dry-run]\n\n" +
        "  Regenerates clean two-sentence verdict summaries into each step's stored\n" +
        "  gate_detail from its stored evidence. Idempotent, stored-data only, never\n" +
        "  touches the live record path. PASS/FAIL and raw evidence are untouched.\n" +
        "  Requires a model key for the generator (see agent-conductor .env / env).",
    );
    return true;
  }

  const [statusArg] = positionals(args);
  if (!statusArg) {
    console.error(red("usage: conductor-board backfill-summaries <status-path> [--dry-run]"));
    return false;
  }
  const statusPath = path.resolve(process.cwd(), statusArg);
  const dryRun = args.includes("--dry-run");

  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not read status.json: ${e.message}`));
    return false;
  }

  const targets = collectGateDetails(status);
  if (!targets.length) {
    console.log(dim("no stored gate_detail entries found; nothing to backfill."));
    return true;
  }

  let changed = 0;
  let skipped = 0;
  let failed = 0;

  for (const { label, detail } of targets) {
    for (const d of detail) {
      if (!d || typeof d !== "object") continue;
      const evidence = typeof d.evidence === "string" ? d.evidence : "";
      // Re-derive the three display lines from the authored summary/made/checked
      // (if present) plus the stored evidence. normalizeVerdictLines keeps any
      // already-valid line and only mints the missing/malformed ones.
      let lines;
      try {
        lines = await normalizeVerdictLines({
          summary: d.summary,
          made_summary: d.made_summary,
          checked_summary: d.checked_summary,
          evidence,
        });
      } catch (e) {
        failed += 1;
        console.error(red(`  ✗ ${label}: generator error: ${e.message}`));
        continue;
      }

      const before = JSON.stringify({
        summary: d.summary ?? null,
        made_summary: d.made_summary ?? null,
        checked_summary: d.checked_summary ?? null,
      });
      const after = JSON.stringify({
        summary: lines.summary ?? null,
        made_summary: lines.made_summary ?? null,
        checked_summary: lines.checked_summary ?? null,
      });

      if (before === after) {
        skipped += 1;
        continue;
      }

      changed += 1;
      console.log(green(`  ✓ ${label}`));
      if (lines.summary) console.log(dim(`      summary: ${lines.summary}`));
      if (dryRun) continue;

      d.summary = lines.summary;
      d.made_summary = lines.made_summary;
      d.checked_summary = lines.checked_summary;
      // PASS/FAIL (d.passed) and raw evidence (d.evidence) are intentionally untouched.
    }
  }

  if (!dryRun && changed > 0) {
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  }

  console.log("");
  console.log(
    `${dryRun ? "DRY RUN — " : ""}backfill complete: ${changed} updated, ${skipped} already clean${
      failed ? `, ${failed} failed` : ""
    }.`,
  );
  if (dryRun) console.log(dim("  no file written (--dry-run)."));
  console.log("");
  return failed === 0;
}
