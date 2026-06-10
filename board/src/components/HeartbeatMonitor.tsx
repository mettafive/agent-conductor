import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { Arrival, StreamBeat } from "../lib/heartbeatStream";
import type { KnowledgeEntry } from "../lib/types";
import { plainNote } from "../lib/heartbeat";
import { AnimatedHeart } from "./AnimatedHeart";
import { TypewriterText } from "./TypewriterText";

export type MonitorMode = "min" | "expanded";

const MODE_KEY = "cb-monitor";

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
    if (q === "min" || q === "expanded") return q;
  } catch {
    /* ignore */
  }
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "min" || v === "expanded") return v;
  } catch {
    /* ignore */
  }
  return "min";
}

type Conn = "connecting" | "live" | "lost";

function beatTextClass(b?: Pick<StreamBeat, "tone" | "note" | "system" | "insight">): string {
  if (!b) return "text-mist";
  // Insight beats keep their amber/insight treatment.
  if (b.tone === "feedback") return "text-amber";
  if (b.tone === "insight" || b.insight) return "text-amber";
  // System beats (Started / Checking / Passed / Failed) are status chatter — muted & lighter
  // so they don't drown out the agent's own update notes. Passed still tints mint, quietly.
  if (b.system) {
    if (/^\s*(✓|passed|pass|checker passed|creating .* passed|workflow accepted)/i.test(plainNote(b.note)))
      return "text-mint/60 font-normal";
    return "text-dim font-normal";
  }
  // The agent's update notes are PRIMARY — normal weight & color (the agent's voice).
  return "text-mist";
}

/** A tiny rose dot, shown only when the SSE link drops (so the heart can't lie). */
function ConnDot({ conn }: { conn?: Conn }) {
  if (!conn || conn === "live") return null;
  return (
    <span
      title={conn === "lost" ? "Connection lost — reconnecting" : "Connecting…"}
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose"
    />
  );
}

/** The full captured detail of one insight, normalized from a beat + the knowledge store. */
type ShownInsight = {
  title: string;
  note?: string;
  current?: string;
  proposed?: string;
  scope?: string;
  step?: string;
  observed?: number;
};

/** Resolve a beat's insight to its full detail: prefer the matching knowledge entry (which carries
 *  the note + current→proposed change), falling back to the beat's own insight payload. */
function insightFor(b: StreamBeat, knowledge?: KnowledgeEntry[]): ShownInsight {
  const seed = b.insight?.seed ?? plainNote(b.note);
  const k =
    (b.insight?.id ? knowledge?.find((e) => e.id === b.insight?.id) : undefined) ??
    knowledge?.find((e) => e.title === seed) ??
    (seed ? knowledge?.find((e) => e.title?.startsWith(seed.slice(0, 24))) : undefined);
  return {
    title: k?.title ?? b.insight?.title ?? seed,
    note: k?.note,
    current: k?.current,
    proposed: k?.proposed,
    scope: k?.scope ?? b.insight?.scope,
    step: k?.step ?? b.insight?.step,
    observed: k?.observed,
  };
}

/** Format THIS run's heartbeats + captured insights as a clean markdown digest —
 *  for handing to an LLM (or a human). Prose beats only (system "Started/Checking/
 *  Passed" pings are dropped); insights carry their full captured detail, not just
 *  the chip. Scoped to the beats the terminal currently holds — the last run, not
 *  any setup/lifecycle feed. */
