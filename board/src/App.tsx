import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { EMPTY, useBoardState } from "./lib/useBoardState";
import type { WorkflowEntry } from "./lib/useBoardState";
import { buildModel } from "./lib/merge";
import { isMuted, playFailure, playSuccess, playTick, setMuted } from "./lib/sounds";
import { lastBeatIso, useHeartbeatStream } from "./lib/heartbeatStream";
import { StatusBar } from "./components/StatusBar";
import { StepDetail } from "./components/StepDetail";
import { SummaryView } from "./components/SummaryView";
import { LoopOverview } from "./components/LoopOverview";
import { IterationKanban } from "./components/IterationKanban";
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import { InsightsDashboard } from "./components/InsightsDashboard";
import { HeartbeatMonitor, loadMonitorMode } from "./components/HeartbeatMonitor";
import type { MonitorMode } from "./components/HeartbeatMonitor";
import type { BoardModel, RunRecord, Snapshot, Suggestion } from "./lib/types";

const params = new URLSearchParams(window.location.search);

export function App() {
  const { workflows, order, conn } = useBoardState();
  const [selectedWf, setSelectedWf] = useState<string | null>(params.get("wf"));
  const [selectedRun, setSelectedRun] = useState<string | null>(params.get("run"));
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [muted, setMutedState] = useState(isMuted());
  const [pinned, setPinned] = useState<string[]>([]);
  const [monitorMode, setMonitorMode] = useState<MonitorMode>(loadMonitorMode);
  const [selectedStep, setSelectedStep] = useState<string | null>(null); // sidebar focus

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

  // The active workflow's persistent insights ledger — accumulated across runs.
  // The review panel acts on the still-open items (cross-run memory), not just
  // the suggestions of one run, so insights stop evaporating between runs.
  const activeLedger = activeWf ? workflows[activeWf]?.ledger : undefined;
  const openInsights = (activeLedger?.items ?? [])
    .filter((i) => i.status === "open")
    .map((i) => ({ ...i, id: i.key }) as Suggestion & { key: string });

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
  };
  const pickRun = (wf: string, runId: string) => {
    setSelectedWf(wf);
    setSelectedRun(runId);
    setSelectedStep(null);
  };
  const togglePin = (name: string) =>
    setPinned((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));

  // Insights are now a persistent, browsable page (✨ in the status bar) rather
  // than a popup that forces itself open and flashes by when the loop moves on.
  // Proven patterns auto-apply server-side; the dashboard is informational and
  // the open items still get manual apply/dismiss controls (§5.5/§5.6).
  const [showInsights, setShowInsights] = useState(false);
  const liveRunId = (liveSnap.status as { run_id?: string } | null)?.run_id;
  void liveRunId;

  // Send the full suggestion objects so applying works for a past run too —
  // the server no longer has to find them in the (possibly reset) live status.
  const applySuggestions = async (items: Suggestion[]) => {
    if (!activeWf) return { ok: false, error: "no active workflow" };
    try {
      const r = await fetch(
        `/api/workflow/${encodeURIComponent(activeWf)}/apply-suggestion`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ suggestions: items }),
        },
      );
      const d = await r.json().catch(() => ({}));
      return r.ok ? { ok: true } : { ok: false, error: d.error };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
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
  const model: BoardModel | null = viewing
    ? record
      ? buildModel(record.snapshot)
      : null
    : liveModel;

  const liveStarted = !!(
    liveSnap.status &&
    typeof liveSnap.status === "object" &&
    Object.keys((liveSnap.status as { steps?: object }).steps ?? {}).length > 0
  );
  const showBoard = viewing ? !!record : liveStarted;

  // Three-zone layout: the main area shows exactly ONE view at a time —
  //   • a completion summary,
  //   • one iteration's full kanban (sidebar selection "loopId::item"),
  //   • a loop's overview of all iterations (a loop is the active step),
  //   • a single non-loop step's detail.
  // The sidebar is the only navigator; the main area never stacks kanbans.
  const iterSel =
    selectedStep && selectedStep.includes("::") ? selectedStep.split("::") : null;
  const activeStepId = iterSel
    ? iterSel[0]
    : selectedStep && model?.steps.some((s) => s.id === selectedStep)
      ? selectedStep
      : (model?.currentStep ?? null);
  const activeStep =
    model?.steps.find((s) => s.id === activeStepId) ?? model?.steps[0] ?? null;
  const showSummary =
    !selectedStep && !!model && (model.overallStatus === "done" || model.overallStatus === "failed");

  const dismissInsights = async (keys: string[]) => {
    if (!activeWf || keys.length === 0) return;
    try {
      await fetch(`/api/workflow/${encodeURIComponent(activeWf)}/insights/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys, status: "dismissed" }),
      });
    } catch {
      /* the SSE refresh will reconcile */
    }
  };

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
            onPin={togglePin}
            width={sidebarWidth}
            onResize={setSidebarWidth}
            activeStep={selectedStep ?? activeStepId}
            onSelectStep={setSelectedStep}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar
            model={model ?? liveModel}
            conn={conn}
            viewing={viewing}
            muted={muted}
            onToggleMute={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
            }}
            onBackToLive={() => setSelectedRun(null)}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            optimizeCount={openInsights.length}
            optimizeOpen={showInsights}
            onToggleOptimize={() => setShowInsights((o) => !o)}
          />

          {pinned.length > 0 && (
            <TabBar
              pinned={pinned}
              workflows={workflows}
              activeWf={activeWf}
              onPick={pickWorkflow}
              onUnpin={togglePin}
            />
          )}

          {model?.error && (
            <div className="px-5 pt-4">
              <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
                ⚠ {model.error}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {showInsights ? (
              <motion.div
                key="insights-dashboard"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="board-scroll h-full overflow-y-auto"
              >
                <InsightsDashboard
                  workflow={activeWf ?? "workflow"}
                  ledger={activeLedger}
                  runCount={(activeWf && workflows[activeWf]?.history.length) || 0}
                  onApply={applySuggestions}
                  onDismiss={dismissInsights}
                />
              </motion.div>
            ) : viewing && !record ? (
              <div className="grid h-full place-items-center">
                <span className="font-mono text-xs text-mist">loading run…</span>
              </div>
            ) : showBoard && model ? (
              <motion.div
                key={`${activeWf}:${selectedRun ?? "live"}:${showSummary ? "sum" : (selectedStep ?? activeStep?.id ?? "none")}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="board-scroll h-full overflow-y-auto"
              >
                {showSummary ? (
                  <SummaryView model={model} onOpenInsights={() => setShowInsights(true)} />
                ) : iterSel && activeStep?.isLoop ? (
                  <IterationKanban
                    loopStep={activeStep}
                    item={iterSel[1]}
                    onBack={() => setSelectedStep(activeStep.id)}
                  />
                ) : activeStep?.isLoop ? (
                  <LoopOverview
                    loopStep={activeStep}
                    onOpenIteration={(item) => setSelectedStep(`${activeStep.id}::${item}`)}
                  />
                ) : activeStep ? (
                  <StepDetail step={activeStep} onApprove={viewing ? undefined : applyApproval} />
                ) : (
                  <div className="grid h-full place-items-center">
                    <span className="font-mono text-xs text-mist">select a step from the sidebar</span>
                  </div>
                )}
              </motion.div>
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
          />
        </div>
      </div>
    </>
  );
}

function statusOf(entry: WorkflowEntry | undefined): string | undefined {
  return (entry?.snap.status as { status?: string } | null)?.status;
}

const DOT: Record<string, string> = {
  running: "bg-cyan animate-pulse",
  done: "bg-mint",
  failed: "bg-rose",
};

function TabBar({
  pinned,
  workflows,
  activeWf,
  onPick,
  onUnpin,
}: {
  pinned: string[];
  workflows: Record<string, WorkflowEntry>;
  activeWf: string | null;
  onPick: (n: string) => void;
  onUnpin: (n: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line bg-ink/60 px-3 py-1.5">
      {pinned.map((name) => {
        const status = workflows[name]?.snap.status as
          | { status?: string; steps?: Record<string, { status?: string }> }
          | null;
        const steps = status?.steps ?? {};
        const total = Object.keys(steps).length;
        const done = Object.values(steps).filter((s) => s?.status === "done").length;
        const active = activeWf === name;
        return (
          <div
            key={name}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
              active ? "border-iris/40 bg-iris/10" : "border-line bg-panel/40"
            }`}
          >
            <button onClick={() => onPick(name)} className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[status?.status ?? ""] ?? "bg-line-2"}`} />
              <span className="font-mono text-xs text-chalk">{name}</span>
              {total > 0 && (
                <span className="font-mono text-[10px] text-mist">
                  {done}/{total}
                </span>
              )}
            </button>
            <button
              onClick={() => onUnpin(name)}
              title="Unpin"
              className="text-mist hover:text-chalk"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
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
        <p className="mt-2 font-mono text-[11px] text-line-2">{statusPath}</p>
      </div>
    </div>
  );
}
