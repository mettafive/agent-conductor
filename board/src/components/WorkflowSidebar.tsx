import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { WorkflowEntry } from "../lib/useBoardState";
import type { BoardStep, HistoryRun, Snapshot } from "../lib/types";
import { useNow } from "../lib/useNow";
import { buildModel } from "../lib/merge";
import { iterationColumn } from "../lib/loop";
import { clockSince } from "../lib/view";
import { fmtDurCompact } from "../lib/format";
import { Led } from "./Led";
import { Icon } from "./Icon";

const SEL = "bg-line-2/40"; // manually-selected row — a neutral surface lift, never colour
// Live-follow row — a mint accent + inset ring, clearly DIFFERENT from a manual selection,
// so "I'm auto-following the agent here" never reads as "a tab is stuck selected".
const FOLLOW = "bg-mint/10 ring-1 ring-inset ring-mint/30";

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

  // §7: improvement runs silently — only structural changes (needing approval)
  // appear in the tree.
  const improve = model.steps.filter((s) => s.phase === "improve" && s.improve?.structural === true);
  const workflow = model.steps.filter((s) => s.phase !== "improve");

  const renderStep = (s: BoardStep) => {
    const on = activeStep === s.id || (!!activeStep && activeStep.startsWith(`${s.id}::`));
    const label = s.phase === "improve" ? s.improve?.title ?? s.id.replace("_improve::", "") : s.id;
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
          <SectionRule text="Awaiting approval" />
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
  activeStep,
  following,
  onSelectStep,
  viewingSnap,
}: Props) {
  const now = useNow(1000);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => onResize(Math.max(248, Math.min(600, ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const statusOf = (name: string) => workflows[name]?.snap.status as LiveStatus | null;
  const liveStatus = activeWf ? statusOf(activeWf) : null;
  const liveModel = activeWf ? buildModel(workflows[activeWf].snap) : null;
  const others = order.filter((n) => n !== activeWf);

  const historyGroups = order
    .map((name) => {
      const status = statusOf(name);
      const isRunning = status?.status === "running";
      const runs = (workflows[name]?.history ?? []).filter(
        (h) => !(isRunning && h.run_id === status?.run_id),
      );
      return { name, runs };
    })
    .filter((g) => g.runs.length > 0);

  const overallStatus = liveStatus?.status ?? "idle";
  const elapsed = overallStatus === "running" ? clockSince(liveStatus?.started_at, now) : null;

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-panel/60"
    >
      <div className="flex-1 overflow-y-auto board-scroll px-4 py-4">
        {activeWf && liveModel ? (
          <>
            {/* active workflow — name + status · elapsed */}
            <button onClick={() => onPickWorkflow(activeWf)} className="block w-full px-2 text-left">
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

            {/* progress tree */}
            <div className="mt-4">
              {selectedRun === null && (
                <StepTree snap={workflows[activeWf].snap} activeStep={activeStep} following={following} onSelectStep={onSelectStep} />
              )}
            </div>

            {/* other workflows — compact switcher, only when there's more than one */}
            {others.length > 0 && (
              <div className="mt-5">
                <SectionRule text="Workflows" />
                <div className="space-y-0.5">
                  {others.map((name) => {
                    const st = statusOf(name)?.status ?? "idle";
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
                    const label = r.run_name || fmtDate(r.completed_at || r.archived_at || r.started_at);
                    const dur = fmtDurCompact(r.started_at, r.completed_at);
                    return (
                      <div key={r.run_id}>
                        <button
                          onClick={() => onPickRun(name, r.run_id)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors duration-150 ${
                            active ? SEL : "hover:bg-panel-2/60"
                          }`}
                        >
                          <Slot>
                            <span className={failed ? "text-rose" : "text-mist"}>
                              <Icon name={failed ? "cross" : "check"} size={13} />
                            </span>
                          </Slot>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-mist">{label}</span>
                          {dur && <span className="shrink-0 text-[11px] tabular-nums text-dim">{dur}</span>}
                        </button>
                        {active && viewingSnap && (
                          <div className="ml-3 mt-0.5 pl-2">
                            <StepTree snap={viewingSnap} activeStep={activeStep} onSelectStep={onSelectStep} />
                            {/* per-run summary — selecting nothing shows this run's SummaryView */}
                            <button
                              onClick={() => onSelectStep?.(null)}
                              className={`mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] transition-colors duration-150 ${
                                activeStep == null ? SEL : "hover:bg-panel-2/60"
                              }`}
                            >
                              <Slot>
                                <span className="text-mist">
                                  <Icon name="check" size={12} />
                                </span>
                              </Slot>
                              <span className="min-w-0 flex-1 text-mist">Run summary</span>
                            </button>
                          </div>
                        )}
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
        className="absolute inset-y-0 -right-1 w-2 cursor-col-resize"
        title="Drag to resize"
      />
    </aside>
  );
}
