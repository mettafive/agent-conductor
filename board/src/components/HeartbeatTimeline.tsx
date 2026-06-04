import { useState } from "react";
import type { HeartbeatEntry, LoopState } from "../lib/types";
import { relativeTime, renderNote } from "../lib/heartbeat";

function absTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Stamp({ iso, running, now }: { iso: string; running: boolean; now: number }) {
  return (
    <span className="shrink-0 font-mono text-[9px] text-line-2" title={iso}>
      {running ? relativeTime(iso, now) : absTime(iso)}
    </span>
  );
}

interface Props {
  entries: HeartbeatEntry[];
  learnings: string[];
  now: number;
  running: boolean;
  loop?: LoopState;
}

/**
 * The per-card heartbeat history as a vertical timeline — connected dots, with
 * finalBeats marked as handoffs. Loop steps get iteration filter tabs.
 */
export function HeartbeatTimeline({ entries, learnings, now, running, loop }: Props) {
  const iterations = loop?.iterations.map((i) => i.item) ?? [];
  const [filter, setFilter] = useState<string>("all");

  const shown =
    filter === "all" ? entries : entries.filter((h) => h.iteration === filter);

  return (
    <div className="mt-2.5 border-t border-line pt-2 pl-7">
      {iterations.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {["all", ...iterations].map((it) => {
            const on = filter === it;
            return (
              <button
                key={it}
                onClick={(e) => {
                  e.stopPropagation();
                  setFilter(it);
                }}
                className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
                  on
                    ? "border-iris/50 bg-iris/15 text-chalk"
                    : "border-line text-mist hover:text-chalk"
                }`}
              >
                {it === "all" ? "All" : it}
              </button>
            );
          })}
        </div>
      )}

      {learnings.length > 0 && (
        <div className="mb-2 rounded-lg border border-cyan/20 bg-cyan/[0.06] px-2.5 py-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-cyan">
            learnings
          </div>
          <ul className="space-y-0.5">
            {learnings.map((l, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-mist-2">
                <span className="text-cyan">·</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {shown.length > 0 && (
        <div className="relative max-h-64 space-y-2 overflow-y-auto board-scroll pl-3.5">
          {/* the connecting line */}
          <span className="pointer-events-none absolute bottom-1 left-[3px] top-1.5 w-px bg-line" />
          {[...shown].reverse().map((h, i) => (
            <div
              key={i}
              className={`relative ${
                h.insight ? "-ml-1 rounded-md border-l-2 border-amber/50 bg-amber/[0.05] pl-2" : ""
              }`}
            >
              {/* dot (or handoff arrow for finalBeats) */}
              {h.finalBeat ? (
                <span
                  className="absolute -left-[15px] top-[3px] font-mono text-[10px] leading-none text-mint"
                  title={h.handoff?.to ? `handoff → ${h.handoff.to}` : "final beat"}
                >
                  →
                </span>
              ) : (
                <span
                  className={`absolute -left-[13px] top-[5px] h-1.5 w-1.5 rounded-full ${
                    h.insight ? "bg-amber" : "bg-line-2"
                  }`}
                />
              )}

              <div className="flex items-start gap-2">
                <Stamp iso={h.at} running={running} now={now} />
                <span className="flex-1 text-[11px] leading-snug text-mist-2">
                  {h.iteration && filter === "all" && (
                    <span className="mr-1 rounded bg-cyan/10 px-1 font-mono text-[9px] text-cyan">
                      {h.iteration}
                    </span>
                  )}
                  {h.insight && (
                    <span
                      className="mr-1 inline-block h-1.5 w-1.5 translate-y-px rounded-full bg-amber"
                      title="carries an insight"
                    />
                  )}
                  {renderNote(h.note)}
                  {h.insight && (
                    <span className="mt-0.5 block text-[10px] italic text-amber/90">
                      ↳ {h.insight.seed}
                    </span>
                  )}
                  {h.finalBeat && h.handoff?.to && (
                    <span className="mt-0.5 block font-mono text-[9px] text-mint/80">
                      → handoff to {h.handoff.to}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
