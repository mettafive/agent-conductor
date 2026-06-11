import fs from "node:fs";
import path from "node:path";

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

function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function workflowNameFromPath(workflowPath) {
  return readJsonMaybe(workflowPath)?.name || path.basename(path.dirname(path.resolve(workflowPath))) || "workflow";
}

export function scopedStatusForWorkflow(workflowPath) {
  return path.join(path.dirname(path.resolve(workflowPath)), "status.json");
}

export function scopedWorkflowForStatus(statusPath) {
  return path.join(path.dirname(path.resolve(statusPath)), "workflow.json");
}

function newestWorkflow(candidates) {
  return candidates
    .filter((file) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    })
    .map((file) => {
      const statusPath = scopedStatusForWorkflow(file);
      const workflowMtime = fs.statSync(file).mtimeMs;
      let statusMtime = 0;
      try {
        statusMtime = fs.statSync(statusPath).mtimeMs;
      } catch {
        /* status may not exist yet */
      }
      return { file, mtime: Math.max(workflowMtime, statusMtime) };
    })
    .sort((a, b) => b.mtime - a.mtime)[0]?.file;
}

function discoverDefaultWorkflow(cwd, defaultWorkflow) {
  const flat = path.resolve(cwd, defaultWorkflow);
  if (fs.existsSync(flat)) return flat;

  const scopedRoot = path.resolve(cwd, ".conductor");
  try {
    const candidates = fs
      .readdirSync(scopedRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(scopedRoot, entry.name, "workflow.json"));
    return newestWorkflow(candidates) || flat;
  } catch {
    return flat;
  }
}

export function resolveWorkflowContext(args, { workflowArg, defaultWorkflow = ".conductor/workflow.json" } = {}) {
  const cwd = process.cwd();
  const dir = flag(args, ["--dir"]);
  const explicitPath = flag(args, ["--path", "-p"]);
  const explicitWorkflow = flag(args, ["--workflow", "--conductor", "-c", "-w"]);

  let workflowPath = null;
  if (typeof explicitWorkflow === "string") workflowPath = path.resolve(cwd, explicitWorkflow);
  else if (typeof workflowArg === "string") workflowPath = path.resolve(cwd, workflowArg);
  else if (typeof dir === "string") workflowPath = path.resolve(cwd, dir, "workflow.json");
  else workflowPath = discoverDefaultWorkflow(cwd, defaultWorkflow);

  let statusPath = null;
  if (typeof explicitPath === "string") statusPath = path.resolve(cwd, explicitPath);
  else if (typeof dir === "string") statusPath = path.resolve(cwd, dir, "status.json");
  else if (workflowPath && path.basename(workflowPath) === "workflow.json") statusPath = scopedStatusForWorkflow(workflowPath);
  else statusPath = path.resolve(cwd, ".conductor/status.json");

  return {
    workflowPath,
    statusPath,
    conductorDir: path.dirname(path.resolve(statusPath)),
    workflowName: workflowPath ? workflowNameFromPath(workflowPath) : "workflow",
  };
}

export function resolveStatusPath(args) {
  return resolveWorkflowContext(args).statusPath;
}
