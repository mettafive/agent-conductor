import { useState } from "react";
import type { HistoryRun } from "../lib/types";
import type { WorkflowEntry } from "../lib/useBoardState";
import { useNow } from "../lib/useNow";
import { buildModel } from "../lib/merge";
import { iterationColumn } from "../lib/loop";
import { AnimatedHeart } from "./AnimatedHeart";

const TREE_GLYPH: Record<string, string> = {
  done: "✅",
  failed: "❌",
  gate: "⏳",
  running: "🔄",
  pending: "·",
};

/** Clickable step + loop-iteration tree — the navigation for the main area. */
function StepTree({
  snap,
  activeStep,
  onSelectStep,
}: {
  snap: WorkflowEntry["snap"];
  activeStep?: string | null;
  onSelectStep?: (id: string | null) => void;
}) {
  const model = buildModel(snap);
  if (!model.steps.length) return null;
  const improve = model.steps.filter((s) => s.phase === "improve");
  const workflow = model.steps.filter((s) => s.phase !== "improve");

  const renderStep = (s: (typeof model.steps)[number]) => {
        // a step is "on" when it's the selection, or when an iteration of this
        // loop is selected ("loopId::item") so the parent stays highlighted too
        const on = activeStep === s.id || (!!activeStep && activeStep.startsWith(`${s.id}::`));
        const label = s.phase === "improve" ? s.improve?.title ?? s.id.replace("_improve::", "") : s.id;
        return (
          <div key={s.id}>
            <button
              onClick={() => onSelectStep?.(s.id)}
              className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[10px] transition-colors ${
                on ? "bg-iris/15" : "hover:bg-panel/60"
              }`}
            >
              <span className="w-3 shrink-0 text-center">{TREE_GLYPH[s.column] ?? "·"}</span>
              <span
                title={label}
                className={`min-w-0 flex-1 truncate ${s.column === "running" ? "text-cyan" : on ? "text-chalk" : "text-mist-2"}`}
              >
                {label}
              </span>
              {s.isLoop && s.loop && (
                <span className="shrink-0 text-line-2">
                  {s.loop.completed}/{s.loop.total}
                </span>
              )}
            </button>
            {s.isLoop && s.loop && s.loop.iterations.length > 0 && (
              <div className="ml-3 space-y-0.5 border-l border-line/40 pl-2">
                {s.loop.iterations.map((it) => {
                  const c = iterationColumn(it);
                  const iterId = `${s.id}::${it.item}`;
                  const onIter = activeStep === iterId;
                  return (
                    <button
                      key={it.item}
                      onClick={() => onSelectStep?.(iterId)}
                      title={it.item}
                      className={`flex w-full items-center gap-1.5 rounded px-1 py-px text-left font-mono text-[9.5px] transition-colors ${
                        onIter ? "bg-iris/15" : "hover:bg-panel/60"
                      }`}
                    >
                      <span className="w-3 shrink-0 text-center">{TREE_GLYPH[c] ?? "·"}</span>
                      <span
                        className={`min-w-0 flex-1 truncate ${c === "running" ? "text-cyan" : onIter ? "text-chalk" : "text-mist"}`}
                      >
                        {it.item}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
  };

  const sectionLabel = (text: string) => (
    <div className="mt-1.5 mb-0.5 flex items-center gap-1.5 px-1">
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-line-2">
        {text}
      </span>
      <span className="h-px flex-1 bg-line/50" />
    </div>
  );

  return (
    <div className="ml-2 mt-1 space-y-0.5 border-l border-line/60 pl-2">
      {improve.length > 0 && (
        <>
          {sectionLabel("Improvement")}
          {improve.map(renderStep)}
          {sectionLabel("Workflow")}
        </>
      )}
      {workflow.map(renderStep)}
    </div>
  );
}

interface LiveStatus {
  status?: string;
  started_at?: string;
  current_step?: string;
  run_id?: string;
  steps?: Record<string, { status?: string; heartbeat?: Array<{ at?: string }> }>;
}

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

function lastBeatOf(status: LiveStatus | null): string | undefined {
  let last: string | undefined;
  for (const st of Object.values(status?.steps ?? {})) {
    const hb = st?.heartbeat;
    if (!Array.isArray(hb)) continue;
    for (const h of hb) if (h?.at && (!last || h.at > last)) last = h.at;
  }
  return last;
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
  activeStep?: string | null;
  onSelectStep?: (id: string | null) => void;
  /** snapshot of the currently-viewed past run, so its tree is navigable too */
  viewingSnap?: WorkflowEntry["snap"] | null;
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
  activeStep,
  onSelectStep,
  viewingSnap,
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
    const move = (ev: PointerEvent) => onResize(Math.max(220, Math.min(320, ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const statusOf = (name: string) => workflows[name]?.snap.status as LiveStatus | null;
  const running = order.filter((n) => statusOf(n)?.status === "running");

  // every workflow that has at least one past run to browse
  const historyGroups = order
    .map((name) => {
      const status = statusOf(name);
      const isRunning = status?.status === "running";
      // a running workflow's in-flight run is shown in RUNNING, not history
      const runs = (workflows[name]?.history ?? []).filter(
        (h) => !(isRunning && h.run_id === status?.run_id),
      );
      return { name, runs };
    })
    .filter((g) => g.runs.length > 0);

  return (
    <aside
      style={{ width }}
      className="relative flex h-screen shrink-0 flex-col border-r border-line bg-ink-2/60 backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <img src="./conductor.svg" alt="" className="h-5 w-5 opacity-90" />
        <span className="font-mono text-xs font-medium tracking-wide text-chalk">
          conductor
        </span>
        <span className="ml-auto font-mono text-[11px] text-mist">{order.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ---- RUNNING ---- */}
        <div className="px-3 pt-3.5">
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <span className="h-2 w-2 rounded-full bg-mint shadow-[0_0_6px] shadow-mint/60" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-mint">
              Running
            </span>
            <span className="ml-auto font-mono text-[10px] text-mist">{running.length}</span>
          </div>

          {running.length === 0 ? (
            <p className="px-1 pb-1 pt-0.5 font-mono text-[11px] text-line-2">
              No active workflows.
            </p>
          ) : (
            <div className="space-y-1.5">
              {running.map((name) => {
                const status = statusOf(name);
                // weighted units (steps + loop sub-steps) — consistent with the header
                const wm = buildModel(workflows[name].snap);
                const done = wm.unitsDone;
                const total = wm.unitsTotal;
                const active = activeWf === name && selectedRun === null;
                return (
                  <div key={name}>
                  <button
                    onClick={() => onPickWorkflow(name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onPin?.(name);
                    }}
                    title="Click to open · right-click to pin as a tab"
                    className={`block w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "border-iris/40 bg-iris/10"
                        : "border-line bg-panel/50 hover:border-line-2 hover:bg-panel"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-chalk">
                        {name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-mist">
                        {done}/{total}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <AnimatedHeart lastBeatIso={lastBeatOf(status)} size={12} />
                      <span className="font-mono text-[10.5px] tabular-nums text-mist-2">
                        {liveElapsed(status?.started_at, now)}
                      </span>
                      {status?.current_step && (
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-cyan">
                          {status.current_step}
                        </span>
                      )}
                    </div>
                  </button>
                  {active && workflows[name]?.snap && (
                    <StepTree
                      snap={workflows[name].snap}
                      activeStep={activeStep}
                      onSelectStep={onSelectStep}
                    />
                  )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- HISTORY ---- */}
        <div className="mt-4 px-3">
          <div className="flex items-center gap-2 px-1 pb-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">
              History
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          {historyGroups.length === 0 ? (
            <p className="px-1 pt-1 font-mono text-[11px] text-line-2">No past runs yet.</p>
          ) : (
            <div className="space-y-0.5 pt-1">
              {historyGroups.map(({ name, runs }) => {
                const open = !collapsed.has(name);
                return (
                  <div key={name}>
                    <button
                      onClick={() => toggle(name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onPin?.(name);
                      }}
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-panel/60"
                    >
                      <span className="font-mono text-[10px] text-mist">{open ? "▾" : "▸"}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mist-2">
                        {name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-line-2">
                        {runs.length} run{runs.length === 1 ? "" : "s"}
                      </span>
                    </button>

                    {open && (
                      <div className="ml-2.5 border-l border-line/60 pl-1.5">
                        {runs.map((r: HistoryRun) => {
                          const active = activeWf === name && selectedRun === r.run_id;
                          const failed = r.status === "failed";
                          return (
                            <div key={r.run_id}>
                              <button
                                onClick={() => onPickRun(name, r.run_id)}
                                className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
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
                              {/* selected past run → its step/iteration tree, fully navigable */}
                              {active && viewingSnap && (
                                <StepTree
                                  snap={viewingSnap}
                                  activeStep={activeStep}
                                  onSelectStep={onSelectStep}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
