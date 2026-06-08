export function resolveTopLevelIndex(doc, stepId) {
  const steps = Array.isArray(doc?.steps) ? doc.steps : [];
  const n = Number(stepId);
  if (Number.isInteger(n) && n >= 0 && n < steps.length) return n;
  const legacy = steps.findIndex((s) => s && s.id === stepId);
  return legacy === -1 ? null : legacy;
}

function statusForIndex(status, doc, index) {
  const step = doc.steps?.[index];
  return status?.steps?.[String(index)] || (step?.id ? status?.steps?.[step.id] : null);
}

export function dependencyBlockers(doc, status, stepId) {
  if (String(stepId).includes("::")) return [];
  const index = resolveTopLevelIndex(doc, stepId);
  if (index === null) return [];

  const step = doc.steps[index];
  const blockers = [];
  for (const dep of step?.requires || []) {
    const depIndex = Number(dep);
    if (!Number.isInteger(depIndex) || depIndex < 0 || depIndex >= doc.steps.length) continue;
    const depStatus = statusForIndex(status, doc, depIndex);
    if (depStatus?.status !== "done") {
      blockers.push({
        index: depIndex,
        title: doc.steps[depIndex]?.title || `card ${depIndex}`,
        status: depStatus?.status || "pending",
      });
    }
  }
  return blockers;
}

export function dependencyBlockerMessage(stepId, blockers) {
  const list = blockers.map((b) => `${b.index} "${b.title}" (${b.status})`).join(", ");
  return `card ${stepId} is blocked; waiting for: ${list}`;
}
