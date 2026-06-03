import type { HistoryRun } from "../lib/types";

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupByWorkflow(runs: HistoryRun[]): [string, HistoryRun[]][] {
  const map = new Map<string, HistoryRun[]>();
  for (const r of runs) {
    const k = r.workflow || "workflow";
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.entries()];
}

interface Props {
  runs: HistoryRun[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function HistorySidebar({ runs, selected, onSelect }: Props) {
  const groups = groupByWorkflow(runs);

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-ink-2/60 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <svg width="14" height="14" viewBox="0 0 24 24" className="text-mist">
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5" />
        </svg>
        <span className="font-mono text-xs uppercase tracking-wide text-mist">
          History
        </span>
        <span className="ml-auto font-mono text-[11px] text-mist">{runs.length}</span>
      </div>

      <button
        onClick={() => onSelect(null)}
        className={`mx-2 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
          selected === null ? "bg-iris/15 text-iris" : "text-mist-2 hover:bg-panel"
        }`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
        </span>
        <span className="font-mono text-xs">Live</span>
      </button>

      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {runs.length === 0 && (
          <p className="px-2 pt-4 font-mono text-[11px] leading-relaxed text-line-2">
            No past runs yet. Completed and failed runs are archived here.
          </p>
        )}

        {groups.map(([workflow, items]) => (
          <div key={workflow} className="mt-3">
            <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wide text-mist">
              {workflow}
            </div>
            <div className="space-y-1">
              {items.map((r) => {
                const active = selected === r.run_id;
                const failed = r.status === "failed";
                return (
                  <button
                    key={r.run_id}
                    onClick={() => onSelect(r.run_id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "border-iris/40 bg-iris/10"
                        : "border-transparent hover:border-line-2 hover:bg-panel"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        failed ? "bg-rose" : "bg-mint"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-chalk">
                        {fmtTime(r.completed_at || r.archived_at || r.started_at)}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          failed ? "text-rose" : "text-mist"
                        }`}
                      >
                        {failed ? "failed" : "done"} · {r.done}/{r.total}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
