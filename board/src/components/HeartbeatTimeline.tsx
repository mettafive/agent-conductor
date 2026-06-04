import { useState } from "react";
import type { HeartbeatEntry, LoopState } from "../lib/types";
import { relativeTime, renderNote } from "../lib/heartbeat";
import { groupBeats, loadComment, saveComment, type BeatGroup } from "../lib/groups";

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
        <div className="max-h-72 space-y-1.5 overflow-y-auto board-scroll">
          {/* Related beats are grouped into activities, newest first, so there's always a
              coherent "current activity" at the top instead of a flat firehose. */}
          {[...groupBeats(shown)].reverse().map((g, gi) => (
            <GroupBlock key={g.id} group={g} defaultOpen={gi === 0} running={running} now={now} showIter={filter === "all"} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One activity group: a clickable headline (latest note + meta), its beats, and a comment. */
function GroupBlock({
  group,
  defaultOpen,
  running,
  now,
  showIter,
}: {
  group: BeatGroup;
  defaultOpen: boolean;
  running: boolean;
  now: number;
  showIter: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [comment, setComment] = useState(() => loadComment(group.id));
  const [editing, setEditing] = useState(false);
  const latest = group.beats[group.beats.length - 1];
  const multi = group.beats.length > 1;

  return (
    <div
      className={`rounded-md border-l-2 pl-2.5 ${
        group.insightCount ? "border-amber/50 bg-amber/[0.05]" : group.hasFinal ? "border-mint/40" : "border-line-2"
      }`}
    >
      {/* headline — the latest note is the "current activity"; click to expand the beats */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (multi) setOpen((o) => !o);
        }}
        className="flex w-full items-start gap-2 py-1 text-left"
      >
        <Stamp iso={group.endedAt} running={running} now={now} />
        <span className="flex-1 text-[11px] leading-snug text-mist-2">
          {showIter && group.label !== "activity" && (
            <span className="mr-1 rounded bg-cyan/10 px-1 font-mono text-[9px] text-cyan">{group.label}</span>
          )}
          {group.hasFinal && <span className="mr-1 font-mono text-[10px] text-mint">→</span>}
          {renderNote(latest.note)}
          {latest.insight && <span className="mt-0.5 block text-[10px] italic text-amber/90">↳ {latest.insight.seed}</span>}
          {latest.finalBeat && latest.handoff?.to && (
            <span className="mt-0.5 block font-mono text-[9px] text-mint/80">→ handoff to {latest.handoff.to}</span>
          )}
        </span>
        {multi && (
          <span className="shrink-0 font-mono text-[9px] text-dim">
            {open ? "▾" : "▸"} {group.beats.length}
          </span>
        )}
      </button>

      {/* expanded — the earlier beats of this activity */}
      {multi && open && (
        <div className="space-y-1 border-l border-line pb-1.5 pl-2.5">
          {group.beats.slice(0, -1).reverse().map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <Stamp iso={h.at} running={running} now={now} />
              <span className="flex-1 text-[10.5px] leading-snug text-mist">
                {renderNote(h.note)}
                {h.insight && <span className="mt-0.5 block text-[9.5px] italic text-amber/90">↳ {h.insight.seed}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* comment — annotate this activity (persists locally) */}
      <div className="pb-1.5">
        {editing ? (
          <textarea
            autoFocus
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => {
              saveComment(group.id, comment);
              setEditing(false);
            }}
            placeholder="Leave a note on this activity…"
            className="w-full rounded border border-line bg-ink/50 px-2 py-1 text-[10.5px] text-mist-2 outline-none focus:border-cyan/40"
          />
        ) : comment ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="flex w-full items-start gap-1.5 rounded border border-cyan/20 bg-cyan/[0.06] px-2 py-1 text-left text-[10.5px] leading-snug text-mist-2"
          >
            <span className="text-cyan">✎</span>
            <span className="flex-1">{comment}</span>
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="font-mono text-[9px] text-dim transition-colors hover:text-cyan"
          >
            + note
          </button>
        )}
      </div>
    </div>
  );
}
