#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "../server/server.js";

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : null;
const rest = argv.slice(1);

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

const HELP = `
  conductor-board — gated workflows for AI agents, with a live Kanban board

  Usage
    $ npx conductor-board [command] [options]

  Commands
    (default)                Serve the live board (watches .conductor/)
    init                     Scaffold a new .conductor/conductor.yaml
    validate [path]          Check a conductor against the spec
    setup                    Write setup.conductor.yaml (the bootstrap conductor)

  Board options
    --path, -p <file>        Path to status.json   (default: .conductor/status.json)
    --conductor, -c <file>   Path to the conductor  (default: auto-discovered)
    --port <n>               Port to serve on        (default: 3042)
    --no-open                Don't open the browser  (CI / headless only;
                             the board opens your browser by default)

  init options
    --name, -n <name>        Workflow name (skips the prompts)
    --description, -d <text> One-line description
    --steps, -s <n>          Number of placeholder steps
    --force, -f              Overwrite an existing conductor.yaml

  --help, -h                 Show this help

  Examples
    $ npx conductor-board
    $ npx conductor-board init --name clinic-update --steps 4
    $ npx conductor-board validate .conductor/conductor.yaml
`;

// ---- subcommands ----
if (command === "help" || (!command && flag(["--help", "-h"], false))) {
  console.log(HELP);
  process.exit(0);
}

if (command === "init") {
  const { runInit } = await import("../cli/init.js");
  process.exit((await runInit(rest)) ? 0 : 1);
}

if (command === "validate") {
  const { runValidate } = await import("../cli/validate.js");
  process.exit((await runValidate(rest)) ? 0 : 1);
}

if (command === "setup") {
  const { runSetup } = await import("../cli/setup.js");
  process.exit((await runSetup(rest)) ? 0 : 1);
}

if (command && command !== "board") {
  console.error(`Unknown command "${command}". Run with --help to see usage.`);
  process.exit(1);
}

// ---- default: serve the board ----
const statusPath = String(flag(["--path", "-p"], ".conductor/status.json"));
const conductorArg = flag(["--conductor", "-c"], null);
const conductorPath = conductorArg ? path.resolve(process.cwd(), String(conductorArg)) : null;
const wantedPort = Number(flag(["--port"], 3042)) || 3042;
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

const { conductorPath: resolvedConductor, absStatus, server, serverJsonPath } =
  await listenWithFallback(wantedPort);
const port = server.address().port;
const url = `http://localhost:${port}`;
const rel = (p) => (p ? path.relative(process.cwd(), p) || p : null);

console.log("");
console.log(`  ${iris("🎼 conductor-board")}`);
console.log(`  ${bold("Board live at")} ${mint(url)} ${dim("— watching " + rel(absStatus))}`);
if (resolvedConductor) {
  console.log(`  ${dim("conductor:  " + rel(resolvedConductor))}`);
} else {
  console.log(`  ${dim("conductor:  not found — cards show status only")}`);
}
console.log(`  ${dim("press ctrl+c to stop")}`);
console.log("");

if (!noOpen) openBrowser(url);

function shutdown() {
  try {
    if (serverJsonPath) fs.unlinkSync(serverJsonPath);
  } catch {
    /* already gone */
  }
  console.log(dim("\n  board stopped\n"));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
