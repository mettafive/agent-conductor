import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Arrival, StreamBeat } from "../lib/heartbeatStream";
import { plainNote } from "../lib/heartbeat";
import { AnimatedHeart } from "./AnimatedHeart";
import { TypewriterText } from "./TypewriterText";

export type MonitorMode = "min" | "expanded" | "hidden";

const MODE_KEY = "cb-monitor";
const WF_COLORS = ["text-cyan", "text-iris", "text-mint", "text-amber", "text-rose"];

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
  // a ?monitor= override wins (handy for sharing a view), else the saved choice
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

interface Props {
  beats: StreamBeat[];
  arrival: Arrival | null;
  order: string[];
  mode: MonitorMode;
  onMode: (m: MonitorMode) => void;
  lastBeatIso?: string;
}

export function HeartbeatMonitor({ beats, arrival, order, mode, onMode, lastBeatIso }: Props) {
  const wfColor = (name: string) => WF_COLORS[Math.max(0, order.indexOf(name)) % WF_COLORS.length];
  const multi = order.length > 1;
  const latest = beats[beats.length - 1];
  const streamKey = arrival?.beat.key;

  // persist mode
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
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={() => onMode("min")}
        title="Show heartbeat monitor"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-ink-2/90 px-3 py-2 shadow-lg backdrop-blur transition-colors hover:border-line-2"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={15} />
        <span className="font-mono text-[10px] text-mist">monitor</span>
      </motion.button>
    );
  }

  if (mode === "min") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="shrink-0 border-t border-line bg-ink-2/80 backdrop-blur"
      >
        <button
          onClick={() => onMode("expanded")}
          className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left"
          title="Expand heartbeat monitor (Ctrl+`)"
        >
          <AnimatedHeart lastBeatIso={lastBeatIso} size={13} />
          {latest ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px]">
              <span className="shrink-0 text-line-2">{clock(latest.at)}</span>
              {multi && (
                <span className={`shrink-0 ${wfColor(latest.workflow)}`}>{latest.workflow}</span>
              )}
              <span className="shrink-0 text-cyan/80">{latest.step}:</span>
              <span className="min-w-0 flex-1 truncate text-mist-2">
                {latest.key === streamKey ? (
                  <TypewriterText text={plainNote(latest.note)} />
                ) : (
                  plainNote(latest.note)
                )}
              </span>
              {latest.insight && <span className="shrink-0">💡</span>}
            </span>
          ) : (
            <span className="flex-1 font-mono text-[11px] text-line-2">
              waiting for the first heartbeat…
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-mist">▲</span>
        </button>
      </motion.div>
    );
  }

  return <ExpandedMonitor beats={beats} order={order} streamKey={streamKey} onMode={onMode} wfColor={wfColor} multi={multi} lastBeatIso={lastBeatIso} />;
}

function ExpandedMonitor({
  beats,
  order,
  streamKey,
  onMode,
  wfColor,
  multi,
  lastBeatIso,
}: {
  beats: StreamBeat[];
  order: string[];
  streamKey?: string;
  onMode: (m: MonitorMode) => void;
  wfColor: (n: string) => string;
  multi: boolean;
  lastBeatIso?: string;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [height, setHeight] = useState(280);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [cursorOn, setCursorOn] = useState(false);

  const shown = beats.filter((b) =>
    filter === "all" ? true : filter === "insights" ? !!b.insight : b.workflow === filter,
  );

  // auto-scroll to the newest line while pinned to the bottom
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    }
  }, [shown.length, filter]);

  // blinking cursor lives for 10s after the most recent beat
  useEffect(() => {
    if (!streamKey) return;
    setCursorOn(true);
    const t = setTimeout(() => setCursorOn(false), 10000);
    return () => clearTimeout(t);
  }, [streamKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    pinned.current = atBottom;
    setShowJump(!atBottom);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    pinned.current = true;
    setShowJump(false);
  };

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
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      style={{ height }}
      className="relative flex shrink-0 flex-col border-t border-line bg-[#08080d] font-mono"
    >
      {/* resize handle */}
      <div
        onPointerDown={startResize}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        title="Drag to resize"
      />

      {/* header — click anywhere on the bar to collapse, like the chevron */}
      <div
        onClick={() => onMode("min")}
        title="Click to minimize (Ctrl+`)"
        className="group/bar flex cursor-pointer items-center gap-2 border-b border-line/70 px-3 py-1.5 transition-colors hover:bg-panel/40"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={13} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-2">
          Heartbeat Monitor
        </span>
        <span className="text-[10px] text-line-2">{beats.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-mist">
          <span
            aria-hidden
            title="Minimize"
            className="grid h-5 w-5 place-items-center rounded transition-colors group-hover/bar:text-chalk"
          >
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

      {/* filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line/50 px-3 py-1.5">
        {FILTERS.map((f) => {
          const on = filter === f;
          const label = f === "all" ? "All" : f === "insights" ? "💡 Insights" : f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                on
                  ? "border-iris/50 bg-iris/15 text-chalk"
                  : "border-line bg-panel/40 text-mist hover:text-chalk"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* terminal log */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="board-scroll monitor-grain relative min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[11.5px] leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="grid h-full place-items-center text-[11px] text-line-2">
            no heartbeats{filter === "all" ? " yet" : ` for “${filter}”`}
          </div>
        ) : (
          shown.map((b) => (
            <div key={b.key} className="flex items-start gap-2 py-px">
              <span className="shrink-0 text-line-2">{clock(b.at)}</span>
              {multi && <span className={`shrink-0 ${wfColor(b.workflow)}`}>{b.workflow}</span>}
              <span className="w-32 shrink-0 truncate text-cyan/80" title={b.step}>
                {b.step}
              </span>
              <span className="min-w-0 flex-1 text-mist-2">
                {b.key === streamKey ? (
                  <TypewriterText text={plainNote(b.note)} />
                ) : (
                  plainNote(b.note)
                )}
              </span>
              {b.finalBeat && (
                <span className="shrink-0 text-line-2" title="final beat — handoff to next step">
                  ·→
                </span>
              )}
              {b.insight && <span className="shrink-0">💡</span>}
            </div>
          ))
        )}
        {cursorOn && shown.length > 0 && (
          <div className="px-0 text-cyan">
            <span className="tw-cursor">▌</span>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 8, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 8, x: "-50%" }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
