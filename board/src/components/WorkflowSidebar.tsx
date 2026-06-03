import { useState } from "react";
import type { HistoryRun } from "../lib/types";
import type { WorkflowEntry } from "../lib/useBoardState";
import { useNow } from "../lib/useNow";

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

function fmtDur(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function liveElapsed(start: string | undefined, now: number): string {
  if (!start) return "";
  const a = new Date(start).getTime();
  if (Number.isNaN(a)) return "";
  const s = Math.max(0, Math.floor((now - a) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

interface Props {
  workflows: Record<string, WorkflowEntry>;
  order: string[];
  activeWf: string | null;
  selectedRun: string | null;
  onPickWorkflow: (name: string) => void;
  onPickRun: (wf: string, runId: string) => void;
  onPin?: (name: string) => void;
  width: number;
  onResize: (w: number) => void;
}

export function WorkflowSidebar({
  workflows,
  order,
  activeWf,
  selectedRun,
  onPickWorkflow,
  onPickRun,
  onPin,
  width,
  onResize,
}: Props) {
  const now = useNow(1000);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (n: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) =>
      onResize(Math.max(200, Math.min(340, ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      style={{ width }}
      className="relative flex h-screen shrink-0 flex-col border-r border-line bg-ink-2/60 backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <span className="font-mono text-xs uppercase tracking-wide text-mist">
          Workflows
        </span>
        <span className="ml-auto font-mono text-[11px] text-mist">{order.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {order.length === 0 && (
          <p className="px-4 pt-3 font-mono text-[11px] leading-relaxed text-line-2">
            No workflows yet. They appear when an agent writes a conductor + status
            file under .conductor/.
          </p>
        )}

        {order.map((name) => {
          const entry = workflows[name];
          const status = entry?.snap.status as
            | { status?: string; started_at?: string; steps?: Record<string, { status?: string }>; run_id?: string }
            | null;
          const open = !collapsed.has(name);
          const isActiveWf = activeWf === name;
          const st = status?.status;
          const steps = status?.steps ?? {};
          const total = Object.keys(steps).length;
          const done = Object.values(steps).filter((s) => s?.status === "done").length;
          const runs = (entry?.history ?? []).filter(
            (h) => h.run_id !== status?.run_id,
          );

          return (
            <div key={name} className="mb-1">
              <button
                onClick={() => toggle(name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onPin?.(name);
                }}
                title="Right-click to pin as a tab"
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
              >
                <span className="font-mono text-[10px] text-mist">{open ? "▼" : "▸"}</span>
                <span className="flex-1 truncate font-mono text-xs font-medium text-chalk">
                  {name}
                </span>
                {st && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      st === "running"
                        ? "bg-cyan animate-pulse"
                        : st === "failed"
                          ? "bg-rose"
                          : st === "done"
                            ? "bg-mint"
                            : "bg-line-2"
                    }`}
                  />
                )}
              </button>

              {open && (
                <div className="ml-2 space-y-0.5 border-l border-line/60 pl-2">
                  {/* current / live run */}
                  {total > 0 && (
                    <button
                      onClick={() => onPickWorkflow(name)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        isActiveWf && selectedRun === null
                          ? "bg-iris/15"
                          : "hover:bg-panel"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          st === "running" ? "bg-mint animate-pulse" : st === "failed" ? "bg-rose" : "bg-mint"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[10.5px] text-chalk">
                          {st === "running" ? "Running" : st === "failed" ? "Failed" : "Done"}
                          {st === "running" && (
                            <span className="ml-1.5 text-mist">
                              {liveElapsed(status?.started_at, now)}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-mist">
                        {done}/{total}
                      </span>
                    </button>
                  )}

                  {/* past runs */}
                  {runs.map((r: HistoryRun) => {
                    const active = isActiveWf && selectedRun === r.run_id;
                    const failed = r.status === "failed";
                    return (
                      <button
                        key={r.run_id}
                        onClick={() => onPickRun(name, r.run_id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                          active ? "bg-iris/15" : "hover:bg-panel"
                        }`}
                      >
                        <span className="shrink-0 text-[10px]">{failed ? "❌" : "✅"}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-mist-2">
                          {fmtTime(r.completed_at || r.archived_at || r.started_at)}
                        </span>
                        <span className="shrink-0 font-mono text-[9px] text-line-2">
                          {fmtDur(r.started_at, r.completed_at)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* drag-to-resize handle */}
      <div
        onPointerDown={startDrag}
        className="absolute inset-y-0 -right-1 w-2 cursor-col-resize"
        title="Drag to resize"
      />
    </aside>
  );
}
