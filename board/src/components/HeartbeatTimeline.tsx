import { useState } from "react";
import type { HeartbeatEntry, LoopState, DeveloperNote } from "../lib/types";
import { relativeTime, renderNote } from "../lib/heartbeat";
import { groupBeats, detailBeats, postComment, type BeatGroup } from "../lib/groups";

const SCOPES = ["this-conductor", "upstream", "template", "tooling", "corpus"] as const;

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
  /** parallel-agent overviews per card id — when present, the card defaults to its overview */
  cardOverviews?: Record<string, string>;
  /** developer notes/directives on this step's cards (flow-manager loop) */
  notes?: DeveloperNote[];
  /** workflow name + step id — needed to persist a comment to the server */
  workflow?: string;
  step?: string;
}

/**
 * The per-card heartbeat history as a vertical timeline — connected dots, with
 * finalBeats marked as handoffs. Loop steps get iteration filter tabs.
 */
export function HeartbeatTimeline({ entries, learnings, now, running, loop, cardOverviews, notes, workflow, step }: Props) {
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
            <GroupBlock
              key={g.id}
              group={g}
              overview={cardOverviews?.[g.id]}
              note={notes?.find((n) => n.card === g.id)}
              workflow={workflow}
              step={step}
              defaultOpen={gi === 0}
              running={running}
              now={now}
              showIter={filter === "all"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One activity CARD: the intent (title) is the hero; the latest detail beat is the live
 *  status; earlier detail beats collapse; a comment box annotates the activity. */
function GroupBlock({
  group,
  overview,
  note,
  workflow,
  step,
  defaultOpen,
  running,
  now,
  showIter,
}: {
  group: BeatGroup;
  /** parallel-agent overview for this card — when present, the card defaults to it */
  overview?: string;
  /** the developer's note/directive on this card, if any */
  note?: DeveloperNote;
  workflow?: string;
  step?: string;
  defaultOpen: boolean;
  running: boolean;
  now: number;
  showIter: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note?.text ?? "");
  const [directive, setDirective] = useState(note?.directive ?? false);
  const [scope, setScope] = useState(note?.scope ?? "this-conductor");
  // a summarized card defaults to its overview; toggle to the raw beats
  const [view, setView] = useState<"overview" | "beats">(overview ? "overview" : "beats");

  const canComment = !!workflow && !!step;
  const saveNote = (action?: "delete") => {
    if (canComment) postComment(workflow!, { step: step!, card: group.id, text: draft, directive, scope, action });
    setEditing(false);
  };

  const detail = detailBeats(group);
  const status = detail.at(-1); // the current/last thing happening within this activity
  const earlier = detail.slice(0, -1);
  const iter = showIter ? group.beats[0]?.iteration : undefined;
  const showOverview = view === "overview" && !!overview;
  // colour carries STATE only (amber = insight, mint = handoff); everything else stays grayscale
  const accent = group.insightCount
    ? "border-amber/50 bg-amber/[0.04]"
    : group.hasFinal
      ? "border-mint/40"
      : "border-line-2";

  return (
    <div className={`rounded-md border-l-2 pl-2.5 ${accent}`}>
      {/* card heading — the intent */}
      <div className="flex items-start gap-2 py-1.5">
        <span className="mt-[5px] shrink-0">
          {group.hasFinal ? (
            <span className="font-mono text-[10px] leading-none text-mint">→</span>
          ) : (
            <span
              className={`block h-1.5 w-1.5 rounded-full ${group.insightCount ? "bg-amber" : "bg-line-2"}`}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            {iter && <span className="shrink-0 rounded bg-line-2/60 px-1 font-mono text-[9px] text-mist">{iter}</span>}
            <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-chalk">
              {renderNote(group.title)}
            </span>
          </div>
          {showOverview ? (
            <p className="mt-1 text-[11.5px] leading-relaxed text-mist-2">{overview}</p>
          ) : (
            <>
              {status && (
                <p className="mt-0.5 text-[11px] leading-snug text-mist">
                  {renderNote(status.note)}
                  {status.insight && (
                    <span className="mt-0.5 block text-[10px] italic text-amber/90">↳ {status.insight.seed}</span>
                  )}
                </p>
              )}
              {group.hasFinal && status?.handoff?.to && (
                <p className="mt-0.5 font-mono text-[9px] text-mint/80">→ handoff to {status.handoff.to}</p>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {overview && (
            <div className="flex overflow-hidden rounded border border-line font-mono text-[8.5px] leading-none">
              {(["overview", "beats"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-1.5 py-0.5 transition-colors ${
                    view === v ? "bg-line-2 text-chalk" : "text-dim hover:text-mist"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <Stamp iso={group.endedAt} running={running} now={now} />
          {!showOverview && earlier.length > 0 && (
            <button onClick={() => setOpen((o) => !o)} className="font-mono text-[9px] text-dim transition-colors hover:text-mist">
              {open ? "▾" : "▸"} {detail.length}
            </button>
          )}
        </div>
      </div>

      {/* expanded — the earlier detail beats (beats view only) */}
      {!showOverview && open && earlier.length > 0 && (
        <div className="space-y-1 border-l border-line pb-1.5 pl-3.5">
          {[...earlier].reverse().map((h, i) => (
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

      {/* developer note / directive — the flow-manager loop (persists server-side) */}
      {canComment && (
        <div className="pb-1.5">
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Leave a note on this card… (steer the next run to make it a directive)"
                className="w-full rounded border border-line-2 bg-ink/50 px-2 py-1 text-[10.5px] text-mist-2 outline-none focus:border-mist/40"
              />
              <div className="flex flex-wrap items-center gap-2 text-[9.5px]">
                <label className="flex items-center gap-1 text-mist">
                  <input
                    type="checkbox"
                    checked={directive}
                    onChange={(e) => setDirective(e.target.checked)}
                    className="accent-mint"
                  />
                  steer the next run
                </label>
                {directive && (
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    className="rounded border border-line bg-panel px-1 py-0.5 font-mono text-[9px] text-mist outline-none"
                  >
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
                <span className="flex-1" />
                <button onClick={() => saveNote()} className="rounded bg-line-2 px-2 py-0.5 text-chalk transition-colors hover:bg-line-2/70">
                  Save
                </button>
                {note && (
                  <button onClick={() => { setDraft(""); saveNote("delete"); }} className="text-dim transition-colors hover:text-rose">
                    delete
                  </button>
                )}
                <button
                  onClick={() => { setEditing(false); setDraft(note?.text ?? ""); }}
                  className="text-dim transition-colors hover:text-mist"
                >
                  cancel
                </button>
              </div>
            </div>
          ) : note?.text ? (
            <div className="rounded border border-line bg-panel-2 px-2 py-1">
              <button
                onClick={() => setEditing(true)}
                className="flex w-full items-start gap-1.5 text-left text-[10.5px] leading-snug text-mist-2"
              >
                <span className="text-mist">✎</span>
                <span className="flex-1">{note.text}</span>
              </button>
              {note.directive && (
                <div className="mt-1 flex items-start gap-1.5 border-t border-line pt-1 font-mono text-[9px]">
                  {note.status === "applied" ? (
                    <span className="shrink-0 text-mint">✓ applied</span>
                  ) : note.status === "deferred" ? (
                    <span className="shrink-0 text-dim">– deferred</span>
                  ) : (
                    <span className="shrink-0 text-mist">● steers next run</span>
                  )}
                  {note.resolution && <span className="flex-1 text-dim">{note.resolution}</span>}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="font-mono text-[9px] text-dim transition-colors hover:text-mist"
            >
              + note
            </button>
          )}
        </div>
      )}
    </div>
  );
}
