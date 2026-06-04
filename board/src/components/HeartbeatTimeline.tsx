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
        <div className="max-h-96 space-y-2 overflow-y-auto board-scroll">
          {/* Beats grouped into activity cards, newest first — the live card streams its rows,
              closed cards collapse to their summary, so there's always a clear current activity. */}
          {[...groupBeats(shown)].reverse().map((g, gi) => (
            <GroupBlock
              key={g.id}
              group={g}
              overview={cardOverviews?.[g.id]}
              cardNotes={(notes ?? []).filter((n) => n.card === g.id && n.status !== "removed")}
              workflow={workflow}
              step={step}
              active={gi === 0 && running && !g.hasFinal}
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

/** One activity CARD — a clean black block the flow manager reads top-to-bottom:
 *  the card NAME, then its body (an ACTIVE card streams its heartbeat rows live; a CLOSED card
 *  shows its SUMMARY instead — the overview replaces the stream), then COMMENTS at the bottom. */
function GroupBlock({
  group,
  overview,
  cardNotes,
  workflow,
  step,
  active,
  running,
  now,
  showIter,
}: {
  group: BeatGroup;
  /** parallel-agent summary for this card — replaces the stream once the card closes */
  overview?: string;
  /** the developer's notes/directives pinned to this card (a thread) */
  cardNotes?: DeveloperNote[];
  workflow?: string;
  step?: string;
  /** the live card — streams its rows; closed cards show their summary */
  active: boolean;
  running: boolean;
  now: number;
  showIter: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const notes = cardNotes ?? [];
  const canComment = !!workflow && !!step;
  const rows = detailBeats(group); // the heartbeats under the card name
  const iter = showIter ? group.beats[0]?.iteration : undefined;
  const handoff = group.beats.find((b) => b.finalBeat)?.handoff;

  // closed + summarized → the summary replaces the stream; otherwise show the rows
  // (active = full live stream; closed-but-unsummarized = last couple, expandable).
  const asSummary = !!overview && !active;
  const collapsible = !active && rows.length > 3;
  const shownRows = collapsible && !expanded ? rows.slice(-2) : rows;

  return (
    <div className="rounded-lg border border-line bg-panel/40 px-3 py-2.5">
      {/* card NAME + state + timestamp */}
      <div className="flex items-baseline gap-2">
        {iter && <span className="shrink-0 rounded bg-line-2/60 px-1 font-mono text-[9px] text-mist">{iter}</span>}
        {group.hasFinal && <span className="shrink-0 font-mono text-[10px] leading-none text-mint">→</span>}
        {group.insightCount > 0 && (
          <span className="shrink-0 h-1.5 w-1.5 translate-y-px rounded-full bg-amber" title="carries an insight" />
        )}
        <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-chalk">{renderNote(group.title)}</span>
        {active && <span className="shrink-0 font-mono text-[9px] tracking-wide text-mint">● live</span>}
        <Stamp iso={group.endedAt} running={running} now={now} />
      </div>

      {/* body — the summary, or the heartbeat-row stream */}
      {asSummary ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-2">{overview}</p>
      ) : rows.length > 0 ? (
        <div className="mt-2 space-y-1 border-l border-line pl-2.5">
          {shownRows.map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              <Stamp iso={h.at} running={running} now={now} />
              <span className="flex-1 text-[11px] leading-snug text-mist-2">
                {renderNote(h.note)}
                {h.insight && <span className="mt-0.5 block text-[9.5px] italic text-amber/90">↳ {h.insight.seed}</span>}
              </span>
            </div>
          ))}
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

      {/* comments — prominent, at the bottom: the flow manager's tweak point */}
      {canComment && (
        <div className="mt-2.5 border-t border-line pt-2">
          <NoteThread notes={notes} workflow={workflow!} step={step!} card={group.id} cardTitle={group.title} />
        </div>
      )}
    </div>
  );
}

/** The thread of developer notes on one card: each note shows its directive status + an edit/remove
 *  affordance; you can add more throughout the run. Edits/removals append to the server-side audit. */
function NoteThread({
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
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [directive, setDirective] = useState(false);
  const [scope, setScope] = useState("this-conductor");

  const reset = () => {
    setAdding(false);
    setEditingId(null);
    setDraft("");
    setDirective(false);
    setScope("this-conductor");
  };
  const startAdd = () => {
    reset();
    setAdding(true);
  };
  const startEdit = (n: DeveloperNote) => {
    setAdding(false);
    setEditingId(n.id);
    setDraft(n.text);
    setDirective(n.directive);
    setScope(n.scope ?? "this-conductor");
  };
  const save = () => {
    if (!draft.trim()) return reset();
    postComment(
      workflow,
      editingId
        ? { id: editingId, step, card, text: draft, directive, scope }
        : { step, card, cardTitle, text: draft, directive, scope },
    );
    reset();
  };
  const remove = (n: DeveloperNote) => postComment(workflow, { id: n.id, step, card, text: "", action: "remove" });

  return (
    <div className="space-y-1 pb-1.5">
      {notes.map((n) =>
        editingId === n.id ? (
          <NoteEditor
            key={n.id}
            draft={draft}
            setDraft={setDraft}
            directive={directive}
            setDirective={setDirective}
            scope={scope}
            setScope={setScope}
            onSave={save}
            onCancel={reset}
          />
        ) : (
          <NoteRow key={n.id} note={n} onEdit={() => startEdit(n)} onRemove={() => remove(n)} />
        ),
      )}

      {adding ? (
        <NoteEditor
          draft={draft}
          setDraft={setDraft}
          directive={directive}
          setDirective={setDirective}
          scope={scope}
          setScope={setScope}
          onSave={save}
          onCancel={reset}
        />
      ) : (
        <button
          onClick={startAdd}
          className="flex w-full items-center gap-1.5 rounded border border-dashed border-line-2 px-2 py-1 text-left font-mono text-[9.5px] text-dim transition-colors hover:border-mist/40 hover:text-mist"
        >
          <span className="text-mist">✎</span> add a note or directive…
        </button>
      )}
    </div>
  );
}

/** A single saved note — its text, directive status, and an edit/remove affordance. */
function NoteRow({ note, onEdit, onRemove }: { note: DeveloperNote; onEdit: () => void; onRemove: () => void }) {
  const edits = (note.history ?? []).filter((h) => h.action === "edited");
  const lastEdit = edits.at(-1);
  return (
    <div className="group rounded border border-line bg-panel-2 px-2 py-1">
      <div className="flex items-start gap-1.5 text-[10.5px] leading-snug text-mist-2">
        <span className="text-mist">✎</span>
        <span className="flex-1">{note.text}</span>
        <span className="flex shrink-0 gap-1.5 font-mono text-[9px] text-dim opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onEdit} className="hover:text-mist">edit</button>
          <button onClick={onRemove} className="hover:text-rose">remove</button>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 border-t border-line pt-1 font-mono text-[9px]">
        {note.directive ? (
          note.status === "applied" ? (
            <span className="shrink-0 text-mint">✓ applied</span>
          ) : note.status === "deferred" ? (
            <span className="shrink-0 text-dim">– deferred</span>
          ) : (
            <span className="shrink-0 text-mist">● steers next run · {note.scope ?? "this-conductor"}</span>
          )
        ) : (
          <span className="shrink-0 text-dim">note</span>
        )}
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

/** The add/edit form: text + a "steer the next run" toggle (promotes to a directive) + scope. */
function NoteEditor({
  draft,
  setDraft,
  directive,
  setDirective,
  scope,
  setScope,
  onSave,
  onCancel,
}: {
  draft: string;
  setDraft: (s: string) => void;
  directive: boolean;
  setDirective: (b: boolean) => void;
  scope: string;
  setScope: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <textarea
        autoFocus
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSave(); // Enter saves; Shift+Enter inserts a newline
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation(); // don't bubble to the board-level Esc (back-to-live)
            onCancel();
          }
        }}
        placeholder="Note… (Enter saves · Shift+Enter for a new line · steer the next run to make it a directive)"
        className="w-full rounded border border-line-2 bg-ink/50 px-2 py-1.5 text-[11px] leading-snug text-mist-2 outline-none focus:border-mist/40"
      />
      <div className="flex flex-wrap items-center gap-2 text-[9.5px]">
        <label className="flex items-center gap-1 text-mist">
          <input type="checkbox" checked={directive} onChange={(e) => setDirective(e.target.checked)} className="accent-mint" />
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
        <button onClick={onSave} className="rounded bg-line-2 px-2 py-0.5 text-chalk transition-colors hover:bg-line-2/70">
          Save
        </button>
        <button onClick={onCancel} className="text-dim transition-colors hover:text-mist">
          cancel
        </button>
      </div>
    </div>
  );
}
