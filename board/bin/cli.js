#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { startServer } from "../server/server.js";

const argv = process.argv.slice(2);

function flag(names, fallback) {
  for (const name of names) {
    const i = argv.indexOf(name);
    if (i !== -1) {
      const next = argv[i + 1];
      return next && !next.startsWith("-") ? next : true;
    }
  }
  return fallback;
}

if (flag(["--help", "-h"], false)) {
  console.log(`
  agent-conductor — live local Kanban board for gated agent workflows

  Usage
    $ npx agent-conductor [options]

  Options
    --path, -p <file>        Path to status.json   (default: .conductor/status.json)
    --conductor, -c <file>   Path to the conductor  (default: auto-discovered)
    --port <n>               Port to serve on        (default: 3000)
    --no-open                Don't open the browser
    --help, -h               Show this help

  Examples
    $ npx agent-conductor
    $ npx agent-conductor --path ./run/status.json --port 3001
`);
  process.exit(0);
}

const statusPath = String(flag(["--path", "-p"], ".conductor/status.json"));
const conductorArg = flag(["--conductor", "-c"], null);
const conductorPath = conductorArg ? path.resolve(process.cwd(), String(conductorArg)) : null;
const wantedPort = Number(flag(["--port"], 3000)) || 3000;
const noOpen = flag(["--no-open"], false) === true;

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening the browser is best-effort */
  }
}

// Try the requested port, walk forward a few if it's taken.
async function listenWithFallback(port, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await startServer({ statusPath, conductorPath, port: port + i });
    } catch (e) {
      if (e && e.code === "EADDRINUSE") continue;
      throw e;
    }
  }
  throw new Error(`No free port in range ${port}-${port + attempts - 1}`);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const iris = (s) => `\x1b[38;5;141m${s}\x1b[0m`;
const mint = (s) => `\x1b[38;5;78m${s}\x1b[0m`;

const { conductorPath: resolvedConductor, absStatus, server } =
  await listenWithFallback(wantedPort);
const port = server.address().port;
const url = `http://localhost:${port}`;
const rel = (p) => (p ? path.relative(process.cwd(), p) || p : null);

console.log("");
console.log(`  ${iris("🎼 agent-conductor")}`);
console.log(`  ${bold("Board live at")} ${mint(url)} ${dim("— watching " + rel(absStatus))}`);
if (resolvedConductor) {
  console.log(`  ${dim("conductor:  " + rel(resolvedConductor))}`);
} else {
  console.log(`  ${dim("conductor:  not found — cards show status only")}`);
}
console.log(`  ${dim("press ctrl+c to stop")}`);
console.log("");

if (!noOpen) openBrowser(url);

process.on("SIGINT", () => {
  console.log(dim("\n  board stopped\n"));
  process.exit(0);
});
