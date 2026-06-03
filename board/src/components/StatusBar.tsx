import { useEffect, useState } from "react";
import type { BoardModel } from "../lib/types";

type Conn = "connecting" | "live" | "lost";

function useElapsed(startedAt?: string, running?: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_TINT: Record<string, string> = {
  running: "text-cyan border-cyan/30 bg-cyan/10",
  done: "text-mint border-mint/30 bg-mint/10",
  failed: "text-rose border-rose/30 bg-rose/10",
  idle: "text-mist border-line-2 bg-panel",
};

function ConnDot({ conn }: { conn: Conn }) {
  const map = {
    live: { c: "bg-mint", t: "live" },
    connecting: { c: "bg-amber animate-pulse", t: "connecting" },
    lost: { c: "bg-rose", t: "reconnecting" },
  }[conn];
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-mist">
      <span className={`h-1.5 w-1.5 rounded-full ${map.c}`} />
      {map.t}
    </span>
  );
}

export function StatusBar({ model, conn }: { model: BoardModel; conn: Conn }) {
  const elapsed = useElapsed(model.startedAt, model.overallStatus === "running");
  const pct = model.total ? Math.round((model.done / model.total) * 100) : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <img src="./conductor.svg" alt="" className="h-6 w-6" />
          <span className="font-mono text-sm font-medium text-chalk">
            {model.workflow}
          </span>
          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] capitalize ${
              STATUS_TINT[model.overallStatus] ?? STATUS_TINT.idle
            }`}
          >
            {model.overallStatus}
          </span>
        </div>

        {model.description && (
          <span className="hidden max-w-md truncate text-sm text-mist lg:block">
            {model.description}
          </span>
        )}

        <div className="ml-auto flex items-center gap-5">
          {elapsed && (
            <span className="flex items-center gap-1.5 font-mono text-xs text-mist">
              <svg width="12" height="12" viewBox="0 0 24 24" className="text-line-2">
                <path
                  fill="currentColor"
                  d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10V6h-2v8h6v-2h-4Z"
                />
              </svg>
              {elapsed}
            </span>
          )}

          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-iris to-cyan transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-xs text-mist-2">
              {model.done}/{model.total}
            </span>
          </div>

          <ConnDot conn={conn} />
        </div>
      </div>
    </header>
  );
}
