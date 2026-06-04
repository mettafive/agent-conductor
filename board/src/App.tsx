import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EMPTY, useBoardState } from "./lib/useBoardState";
import type { WorkflowEntry } from "./lib/useBoardState";
import { buildModel } from "./lib/merge";
import { isMuted, playFailure, playSuccess, playTick, setMuted } from "./lib/sounds";
import { lastBeatIso, useHeartbeatStream } from "./lib/heartbeatStream";
import { useNow } from "./lib/useNow";
import { clockSince, followStep, resolveActiveUnit } from "./lib/view";
import { ContextHeader } from "./components/ContextHeader";
import { ActiveCard } from "./components/ActiveCard";
import { StepDetail } from "./components/StepDetail";
import { SummaryView } from "./components/SummaryView";
import { LoopOverview } from "./components/LoopOverview";
import { IterationKanban } from "./components/IterationKanban";
import { ImprovementCard } from "./components/ImprovementCard";
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import { InsightsDashboard } from "./components/InsightsDashboard";
import { HeartbeatMonitor, loadMonitorMode } from "./components/HeartbeatMonitor";
import type { MonitorMode } from "./components/HeartbeatMonitor";
import type { BoardModel, BoardStep, RunRecord, Snapshot } from "./lib/types";

const params = new URLSearchParams(window.location.search);

export function App() {
  const { workflows, order, conn } = useBoardState();
  const [selectedWf, setSelectedWf] = useState<string | null>(params.get("wf"));
  const [selectedRun, setSelectedRun] = useState<string | null>(params.get("run"));
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280); // Part 1.1 — wide enough to never truncate
  const [muted, setMutedState] = useState(isMuted());
  const [monitorMode, setMonitorMode] = useState<MonitorMode>(loadMonitorMode);
  const [selectedStep, setSelectedStep] = useState<string | null>(null); // null = auto-follow live
  const [showInsights, setShowInsights] = useState(false);
  const now = useNow(1000);

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
    let alive = true;
    setRecord(null);
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
    setShowInsights(false);
  };
  const pickRun = (wf: string, runId: string) => {
    setSelectedWf(wf);
    setSelectedRun(runId);
    setSelectedStep(null);
    setShowInsights(false);
  };
  const backToLive = () => {
    setSelectedRun(null);
    setSelectedStep(null);
    setShowInsights(false);
  };

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
  const liveFollow = !viewing && selectedStep === null && !showInsights;
  const follow = liveFollow ? followStep(liveModel) : null;

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

  const showSummary =
    !showInsights &&
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
    showInsights,
    showSummary,
    now,
  });
  const showBackToLive = selectedStep !== null || selectedRun !== null || showInsights;

  // motion key — changes whenever the rendered view changes, giving the crossfade
  const viewKey = showInsights
    ? "insights"
    : `${activeWf}:${selectedRun ?? "live"}:${
        showSummary
          ? "sum"
          : structuralPending && liveFollow
            ? `imp:${structuralPending.id}`
            : liveFollow
              ? `follow:${follow?.id ?? "none"}`
              : (selectedStep ?? selectedStepObj?.id ?? "none")
      }`;

  return (
    <>
      <div className="aurora" />
      <div className="flex h-screen overflow-hidden">
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
            activeStep={selectedStep ?? activeStepId}
            onSelectStep={setSelectedStep}
            viewingSnap={viewing ? record?.snapshot : null}
            onOpenInsights={() => {
              setShowInsights(true);
              setSelectedStep(null);
            }}
            insightsOpen={showInsights}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {model?.demo && (
            <div className="flex items-center justify-center gap-2 border-b border-amber/25 bg-amber/10 px-5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber">
              Demo — simulated data
            </div>
          )}

          <ContextHeader
            label={header.label}
            timer={header.timer}
            timerPrefix={header.timerPrefix}
            onBackToLive={showBackToLive ? backToLive : undefined}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
          />

          {model?.error && (
            <div className="px-5 pt-4">
              <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
                {model.error}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {showInsights ? (
              <ViewShell vkey="insights">
                <InsightsDashboard
                  workflow={activeWf ?? "workflow"}
                  knowledge={(model ?? liveModel).knowledge}
                  runCount={(activeWf && workflows[activeWf]?.history.length) || 0}
                />
              </ViewShell>
            ) : viewing && !record ? (
              <div className="grid h-full place-items-center">
                <span className="font-mono text-xs text-mist">loading run…</span>
              </div>
            ) : showBoard && model ? (
              <ViewShell vkey={viewKey} fill={liveFollow && !showSummary && !structuralPending}>
                {showSummary ? (
                  <SummaryView model={model} />
                ) : structuralPending && liveFollow ? (
                  <ImprovementCard step={structuralPending} onApprove={applyApproval} />
                ) : liveFollow ? (
                  follow ? (
                    <ActiveCard step={follow} />
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
                  />
                )}
              </ViewShell>
            ) : (
              <WaitingState model={liveModel} statusPath={liveSnap.statusPath} />
            )}
          </div>

          <HeartbeatMonitor
            beats={log}
            arrival={arrival}
            order={order}
            mode={monitorMode}
            onMode={setMonitorMode}
            lastBeatIso={globalLastBeat}
            conn={conn}
            muted={muted}
            onToggleMute={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
            }}
          />
        </div>
      </div>
    </>
  );
}

function statusOf(entry: WorkflowEntry | undefined): string | undefined {
  return (entry?.snap.status as { status?: string } | null)?.status;
}

/** A crossfading shell so view changes transition smoothly (Part 3). */
function ViewShell({
  vkey,
  fill,
  children,
}: {
  vkey: string;
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={vkey}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={fill ? "h-full" : "board-scroll h-full overflow-y-auto"}
    >
      {children}
    </motion.div>
  );
}

/** The detail surface when a step/iteration is selected, or a past run browsed. */
function SelectedView({
  step,
  iterSel,
  viewing,
  onApprove,
  onBackToOverview,
  onOpenIteration,
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
    return <IterationKanban loopStep={step} item={iterSel[1]} onBack={() => onBackToOverview(step.id)} />;
  }
  if (step.isLoop) {
    return <LoopOverview loopStep={step} onOpenIteration={(item) => onOpenIteration(step.id, item)} />;
  }
  return <StepDetail step={step} onApprove={viewing ? undefined : onApprove} />;
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
  showInsights,
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
  showInsights: boolean;
  showSummary: boolean;
  now: number;
}): { label: string; timer?: string | null; timerPrefix?: string } {
  const wf = model?.workflow ?? "workflow";

  if (showInsights) return { label: `${wf} · knowledge` };

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

function WaitingState({ model, statusPath }: { model: BoardModel; statusPath: string }) {
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
          watching for changes
        </div>
        <p className="mt-2 font-mono text-[11px] text-dim">{statusPath}</p>
      </div>
    </div>
  );
}
