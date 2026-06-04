import { useEffect, useRef, useState } from "react";
import { Led } from "./Led";
import { Icon } from "./Icon";
import { Heart } from "./Heart";
import { TypewriterText } from "./TypewriterText";

/**
 * A self-contained, continuously-looping board — the real visual language
 * (status LEDs, row lines, the heart, streaming heartbeats) driven by a scripted
 * in-browser simulation. No server, no SSE: it just plays. This is the live demo.
 *
 * The scenario reads like a real PR review: a "batch-review" loop walks four
 * changed files, each through read-diff → review → verdict, and the bottom bar
 * streams a genuine-sounding heartbeat for whatever it's doing right now.
 */

type Col = "pending" | "running" | "gate" | "done";

const SUBS = [
  { id: "read diff", gate: false },
  { id: "review", gate: true },
  { id: "verdict", gate: true },
];

// A little review story per file — so each iteration shows something useful.
const FILES: { item: string; beats: [string, string, string]; verdict: string }[] = [
  {
    item: "src/auth.ts",
    beats: [
      "Reading src/auth.ts — token refresh + two new route guards.",
      "Flagging a missing `await` on refresh() at line 42 — token can be stale.",
      "1 blocker. Requesting changes before this can merge.",
    ],
    verdict: "changes requested",
  },
  {
    item: "src/api/users.ts",
    beats: [
      "Reading src/api/users.ts — adds pagination params to the list endpoint.",
      "Edge case: page=0 returns the whole table. Needs a floor of 1.",
      "1 nit, non-blocking. Approving with a note.",
    ],
    verdict: "approved with notes",
  },
  {
    item: "db/schema.sql",
    beats: [
      "Reading db/schema.sql — new index on users(email).",
      "Index is non-unique; duplicate emails could still slip in.",
      "Approving — tightening the index can be a follow-up.",
    ],
    verdict: "approved",
  },
  {
    item: "ui/Login.tsx",
    beats: [
      "Reading ui/Login.tsx — inline error states on the form.",
      "Error region is missing aria-live, so it won't be announced.",
      "Approve once the a11y fix lands. Handing back the batch.",
    ],
    verdict: "approved",
  },
];

const ITEMS = FILES.map((f) => f.item);
const COLS: Col[] = ["pending", "running", "gate", "done"];
const COL_LABEL: Record<Col, string> = { pending: "Pending", running: "Running", gate: "Gate", done: "Done" };

interface State {
  item: number; // current iteration index
  cols: Col[][]; // cols[itemIdx][subIdx]
  note: string;
}

function fresh(): State {
  return {
    item: 0,
    cols: ITEMS.map(() => SUBS.map(() => "pending" as Col)),
    note: "Discovered 4 changed files in the PR. Starting the review loop.",
  };
}

/** Advance one beat of the simulation. Returns the next state. */
function advance(s: State): State {
  const cols = s.cols.map((r) => r.slice());
  const it = s.item;
  const row = cols[it];
  const file = FILES[it];

  let i = row.findIndex((c) => c === "running" || c === "gate");
  if (i === -1) i = row.findIndex((c) => c === "pending");

  if (i === -1) {
    // iteration done → next item, or loop back to the start
    if (it + 1 < ITEMS.length) {
      return { ...s, item: it + 1, cols, note: `${ITEMS[it + 1]}: opening the diff. Carrying forward the last file's patterns.` };
    }
    return { ...fresh(), note: "All four files reviewed. Posting the summary, then watching for the next push." };
  }

  const cur = row[i];
  const sub = SUBS[i];
  if (cur === "pending") row[i] = "running";
  else if (cur === "running") row[i] = sub.gate ? "gate" : "done";
  else if (cur === "gate") row[i] = "done";

  // the heartbeat that matches what it's doing right now
  let note: string;
  if (row[i] === "done" && i === SUBS.length - 1) note = `${file.item}: ${file.verdict}.`;
  else if (row[i] === "done") note = `${file.item}: ${sub.id} done — handing to ${SUBS[i + 1].id}.`;
  else note = file.beats[i];

  return { ...s, cols, note };
}

export function LiveBoard() {
  const [s, setS] = useState<State>(fresh);
  const [beat, setBeat] = useState(0);
  const sref = useRef(s);
  sref.current = s;

  useEffect(() => {
    const id = setInterval(() => {
      setS(advance(sref.current));
      setBeat((b) => b + 1);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const item = ITEMS[s.item];
  const row = s.cols[s.item];
  const done = row.filter((c) => c === "done").length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink-2 text-left shadow-2xl">
      {/* top bar */}
      <div className="flex h-10 items-center gap-2.5 border-b border-line bg-panel/60 px-3">
        <Icon name="loop" size={13} />
        <span className="font-mono text-[12px] text-mist">batch-review</span>
        <span className="text-dim">/</span>
        <span className="truncate text-[13px] font-medium text-chalk">{item}</span>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-mist">
          file {s.item + 1}/{ITEMS.length}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-mist">
          <Led state="running" /> Running
        </span>
      </div>

      {/* kanban */}
      <div className="grid grid-cols-2 gap-x-5 px-4 py-4 sm:grid-cols-4">
        {COLS.map((c) => {
          const cards = SUBS.map((sub, i) => ({ sub, i })).filter(({ i }) => row[i] === c);
          return (
            <div key={c} className="min-w-0">
              <div className="mb-1 flex items-center gap-2 border-b border-line px-1 pb-1.5">
                <Led state={c} />
                <span className="text-[11px] text-mist">{COL_LABEL[c]}</span>
                <span className="ml-auto text-[11px] tabular-nums text-dim">{cards.length}</span>
              </div>
              <div className="min-h-[10.5rem]">
                {cards.map(({ sub }) => (
                  <div
                    key={`${item}-${sub.id}-${c}`}
                    className="liveboard-card border-b border-line px-1.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Led state={c} />
                      <span className="text-[12.5px] text-chalk">{sub.id}</span>
                      {c === "done" && (
                        <span className="ml-auto text-mint">
                          <Icon name="check" size={12} />
                        </span>
                      )}
                    </div>
                    <div className="mt-1 pl-[18px] text-[10.5px] text-dim">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* bottom bar — the heartbeat, streaming */}
      <div className="flex h-9 items-center gap-2.5 border-t border-line bg-panel/40 px-3">
        <Heart beat={beat} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-mist">
          <TypewriterText text={s.note} cursor={false} />
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-dim">{done}/{SUBS.length}</span>
      </div>
    </div>
  );
}
