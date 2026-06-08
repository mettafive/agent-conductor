import fs from "node:fs";
import path from "node:path";

const READABLE_EXTENSIONS = [".md", ".txt", ".json", ".log", ".html", ".csv", ".tsv"];

export function artifactsDir(statusPath) {
  return path.join(path.dirname(statusPath), "artifacts");
}

export function outputsDir(statusPath) {
  return artifactsDir(statusPath);
}

function legacyOutputsDir(statusPath) {
  return path.join(path.dirname(statusPath), "outputs");
}

function safeInOutputs(statusPath, relOrAbs) {
  const raw = String(relOrAbs || "");
  const clean = raw.replace(/^[/\\]+/, "");
  const roots = [artifactsDir(statusPath), legacyOutputsDir(statusPath)];
  let abs;
  if (path.isAbsolute(raw)) {
    abs = path.resolve(raw);
  } else if (clean.startsWith(".conductor/artifacts/") || clean.startsWith(".conductor\\artifacts\\")) {
    abs = path.resolve(path.dirname(statusPath), "..", clean);
  } else if (clean.startsWith(".conductor/outputs/") || clean.startsWith(".conductor\\outputs\\")) {
    abs = path.resolve(path.dirname(statusPath), "..", clean);
  } else if (clean.startsWith("artifacts/") || clean.startsWith("artifacts\\")) {
    abs = path.resolve(artifactsDir(statusPath), clean);
  } else if (clean.startsWith("outputs/") || clean.startsWith("outputs\\")) {
    abs = path.resolve(legacyOutputsDir(statusPath), clean.replace(/^outputs[\\/]/, ""));
  } else {
    abs = path.resolve(artifactsDir(statusPath), clean);
    if (!fs.existsSync(abs)) {
      const legacyAbs = path.resolve(legacyOutputsDir(statusPath), clean);
      if (fs.existsSync(legacyAbs)) abs = legacyAbs;
    }
  }
  for (const root of roots) {
    const relative = path.relative(root, abs);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return { abs, rel: relative.split(path.sep).join("/") };
    }
  }
  return null;
}

export function artifactForFile(statusPath, filePath) {
  const resolved = safeInOutputs(statusPath, filePath);
  if (!resolved) return null;
  if (!fs.existsSync(resolved.abs) || !fs.statSync(resolved.abs).isFile()) return null;
  return {
    path: resolved.rel,
    abs: resolved.abs,
    size: fs.statSync(resolved.abs).size,
  };
}

function candidateNames(stepId) {
  const safe = String(stepId).replace(/[^a-zA-Z0-9._-]+/g, "__");
  return [`${safe}.md`];
}

export function isReadableArtifactPath(filePath) {
  return READABLE_EXTENSIONS.includes(path.extname(String(filePath || "")).toLowerCase());
}

export function isReceiptArtifactPath(filePath) {
  return path.extname(String(filePath || "")).toLowerCase() === ".md";
}

function entryArtifactPaths(entry) {
  const fields = [
    entry?.artifact,
    entry?.artifact_path,
    entry?.output_file,
    entry?.output_path,
    ...(Array.isArray(entry?.artifacts) ? entry.artifacts : []),
    ...(Array.isArray(entry?.output_files) ? entry.output_files : []),
    ...(Array.isArray(entry?.files) ? entry.files : []),
    ...(Array.isArray(entry?.gate_detail)
      ? entry.gate_detail.flatMap((detail) => detail?.artifact_paths || [])
      : []),
  ].filter(Boolean);
  return fields
    .map((item) => (typeof item === "string" ? item : item.path || item.file))
    .filter(Boolean);
}

export function findArtifacts({ statusPath, stepId, entry }) {
  const roots = [artifactsDir(statusPath), legacyOutputsDir(statusPath)];
  const found = new Map();

  for (const name of candidateNames(stepId)) {
    for (const root of roots) {
      const abs = path.join(root, name);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        found.set(name, { path: name, abs, size: fs.statSync(abs).size });
        break;
      }
    }
  }

  for (const p of entryArtifactPaths(entry)) {
    const artifact = artifactForFile(statusPath, p);
    if (artifact) found.set(artifact.path, artifact);
  }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export function findReceiptArtifact({ statusPath, stepId, entry }) {
  const safe = String(stepId).replace(/[^a-zA-Z0-9._-]+/g, "__");
  const name = `${safe}.md`;
  return artifactForFile(statusPath, name) || artifactForFile(statusPath, path.join("outputs", name));
}

export function findArtifactsReferencedInReceipt(statusPath, receipt) {
  if (!receipt || !fs.existsSync(receipt.abs) || !fs.statSync(receipt.abs).isFile()) return [];
  if (!isReadableArtifactPath(receipt.path)) return [];
  const text = fs.readFileSync(receipt.abs, "utf8");
  const found = new Map();
  const patterns = [
    /\.conductor\/artifacts\/([^\s)`'"]+)/g,
    /\.conductor\/outputs\/([^\s)`'"]+)/g,
    /artifacts\/([^\s)`'"]+)/g,
    /outputs\/([^\s)`'"]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const artifact = artifactForFile(statusPath, match[1]);
      if (artifact) found.set(artifact.path, artifact);
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export function artifactReadSources({ statusPath, stepId, entry }) {
  return findArtifacts({ statusPath, stepId, entry })
    .filter((artifact) => isReadableArtifactPath(artifact.path))
    .map((artifact) => ({
      label: path.join("artifacts", artifact.path),
      path: artifact.path,
      text: fs.readFileSync(artifact.abs, "utf8"),
    }));
}

export function artifactRequirementMessage(stepId) {
  const safe = String(stepId).replace(/[^a-zA-Z0-9._-]+/g, "__");
  return (
    `no artifact found for card ${stepId} — write .conductor/artifacts/${safe}.md ` +
    `with the work product or action record before completing`
  );
}
