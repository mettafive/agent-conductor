import http from "node:http";

/** GET /health on a local port; resolves the parsed health or null. */
export function getHealth(port, timeout = 400) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const h = JSON.parse(data);
            resolve(h && h.status === "ok" ? { port, ...h } : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Scan the conductor-board port range for live boards. */
export async function scanBoards(from = 3042, to = 3099) {
  const ports = [];
  for (let p = from; p <= to; p++) ports.push(p);
  const all = await Promise.all(ports.map((p) => getHealth(p)));
  return all.filter(Boolean);
}

export function fmtUptime(s) {
  if (!Number.isFinite(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
