import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Arrival, StreamBeat } from "../lib/heartbeatStream";
import { plainNote, secondsSince } from "../lib/heartbeat";
import { useNow } from "../lib/useNow";
import { AnimatedHeart } from "./AnimatedHeart";
import { TypewriterText } from "./TypewriterText";

export type MonitorMode = "min" | "expanded" | "hidden";

const MODE_KEY = "cb-monitor";
const STALL_SECONDS = 90;
const WF_COLORS = ["text-chalk", "text-mist-2", "text-mist", "text-mist-2", "text-mist"];

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function loadMonitorMode(): MonitorMode {
  try {
    const q = new URLSearchParams(window.location.search).get("monitor");
    if (q === "min" || q === "expanded" || q === "hidden") return q;
  } catch {
    /* ignore */
  }
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "min" || v === "expanded" || v === "hidden") return v;
  } catch {
    /* ignore */
  }
  return "min";
}

/** A small amber dot that breathes when beats have gone quiet (§5.1). The quiet threshold
 *  scales with the configured heartbeat interval (Settings). */
function StallDot({ lastBeatIso, stallSeconds = STALL_SECONDS }: { lastBeatIso?: string; stallSeconds?: number }) {
  const now = useNow(1000);
  const overdue = !!lastBeatIso && (secondsSince(lastBeatIso, now) ?? 0) > stallSeconds;
  if (!overdue) return null;
  return (
    <span
      title="beats have gone quiet — the agent may be working without checking in"
      className="stall-breathe h-1.5 w-1.5 rounded-full bg-amber"
    />
  );
}

type Conn = "connecting" | "live" | "lost";

/** A tiny rose dot, shown only when the SSE link drops (so the heart can't lie). */
function ConnDot({ conn }: { conn?: Conn }) {
  if (!conn || conn === "live") return null;
  return (
    <span
      title={conn === "lost" ? "connection lost — reconnecting" : "connecting…"}
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose"
    />
  );
}

interface Props {
  beats: StreamBeat[];
  arrival: Arrival | null;
  order: string[];
  mode: MonitorMode;
  onMode: (m: MonitorMode) => void;
  lastBeatIso?: string;
  conn?: Conn;
  /** quiet-threshold in seconds (derived from the configured heartbeat interval) */
  stallSeconds?: number;
}

export function HeartbeatMonitor({
  beats,
  arrival,
  order,
  mode,
  onMode,
  lastBeatIso,
  conn,
  stallSeconds,
}: Props) {
  const wfColor = (name: string) => WF_COLORS[Math.max(0, order.indexOf(name)) % WF_COLORS.length];
  const multi = order.length > 1;
  const streamKey = arrival?.beat.key;
  const latest = beats[beats.length - 1];

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  // Ctrl+` toggles minimized ↔ expanded
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        onMode(mode === "expanded" ? "min" : "expanded");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onMode]);

  if (mode === "hidden") {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onClick={() => onMode("min")}
        title="Show heartbeat monitor"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-ink-2/90 px-3 py-2 shadow-lg backdrop-blur transition-colors hover:border-line-2"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={15} stallSeconds={stallSeconds} />
        <StallDot lastBeatIso={lastBeatIso} stallSeconds={stallSeconds} />
        <ConnDot conn={conn} />
      </motion.button>
    );
  }

  if (mode === "min") {
    // The 36px bottom bar: the heart, the latest beat streaming in, and a way to
    // expand. The heart is the one colour; status comes through the stall/conn dots.
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex h-9 shrink-0 items-center gap-2.5 border-t border-line bg-panel px-4"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={14} stallSeconds={stallSeconds} />
        <StallDot lastBeatIso={lastBeatIso} stallSeconds={stallSeconds} />
        <ConnDot conn={conn} />
        <button
          onClick={() => onMode("expanded")}
          title="Expand heartbeat monitor (Ctrl+`)"
          aria-label="Expand heartbeat monitor"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {latest ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-mist">
              {latest.key === streamKey ? (
                <TypewriterText text={plainNote(latest.note)} />
              ) : (
                plainNote(latest.note)
              )}
            </span>
          ) : (
            <span className="flex-1 font-mono text-[12px] text-dim">
              waiting for the first heartbeat…
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-dim">▲</span>
        </button>
      </motion.div>
    );
  }

  return (
    <ExpandedMonitor
      beats={beats}
      order={order}
      streamKey={streamKey}
      onMode={onMode}
      wfColor={wfColor}
      multi={multi}
      lastBeatIso={lastBeatIso}
      conn={conn}
      stallSeconds={stallSeconds}
    />
  );
}

