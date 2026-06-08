import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { WorkflowEntry } from "../lib/useBoardState";
import type { BoardStep, HistoryRun, Snapshot } from "../lib/types";
import { useNow } from "../lib/useNow";
import { buildModel } from "../lib/merge";
import { iterationColumn } from "../lib/loop";
import { clockSince, SUMMARY_SEL } from "../lib/view";
import { fmtDurCompact } from "../lib/format";
import { Led } from "./Led";
import { Icon } from "./Icon";

const SEL = "bg-line-2/40"; // manually-selected row — a neutral surface lift, never colour
// Live-follow row — a slightly stronger neutral lift; the small mint "● live" marker (status
// colour, used sparingly) is what says "I'm auto-following the agent here", not a tinted surface.
const FOLLOW = "bg-line-2/70";

/** Fixed-width, vertically-centred leading slot so every label lines up. */
function Slot({ children }: { children: React.ReactNode }) {
  return <span className="flex h-[18px] w-3.5 shrink-0 items-center justify-center">{children}</span>;
}

function textFor(col: string, on: boolean): string {
  if (col === "running" || col === "gate") return "text-chalk";
  if (on) return "text-chalk";
  if (col === "pending") return "text-dim";
  return "text-mist"; // done / other
}

/**
 * The clickable step + loop-iteration tree — the only navigator for the main
 * area. Status LEDs carry every bit of state; no badges, counts or fractions.
 * Iteration names are spelled out in full, never truncated.
 */
