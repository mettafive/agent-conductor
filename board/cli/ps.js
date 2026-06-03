import { scanBoards, fmtUptime } from "./discover.js";

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const pad = (s, n) => String(s).padEnd(n);

/** List every conductor-board server running on this machine. */
export async function runPs() {
  const boards = await scanBoards();
  console.log("");
  if (boards.length === 0) {
    console.log(dim("  No conductor-board servers running."));
    console.log("");
    return true;
  }

  console.log("  " + bold(pad("PID", 7) + pad("PORT", 7) + pad("UPTIME", 10) + pad("MEM", 8) + "WORKFLOWS"));
  let totalMem = 0;
  for (const h of boards.sort((a, b) => a.port - b.port)) {
    totalMem += h.memory_mb || 0;
    const wfs = Object.entries(h.workflows || {})
      .map(([n, s]) => `${n} (${s.status})`)
      .join(", ");
    console.log(
      "  " +
        pad(h.pid ?? "?", 7) +
        pad(h.port, 7) +
        pad(fmtUptime(h.uptime_seconds), 10) +
        pad(`${h.memory_mb ?? "?"} MB`, 8) +
        (wfs || dim("—")),
    );
  }
  console.log("");
  console.log(dim(`  ${boards.length} board${boards.length === 1 ? "" : "s"} running, ${totalMem} MB total`));
  console.log(dim("  stop one with  conductor-board stop  ·  all with  conductor-board stop --all"));
  console.log("");
  return true;
}
