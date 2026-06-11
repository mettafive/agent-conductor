import { useEffect, useRef, useState } from "react";
import type { HeartbeatEntry, LoopState, DeveloperNote } from "../lib/types";
import { relativeTime, renderNote } from "../lib/heartbeat";
import { groupBeats, detailBeats, postComment, type BeatGroup } from "../lib/groups";

function absTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Stamp({ iso, running, now }: { iso: string; running: boolean; now: number }) {
  return (
    <span className="shrink-0 font-mono text-[9px] text-mist" title={iso}>
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
  /** Accepted for backwards-compat with callers that still pass them, but no longer used here:
   *  comments now live as ONE card-level thread in WorkflowCard, not per activity group. */
  notes?: DeveloperNote[];
  workflow?: string;
  step?: string;
}

/**
 * The per-card heartbeat history as a vertical timeline — connected dots, with
 * finalBeats marked as handoffs. Loop steps get iteration filter tabs.
 */
export function HeartbeatTimeline({ entries, learnings, now, running, loop, cardOverviews }: Props) {
  const iterations = loop?.iterations.map((i) => i.item) ?? [];
  const [filter, setFilter] = useState<string>("all");

  const shown =
    filter === "all" ? entries : entries.filter((h) => h.iteration === filter);
  const groups = groupBeats(shown);

  // keep the latest (bottom) activity in view as it streams, unless the user scrolled up
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, running]);

  return (
    <div className="mt-2.5 -ml-7 border-t border-line pt-2 pl-0">
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

      {groups.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="relative max-h-[28rem] overflow-y-auto board-scroll pl-7"
        >
          {/* the timeline spine — activity blocks stack along it, oldest → newest */}
          <span className="pointer-events-none absolute bottom-3 left-[11px] top-3 w-px bg-line" />
          <div className="space-y-2.5">
            {groups.map((g, gi) => (
              <GroupBlock
                key={g.id}
                group={g}
                overview={cardOverviews?.[g.id]}
                active={gi === groups.length - 1 && running && !g.hasFinal}
                running={running}
                now={now}
                showIter={filter === "all"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One activity CARD — a clean black block the flow manager reads top-to-bottom:
 *  the card NAME, then its body (an ACTIVE card streams its heartbeat rows live; a CLOSED card
 *  shows its SUMMARY instead — the overview replaces the stream), then COMMENTS at the bottom. */
function GroupBlock({
  group,
  overview,
  active,
  running,
  now,
  showIter,
}: {
  group: BeatGroup;
  /** parallel-agent summary for this card — replaces the stream once the card closes */
  overview?: string;
  /** the live card — streams its rows; closed cards show their summary */
  active: boolean;
  running: boolean;
  now: number;
  showIter: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = detailBeats(group); // the heartbeats under the card name
  const iter = showIter ? group.beats[0]?.iteration : undefined;
  const handoff = group.beats.find((b) => b.finalBeat)?.handoff;

  // closed + summarized → the summary replaces the stream; otherwise show the rows
  // (active = full live stream; closed-but-unsummarized = last couple, expandable).
  const asSummary = !!overview && !active;
  const collapsible = !active && rows.length > 3;
  const shownRows = collapsible && !expanded ? rows.slice(-2) : rows;

  return (
    <div
      title={iter ? `iteration: ${iter}` : undefined}
      className={`relative rounded-lg border bg-panel/40 px-3 py-2.5 ${
        active ? "border-mint/30" : "border-line"
      }`}
    >
      {/* heartbeat node sitting on the timeline spine — a white heart per beat, → for the handoff */}
      <span
        className={`absolute -left-7 top-2.5 grid h-[22px] w-[22px] place-items-center rounded-full border bg-ink font-mono leading-none ${
          group.hasFinal ? "text-[9px]" : "text-[11px]"
        } ${
          active
            ? "border-mint/60 text-mint"
            : group.hasFinal
              ? "border-mint/40 text-mint/80"
              : "border-line-2 text-chalk"
        }`}
      >
        {group.hasFinal ? "→" : "♥"}
      </span>

      {/* header — the title gets the room and wraps to as many lines as it needs (never truncates to
          "…DB ro…"); the state + time sit compact, top-right, so they never crowd the name. The
          iteration is on the card's hover title, not a chip that competes for width. */}
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-[12.5px] font-medium leading-snug text-chalk">
          {renderNote(group.title)}
        </span>
        <span className="mt-px flex shrink-0 items-center gap-1.5">
          {group.insightCount > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber" title="Carries an insight" />
          )}
          {active && <span className="font-mono text-[9px] tracking-wide text-mint">● live</span>}
          <Stamp iso={group.endedAt} running={running} now={now} />
        </span>
      </div>

      {/* body — the summary, or the heartbeat-row stream */}
      {asSummary ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-2">{overview}</p>
      ) : rows.length > 0 ? (
        <div className="mt-2 space-y-1 border-l border-line pl-2.5">
          {shownRows.map((h, i) => {
            return (
              <div key={i}>
                <span
                  className="inline-block rounded bg-line-2/40 px-1 font-mono text-[10px] leading-[1.5] text-mist"
                  title={h.at}
                >
                  {absTime(h.at)}
                </span>
                <p className="mt-0.5 text-[12px] leading-snug text-mist-2">
                  {renderNote(h.note)}
                  {h.insight && <span className="mt-0.5 block text-[10px] italic text-amber/90">↳ {h.insight.seed}</span>}
                </p>
              </div>
            );
          })}
          {collapsible && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="font-mono text-[9px] text-dim transition-colors hover:text-mist"
            >
              {expanded ? "show less" : `+ ${rows.length - shownRows.length} earlier beats`}
            </button>
          )}
        </div>
      ) : null}

      {/* handoff to the next step */}
      {handoff?.to && <p className="mt-1.5 font-mono text-[9px] text-mint/80">→ handoff to {handoff.to}</p>}
    </div>
  );
}

/** The thread of developer notes on one card. Every comment becomes a knowledge candidate
 *  when the run is archived; edits/removals append to the server-side audit. */
export function NoteThread({
  notes,
  workflow,
  step,
  card,
  cardTitle,
}: {
  notes: DeveloperNote[];
  workflow: string;
  step: string;
  card: string;
  cardTitle: string;
}) {
  // editingId tracks a saved note being edited inline; the bottom composer is
  // ALWAYS shown (its own draft state) so leaving a comment is a real, visible field.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [draft, setDraft] = useState("");

  const startEdit = (n: DeveloperNote) => {
    setEditingId(n.id);
    setEditDraft(n.text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };
  const saveEdit = () => {
    if (!editDraft.trim()) return cancelEdit();
    postComment(workflow, { id: editingId!, step, card, text: editDraft, directive: false });
    cancelEdit();
  };
  const saveNew = () => {
    if (!draft.trim()) {
      setDraft("");
      return;
    }
    postComment(workflow, { step, card, cardTitle, text: draft, directive: false });
    setDraft("");
  };
  const remove = (n: DeveloperNote) => postComment(workflow, { id: n.id, step, card, text: "", action: "remove" });

  return (
    <div className="space-y-1.5">
      {notes.map((n) =>
        editingId === n.id ? (
          <NoteEditor
            key={n.id}
            draft={editDraft}
            setDraft={setEditDraft}
            onSave={saveEdit}
            onCancel={cancelEdit}
          />
        ) : (
          <NoteRow key={n.id} note={n} onEdit={() => startEdit(n)} onRemove={() => remove(n)} />
        ),
      )}

      {/* the composer — a real, always-visible comment field at the bottom of the card */}
      <NoteEditor draft={draft} setDraft={setDraft} onSave={saveNew} composer />
    </div>
  );
}

/** A single saved note — its text and an edit/remove affordance. */
function NoteRow({ note, onEdit, onRemove }: { note: DeveloperNote; onEdit: () => void; onRemove: () => void }) {
  const edits = (note.history ?? []).filter((h) => h.action === "edited");
  const lastEdit = edits.at(-1);
  return (
    <div className="group rounded-md border border-line bg-panel-2/80 px-2.5 py-1.5">
      <div className="flex items-start gap-2 text-[12.5px] leading-snug text-mist-2">
        <span className="text-[11px] text-mist">✎</span>
        <span className="flex-1">{note.text}</span>
        <span className="flex shrink-0 gap-1.5 font-mono text-[9px] text-dim opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onEdit} className="hover:text-mist">edit</button>
          <button onClick={onRemove} className="hover:text-rose">remove</button>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 border-t border-line/70 pt-1 font-mono text-[9px]">
        <span className="shrink-0 text-dim">comment</span>
        {note.resolution && <span className="min-w-0 flex-1 truncate text-dim" title={note.resolution}>{note.resolution}</span>}
        {edits.length > 0 && (
          <span
            className="ml-auto shrink-0 text-dim"
            title={lastEdit ? `edited from “${lastEdit.from ?? ""}” to “${lastEdit.to ?? ""}”` : "edited"}
          >
            · edited {edits.length}×
          </span>
        )}
      </div>
    </div>
  );
}

/** The add/edit form. Comments are archived as knowledge candidates automatically.
 *  In `composer` mode this is the always-visible, prominent comment field at the
 *  bottom of the card (no autofocus, no cancel — it's a persistent input); when
 *  editing a saved note it keeps the inline Save/cancel pair. */
function NoteEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  composer = false,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSave: () => void;
  onCancel?: () => void;
  composer?: boolean;
}) {
  return (
    <div className={composer ? "space-y-1.5 rounded-md border border-line bg-ink/35 px-2 py-2" : "space-y-1.5"}>
      <textarea
        autoFocus={!composer}
        rows={composer ? 2 : 2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) =>
          // gently bring the input fully into view so leaving a comment feels natural — the card may
          // sit low in a scroll area, and a focused-but-clipped input is a jarring place to start.
          e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(); // Enter saves; Shift+Enter inserts a newline
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // don't bubble to the board-level Esc (back-to-live)
            onCancel?.();
          }
        }}
        placeholder={
          composer
            ? "Add a comment on this card… (Enter saves · Shift+Enter = new line)"
            : "Note on this activity… (Enter saves · Shift+Enter = new line)"
        }
        className={`w-full rounded border border-line-2 px-2 ${
          composer ? "bg-ink/60 py-1.5 text-[13px]" : "bg-ink/50 py-1.5 text-[12px]"
        } leading-snug text-mist-2 outline-none placeholder:text-dim focus:border-mist/40`}
      />
      {composer ? (
        <button
          onClick={onSave}
          disabled={!draft.trim()}
          className="w-full rounded bg-line-2 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-chalk transition-colors hover:bg-line-2/70 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Comment
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-[9.5px]">
          <span className="flex-1" />
          <button
            onClick={onSave}
            className="rounded bg-line-2 px-2.5 py-1 text-chalk transition-colors hover:bg-line-2/70"
          >
            Save
          </button>
          {onCancel && (
            <button onClick={onCancel} className="text-dim transition-colors hover:text-mist">
              cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
