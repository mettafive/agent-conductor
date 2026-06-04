import { useEffect, useRef, useState } from "react";
import { Led } from "./Led";
import { Icon } from "./Icon";

/**
 * A self-contained, continuously-looping board — the real visual language
 * (status LEDs, row lines, the heart) driven by a scripted in-browser
 * simulation. No server, no SSE: it just plays. This is the live demo.
 */

type Col = "pending" | "running" | "gate" | "done";
const ITEMS = ["src/auth.ts", "src/api/users.ts", "db/schema.sql", "ui/Login.tsx"];
const SUBS = [
  { id: "read", gate: false },
  { id: "critique", gate: true },
  { id: "verdict", gate: true },
];
const COLS: Col[] = ["pending", "running", "gate", "done"];
const COL_LABEL: Record<Col, string> = { pending: "Pending", running: "Running", gate: "Gate", done: "Done" };

const NOTES: Record<string, string> = {
  read: "Reading the diff — summarising what changed and why.",
  critique: "Scanning for bugs and unsafe patterns; each finding gets a line + fix.",
  verdict: "Weighing severity. Ship, or send back with notes?",
};

interface State {
  item: number; // current iteration index
  cols: Col[][]; // cols[itemIdx][subIdx]
  note: string;
}

function fresh(): State {
  return {
    item: 0,
    cols: ITEMS.map(() => SUBS.map(() => "pending" as Col)),
    note: "Discovered 4 changed files. Starting the review loop.",
  };
}

/** Advance one beat of the simulation. Returns the next state. */
function advance(s: State): State {
  const cols = s.cols.map((r) => r.slice());
  const it = s.item;
  const row = cols[it];
  // find the sub-step in flight (running/gate) or the next pending one
  let i = row.findIndex((c) => c === "running" || c === "gate");
  if (i === -1) i = row.findIndex((c) => c === "pending");
  if (i === -1) {
    // iteration done → next item, or loop back to the start
    if (it + 1 < ITEMS.length) return { ...s, item: it + 1, cols, note: `${ITEMS[it + 1]}: applying the pattern from the last file. Starting.` };
    const r = fresh();
    return r;
  }
  const cur = row[i];
  const sub = SUBS[i];
  if (cur === "pending") row[i] = "running";
  else if (cur === "running") row[i] = sub.gate ? "gate" : "done";
  else if (cur === "gate") row[i] = "done";
  const note = row[i] === "done" ? `${sub.id} cleared its gate — handing off.` : NOTES[sub.id];
  return { ...s, cols, note };
}

function Heart({ beat }: { beat: number }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 420);
    return () => clearTimeout(t);
  }, [beat]);
  return (
    <svg
      className={pulse ? "heart-strong" : "heart-rest"}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      style={{ color: "var(--color-heart)" }}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 21s-7.5-4.7-10-9.2C.4 8.4 2 5 5.2 5c2 0 3.3 1.1 4.1 2.3l.9 1.3.9-1.3C11.9 6.1 13.2 5 15.2 5 18.4 5 20 8.4 18.5 11.8 16 16.3 12 21 12 21Z"
      />
    </svg>
  );
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
    }, 1100);
    return () => clearInterval(id);
  }, []);

  const item = ITEMS[s.item];
  const row = s.cols[s.item];
  const done = row.filter((c) => c === "done").length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink-2 shadow-2xl">
      {/* top bar */}
      <div className="flex h-10 items-center gap-2.5 border-b border-line bg-panel/60 px-3">
        <Icon name="loop" size={13} />
        <span className="font-mono text-[12px] text-mist">batch-review</span>
        <span className="text-dim">/</span>
        <span className="truncate text-[13px] font-medium text-chalk">{item}</span>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-mist">
          {s.item + 1}/{ITEMS.length}
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

      {/* bottom bar */}
      <div className="flex h-9 items-center gap-2.5 border-t border-line bg-panel/40 px-3">
        <Heart beat={beat} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-mist">{s.note}</span>
        <span className="font-mono text-[10px] tabular-nums text-dim">
          {done}/{SUBS.length}
        </span>
      </div>
    </div>
  );
}
