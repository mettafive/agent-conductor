import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowEntry } from "../lib/useBoardState";
import type { HistoryRun } from "../lib/types";
import { Icon } from "./Icon";
import { displayName, phaseLabel } from "../lib/identity";

// Selected-row surface lift — a neutral surface lift, never colour.
const SEL = "bg-line-2/40";

// Resizable width clamps + persistence.
const MIN_WIDTH = 220;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 300;
const WIDTH_KEY = "conductor.navWidth";

function loadWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const raw = Number(window.localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
}

/** Fixed-width, vertically-centred trailing slot so every check/dot lines up. */
function Slot({ children }: { children: React.ReactNode }) {
  return <span className="flex h-[18px] w-3.5 shrink-0 items-center justify-center">{children}</span>;
}

/** Strip the trailing ISO timestamp from a run_name so the title reads cleanly
 *  (e.g. `treatment-seo-run-9-2026-06-08T19-57` → `treatment-seo-run-9`). The
 *  date lives on its own line beneath. Falls back to run_id when no run_name. */
function runTitle(run: HistoryRun): string {
  const name = run.run_name?.trim();
  if (name) {
    const stripped = name.replace(/[-_ ]?\d{4}-\d{2}-\d{2}[T_ -].*$/, "").trim();
    return stripped || name;
  }
  return run.run_id || "Untitled run";
}

function fmtDate(iso?: string | null): string {
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

/** A live run currently streaming — surfaced at the top of the drawer with a live dot. */
export interface LiveEntry {
  workflow: string;
  runName: string;
  startedAt?: string;
  /** The live run's real status, so the pinned entry can reflect it (running/done/failed). */
  status?: string;
}

interface Props {
  /** Per-workflow history (each list already newest-first). */
  workflows: Record<string, WorkflowEntry>;
  /** Workflow display order. */
  order: string[];
  /** The run currently loaded onto the board, as a "wf:runId" identity (null = live/default).
   *  Scoped by workflow so a matching run_id in ANOTHER group never lights up too. */
  viewingKey: string | null;
  /** A live run if one is streaming, to pin at the top. */
  live: LiveEntry | null;
  /** True when the board is showing the live run (viewingKey === null and a live run exists). */
  liveActive: boolean;
  /** Load a past run onto the board. */
  onPickRun: (wf: string, runId: string) => void;
  /** Clear back to the live/default board. */
  onClear: () => void;
}

/**
 * The Navigator — a drawer listing past runs. Click a row to load it onto the
 * board (statically). One workflow → a flat list; more than one → rows grouped
 * under workflow-name headers. A live run (if any) sits at the top with a live
 * dot so it's one click back to current.
 */
export function WorkflowSidebar({
  workflows,
  order,
  viewingKey,
  live,
  liveActive,
  onPickRun,
  onClear,
}: Props) {
  // Build the grouped, newest-first history. The live run is never in history
  // (history is done+failed only), so it's pinned at the top, not filtered here.
  const groups = order
    .map((name) => ({ name, runs: workflows[name]?.history ?? [] }))
    .filter((g) => g.runs.length > 0);

  const multi = groups.length > 1;
  const hasAny = groups.length > 0 || !!live;

  // Resizable width with a right-edge drag handle (persisted to localStorage).
  const [width, setWidth] = useState<number>(loadWidth);
  const draggingRef = useRef(false);

  const onDrag = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    setWidth(next);
  }, []);

  const stopDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    setWidth((w) => {
      window.localStorage.setItem(WIDTH_KEY, String(w));
      return w;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
    return () => {
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, [onDrag, stopDrag]);

  const startDrag = () => {
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-panel"
      style={{ width }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
        <span className="text-[15px] font-semibold text-chalk">Runs</span>
      </div>

      <div className="flex-1 overflow-y-auto board-scroll px-1 pb-4 pt-1">
        {!hasAny ? (
          <p className="px-3 pt-0.5 text-[12px] text-dim">No runs yet.</p>
        ) : (
          <div className="space-y-0.5">
            {/* Current run pinned at top — its label + dot reflect the live run's real status:
                running → green pulsing "Currently running"; done → static white "Run finished";
                failed → static rose "Run failed". Clickable in every state (returns to the board). */}
            {live && (() => {
              const running = live.status === "running";
              const failed = live.status === "failed";
              // Same display scheme as the header: base name + phase (never the inner title).
              const label = phaseLabel(live.workflow, live.status);
              const labelColor = running ? "text-mint" : failed ? "text-rose" : "text-mist-2";
              const dotColor = running ? "bg-mint" : failed ? "bg-rose" : "bg-chalk";
              return (
                <button
                  onClick={onClear}
                  title="Back to the current run"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ${
                    liveActive ? SEL : "hover:bg-panel-2/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-chalk">{displayName(live.workflow)}</div>
                    <div className={`mt-0.5 text-[11px] ${labelColor}`}>{label}</div>
                  </div>
                  <Slot>
                    <span className={`h-2 w-2 rounded-full ${dotColor} ${running ? "animate-pulse" : ""}`} />
                  </Slot>
                </button>
              );
            })()}

            {groups.map(({ name, runs }) => (
              <div key={name} className={multi ? "mt-2 border-t border-line/60 pt-2 first:mt-0 first:border-t-0 first:pt-0" : undefined}>
                {multi && (
                  <div className="px-3 pb-1 pt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-mist-2">
                    {displayName(name)}
                  </div>
                )}
                {runs.map((r: HistoryRun) => (
                  <Row
                    key={r.run_id}
                    run={r}
                    active={viewingKey === `${name}:${r.run_id}`}
                    onClick={() => onPickRun(name, r.run_id)}
                  />
                ))}
              </div>
            ))}

            {groups.length === 0 && live && (
              <p className="px-3 pt-2 text-[12px] text-dim">No finished runs yet.</p>
            )}
          </div>
        )}
      </div>

      {/* right-edge drag handle — resize the drawer width */}
      <div
        onMouseDown={startDrag}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-line-2/60"
        title="Drag to resize"
      />
    </aside>
  );
}

function Row({
  run,
  active,
  onClick,
}: {
  run: HistoryRun;
  active: boolean;
  onClick: () => void;
}) {
  const done = run.status === "done";
  const title = runTitle(run);
  const when = fmtDate(run.completed_at || run.archived_at || run.started_at);
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ${
        active ? SEL : "hover:bg-panel-2/60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-chalk">{title}</div>
        {when && <div className="mt-0.5 text-[11px] text-mist">{when}</div>}
      </div>
      <Slot>
        {done ? (
          <span className="text-mint">
            <Icon name="check" size={14} />
          </span>
        ) : null}
      </Slot>
    </button>
  );
}