function ExpandedMonitor({
  beats,
  order,
  streamKey,
  onMode,
  wfColor,
  multi,
  lastBeatIso,
  conn,
  stallSeconds,
}: {
  beats: StreamBeat[];
  order: string[];
  streamKey?: string;
  onMode: (m: MonitorMode) => void;
  wfColor: (n: string) => string;
  multi: boolean;
  lastBeatIso?: string;
  conn?: Conn;
  stallSeconds?: number;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [height, setHeight] = useState(280);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const driftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [cursorOn, setCursorOn] = useState(false);

  // Glide (or snap) to the latest and re-pin. Smooth for explicit jumps — the button, the
  // drift-home timer, opening — so the eye can follow the scroll; snapped for per-beat streaming.
  const scrollToBottom = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinned.current = true;
    setShowJump(false);
    if (driftTimer.current) {
      clearTimeout(driftTimer.current);
      driftTimer.current = null;
    }
  };

  const shown = beats.filter((b) =>
    filter === "all" ? true : filter === "insights" ? !!b.insight : b.workflow === filter,
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    }
  }, [shown.length, filter]);

  useEffect(() => {
    if (!streamKey) return;
    setCursorOn(true);
    const t = setTimeout(() => setCursorOn(false), 10000);
    return () => clearTimeout(t);
  }, [streamKey]);

  // Opening the terminal (this component mounts on open) lands you at the latest. Clean up the
  // drift-home timer on close/unmount.
  useEffect(() => {
    scrollToBottom(false);
    return () => {
      if (driftTimer.current) clearTimeout(driftTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (pinned.current !== atBottom) {
      pinned.current = atBottom;
      setShowJump(!atBottom);
    }
    // Drift self-heals: 60s scrolled-up-and-idle → glide back to the latest, so you never come
    // back to a stale position and have to re-orient. Any scroll resets the 60s clock.
    if (driftTimer.current) clearTimeout(driftTimer.current);
    driftTimer.current = atBottom ? null : setTimeout(() => scrollToBottom(true), 60_000);
  };

  const jumpToLatest = () => scrollToBottom(true); // smooth glide so the eye can follow the scroll

  // Keep the bottom row fully in view as it grows — a multi-line beat (or text still streaming in)
  // would otherwise get clipped at the container edge. Observe the list and re-pin to the bottom
  // while pinned, so the last row always clears.
  const roRef = useRef<ResizeObserver | null>(null);
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (node) {
      const ro = new ResizeObserver(() => {
        const el = scrollRef.current;
        if (el && pinned.current) el.scrollTop = el.scrollHeight;
      });
      ro.observe(node);
      roRef.current = ro;
    }
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) =>
      setHeight(Math.max(150, Math.min(window.innerHeight * 0.7, startH + (startY - ev.clientY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const FILTERS = ["all", ...order, "insights"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      style={{ height }}
      className="relative flex shrink-0 flex-col border-t border-line bg-ink-2 font-mono"
    >
      <div
        onPointerDown={startResize}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        title="Drag to resize"
      />

      <div
        onClick={() => onMode("min")}
        title="Click to minimize (Ctrl+`)"
        className="group/bar flex cursor-pointer items-center gap-2 border-b border-line/70 px-3 py-1.5 transition-colors hover:bg-panel/40"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={13} stallSeconds={stallSeconds} />
        <StallDot lastBeatIso={lastBeatIso} stallSeconds={stallSeconds} />
        <ConnDot conn={conn} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-2">
          Heartbeats
        </span>
        <span className="text-[10px] text-dim">{beats.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-dim">
          <span aria-hidden title="Minimize" className="grid h-5 w-5 place-items-center rounded transition-colors group-hover/bar:text-chalk">
            ▼
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMode("hidden");
            }}
            title="Hide"
            className="grid h-5 w-5 place-items-center rounded text-[13px] transition-colors hover:bg-panel hover:text-chalk"
          >
            ─
          </button>
        </span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line/50 px-3 py-1.5">
        {FILTERS.map((f) => {
          const on = filter === f;
          const label = f === "all" ? "All" : f === "insights" ? "Insights" : f;
          return (
            <button
              key={f}
              onClick={() => {
                pinned.current = true;
                setFilter(f);
              }}
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                on
                  ? "border-cyan/50 bg-cyan/15 text-chalk"
                  : "border-line bg-panel/40 text-mist hover:text-chalk"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="board-scroll relative min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4 text-[13px] leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="grid h-full place-items-center text-[11px] text-dim">
            no heartbeats{filter === "all" ? " yet" : ` for “${filter}”`}
          </div>
        ) : (
          <div ref={contentRef}>
          {shown.map((b) => (
            <div key={b.key} className="flex items-start gap-2 py-px">
              <span className="shrink-0 select-none text-dim">{clock(b.at)}</span>
              {multi && (
                <span className={`shrink-0 select-none ${wfColor(b.workflow)}`}>{b.workflow}</span>
              )}
              <span className="w-32 shrink-0 select-none truncate text-mist" title={b.step}>
                {b.step}
              </span>
              <span className="min-w-0 flex-1 text-chalk">
                {b.key === streamKey ? (
                  <TypewriterText text={plainNote(b.note)} />
                ) : (
                  plainNote(b.note)
                )}
              </span>
              {b.finalBeat && (
                <span className="shrink-0 select-none text-dim" title="final beat — handoff to next step">
                  →
                </span>
              )}
              {b.insight && (
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 select-none rounded-full bg-amber"
                  title="carries an insight"
                />
              )}
            </div>
          ))}
          {cursorOn && (
            <div className="px-0 text-cyan">
              <span className="tw-cursor">▌</span>
            </div>
          )}
          <div className="h-2" />
          </div>
        )}
      </div>

      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 8, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 8, x: "-50%" }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 rounded-full border border-cyan/40 bg-ink/90 px-3 py-1 text-[10px] text-cyan shadow-lg backdrop-blur hover:bg-cyan/10"
          >
            ↓ Jump to latest
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
