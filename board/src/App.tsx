import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EMPTY, useBoardState } from "./lib/useBoardState";
import type { WorkflowEntry } from "./lib/useBoardState";
import { buildModel } from "./lib/merge";
import {
  isChimesMuted,
  isTicksMuted,
  playFailure,
  playSuccess,
  playTick,
  setChimesMuted,
  setTicksMuted,
} from "./lib/sounds";
import { lastBeatIso, useHeartbeatStream } from "./lib/heartbeatStream";
import { relativeTime } from "./lib/heartbeat";
import { useNow } from "./lib/useNow";
import { activeIterationItem, clockSince, followStep, resolveActiveUnit } from "./lib/view";
import { TopBar } from "./components/TopBar";
import { ContextHeader } from "./components/ContextHeader";
import { ActiveCard } from "./components/ActiveCard";
import { StepDetail } from "./components/StepDetail";
import { SummaryView } from "./components/SummaryView";
import { LoopOverview } from "./components/LoopOverview";
import { IterationKanban } from "./components/IterationKanban";
import { ImprovementCard } from "./components/ImprovementCard";
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import { Settings } from "./components/Settings";
import { HeartbeatMonitor, loadMonitorMode } from "./components/HeartbeatMonitor";
import type { MonitorMode } from "./components/HeartbeatMonitor";
import { loadHeartbeatInterval, saveHeartbeatInterval, stallSecondsFor } from "./lib/settings";
import type { BoardModel, BoardStep, RunRecord, Snapshot } from "./lib/types";

const params = new URLSearchParams(window.location.search);

function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem("cb-sidebar-open") !== "0";
  } catch {
    return true;
  }
}
function loadSidebarWidth(): number {
  try {
    const v = Number(localStorage.getItem("cb-sidebar-w"));
    if (v >= 248 && v <= 600) return v;
  } catch {
    /* ignore */
  }
  return 280;
}

