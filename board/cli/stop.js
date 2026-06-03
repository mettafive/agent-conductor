import fs from "node:fs";
import path from "node:path";
import { scanBoards } from "./discover.js";

const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const flag = (args, names, def) => {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) return args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : true;
  }
  return def;
};

const kill = (pid) => {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
};

/** Stop the board for this project, or every board with --all. */
export async function runStop(args) {
  console.log("");
  if (args.includes("--all")) {
    const boards = await scanBoards();
    if (boards.length === 0) {
      console.log(dim("  no boards running."));
      console.log("");
      return true;
    }
    let n = 0;
    for (const b of boards) {
      if (b.pid && kill(b.pid)) {
        n += 1;
        console.log(dim(`  stopped pid ${b.pid} (port ${b.port})`));
      }
    }
    console.log("");
    console.log(dim(`  stopped ${n} board${n === 1 ? "" : "s"}.`));
    console.log("");
    return true;
  }

  // this project
  const dir = String(flag(args, ["--dir"], ".conductor"));
  const serverJson = path.resolve(process.cwd(), dir, "server.json");
  let info;
  try {
    info = JSON.parse(fs.readFileSync(serverJson, "utf8"));
  } catch {
    console.log(dim(`  no board for this project (${path.relative(process.cwd(), serverJson)} not found).`));
    console.log(dim("  use  conductor-board ps  to see boards, or  stop --all  to stop them."));
    console.log("");
    return true;
  }
  if (info.pid && kill(info.pid)) {
    console.log(dim(`  stopped the board for this project (pid ${info.pid}, port ${info.port}).`));
  } else {
    try {
      fs.unlinkSync(serverJson);
    } catch {
      /* ignore */
    }
    console.log(dim(`  board pid ${info.pid} was not running — cleaned up server.json.`));
  }
  console.log("");
  return true;
}
