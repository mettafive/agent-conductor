import fs from "node:fs";
import path from "node:path";
import { recordCheckerResult, resolveStep, statusEntry, discoverConductor } from "./complete.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stringifyOutput(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value, null, 2);
}

function readMaybeFile(cwd, p) {
  const file = path.resolve(cwd, String(p));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return {
    label: path.relative(cwd, file),
    text: fs.readFileSync(file, "utf8"),
  };
}

function collectOutput({ args, cwd, statusPath, status, stepId, entry }) {
  const chunks = [];
  const inline = flag(args, ["--output"]);
  if (typeof inline === "string" && inline.trim()) chunks.push({ label: "--output", text: inline });

  const outputFile = flag(args, ["--output-file", "--file", "-f"]);
  if (typeof outputFile === "string") {
    const read = readMaybeFile(cwd, outputFile);
    if (read) chunks.push(read);
  }

  for (const key of ["output", "output_value", "result", "evidence"]) {
    const text = stringifyOutput(entry?.[key]);
    if (text) chunks.push({ label: `status.${key}`, text });
  }

  const candidateFields = [
    entry?.output_file,
    entry?.output_path,
    ...(Array.isArray(entry?.output_files) ? entry.output_files : []),
    ...(Array.isArray(entry?.artifacts) ? entry.artifacts : []),
    ...(Array.isArray(entry?.files) ? entry.files : []),
  ].filter(Boolean);
  for (const item of candidateFields) {
    const p = typeof item === "string" ? item : item.path || item.file;
    if (!p) continue;
    const read = readMaybeFile(cwd, p);
    if (read) chunks.push(read);
  }

  const statusDir = path.dirname(statusPath);
  for (const rel of [
    path.join("outputs", `${stepId}.md`),
    path.join("outputs", `${stepId}.txt`),
    `${stepId}-output.md`,
    `${stepId}.output.md`,
  ]) {
    const read = readMaybeFile(statusDir, rel) || readMaybeFile(cwd, path.join(".conductor", rel));
    if (read) chunks.push(read);
  }

  const handoffs = (Array.isArray(entry?.heartbeat) ? entry.heartbeat : [])
    .map((h) => h?.handoff?.produced)
    .filter((x) => typeof x === "string" && x.trim());
  for (const produced of handoffs) chunks.push({ label: "heartbeat.handoff.produced", text: produced });

  const text = chunks
    .map((c) => `--- ${c.label} ---\n${String(c.text).trim()}`)
    .join("\n\n")
    .trim();
  return { text, sources: chunks.map((c) => c.label) };
}

function parseVerdict(text) {
  const trimmed = String(text || "").trim();
  const first = trimmed.split(/\s+/)[0]?.toUpperCase();
  if (first === "PASS") return { passed: true, evidence: trimmed };
  if (first === "FAIL") return { passed: false, evidence: trimmed };
  if (/^\s*PASS\b/i.test(trimmed)) return { passed: true, evidence: trimmed };
  return { passed: false, evidence: `FAIL checker response did not start with PASS: ${trimmed}` };
}

async function runOpenAiChecker(instruction, output) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.CONDUCTOR_CHECKER_MODEL || "gpt-4o-mini";
  const prompt =
    `The agent was asked to do:\n${instruction}\n\n` +
    `Here is what it produced:\n${output}\n\n` +
    "Does the output satisfy the instruction? List specifically what's done and what's missing or wrong. " +
    "Respond with PASS or FAIL followed by your reasoning.";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are an independent checker for an AI-agent workflow. Judge only the instruction and output provided." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI checker failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return parseVerdict(json?.choices?.[0]?.message?.content || "");
}

/**
 * conductor-board check <step-id>
 *
 * Runs the universal independent checker: instruction + produced output in,
 * PASS/FAIL evidence out. Records the verdict directly into status.json for
 * `complete` to consume.
 */
export async function runCheck(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: conductor-board check <step-id>[::iter::sub] [--output \"...\"] [--output-file file]\n" +
        "       conductor-board check <step-id> --path .conductor/status.json --conductor .conductor/conductor.json\n\n" +
        "  Independently verifies the card output against its instruction and records\n" +
        "  the PASS/FAIL verdict for `conductor-board complete`.\n\n" +
        "  Output sources: --output, --output-file, status output/artifact fields,\n" +
        "  .conductor/outputs/<step>.md, and heartbeat handoff produced text.\n" +
        "  Uses OPENAI_API_KEY when present; otherwise records a heuristic verdict.",
    );
    return true;
  }

  const [stepId] = positionals(args);
  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  if (!stepId) {
    console.error(red("usage: conductor-board check <step-id>[::iter::sub] [--output \"...\"] [--output-file file]"));
    return false;
  }

  const conductorPath = discoverConductor(statusPath, flag(args, ["--conductor", "-c"]));
  if (!conductorPath) {
    console.error(red("✗ no conductor file found next to status.json or in cwd"));
    return false;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(conductorPath, "utf8"));
  } catch (e) {
    console.error(red(`✗ could not parse conductor: ${e.message}`));
    return false;
  }
  const resolved = resolveStep(doc, stepId);
  if (!resolved.ok) {
    console.error(red(resolved.error));
    return false;
  }

  let status;
  try {
    status = readJson(statusPath);
  } catch (e) {
    console.error(red(`✗ could not read status.json: ${e.message}`));
    return false;
  }

  const entry = statusEntry(status, resolved.loopPath, stepId);
  if (entry.status === "failed") {
    console.error(red(`✗ ${stepId} is failed. No more checker runs are allowed for this card.`));
    return false;
  }

  entry.gate = "checking";
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  const { text: output, sources } = collectOutput({
    args,
    cwd: process.cwd(),
    statusPath,
    status,
    stepId,
    entry,
  });

  const instruction = String(resolved.step.instruction || "").trim();
  let verdict;
  try {
    verdict = await runOpenAiChecker(instruction, output);
  } catch (e) {
    verdict = {
      passed: false,
      evidence: `FAIL checker invocation failed: ${e.message}`,
    };
  }

  if (!verdict) {
    if (!output) {
      verdict = {
        passed: false,
        evidence: "FAIL no output was recorded for this card. Add output or artifact references, then run the checker again.",
      };
    } else {
      verdict = {
        passed: true,
        evidence:
          "PASS provisional heuristic: output was recorded, but no LLM checker is configured. " +
          "Set OPENAI_API_KEY for independent semantic checking.",
      };
    }
  }

  status = readJson(statusPath);
  recordCheckerResult(status, resolved, stepId, verdict.passed, verdict.evidence, {
    checker: process.env.OPENAI_API_KEY ? "instruction" : "heuristic",
    output_sources: sources,
  });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  console.log("");
  console.log(`${verdict.passed ? green("✓ checker PASS") : red("✕ checker FAIL")} ${stepId}`);
  if (!process.env.OPENAI_API_KEY) console.log(amber("  no LLM checker configured; used heuristic fallback"));
  if (sources.length) console.log(dim(`  output: ${sources.join(", ")}`));
  console.log(dim(`  evidence: ${verdict.evidence}`));
  console.log("");
  return verdict.passed;
}