export function App() {
  const { workflows, order, conn } = useBoardState();
  const [selectedWf, setSelectedWf] = useState<string | null>(params.get("wf"));
  const [selectedRun, setSelectedRun] = useState<string | null>(params.get("run"));
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [ticksOn, setTicksOn] = useState(!isTicksMuted());
  const [chimesOn, setChimesOn] = useState(!isChimesMuted());
  const [monitorMode, setMonitorMode] = useState<MonitorMode>(loadMonitorMode);
  const [heartbeatInterval, setHeartbeatInterval] = useState(loadHeartbeatInterval);
  const [selectedStep, setSelectedStep] = useState<string | null>(null); // null = auto-follow live
  const [showSettings, setShowSettings] = useState(false);
  const now = useNow(1000);

  // remember the sidebar's open/closed state and custom width across sessions
  useEffect(() => {
    try {
      localStorage.setItem("cb-sidebar-open", sidebarOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);
  useEffect(() => {
    saveHeartbeatInterval(heartbeatInterval);
  }, [heartbeatInterval]);
  useEffect(() => {
    try {
      localStorage.setItem("cb-sidebar-w", String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  const [summaryReady, setSummaryReady] = useState(false);

  // live heartbeat stream across every workflow — drives the monitor, the heart,
  // and the tick sound. Arrivals are seeded on load so nothing false-fires.
  const { beats, log, arrival } = useHeartbeatStream(workflows, order);
  const globalLastBeat = lastBeatIso(beats);

  useEffect(() => {
    if (arrival) playTick();
  }, [arrival]);

  // resolve the active workflow: explicit pick, else first running, else first
  const activeWf =
    (selectedWf && workflows[selectedWf] ? selectedWf : null) ??
    order.find((n) => statusOf(workflows[n]) === "running") ??
    order[0] ??
    null;

  const liveSnap: Snapshot = (activeWf && workflows[activeWf]?.snap) || EMPTY;
  const liveModel = buildModel(liveSnap);

  // completion chimes — fire on any workflow's status transition (never on load)
  const prevStatuses = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const name of order) {
      const cur = statusOf(workflows[name]);
      if (!cur) continue;
      const prev = prevStatuses.current[name];
      if (prev !== undefined && prev !== cur) {
        if (cur === "done") playSuccess();
        else if (cur === "failed") playFailure();
      }
      prevStatuses.current[name] = cur;
    }
  }, [workflows, order]);

  // keep the URL shareable
  useEffect(() => {
    const url = new URL(window.location.href);
    activeWf ? url.searchParams.set("wf", activeWf) : url.searchParams.delete("wf");
    selectedRun ? url.searchParams.set("run", selectedRun) : url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
  }, [activeWf, selectedRun]);

  // fetch a frozen past run for the active workflow
  useEffect(() => {
    if (selectedRun === null || !activeWf) {
      setRecord(null);
      return;
    }
    // Keep the current record on screen while the next one loads — swapping it
    // in only when it arrives avoids a blank "loading" flash between runs.
    let alive = true;
    fetch(`/api/workflow/${encodeURIComponent(activeWf)}/history/${encodeURIComponent(selectedRun)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rec: RunRecord | null) => alive && setRecord(rec))
      .catch(() => alive && setSelectedRun(null));
    return () => {
      alive = false;
    };
  }, [selectedRun, activeWf]);

  const pickWorkflow = (name: string) => {
    setSelectedWf(name);
    setSelectedRun(null);
    setSelectedStep(null);
  };
  const pickRun = (wf: string, runId: string) => {
    setSelectedWf(wf);
    setSelectedRun(runId);
    setSelectedStep(null);
  };
  const backToLive = () => {
    // Snap to the workflow that's actually LIVE (running), not whatever's selected — otherwise
    // "back to live" leaves you parked on a finished run while a different workflow is the live one.
    const running = order.find((n) => statusOf(workflows[n]) === "running");
    setSelectedWf(running ?? null);
    setSelectedRun(null);
    setSelectedStep(null);
    // drop DOM focus too, or the previously-clicked step row keeps its focus outline (looks "still selected")
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  };

  // ⌘, toggles settings; Esc closes settings, then returns to the live run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
        return;
      }
      if (e.key === "Escape") {
        if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
        } else if (selectedStep !== null || selectedRun !== null) {
          e.preventDefault();
          backToLive(); // drop any manual selection / past-run view and snap back to following the agent live
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, selectedStep, selectedRun]);

  // When a run finishes, hold on the last step for a beat before the summary
  // crossfades in — so the final card is seen, not snapped past.
  useEffect(() => {
    if (selectedRun !== null) return; // past runs show their summary immediately
    const st = liveModel.overallStatus;
    if (st === "done" || st === "failed") {
      // long enough that the final cards visibly settle at Done and rest there
      // before the summary crossfades in (the card move itself takes ~0.42s).
      const t = setTimeout(() => setSummaryReady(true), 1600);
      return () => clearTimeout(t);
    }
    setSummaryReady(false);
  }, [liveModel.overallStatus, liveModel.runId, selectedRun]);

  // human approval — write the decisions to status.json; the agent routes on them
  const applyApproval = async (
    stepId: string,
    decisions: { label: string; decision: "approved" | "rejected" }[],
  ) => {
    if (!activeWf) return { ok: false };
    try {
      const r = await fetch(`/api/workflow/${encodeURIComponent(activeWf)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: stepId, decisions }),
      });
      return { ok: r.ok };
    } catch {
      return { ok: false };
    }
  };

  const viewing = selectedRun !== null;
  const model: BoardModel | null = viewing ? (record ? buildModel(record.snapshot) : null) : liveModel;

  const liveStarted = !!(
    liveSnap.status &&
    typeof liveSnap.status === "object" &&
    Object.keys((liveSnap.status as { steps?: object }).steps ?? {}).length > 0
  );
  const showBoard = viewing ? !!record : liveStarted;

  // §6.1/§7: improvement runs silently. Only a STRUCTURAL change (add/remove/
  // reorder step) that still needs a human surfaces as a card.
  const structuralPending =
    model?.autoImprove && !viewing
      ? model.steps.find(
          (s) =>
            s.phase === "improve" &&
            s.improve?.structural === true &&
            s.column !== "done" &&
            !s.approvalState?.decided,
        )
      : undefined;

  // Auto-follow: with nothing selected on the live run, the main area tracks the
  // active step (Part 3) — the view follows the action, no clicking needed.
  const liveFollow = !viewing && selectedStep === null;
  const follow = liveFollow ? followStep(liveModel) : null;
  // When the agent is in a loop, lock onto the iteration it's working so the
  // live view shows that iteration's kanban with cards moving (follow the agent).
  const followItem = activeIterationItem(follow);
  const followInLoop = !!(follow?.isLoop && followItem);

  // Selected-step resolution (manual inspection / past runs). "loopId::item"
  // selects an iteration; "_improve::*" ids are NOT iterations.
  const iterSel =
    selectedStep && selectedStep.includes("::") && !selectedStep.startsWith("_improve::")
      ? selectedStep.split("::")
      : null;
  const activeStepId = iterSel
    ? iterSel[0]
    : selectedStep && model?.steps.some((s) => s.id === selectedStep)
      ? selectedStep
      : (model?.currentStep ?? null);
  const selectedStepObj = model?.steps.find((s) => s.id === activeStepId) ?? null;

  // What the sidebar highlights: the selection, or — when following live — the
  // exact iteration the agent is in (so you can see where it is at a glance).
  const liveHighlight = followInLoop ? `${follow!.id}::${followItem}` : activeStepId;

  const showSummary =
    (viewing || summaryReady) &&
    selectedStep === null &&
    !!model &&
    (model.overallStatus === "done" || model.overallStatus === "failed");

  const header = buildHeader({
    model,
    viewing,
    record,
    liveFollow,
    follow,
    iterSel,
    selectedStepObj,
    structuralPending,
    followItem,
    showSummary,
    now,
  });
  const showBackToLive = selectedStep !== null || selectedRun !== null;

  // motion key — changes whenever the rendered view changes, giving the crossfade.
  // Includes the live iteration so advancing to the next one crossfades, while
  // staying stable within an iteration so its cards animate in place.
  const viewKey = `${activeWf}:${selectedRun ?? "live"}:${
        showSummary
          ? "sum"
          : structuralPending && liveFollow
            ? `imp:${structuralPending.id}`
            : liveFollow
              ? `follow:${follow?.id ?? "none"}:${followItem ?? ""}`
              : (selectedStep ?? selectedStepObj?.id ?? "none")
      }`;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        workflow={activeWf ?? liveModel.workflow}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        showBackToLive={showBackToLive}
        onBackToLive={backToLive}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <WorkflowSidebar
            workflows={workflows}
            order={order}
            activeWf={activeWf}
            selectedRun={selectedRun}
            onPickWorkflow={pickWorkflow}
            onPickRun={pickRun}
            width={sidebarWidth}
            onResize={setSidebarWidth}
            activeStep={selectedStep ?? liveHighlight}
            following={liveFollow}
            onSelectStep={setSelectedStep}
            viewingSnap={viewing ? record?.snapshot : null}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {model?.demo && (
            <div className="flex items-center justify-center gap-2 border-b border-amber/25 bg-amber/10 px-5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber">
              Demo — simulated data
            </div>
          )}

          <ContextHeader label={header.label} timer={header.timer} timerPrefix={header.timerPrefix} />

          {model?.error && (
            <div className="px-5 pt-4">
              <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
                {model.error}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {viewing && !record ? (
              <div className="grid h-full place-items-center">
                <span className="font-mono text-xs text-mist">loading run…</span>
              </div>
            ) : showBoard && model ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={viewKey}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className={
                    liveFollow && !showSummary && !structuralPending && !followInLoop
                      ? "h-full"
                      : "board-scroll h-full overflow-y-auto"
                  }
                >
                  {showSummary ? (
                    <SummaryView model={model} />
                  ) : structuralPending && liveFollow ? (
                    <ImprovementCard step={structuralPending} onApprove={applyApproval} />
                  ) : liveFollow ? (
                    followInLoop ? (
                      <IterationKanban loopStep={follow!} item={followItem!} workflow={liveModel.workflow} notes={liveModel.developerNotes} />
                    ) : follow ? (
                      <ActiveCard step={follow} workflow={liveModel.workflow} notes={liveModel.developerNotes} />
                    ) : (
                      <Idle />
                    )
                  ) : (
                    <SelectedView
                      step={selectedStepObj}
                      iterSel={iterSel}
                      viewing={viewing}
                      onApprove={applyApproval}
                      onBackToOverview={(id) => setSelectedStep(id)}
                      onOpenIteration={(loopId, item) => setSelectedStep(`${loopId}::${item}`)}
                      workflow={viewing ? undefined : model.workflow}
                      notes={model.developerNotes}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            ) : (
              <WaitingState model={liveModel} statusPath={liveSnap.statusPath} lastBeat={globalLastBeat} now={now} />
            )}
          </div>

          {liveModel &&
            liveModel.overallStatus === "done" &&
            liveModel.nextUp &&
            (liveModel.nextUp.name || (liveModel.nextUp.remaining ?? 0) > 0) && (
              <div className="flex items-center justify-between gap-3 border-t border-line/70 bg-panel/40 px-4 py-1.5 backdrop-blur">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-mist">Up next</span>
                  <span className="truncate text-[12px] text-mist-2">{liveModel.nextUp.name ?? "next batch"}</span>
                  {(liveModel.nextUp.remaining ?? 0) > 0 && (
                    <span className="shrink-0 text-[11px] text-dim">· {liveModel.nextUp.remaining} more</span>
                  )}
                </div>
                <button
                  onClick={() => {
                    void fetch(`/api/workflow/${encodeURIComponent(liveModel.workflow)}/next`, { method: "POST" });
                  }}
                  title="Request the next batch"
                  className="shrink-0 rounded-md border border-mint/40 bg-mint/10 px-2.5 py-1 font-mono text-[11px] text-mint transition-colors hover:bg-mint/20 active:scale-[0.97]"
                >
                  Next →
                </button>
              </div>
            )}

          <HeartbeatMonitor
            beats={log}
            arrival={arrival}
            order={order}
            mode={monitorMode}
            onMode={setMonitorMode}
            lastBeatIso={globalLastBeat}
            conn={conn}
            stallSeconds={stallSecondsFor(heartbeatInterval)}
            done={liveModel.overallStatus === "done" || liveModel.overallStatus === "failed"}
          />
        </div>
      </div>

      <Settings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        ticksOn={ticksOn}
        chimesOn={chimesOn}
        onToggleTicks={() => {
          const next = !ticksOn;
          setTicksMuted(!next);
          setTicksOn(next);
        }}
        onToggleChimes={() => {
          const next = !chimesOn;
          setChimesMuted(!next);
          setChimesOn(next);
        }}
        workflow={activeWf ?? liveModel.workflow}
        knowledge={(model ?? liveModel).knowledge}
        runCount={(activeWf && workflows[activeWf]?.history.length) || 0}
        heartbeatInterval={heartbeatInterval}
        onSetHeartbeatInterval={setHeartbeatInterval}
      />
    </div>
  );
}

function statusOf(entry: WorkflowEntry | undefined): string | undefined {
  return (entry?.snap.status as { status?: string } | null)?.status;
}

/** The detail surface when a step/iteration is selected, or a past run browsed. */
function SelectedView({
  step,
  iterSel,
  viewing,
  onApprove,
  onBackToOverview,
  onOpenIteration,
  workflow,
  notes,
}: {
  step: BoardStep | null;
  iterSel: string[] | null;
  viewing: boolean;
  onApprove: (
    stepId: string,
    decisions: { label: string; decision: "approved" | "rejected" }[],
  ) => Promise<{ ok: boolean }>;
  onBackToOverview: (loopId: string) => void;
  onOpenIteration: (loopId: string, item: string) => void;
  workflow?: string;
  notes?: import("./lib/types").DeveloperNote[];
}) {
  if (!step) {
    return (
      <div className="grid h-full place-items-center">
        <span className="font-mono text-xs text-mist">select a step from the sidebar</span>
      </div>
    );
  }
  if (step.phase === "improve") {
    return <ImprovementCard step={step} onApprove={viewing ? undefined : onApprove} />;
  }
  if (iterSel && step.isLoop) {
    return (
      <IterationKanban
        loopStep={step}
        item={iterSel[1]}
        onBack={() => onBackToOverview(step.id)}
        workflow={workflow}
        notes={notes}
      />
    );
  }
  if (step.isLoop) {
    return <LoopOverview loopStep={step} onOpenIteration={(item) => onOpenIteration(step.id, item)} />;
  }
  return <StepDetail step={step} onApprove={viewing ? undefined : onApprove} workflow={workflow} notes={notes} />;
}

function Idle() {
  return (
    <div className="grid h-full place-items-center">
      <span className="font-mono text-xs text-mist">preparing…</span>
    </div>
  );
}

/** Build the contextual header's label + timer for whatever view is showing. */
function buildHeader({
  model,
  viewing,
  record,
  liveFollow,
  follow,
  iterSel,
  selectedStepObj,
  structuralPending,
  followItem,
  showSummary,
  now,
}: {
  model: BoardModel | null;
  viewing: boolean;
  record: RunRecord | null;
  liveFollow: boolean;
  follow: BoardStep | null;
  iterSel: string[] | null;
  selectedStepObj: BoardStep | null;
  structuralPending?: BoardStep;
  followItem?: string;
  showSummary: boolean;
  now: number;
}): { label: string; timer?: string | null; timerPrefix?: string } {
  const wf = model?.workflow ?? "workflow";

  if (viewing) {
    const runLabel = record?.run_name || fmtRunDate(record?.completed_at || record?.started_at) || wf;
    const where = selectedStepObj ? selectedStepObj.id : "summary";
    const dur = clockSince(record?.started_at ?? undefined, now, record?.completed_at ?? undefined);
    return {
      label: `${runLabel} · ${where}`,
      timer: dur,
      timerPrefix: dur ? (record?.status === "failed" ? "failed ·" : "completed ·") : undefined,
    };
  }

  if (structuralPending && liveFollow) {
    return { label: `improvement · ${structuralPending.improve?.title ?? structuralPending.id}` };
  }

  if (liveFollow) {
    if (showSummary) {
      const dur = clockSince(model?.startedAt, now, model?.endedAt);
      return {
        label: `${wf} — ${model?.overallStatus === "failed" ? "failed" : "complete"}`,
        timer: dur,
        timerPrefix: dur ? "ran" : undefined,
      };
    }
    if (follow && follow.isLoop && followItem) {
      const iters = follow.loop?.iterations ?? [];
      const pos = iters.findIndex((it) => it.item === followItem) + 1;
      const total = follow.loop?.total || iters.length;
      const count = pos > 0 && total > 0 ? ` · ${pos}/${total}` : "";
      return { label: `${follow.id} · ${followItem}${count}` };
    }
    if (follow) {
      const u = resolveActiveUnit(follow);
      return { label: u.title, timer: u.running ? clockSince(u.startedAt, now) : null };
    }
    return { label: wf };
  }

  // selected step (live)
  if (iterSel && selectedStepObj) {
    return { label: `${selectedStepObj.id} · ${iterSel[1]}` };
  }
  if (selectedStepObj) {
    const running = selectedStepObj.column === "running";
    const dur = clockSince(
      selectedStepObj.started_at,
      now,
      running ? undefined : selectedStepObj.completed_at,
    );
    return {
      label: selectedStepObj.id,
      timer: dur,
      timerPrefix: dur && !running ? "took" : undefined,
    };
  }
  return { label: wf };
}

function fmtRunDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function WaitingState({
  model,
  statusPath,
  lastBeat,
  now,
}: {
  model: BoardModel;
  statusPath: string;
  lastBeat?: string | null;
  now: number;
}) {
  return (
    <div className="grid h-full place-items-center px-5">
      <div className="max-w-md text-center">
        <img src="./conductor.svg" alt="" className="mx-auto h-12 w-12 opacity-80" />

        {model.hasConductor ? (
          <>
            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="font-mono text-sm font-medium text-chalk">{model.workflow}</span>
              <span className="rounded-md border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-mist">
                {model.total} step{model.total === 1 ? "" : "s"}
              </span>
            </div>
            <h1 className="mt-4 text-xl font-semibold text-chalk">
              Waiting for the agent to start execution.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              Cards will appear the moment it writes{" "}
              <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs text-cyan">
                {statusPath}
              </code>
              .
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-xl font-semibold text-chalk">
              Watching <span className="font-mono text-cyan">.conductor/</span> for changes
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              The board will light up when your agent writes a conductor and a status file.
              Start your agent and point it at this project.
            </p>
          </>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 font-mono text-xs text-mist">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
          {lastBeat ? (
            <span className="text-mint">agent active · last beat {relativeTime(lastBeat, now)}</span>
          ) : (
            "watching for changes"
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] text-dim">{statusPath}</p>
      </div>
    </div>
  );
}
