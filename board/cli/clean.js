import fs from "node:fs";
import path from "node:path";

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

const flag = (args, names, def) => {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) {
      const v = args[i + 1];
      return v && !v.startsWith("-") ? v : true;
    }
  }
  return def;
};

/** Workflow directories under a .conductor root (flat + subdirs). */
function workflowDirs(root) {
  const dirs = [];
  const has = (d) =>
    fs.existsSync(path.join(d, "status.json")) || fs.existsSync(path.join(d, "history"));
  if (has(root)) dirs.push(root);
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "history") {
        const d = path.join(root, e.name);
        if (has(d)) dirs.push(d);
      }
    }
  } catch {
    /* no root */
  }
  return dirs;
}

/** conductor-board clean [--keep N] [--prune-heartbeats [--keep-beats M]] [--dry-run] */
export async function runClean(args) {
  const root = path.resolve(process.cwd(), String(flag(args, ["--dir"], ".conductor")));
  const keep = Number(flag(args, ["--keep"], 50)) || 50;
  const keepBeats = Number(flag(args, ["--keep-beats"], 30)) || 30;
  const pruneBeats = args.includes("--prune-heartbeats");
  const dry = args.includes("--dry-run");

  const dirs = workflowDirs(root);
  if (dirs.length === 0) {
    console.log(dim(`\n  nothing to clean under ${path.relative(process.cwd(), root) || root}\n`));
    return true;
  }

  console.log("");
  if (dry) console.log(amber("  DRY RUN — nothing will be deleted or written.\n"));
  let runsDeleted = 0;
  let beatsArchived = 0;

  for (const dir of dirs) {
    const name = path.basename(dir);

    // 1 — trim history to the last `keep` runs
    const histDir = path.join(dir, "history");
    try {
      const files = fs
        .readdirSync(histDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ f, t: fs.statSync(path.join(histDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      const old = files.slice(keep);
      for (const { f } of old) {
        if (!dry) fs.unlinkSync(path.join(histDir, f));
        runsDeleted += 1;
      }
      if (old.length) console.log(`  ${name}: ${dry ? "would remove" : "removed"} ${old.length} old run(s) (keep ${keep})`);
    } catch {
      /* no history */
    }

    // 2 — prune heartbeats (opt-in), keeping finalBeats + insight beats
    if (pruneBeats) {
      const statusPath = path.join(dir, "status.json");
      try {
        const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
        const overflow = [];
        for (const [stepId, step] of Object.entries(status.steps || {})) {
          const hb = Array.isArray(step.heartbeat) ? step.heartbeat : [];
          const protectedSet = new Set(hb.filter((b) => b.finalBeat || b.insight));
          const regular = hb.filter((b) => !protectedSet.has(b));
          if (regular.length <= keepBeats) continue;
          const drop = new Set(regular.slice(0, regular.length - keepBeats));
          for (const b of hb) if (drop.has(b)) overflow.push({ step: stepId, ...b });
          step.heartbeat = hb.filter((b) => !drop.has(b));
        }
        if (overflow.length) {
          beatsArchived += overflow.length;
          if (!dry) {
            fs.appendFileSync(
              path.join(dir, "heartbeat-archive.jsonl"),
              overflow.map((o) => JSON.stringify(o)).join("\n") + "\n",
            );
            fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
          }
          console.log(
            `  ${name}: ${dry ? "would archive" : "archived"} ${overflow.length} heartbeat(s) (keep ${keepBeats}/step; finalBeats + insights kept)`,
          );
        }
      } catch {
        /* no status */
      }
    }
  }

  console.log("");
  console.log(
    green(
      `  ${dry ? "would clean" : "cleaned"}: ${runsDeleted} run(s)` +
        (pruneBeats ? `, ${beatsArchived} heartbeat(s) archived` : ""),
    ),
  );
  console.log("");
  return true;
}
