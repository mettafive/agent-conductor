import { useEffect, useState } from "react";
import type { BoardModel } from "../lib/types";
import { useNow } from "../lib/useNow";
import { relativeTime } from "../lib/heartbeat";

type Conn = "connecting" | "live" | "lost";

function useDuration(startedAt?: string, endedAt?: string, running?: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end = !running && endedAt ? new Date(endedAt).getTime() : now;
  const secs = Math.max(0, Math.floor((end - start) / 1000));
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

interface Props {
  model: BoardModel;
  conn: Conn;
  viewing: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onBackToLive: () => void;
  onToggleSidebar: () => void;
}

export function StatusBar({
  model,
  conn,
  viewing,
  muted,
  onToggleMute,
  onBackToLive,
  onToggleSidebar,
}: Props) {
  const running = !viewing && model.overallStatus === "running";
  const duration = useDuration(model.startedAt, model.endedAt, running);
  const now = useNow(1000);
  const lastBeat = running && model.lastBeatAt ? relativeTime(model.lastBeatAt, now) : null;
  const pct = model.total ? Math.round((model.done / model.total) * 100) : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle history"
          className="grid h-7 w-7 place-items-center rounded-md border border-line text-mist transition-colors hover:border-line-2 hover:text-chalk"
        >
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center gap-2.5">
          <img src="./conductor.svg" alt="" className="h-6 w-6" />
          <span className="font-mono text-sm font-medium text-chalk">{model.workflow}</span>
          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] capitalize ${
              STATUS_TINT[model.overallStatus] ?? STATUS_TINT.idle
            }`}
          >
            {model.overallStatus}
          </span>
        </div>

        {viewing ? (
          <button
            onClick={onBackToLive}
            className="flex items-center gap-1.5 rounded-md border border-amber/30 bg-amber/10 px-2.5 py-1 font-mono text-[11px] text-amber transition-colors hover:bg-amber/15"
          >
            <svg width="11" height="11" viewBox="0 0 24 24">
              <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M11 17 6 12l5-5M6 12h12" />
            </svg>
            past run — back to live
          </button>
        ) : (
          model.goal && (
            <span
              title={model.goal}
              className="hidden max-w-md items-center gap-1.5 truncate text-sm text-mist-2 lg:flex"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0 text-iris">
                <path fill="none" stroke="currentColor" strokeWidth="2" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
                <circle cx="12" cy="12" r="3.2" fill="currentColor" />
              </svg>
              <span className="truncate">{model.goal}</span>
            </span>
          )
        )}

        <div className="ml-auto flex items-center gap-5">
          {model.insightCount > 0 && (
            <span
              title="Improvement signals gathered this run"
              className="flex items-center gap-1 font-mono text-[11px] text-amber"
            >
              💡 {model.insightCount} insight{model.insightCount === 1 ? "" : "s"}
            </span>
          )}
          {lastBeat && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-mist">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
              last beat: {lastBeat}
            </span>
          )}
          {duration && (
            <span className="flex items-center gap-1.5 font-mono text-xs text-mist">
              <svg width="12" height="12" viewBox="0 0 24 24" className="text-line-2">
                <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10V6h-2v8h6v-2h-4Z" />
              </svg>
              {duration}
            </span>
          )}

          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  model.overallStatus === "failed"
                    ? "bg-gradient-to-r from-rose to-amber"
                    : "bg-gradient-to-r from-iris to-cyan"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-xs text-mist-2">
              {model.done}/{model.total}
            </span>
          </div>

          <button
            onClick={onToggleMute}
            title={muted ? "Unmute completion sounds" : "Mute completion sounds"}
            className="grid h-7 w-7 place-items-center rounded-md border border-line text-mist transition-colors hover:border-line-2 hover:text-chalk"
          >
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                <path d="m23 9-6 6M17 9l6 6" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              </svg>
            )}
          </button>

          {viewing ? (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-amber">
              <span className="h-1.5 w-1.5 rounded-full bg-amber" />
              archived
            </span>
          ) : (
            <ConnDot conn={conn} />
          )}
        </div>
      </div>

      {!viewing && running && model.currentStepGoal && (
        <div className="flex items-center gap-2 border-t border-line/60 px-5 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-cyan">
            now
          </span>
          {model.currentStep && (
            <span className="font-mono text-[11px] text-chalk">{model.currentStep}</span>
          )}
          <span className="truncate text-xs text-mist">{model.currentStepGoal}</span>
        </div>
      )}
    </header>
  );
}