function buildRunDigest(beats: StreamBeat[], knowledge?: KnowledgeEntry[]): string {
  const real = beats.filter((b) => !b.system && plainNote(b.note).trim());
  const workflow = real[0]?.workflow ?? beats[0]?.workflow ?? "workflow";
  const lines: string[] = [`# Run heartbeats — ${workflow}`, ""];
  for (const b of real) {
    const card = b.title ? `${b.title} — ` : "";
    const tail = b.finalBeat ? "  (handoff)" : "";
    lines.push(`[${clock(b.at)}] ${card}${plainNote(b.note)}${tail}`);
  }
  const seen = new Set<string>();
  const insights: ShownInsight[] = [];
  for (const b of beats) {
    if (!b.insight) continue;
    const ins = insightFor(b, knowledge);
    if (seen.has(ins.title)) continue;
    seen.add(ins.title);
    insights.push(ins);
  }
  if (insights.length) {
    lines.push("", `## Insights captured this run (${insights.length})`, "");
    for (const ins of insights) {
      lines.push(`### ${ins.title}`);
      if (ins.note) lines.push(ins.note);
      if (ins.current) lines.push(`- was:  ${ins.current}`);
      if (ins.proposed) lines.push(`- now:  ${ins.proposed}`);
      const meta = [ins.scope, ins.step, ins.observed ? `seen ${ins.observed}×` : null].filter(Boolean).join(" · ");
      if (meta) lines.push(`(${meta})`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

/** A clean modal for one insight — title, the captured note, the current→proposed change, and
 *  provenance. Opened by clicking a beat's "insight" tag; closes on backdrop click, ✕, or Esc.
 *  Every interaction stops propagation, so opening/closing it never re-routes the board beneath. */
function InsightModal({ insight, onClose }: { insight: ShownInsight; onClose: () => void }) {
  useEffect(() => {
    // capture-phase + stopImmediate so Esc closes the modal without also firing "back to live"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };
  const meta = [insight.scope, insight.step, insight.observed ? `seen ${insight.observed}×` : null]
    .filter(Boolean)
    .join(" · ");
  const bare = !insight.note && !insight.current && !insight.proposed;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/75 p-6 font-sans backdrop-blur-sm"
      onClick={close}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="relative w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded text-[12px] text-dim transition-colors hover:bg-line-2/50 hover:text-chalk"
        >
          ✕
        </button>
        {/* eyebrow + title — same grammar as SummaryView's section heads (mono, uppercase, tracked) */}
        <div className="font-mono text-[10px] uppercase tracking-wide text-amber">Insight</div>
        <h3 className="mt-2 pr-6 text-[15px] font-medium leading-snug text-chalk">{insight.title}</h3>
        <div className="mt-3 max-h-[50vh] space-y-2.5 overflow-y-auto board-scroll">
          {insight.note && <p className="text-[12px] leading-relaxed text-mist-2">{insight.note}</p>}
          {(insight.current || insight.proposed) && (
            // the current→proposed diff, styled exactly like SummaryView's InsightItem change block
            <div className="space-y-0.5 rounded-lg border border-line bg-ink/40 px-3 py-2.5 font-mono text-[10.5px] leading-snug">
              {insight.current && <div className="text-rose/80">− {insight.current}</div>}
              {insight.proposed && <div className="text-mint/80">+ {insight.proposed}</div>}
            </div>
          )}
          {bare && (
            <p className="text-[12px] leading-snug text-dim">No further detail was captured for this insight.</p>
          )}
        </div>
        {meta && <div className="mt-4 border-t border-line pt-3 font-mono text-[10px] text-dim">{meta}</div>}
      </motion.div>
    </motion.div>
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
  /** the live run is finished — settle the heart instead of flashing amber */
  done?: boolean;
  /** the knowledge store — lets an insight beat open its full captured detail in a modal */
  knowledge?: KnowledgeEntry[];
  doneCount?: number;
  totalCount?: number;
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
  done,
  knowledge,
}: Props) {
  const streamKey = arrival?.beat.key;
  // The prominent single line is the agent's "what's happening" sentence — its own
  // update notes are PRIMARY (the agent's voice), so the collapsed monitor surfaces the
  // latest NON-system beat, falling back to the latest beat of any kind when the agent
  // hasn't spoken yet. (The expanded view still shows every beat with the muted-system
  // hierarchy.) Without this, system status chatter — "Started…/Checking…/Passed" —
  // eclipses the explanatory sentence here, which is the regression we're restoring.
  const latest = [...beats].reverse().find((b) => !b.system) ?? beats[beats.length - 1];

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

  if (mode === "min") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex min-h-11 shrink-0 items-center gap-2.5 border-t border-line bg-panel px-4 py-2.5"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={14} stallSeconds={stallSeconds} done={done} />
        <ConnDot conn={conn} />
        <button
          onClick={() => onMode("expanded")}
          title="Expand updates (Ctrl+`)"
          aria-label="Expand updates"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {latest ? (
            <span className={`min-w-0 flex-1 whitespace-normal break-words font-mono text-[14px] leading-relaxed ${beatTextClass(latest)}`}>
              {latest.key === streamKey ? (
                <TypewriterText text={plainNote(latest.note)} />
              ) : (
                plainNote(latest.note)
              )}
            </span>
          ) : (
            <span className="flex-1 font-mono text-[14px] text-dim">
              Waiting for agent update…
            </span>
          )}
          <span className="shrink-0 font-mono text-[12px] text-dim">▲</span>
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
      lastBeatIso={lastBeatIso}
      conn={conn}
      stallSeconds={stallSeconds}
      done={done}
      knowledge={knowledge}
    />
  );
}

function ExpandedMonitor({
  beats,
  streamKey,
  onMode,
  lastBeatIso,
  conn,
  stallSeconds,
  done,
  knowledge,
}: {
  beats: StreamBeat[];
  order: string[];
  streamKey?: string;
  onMode: (m: MonitorMode) => void;
  lastBeatIso?: string;
  conn?: Conn;
  stallSeconds?: number;
  done?: boolean;
  knowledge?: KnowledgeEntry[];
}) {
  const [modalInsight, setModalInsight] = useState<ShownInsight | null>(null);
  const [height, setHeight] = useState(280);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const driftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [cursorOn, setCursorOn] = useState(false);
  const [copied, setCopied] = useState(false);

  // Copy this run's heartbeats (prose only — no system pings) + the captured
  // insights with their full detail, in a clean markdown digest to hand to an LLM.
  const copyRun = async () => {
    try {
      await navigator.clipboard.writeText(buildRunDigest(beats, knowledge));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked (e.g. insecure context) */
    }
  };

  const shown = beats;

  // Glue to the bottom SYNCHRONOUSLY (before paint): both the new-beat layout
  // effect and the typing ResizeObserver call this, so the bottom edge stays
  // pinned frame-by-frame as a beat streams in. Doing it in a rAF (next frame)
  // painted the new content at the old scroll first, then snapped — the jump.
  const stickToBottom = useCallback(() => {
    if (!pinned.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setShowJump(false);
    if (driftTimer.current) {
      clearTimeout(driftTimer.current);
      driftTimer.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (pinned.current) {
      stickToBottom();
      setShowJump(false);
    }
  }, [shown.length, stickToBottom]);

  useEffect(() => {
    if (!streamKey) return;
    setCursorOn(true);
    const t = setTimeout(() => setCursorOn(false), 10000);
    return () => clearTimeout(t);
  }, [streamKey]);

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
    if (driftTimer.current) clearTimeout(driftTimer.current);
    driftTimer.current = atBottom ? null : setTimeout(() => scrollToBottom(true), 60_000);
  };

  const jumpToLatest = () => scrollToBottom(true);

  const roRef = useRef<ResizeObserver | null>(null);
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (node) {
        const ro = new ResizeObserver(() => stickToBottom());
        ro.observe(node);
        roRef.current = ro;
      }
    },
    [stickToBottom],
  );

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
        className="group/bar flex cursor-pointer items-center gap-2 border-b border-line/70 px-3 py-2 transition-colors hover:bg-panel/40"
      >
        <AnimatedHeart lastBeatIso={lastBeatIso} size={13} stallSeconds={stallSeconds} done={done} />
        <ConnDot conn={conn} />
        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-mist-2">
          Updates
        </span>
        <span className="text-[12px] tabular-nums text-mist-2">{beats.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-dim">
          <span aria-hidden title="Minimize" className="grid h-6 w-6 place-items-center rounded text-[13px] transition-colors group-hover/bar:text-chalk">
            ▼
          </span>
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="board-scroll relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-5 text-[15px] leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="grid h-full place-items-center text-[11px] text-dim">
            No updates yet
          </div>
        ) : (
          <div ref={contentRef}>
          {shown.map((b) => (
            <div
              key={b.key}
              className={`flex items-start gap-2.5 rounded py-1 ${
                b.tone === "feedback" || b.tone === "insight" || b.insight ? "-mx-1 bg-amber/[0.06] px-1" : ""
              }`}
            >
              <span className="shrink-0 select-none text-dim">{clock(b.at)}</span>
              <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${beatTextClass(b)}`}>
                {b.key === streamKey ? (
                  <TypewriterText text={plainNote(b.note)} />
                ) : (
                  plainNote(b.note)
                )}
              </span>
              {b.finalBeat && (
                <span className="shrink-0 select-none text-dim" title="Final beat — handoff to next step">
                  →
                </span>
              )}
              {b.insight && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setModalInsight(insightFor(b, knowledge));
                  }}
                  className="shrink-0 self-center select-none rounded border border-amber/25 bg-amber/15 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-amber transition-colors hover:bg-amber/25"
                  title="Captured a learning — click to see it"
                >
                  ◇ insight
                </button>
              )}
            </div>
          ))}
          {cursorOn && (
            <div className="px-0 text-cyan">
              <span className="tw-cursor">▌</span>
            </div>
          )}
          {done && (
            // The closing line — after every beat (and the last insight). The run
            // is over and the board is yours again.
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="mt-1.5 flex items-center gap-2.5 border-t border-line/60 pt-2.5 text-mint"
            >
              {lastBeatIso && <span className="shrink-0 select-none text-dim">{clock(lastBeatIso)}</span>}
              <span className="min-w-0 flex-1 font-medium">Board complete — awaiting your instructions.</span>
              <span className="shrink-0 select-none" aria-hidden title="done">✓</span>
            </motion.div>
          )}
          <div className="h-2" />
          </div>
        )}
      </div>
      {/* Scrolled-up controls, stacked bottom-center: "Copy heartbeats" sits ABOVE
          "Jump to latest". Copy is available whenever you've scrolled up OR the run
          has finished, so a completed run is one click from your clipboard. */}
      <AnimatePresence>
        {(showJump || done) && shown.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2"
          >
            <button
              onClick={copyRun}
              title="Copy this run's heartbeats + insights as markdown — for handing to an LLM"
              className={`rounded-full border px-3 py-1 text-[10px] shadow-lg backdrop-blur transition-colors ${
                copied
                  ? "border-mint/50 bg-mint/15 text-mint"
                  : "border-line-2 bg-ink/90 text-mist-2 hover:bg-panel/60 hover:text-chalk"
              }`}
            >
              {copied ? "Copied ✓" : "Copy heartbeats from this run"}
            </button>
            {showJump && (
              <button
                onClick={jumpToLatest}
                className="rounded-full border border-cyan/40 bg-ink/90 px-3 py-1 text-[10px] text-cyan shadow-lg backdrop-blur hover:bg-cyan/10"
              >
                ↓ Jump to latest
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {createPortal(
        // AnimatePresence keeps the modal mounted through its exit transition, so the backdrop +
        // card glide away on close instead of vanishing.
        <AnimatePresence>
          {modalInsight && (
            <InsightModal insight={modalInsight} onClose={() => setModalInsight(null)} />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </motion.div>
  );
}
