import fs from "node:fs";
import path from "node:path";

import { artifactsDir, receiptArtifactName } from "./artifacts.js";

const LEGACY_RECEIPT_RE = /`?\.conductor[\\/]artifacts[\\/](?:<card-index>-<slugified-card-title>|[^`\s,;:)]+?\.md)`?/g;

function receiptRelFor({ cwd, statusPath, stepId, step }) {
  return path.relative(
    cwd,
    path.join(artifactsDir(statusPath), receiptArtifactName(String(stepId), step)),
  ).split(path.sep).join("/");
}

/**
 * Old compiled workflows hard-coded `.conductor/artifacts/...` into every card.
 * Scoped v3 runs write receipts under `.conductor/<workflow>/artifacts/...`.
 *
 * Normalize just before dispatch so fresh compiles, cached compiles, and older
 * workflows all point workers at the same receipt path the runtime/checker uses.
 */
export function normalizeWorkflowReceiptInstructions({ workflowPath, statusPath, cwd = process.cwd() }) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  } catch {
    return false;
  }
  let changed = false;
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step.instruction !== "string") continue;
    const exact = `\`${receiptRelFor({ cwd, statusPath, stepId: i, step })}\``;
    const next = step.instruction.replace(LEGACY_RECEIPT_RE, exact);
    if (next !== step.instruction) {
      step.instruction = next;
      changed = true;
    }
  }
  if (!changed) return false;
  fs.writeFileSync(workflowPath, JSON.stringify(doc, null, 2));
  return true;
}

