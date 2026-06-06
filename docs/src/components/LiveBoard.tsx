import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Led } from "./Led";
import { Icon } from "./Icon";
import { Heart } from "./Heart";
import { TypewriterText } from "./TypewriterText";

/**
 * The live board demo. Cards slide column → column with the same layout
 * animation the real app uses (framer-motion `layout`), stepping strictly
 * pending → running → checking → done so a step is never skipped. The heartbeat
 * streams agent-fast and finishes before a card moves. Two sizes: a compact
 * three-step version, and a five-step version when the board has room.
 */

type Col = "pending" | "running" | "gate" | "done";
const COLS: Col[] = ["pending", "running", "gate", "done"];
const COL_LABEL: Record<Col, string> = { pending: "Pending", running: "Running", gate: "Checking", done: "Done" };

interface Step {
  id: string;
  check: boolean;
  note: string;
}

// A page-building agent run — exactly the kind of workflow where an agent
// declares victory early and skips the image or the SEO pass.
const FULL: Step[] = [
  { id: "research", check: true, note: "Pulling 6 sources on the treatment — cost ranges, risks, the questions owners actually ask." },
  { id: "write page", check: true, note: "Drafting the page from research — answering the owner's top three questions in the first screen." },
  { id: "generate image", check: true, note: "Generating a hero image of the treatment for this species; checking it reads on-brand." },
  { id: "SEO check", check: true, note: "Auditing title, meta, headings, internal links and the target keyword." },
  { id: "publish", check: true, note: "Every check green. Publishing the page and pinging the sitemap." },
];
const COMPACT: Step[] = [FULL[1], FULL[2], FULL[3]]; // write · image · SEO

const CHECK_NOTE = (id: string) => `Checking ${id} — the output has to satisfy the instruction before the next step unlocks.`;
const RESET_NOTE = "Run complete. Watching for the next page to build.";

interface State {
  cols: Col[];
  note: string;
}

function fresh(steps: Step[], note = "New page queued. Starting the build."): State {
  return { cols: steps.map(() => "pending"), note };
}

/** Advance one step of the machine. Returns the next state + how long to dwell. */
function advance(s: State, steps: Step[]): { next: State; delay: number } {
  const cols = s.cols.slice();
  let i = cols.findIndex((c) => c === "running" || c === "gate");
  if (i === -1) i = cols.findIndex((c) => c === "pending");

  if (i === -1) return { next: fresh(steps), delay: 1300 }; // all done → reset

  const step = steps[i];
  if (cols[i] === "pending") {
    cols[i] = "running";
    return { next: { cols, note: step.note }, delay: 2100 }; // let the beat finish
  }
  if (cols[i] === "running") {
    if (step.check) {
      cols[i] = "gate";
      return { next: { cols, note: CHECK_NOTE(step.id) }, delay: 1300 };
    }
    cols[i] = "done";
  } else {
    cols[i] = "done"; // gate → done
  }
  const last = i === steps.length - 1;
  const nextNote = last ? RESET_NOTE : steps[i + 1].note;
  return { next: { cols, note: nextNote }, delay: last ? 1600 : 700 };
}

/** Big when the board itself has room — not just the viewport. */
function useBig(ref: React.RefObject<HTMLDivElement | null>) {
  const [big, setBig] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBig(e.contentRect.width >= 860));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return big;
}

export function LiveBoard() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const big = useBig(wrapRef);
  const steps = big ? FULL : COMPACT;

  const [s, setS] = useState<State>(() => fresh(steps));
  const [beat, setBeat] = useState(0);
  const sref = useRef(s);
  sref.current = s;

  // reset the machine whenever the step set changes (size switch)
  useEffect(() => {
    setS(fresh(steps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big]);

  // self-pacing loop — each transition dwells long enough to read
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const { next, delay } = advance(sref.current, steps);
      setS(next);
      setBeat((b) => b + 1);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big]);

  const done = s.cols.filter((c) => c === "done").length;
  const colH = `${steps.length * (big ? 3 : 2.7)}rem`;

  return (
    <div ref={wrapRef} className="overflow-hidden rounded-xl border border-line bg-ink-2 text-left shadow-2xl">
      {/* top bar */}
      <div className="flex h-10 items-center gap-2.5 border-b border-line bg-panel/60 px-3">
        <Icon name="loop" size={13} />
        <span className="font-mono text-[12px] text-mist">treatment-page</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-mist">
          <Led state="running" /> Running
        </span>
      </div>

      {/* kanban */}
      <LayoutGroup>
        <div className={`grid grid-cols-2 px-4 py-4 sm:grid-cols-4 ${big ? "gap-x-6" : "gap-x-5"}`}>
          {COLS.map((c) => {
            const cards = steps.map((st, i) => ({ st, i })).filter(({ i }) => s.cols[i] === c);
            return (
              <div key={c} className="min-w-0">
                <div className="mb-1 flex items-center gap-2 border-b border-line px-1 pb-1.5">
                  <Led state={c} />
                  <span className="text-[11px] text-mist">{COL_LABEL[c]}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-dim">{cards.length}</span>
                </div>
                <div style={{ minHeight: colH }}>
                  <AnimatePresence initial={false}>
                    {cards.map(({ st, i }) => (
                      <motion.div
                        key={st.id}
                        layout
                        layoutId={st.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{
                          layout: { duration: 0.42, ease: [0.45, 0, 0.55, 1] },
                          opacity: { duration: 0.18 },
                        }}
                        className="mb-1.5 flex items-center gap-2 rounded-md border border-line bg-panel/60 px-2 py-2"
                      >
                        <Led state={s.cols[i]} />
                        <span className={`truncate ${big ? "text-[13px]" : "text-[12.5px]"} text-chalk`}>{st.id}</span>
                        {s.cols[i] === "done" && (
                          <span className="ml-auto text-mint">
                            <Icon name="check" size={12} />
                          </span>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>

      {/* bottom bar — the heartbeat, streaming */}
      <div className="flex h-9 items-center gap-2.5 border-t border-line bg-panel/40 px-3">
        <Heart beat={beat} />
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap font-mono text-[11.5px] text-mist">
          <TypewriterText text={s.note} speed={12} cursor={false} />
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-dim">{done}/{steps.length}</span>
      </div>
    </div>
  );
}
