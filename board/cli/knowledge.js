import fs from "node:fs";
import path from "node:path";
import { validateConductor } from "./validate.js";

export const SCOPES = ["this-conductor", "upstream", "template", "tooling", "corpus"];

/** Find the conductor file paired with a status.json. */
export function discoverConductor(statusPath, explicit) {
  if (explicit) {
    const p = path.resolve(process.cwd(), explicit);
    return fs.existsSync(p) ? p : null;
  }
  const dir = path.dirname(statusPath);
  for (const paired of [
    path.join(dir, "workflow.json"),
    path.join(path.dirname(path.dirname(dir)), "workflow.json"),
  ]) {
    if (fs.existsSync(paired)) return paired;
  }
  const local = path.resolve(process.cwd(), "workflow.json");
  if (fs.existsSync(local)) return local;
  return null;
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The status a knowledge entry should hold given its evidence (§10.3):
 *   1 observation → emerging · 3+ → proven (this-conductor) · applied is sticky.
 * Cross-cutting scopes can't be auto-applied, so they sit at `open`.
 */
export function statusFor(entry) {
  if (entry.status === "applied") return "applied";
  if (entry.scope && entry.scope !== "this-conductor") return "open";
  return (entry.observed || 1) >= 3 ? "proven" : "emerging";
}

/** Merge one learning into a conductor doc's knowledge array (in place). */
export function mergeKnowledge(doc, entry) {
  doc.knowledge = Array.isArray(doc.knowledge) ? doc.knowledge : [];
  const existing = doc.knowledge.find(
    (k) => k && typeof k === "object" && norm(k.title) === norm(entry.title),
  );
  if (existing) {
    existing.observed = (existing.observed || 1) + 1;
    if (entry.scope) existing.scope = entry.scope;
    if (entry.step) existing.step = entry.step;
    if (entry.type) existing.type = entry.type;
    if (entry.current) existing.current = entry.current;
    if (entry.proposed) existing.proposed = entry.proposed;
    if (entry.note) existing.note = entry.note;
    existing.status = statusFor(existing);
    return existing;
  }
  const fresh = {
    title: entry.title,
    scope: entry.scope || "this-conductor",
    observed: entry.observed || 1,
    ...(entry.step ? { step: entry.step } : {}),
    ...(entry.type ? { type: entry.type } : {}),
    ...(entry.current ? { current: entry.current } : {}),
    ...(entry.proposed ? { proposed: entry.proposed } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };
  fresh.status = statusFor(fresh);
  doc.knowledge.push(fresh);
  return fresh;
}

/** Read + parse a conductor file. Throws on parse error. */
export function loadConductor(conductorPath) {
  return JSON.parse(fs.readFileSync(conductorPath, "utf8")) || {};
}

/**
 * Write a conductor doc back, with a single rolling backup and a re-validation.
 * Returns { ok, error } — never throws.
 */
export function saveConductor(conductorPath, doc) {
  const errors = validateConductor(doc);
  if (errors.length) return { ok: false, error: `would be invalid: ${errors[0]}` };
  try {
    fs.writeFileSync(`${conductorPath}.bak`, fs.readFileSync(conductorPath, "utf8"));
  } catch {
    /* backup is best-effort */
  }
  try {
    fs.writeFileSync(conductorPath, JSON.stringify(doc, null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Count knowledge entries (optionally filtered by status/scope). */
export function knowledgeCount(doc, { status, scope } = {}) {
  const k = Array.isArray(doc.knowledge) ? doc.knowledge : [];
  return k.filter(
    (e) =>
      e &&
      (!status || (e.status || "emerging") === status) &&
      (!scope || (e.scope || "this-conductor") === scope),
  ).length;
}
