import { useEffect, useState } from "react";

type Col = "pending" | "running" | "gate" | "done";

interface Card {
  id: string;
  soft: number;
  hard: number;
  beat: string;
}

const STEPS: Card[] = [
  { id: "research", soft: 1, hard: 0, beat: "3/5 sources found via sitemap." },
  { id: "insurance-relevant", soft: 0, hard: 0, beat: "Insurance is relevant — branching." },
  { id: "compare-insurers", soft: 1, hard: 0, beat: "Compared 3 insurers on excess." },
  { id: "write-page", soft: 1, hard: 1, beat: "Draft done; every claim cited." },
  { id: "seo-check", soft: 1, hard: 1, beat: "Title + meta within limits." },
];

const ORDER: Col[] = ["pending", "running", "gate", "done"];
const COLS: { key: Col; label: string; tint: string; dot: string }[] = [
  { key: "pending", label: "Pending", tint: "text-mist", dot: "bg-line-2" },
  { key: "running", label: "Running", tint: "text-cyan", dot: "bg-cyan" },
  { key: "gate", label: "Gate Check", tint: "text-amber", dot: "bg-amber" },
  { key: "done", label: "Done", tint: "text-mint", dot: "bg-mint" },
];

/** Simulates the agent walking the conductor, advancing one card at a time. */
export function BoardPreview() {
  const [pos, setPos] = useState<number[]>(() => STEPS.map(() => 0));

  useEffect(() => {
    const t = setInterval(() => {
      setPos((prev) => {
        const next = [...prev];
        // find the furthest-along card that isn't done, advance it; if all
        // done, reset to start the loop again.
        const lead = next.findIndex((p, i) => p < 3 && (i === 0 || next[i - 1] >= 2));
        if (lead === -1) {
          if (next.every((p) => p === 3)) return STEPS.map(() => 0);
          return next;
        }
        next[lead] = Math.min(3, next[lead] + 1);
        return next;
      });
    }, 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2/70 p-4 shadow-2xl backdrop-blur sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-mint" />
          <span className="font-mono text-xs text-mist">
            watching .conductor/status.json
          </span>
        </div>
        <span className="font-mono text-[11px] text-mist">treatment-page</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {COLS.map((col) => {
          const cards = STEPS.filter((_, i) => ORDER[pos[i]] === col.key);
          return (
            <div
              key={col.key}
              className="min-h-[180px] rounded-xl border border-line bg-ink/50 p-2.5"
            >
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <span className={`h-1.5 w-1.5 rounded-full ${col.dot}`} />
                <span className={`font-mono text-[11px] ${col.tint}`}>
                  {col.label}
                </span>
                <span className="ml-auto font-mono text-[11px] text-mist">
                  {cards.length}
                </span>
              </div>
              <div className="space-y-2">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-lg border bg-panel px-2.5 py-2 transition-all duration-500 ${
                      col.key === "running"
                        ? "border-cyan/40 pulse-ring"
                        : col.key === "gate"
                          ? "border-amber/40"
                          : col.key === "done"
                            ? "border-mint/30 opacity-80"
                            : "border-line-2"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11.5px] text-chalk">
                        {c.id}
                      </span>
                      {col.key === "done" && (
                        <span className="text-[11px] text-mint">✓</span>
                      )}
                      {col.key === "gate" && (
                        <span className="text-[10px] text-amber">checking…</span>
                      )}
                    </div>
                    {(c.soft > 0 || c.hard > 0) && (
                      <div className="mt-1.5 flex gap-1">
                        {c.soft > 0 && (
                          <span className="rounded border border-line-2 px-1 font-mono text-[9px] text-mist">
                            {c.soft} soft
                          </span>
                        )}
                        {c.hard > 0 && (
                          <span className="rounded border border-mint/25 px-1 font-mono text-[9px] text-mint">
                            {c.hard} check
                          </span>
                        )}
                      </div>
                    )}
                    {col.key === "running" && (
                      <div className="mt-1.5 flex items-start gap-1 text-[9.5px] italic leading-snug text-mist">
                        <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-cyan" />
                        <span className="truncate">{c.beat}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