function StepTree({
  snap,
  activeStep,
  following,
  onSelectStep,
}: {
  snap: Snapshot;
  activeStep?: string | null;
  /** true when the main view is auto-following live (no manual selection) — render the
   *  highlighted row as "following the agent", not as a clicked selection. */
  following?: boolean;
  onSelectStep?: (id: string | null) => void;
}) {
  const model = buildModel(snap);
  // Loops are open by default; collapsing is independent per loop, so several
  // can be open at once. `collapsed` holds the ones the user has folded shut.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (!model.steps.length) return null;

  // Phase-0 improvement runs silently unless a structural proposal is present.
  const improve = model.steps.filter((s) => s.phase === "improve" && s.improve?.structural === true);
  const workflow = model.steps.filter((s) => s.phase !== "improve");

  const renderStep = (s: BoardStep) => {
    const on = activeStep === s.id || (!!activeStep && activeStep.startsWith(`${s.id}::`));
    const label = s.phase === "improve" ? s.improve?.title ?? s.title : s.title;
    const collapsible = s.isLoop && !!s.loop && s.loop.iterations.length > 0;
    const open = collapsible && !collapsed.has(s.id);
    return (
      <div key={s.id}>
        <div
          className={`flex items-stretch rounded transition-colors duration-150 ${
            on ? (following ? FOLLOW : SEL) : "hover:bg-panel-2/60"
          }`}
        >
          {collapsible ? (
            <button
              onClick={() => toggle(s.id)}
              aria-label={open ? "Collapse" : "Expand"}
              className="grid w-5 shrink-0 place-items-center text-dim transition-colors hover:text-mist"
            >
              <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="grid place-items-center">
                <Icon name="chevronRight" size={12} />
              </motion.span>
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            onClick={() => onSelectStep?.(s.id)}
            className="flex min-w-0 flex-1 items-start gap-2 py-1 pr-2 text-left text-[13px] leading-[18px]"
          >
            <Slot>
              <Led state={s.column} />
            </Slot>
            <span className={`min-w-0 flex-1 transition-colors duration-300 ${textFor(s.column, on)}`}>
              {label}
            </span>
            {following && on && (
              <span className="ml-auto flex shrink-0 items-center gap-1 self-center pr-0.5 text-[10px] font-medium uppercase tracking-wide text-mint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
                live
              </span>
            )}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {collapsible && open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="ml-5 space-y-0.5 pt-0.5">
                {s.loop!.iterations.map((it) => {
                  const c = iterationColumn(it);
                  const iterId = `${s.id}::${it.item}`;
                  const onIter = activeStep === iterId;
                  return (
                    <button
                      key={it.item}
                      onClick={() => onSelectStep?.(iterId)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-0.5 text-left text-[12.5px] leading-[18px] transition-colors duration-150 ${
                        onIter ? (following ? FOLLOW : SEL) : "hover:bg-panel-2/60"
                      }`}
                    >
                      <Slot>
                        <Led state={c} />
                      </Slot>
                      <span className={`min-w-0 flex-1 transition-colors duration-300 ${textFor(c, onIter)}`}>
                        {it.item}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      {improve.length > 0 && (
        <>
          <SectionRule text="Proposed changes" />
          {improve.map(renderStep)}
          <div className="h-1.5" />
        </>
      )}
      {workflow.map(renderStep)}
    </div>
  );
}

function SectionRule({ text }: { text: string }) {
  return (
    <div className="mb-1 mt-1 flex items-center gap-2 px-2">
      <span className="text-[12px] text-dim">{text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

interface LiveStatus {
  status?: string;
  started_at?: string;
  run_id?: string;
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

const STATUS_WORD: Record<string, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  idle: "Idle",
};

interface Props {
  workflows: Record<string, WorkflowEntry>;
  order: string[];
  activeWf: string | null;
  selectedRun: string | null;
  onPickWorkflow: (name: string) => void;
  onPickRun: (wf: string, runId: string) => void;
  width: number;
  onResize: (w: number) => void;
  /** Collapse the drawer — the toggle lives at the drawer's own top-right, not in the top bar. */
  onCollapse?: () => void;
  /** True while the user is dragging the resize handle, so the parent can suppress the
   *  open/close width animation (which would otherwise fight the live drag). */
  onResizeActive?: (active: boolean) => void;
  activeStep?: string | null;
  following?: boolean;
  onSelectStep?: (id: string | null) => void;
  viewingSnap?: Snapshot | null;
}

export function WorkflowSidebar({
  workflows,
  order,
  activeWf,
  selectedRun,
  onPickWorkflow,
  onPickRun,
  width,
  onResize,
  onCollapse,
  onResizeActive,
  activeStep,
  following,
  onSelectStep,
  viewingSnap,
}: Props) {
  const now = useNow(1000);

  // Finished runs expand/collapse INDEPENDENTLY (a Set — several can be open at once, stacked
  // under each other). Each open run lazy-loads its own snapshot so its branch tree can render.
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const [runSnaps, setRunSnaps] = useState<Record<string, Snapshot>>({});
  const runKey = (wf: string, runId: string) => `${wf} ${runId}`;
  const toggleRun = (wf: string, runId: string) =>
    setOpenRuns((prev) => {
      const next = new Set(prev);
      const k = runKey(wf, runId);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const openRun = (wf: string, runId: string) =>
    setOpenRuns((prev) => (prev.has(runKey(wf, runId)) ? prev : new Set(prev).add(runKey(wf, runId))));
  useEffect(() => {
    for (const key of openRuns) {
      if (runSnaps[key]) continue;
      const sep = key.indexOf(" ");
      const wf = key.slice(0, sep);
      const runId = key.slice(sep + 1);
      fetch(`/api/workflow/${encodeURIComponent(wf)}/history/${encodeURIComponent(runId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((rec) => rec && setRunSnaps((prev) => ({ ...prev, [key]: rec.snapshot })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRuns]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    onResizeActive?.(true);
    const move = (ev: PointerEvent) => onResize(Math.max(248, Math.min(600, ev.clientX)));
    const up = () => {
      onResizeActive?.(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const statusOf = (name: string) => workflows[name]?.snap.status as LiveStatus | null;
  // The DERIVED status: buildModel already treats a run as "done" when every workflow-phase step is
  // done — even if the agent forgot to flip the top-level status:"running". Use that everywhere the
  // sidebar shows a workflow's state, so a finished run never reads "Running" with a climbing timer.
  const derivedOf = (name: string) => (workflows[name] ? buildModel(workflows[name].snap) : null);
  const liveStatus = activeWf ? statusOf(activeWf) : null;
  const liveModel = activeWf ? buildModel(workflows[activeWf].snap) : null;
  const others = order.filter((n) => n !== activeWf);

  const historyGroups = order
    .map((name) => {
      const status = statusOf(name);
      // a run is only "live" (and thus excluded from the finished list) while it's genuinely running
      // — once every step is done the derived status settles, so the run can join the history.
      const isRunning = derivedOf(name)?.overallStatus === "running";
      const runs = (workflows[name]?.history ?? []).filter(
        (h) => !(isRunning && h.run_id === status?.run_id),
      );
      return { name, runs };
    })
    .filter((g) => g.runs.length > 0);

  const overallStatus = liveModel?.overallStatus ?? "idle";
  const settled = overallStatus === "done" || overallStatus === "failed";
  // While running the timer ticks to `now`; once settled it FREEZES at the run's end (the last beat,
  // surfaced by merge.ts as endedAt) instead of climbing forever. Idle shows nothing.
  const elapsed = settled
    ? clockSince(liveModel?.startedAt, now, liveModel?.endedAt)
    : overallStatus === "running"
      ? clockSince(liveStatus?.started_at, now)
      : null;

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-panel/60"
    >
      {/* Drawer collapse — top-right, the conventional place for a drawer's own toggle. */}
      {onCollapse && (
        <div className="flex shrink-0 items-center justify-end px-2 pt-2">
          <button
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="grid h-7 w-7 place-items-center rounded-md text-mist transition-colors hover:bg-panel-2 hover:text-chalk"
          >
            <Icon name="arrowLeft" size={16} />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto board-scroll px-4 pb-4 pt-1">
        {activeWf && liveModel ? (
          <>
            {/* active workflow — name + status · elapsed (clickable: jump to live) */}
            <button
              onClick={() => onPickWorkflow(activeWf)}
              title="Back to the live run"
              className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel-2/70"
            >
              <div className="truncate text-[15px] font-semibold text-chalk">{activeWf}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-mist">
                <span>{STATUS_WORD[overallStatus] ?? overallStatus}</span>
                {elapsed && (
                  <>
                    <span className="text-dim">·</span>
                    <span className="tabular-nums">{elapsed}</span>
                  </>
                )}
              </div>
            </button>

            {/* progress tree — ALWAYS shown. Viewing a finished run expands that run's branches
                inline below (in "Finished runs"); it must not replace the live navigator. While a
                finished run is selected the live tree goes passive (no highlight); clicking a live
                step snaps back to the live run. */}
            <div className="mt-4">
              <StepTree
                snap={workflows[activeWf].snap}
                activeStep={selectedRun === null ? activeStep : null}
                following={selectedRun === null ? following : false}
                onSelectStep={
                  selectedRun === null
                    ? onSelectStep
                    : (id) => {
                        onPickWorkflow(activeWf); // leave the finished-run view, back to live
                        onSelectStep?.(id);
                      }
                }
              />
              {/* Run summary — its own nav item for the LIVE run too, not only past runs. */}
              <button
                onClick={() => {
                  if (selectedRun !== null) onPickWorkflow(activeWf); // snap back to live first
                  onSelectStep?.(SUMMARY_SEL);
                }}
                className={`mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] transition-colors duration-150 ${
                  selectedRun === null && activeStep === SUMMARY_SEL ? SEL : "hover:bg-panel-2/60"
                }`}
              >
                <Slot>
                  <span className="text-mist">
                    <Icon name="check" size={13} />
                  </span>
                </Slot>
                <span className="min-w-0 flex-1 text-mist">Run summary</span>
              </button>
            </div>

            {/* other workflows — compact switcher, only when there's more than one */}
            {others.length > 0 && (
              <div className="mt-5">
                <SectionRule text="Workflows" />
                <div className="space-y-0.5">
                  {others.map((name) => {
                    const st = derivedOf(name)?.overallStatus ?? "idle";
                    return (
                      <button
                        key={name}
                        onClick={() => onPickWorkflow(name)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] transition-colors duration-150 hover:bg-panel-2/60"
                      >
                        <Slot>
                          <Led state={st} />
                        </Slot>
                        <span className="min-w-0 flex-1 truncate text-mist">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="px-1 text-[13px] text-dim">No active workflow.</p>
        )}

        {/* finished runs */}
        <div className="mt-6">
          <SectionRule text="Finished runs" />
          {historyGroups.length === 0 ? (
            <p className="px-1 pt-0.5 text-[12px] text-dim">No finished runs yet.</p>
          ) : (
            <div className="space-y-0.5 pt-0.5">
              {historyGroups.map(({ name, runs }) => (
                <div key={name}>
                  {historyGroups.length > 1 && (
                    <div className="px-1 pb-0.5 pt-1 text-[11px] text-dim">{name}</div>
                  )}
                  {runs.map((r: HistoryRun) => {
                    const active = activeWf === name && selectedRun === r.run_id;
                    const failed = r.status === "failed";
                    const label =
                      r.run_name?.trim() ||
                      fmtDate(r.completed_at || r.archived_at || r.started_at) ||
                      r.run_id ||
                      "Untitled run";
                    const dur = fmtDurCompact(r.started_at, r.completed_at);
                    // Each finished run opens/closes on its own chevron (a Set drives it), so
                    // several can stay open stacked under each other. The active (selected) run
                    // reuses the already-fetched viewingSnap; others lazy-load into runSnaps.
                    const isOpen = openRuns.has(runKey(name, r.run_id));
                    const snap = active && viewingSnap ? viewingSnap : runSnaps[runKey(name, r.run_id)];
                    return (
                      <div key={r.run_id}>
                        <div
                          className={`flex items-stretch rounded transition-colors duration-150 ${
                            active ? SEL : "hover:bg-panel-2/60"
                          }`}
                        >
                          <button
                            onClick={() => toggleRun(name, r.run_id)}
                            aria-label={isOpen ? "Collapse run" : "Expand run"}
                            className="grid w-5 shrink-0 place-items-center text-dim transition-colors hover:text-mist"
                          >
                            <motion.span
                              animate={{ rotate: isOpen ? 90 : 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              className="grid place-items-center"
                            >
                              <Icon name="chevronRight" size={12} />
                            </motion.span>
                          </button>
                          <button
                            onClick={() => {
                              onPickRun(name, r.run_id);
                              openRun(name, r.run_id);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left"
                          >
                            <Slot>
                              <span className={failed ? "text-rose" : "text-mist"}>
                                <Icon name={failed ? "cross" : "check"} size={13} />
                              </span>
                            </Slot>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-mist">{label}</span>
                            {dur && <span className="shrink-0 text-[11px] tabular-nums text-dim">{dur}</span>}
                          </button>
                        </div>

                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: "easeOut" }}
                              className="overflow-hidden"
                            >
                              <div className="ml-5 mt-0.5 space-y-0.5 border-l border-line/60 pl-2">
                                {snap ? (
                                  <>
                                    {/* per-run summary nav item */}
                                    <button
                                      onClick={() => onPickRun(name, r.run_id)}
                                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] transition-colors duration-150 ${
                                        active && activeStep === SUMMARY_SEL ? SEL : "hover:bg-panel-2/60"
                                      }`}
                                    >
                                      <Slot>
                                        <span className="text-mist">
                                          <Icon name="check" size={12} />
                                        </span>
                                      </Slot>
                                      <span className="min-w-0 flex-1 text-mist">Run summary</span>
                                    </button>
                                    <StepTree
                                      snap={snap}
                                      activeStep={active ? activeStep : null}
                                      onSelectStep={(id) => {
                                        if (!active) onPickRun(name, r.run_id);
                                        onSelectStep?.(id);
                                      }}
                                    />
                                  </>
                                ) : (
                                  <div className="px-2 py-1 font-mono text-[11px] text-dim">loading…</div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        onPointerDown={startDrag}
        className="absolute inset-y-0 right-0 w-2 cursor-col-resize"
        title="Drag to resize"
      />
    </aside>
  );
}
