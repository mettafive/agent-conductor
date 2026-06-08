import { Led } from "./Led";

/**
 * The global header for the Kanban board: workflow identity, run state, elapsed
 * time and completion count. Navigation is intentionally parked in v3's main view.
 */
export function TopBar({
  workflow,
  status,
  elapsed,
  done,
  total,
}: {
  workflow?: string;
  status?: string;
  elapsed?: string | null;
  done?: number;
  total?: number;
}) {
  const shownStatus = status ?? "idle";
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-panel/60 px-3 backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <img src="./conductor.svg" alt="" className="h-4 w-4 shrink-0 opacity-70" />
        <span className="shrink-0 font-mono text-[12px] tracking-wide text-mist">conductor</span>
        {workflow && (
          <>
            <span className="shrink-0 text-dim">/</span>
            <span className="min-w-0 truncate text-[14px] font-medium text-chalk">{workflow}</span>
          </>
        )}
      </div>

      <div className="ml-3 flex shrink-0 items-center gap-3 text-[12px] text-mist">
        <span className="flex items-center gap-1.5">
          <Led state={shownStatus} />
          <span>{shownStatus}</span>
        </span>
        {elapsed && <span className="tabular-nums text-dim">{elapsed}</span>}
        {typeof done === "number" && typeof total === "number" && (
          <span className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-mist">
            {done}/{total} done
          </span>
        )}
      </div>
    </header>
  );
}
