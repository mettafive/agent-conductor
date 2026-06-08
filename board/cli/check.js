import fs from "node:fs";
import path from "node:path";
import { dependencyBlockers, dependencyBlockerMessage } from "./dependencies.js";
import { appendAutoHeartbeat } from "./heartbeats.js";
import { recordCheckerResult, resolveStep, statusEntry, discoverConductor } from "./complete.js";
import { artifactForFile, artifactReadSources, isReadableArtifactPath } from "./artifacts.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
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
    abs: file,
    text: isReadableArtifactPath(file) ? fs.readFileSync(file, "utf8") : null,
  };
}

function collectOutput({ args, cwd, statusPath, status, stepId, entry }) {
  const chunks = [];
  const artifactPaths = [];
  const inline = flag(args, ["--output"]);
  if (typeof inline === "string" && inline.trim()) chunks.push({ label: "--output", text: inline });

  const outputFile = flag(args, ["--output-file", "--file", "-f"]);
  if (typeof outputFile === "string") {
    const read = readMaybeFile(cwd, outputFile);
    if (read) {
      const artifact = artifactForFile(statusPath, read.abs);
      if (artifact) artifactPaths.push(artifact.path);
      if (read.text !== null) chunks.push({ ...read, path: artifact?.path });
    }
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
    if (read) {
      const artifact = artifactForFile(statusPath, read.abs);
      if (artifact) artifactPaths.push(artifact.path);
      if (read.text !== null) chunks.push({ ...read, path: artifact?.path });
    }
  }

  for (const read of artifactReadSources({ statusPath, stepId, entry })) {
    artifactPaths.push(read.path);
    chunks.push(read);
  }

  const handoffs = (Array.isArray(entry?.heartbeat) ? entry.heartbeat : [])
    .map((h) => h?.handoff?.produced)
    .filter((x) => typeof x === "string" && x.trim());
  for (const produced of handoffs) chunks.push({ label: "heartbeat.handoff.produced", text: produced });

  const text = chunks
    .map((c) => `--- ${c.label} ---\n${String(c.text).trim()}`)
    .join("\n\n")
    .trim();
  return {
    text,
    sources: chunks.map((c) => c.label),
    artifactPaths: [...new Set([...artifactPaths, ...chunks.map((c) => c.path).filter(Boolean)])],
  };
}

function checkerPrompt(instruction, output) {
  return (
    `The agent was asked: ${instruction}\n\n` +
    `Here is what was produced:\n${output}\n\n` +
    "The output must be the card's primary markdown receipt at .conductor/artifacts/<card-index>.md: the actual work product or a verifiable action record. Content/code/data cards should show the actual content, code, data, diff, or report in that markdown receipt. Action cards may pass with the markdown receipt only when it includes concrete proof such as command run, timestamp, inputs, return value, changed resource, affected rows/files/URLs, and verification query/curl/test result. If the receipt merely describes what was done without proof, FAIL immediately.\n" +
    "Supporting files such as images, screenshots, PDFs, JSON, CSV, HTML, or logs are not standalone primary artifacts. Evaluate them only as files referenced from the markdown receipt. For image work, the receipt should embed every produced image inline with markdown image syntax.\n" +
    "Does it satisfy the instruction? List what's done and what's missing. PASS or FAIL.\n" +
    "Also write two dashboard lines:\n" +
    "MADE: one line summarizing what the agent produced.\n" +
    "CHECKED: one line summarizing how you verified it passed or why it failed.\n" +
    "Then write a one-line summary starting with SUMMARY: that a non-technical person could scan in a dashboard."
  );
}

/**
 * conductor-board check <step-id>
 *
 * Prints the universal independent checker prompt: instruction + produced
 * output in, PASS/FAIL verdict out. The caller evaluates the prompt in a clean
 * context and records the verdict with `gate-result`.
 */
export async function runCheck(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
        "usage: conductor-board check <step-id>[::iter::sub] [--output \"...\"] [--output-file file]\n" +
        "       conductor-board check <card-index> --path .conductor/status.json --workflow .conductor/workflow.json\n\n" +
        "  Prints the independent checker prompt for comparing the card output against\n" +
        "  its instruction. Evaluate the prompt in a clean context, then record the\n" +
        "  PASS/FAIL verdict and SUMMARY line with `conductor-board gate-result`.\n\n" +
        "  Completion requires .conductor/artifacts/<step>.md as the primary\n" +
        "  markdown receipt. Non-text work should reference supporting files from\n" +
        "  that receipt; image receipts should embed\n" +
        "  every produced image inline.",
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

  const conductorPath = discoverConductor(statusPath, flag(args, ["--workflow", "--conductor", "-c"]));
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
  const blockers = dependencyBlockers(doc, status, stepId);
  if (blockers.length) {
    console.error(red(`✗ ${dependencyBlockerMessage(stepId, blockers)}`));
    return false;
  }

  entry.gate = "checking";
  appendAutoHeartbeat(status, resolved.loopPath, stepId, `Checking: ${resolved.step.title || stepId}`);
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

  const { text: output, sources, artifactPaths } = collectOutput({
    args,
    cwd: process.cwd(),
    statusPath,
    status,
    stepId,
    entry,
  });
  if (artifactPaths.length) {
    entry.artifacts = [...new Set([...(Array.isArray(entry.artifacts) ? entry.artifacts : []), ...artifactPaths])];
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  }

  const instruction = String(resolved.step.instruction || "").trim();
  if (!output) {
    const evidence = "FAIL no output was produced.\nSUMMARY: No output was produced.";
    status = readJson(statusPath);
    recordCheckerResult(status, resolved, stepId, false, evidence, {
      checker: "instruction",
      output_sources: sources,
      artifact_paths: artifactPaths,
    });
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    console.log("");
    console.log(red(`✕ checker FAIL ${stepId}`));
    console.log(dim(`  evidence: ${evidence}`));
    console.log("");
    return false;
  }

  console.log("");
  console.log(`checker prompt for ${stepId}`);
  if (sources.length) console.log(dim(`  output: ${sources.join(", ")}`));
  console.log("");
  console.log(checkerPrompt(instruction, output));
  console.log("");
  return true;
}
