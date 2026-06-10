import { useEffect, useMemo, useRef, useState } from "react";
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
import { useNow } from "./lib/useNow";
import { clockSince, fmtElapsedMs } from "./lib/view";
import { TopBar } from "./components/TopBar";
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import type { LiveEntry } from "./components/WorkflowSidebar";
import { Icon } from "./components/Icon";
import { WorkflowKanban, RunCompleteBanner } from "./components/WorkflowKanban";
import { Settings } from "./components/Settings";
import { InsightsModal } from "./components/InsightsModal";
import { HeartbeatMonitor, loadMonitorMode } from "./components/HeartbeatMonitor";
import type { MonitorMode } from "./components/HeartbeatMonitor";
import { loadHeartbeatInterval, saveHeartbeatInterval, stallSecondsFor } from "./lib/settings";
import type { StreamBeat } from "./lib/heartbeatStream";
import type { BoardModel, HistoryRun, Snapshot } from "./lib/types";

/** Flatten a viewed (past, static) run's persisted beats into one chronological StreamBeat[] —
 *  the terminal's data source when the navigator is viewing a past run instead of the live stream. */
function pastRunBeats(model: BoardModel): StreamBeat[] {
  const out: StreamBeat[] = [];
  for (const step of model.steps) {
    step.heartbeat.forEach((h, i) => {
      out.push({
        key: `${model.workflow} ${step.id} ${h.iteration ?? ""} ${h.sub ?? ""} ${h.at} ${i}`,
        workflow: model.workflow,
        step: String(step.id),
        title: step.title,
        at: h.at,
        note: h.note,
        iteration: h.iteration,
        sub: h.sub,
        finalBeat: h.finalBeat === true,
        system: h.system === true,
        tone: h.tone,
        insight: h.insight,
      });
    });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

const params = new URLSearchParams(window.location.search);

export function App() {
  const { workflows, order, conn } = useBoardState();
  const [selectedWf] = useState<string | null>(params.get("wf"));
  const [ticksOn, setTicksOn] = useState(!isTicksMuted());
  const [chimesOn, setChimesOn] = useState(!isChimesMuted());
  const [monitorMode, setMonitorMode] = useState<MonitorMode>(loadMonitorMode);
  const [heartbeatInterval, setHeartbeatInterval] = useState(loadHeartbeatInterval);
  const [showSettings, setShowSettings] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  // The Navigator drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A single value drives which past run is loaded onto the board. null = live/default source.
  const [viewing, setViewing] = useState<{ wf: string; runId: string } | null>(null);
  const [viewedModel, setViewedModel] = useState<BoardModel | null>(null);
  // The newest-history fallback model, fetched once when there's no live run.
  const [latestModel, setLatestModel] = useState<BoardModel | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    saveHeartbeatInterval(heartbeatInterval);
  }, [heartbeatInterval]);

  const { beats, log, arrival } = useHeartbeatStream(workflows, order);
  const agentLog = log;
  const globalLastBeat = lastBeatIso(beats);

  useEffect(() => {
    if (arrival && !arrival.beat.system) playTick();
  }, [arrival]);

  // A "run" feed is the work workflow; "compile"/"integration" are the shaping
  // feeds. Prefer the RUN feed so the board never sticks on the migration board
  // when the run is going, and so it auto-advances compile → run on one surface
  // (Fix 2). While compile is the only thing running, the third clause still
  // surfaces it live (Fix 3 — you watch the build, not just the finish).
  const isRunFeed = (n: string) => {
    const v = workflows[n]?.snap?.variant;
    return v !== "compile" && v !== "integration"; // run, or untagged/legacy
  };
  const activeWf =
    (selectedWf && workflows[selectedWf] ? selectedWf : null) ??
    order.find((n) => isRunFeed(n) && statusOf(workflows[n]) === "running") ??
    order.find((n) => statusOf(workflows[n]) === "running") ??
    order.find((n) => isRunFeed(n)) ??
    order[0] ??
    null;

  const liveSnap: Snapshot = (activeWf && workflows[activeWf]?.snap) || EMPTY;
  const liveModel = buildModel(liveSnap);

  // Does the live workflow actually have a run streaming (any steps written)?
  const liveStarted = !!(
    liveSnap.status &&
    typeof liveSnap.status === "object" &&
    Object.keys((liveSnap.status as { steps?: object }).steps ?? {}).length > 0
  );

  // The newest finished run across all workflows (the active workflow's own newest wins ties via
  // order) — the fallback board source when nothing is streaming.
  const latestEntry = (() => {
    type Latest = { wf: string; run: HistoryRun };
    const wfs = activeWf ? [activeWf, ...order.filter((w) => w !== activeWf)] : order;
    let best: Latest | null = null;
    for (const wf of wfs) {
      const top = workflows[wf]?.history?.[0]; // history is newest-first
      if (!top) continue;
      const bestAt = best ? best.run.completed_at ?? "" : "";
      if (!best || (top.completed_at ?? "") > bestAt) best = { wf, run: top };
    }
    return best;
  })();

  // Load the viewed past run's snapshot whenever the selection changes. The board is then STATIC —
  // incoming SSE updates do not replace it (we never re-derive viewedModel from live state).
  useEffect(() => {
    if (!viewing) {
      setViewedModel(null);
      return;
    }
    let cancelled = false;
    setViewedModel(null);
    fetch(`/api/workflow/${encodeURIComponent(viewing.wf)}/history/${encodeURIComponent(viewing.runId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rec) => {
        if (!cancelled && rec?.snapshot) setViewedModel(buildModel(rec.snapshot as Snapshot));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewing]);

  // Default-source fallback: when not viewing a past run and nothing is live, fetch the newest
  // finished run's snapshot ONCE so the board lands on your last run instead of an empty screen.
  const latestKey = latestEntry ? `${latestEntry.wf}::${latestEntry.run.run_id}` : null;
  useEffect(() => {
    if (viewing || liveStarted || !latestEntry) {
      setLatestModel(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/workflow/${encodeURIComponent(latestEntry.wf)}/history/${encodeURIComponent(latestEntry.run.run_id)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((rec) => {
        if (!cancelled && rec?.snapshot) setLatestModel(buildModel(rec.snapshot as Snapshot));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestKey, viewing, liveStarted]);

  // Resolve the displayed model: a viewed past run wins; else the live run if it has started;
  // else the newest finished run; else the empty live model (→ WaitingState).
  const model: BoardModel =
    (viewing && viewedModel) ? viewedModel : liveStarted ? liveModel : latestModel ?? liveModel;
  // The board is interactive (live-following) only when showing the genuinely live run.
  const boardStarted = (viewing && viewedModel) ? true : liveStarted ? true : !!latestModel;

  // The terminal's beat source: a viewed past run isn't streaming, so source its persisted beats
  // (flattened from steps[].heartbeat[]); otherwise the live session stream.
  const viewingPast = !!(viewing && viewedModel);
  const monitorBeats = useMemo(
    () => (viewingPast ? pastRunBeats(viewedModel as BoardModel) : agentLog),
    [viewingPast, viewedModel, agentLog],
  );

  // The live run pinned at the top of the drawer — only while a run is genuinely streaming.
  const liveEntry: LiveEntry | null =
    liveStarted && activeWf
      ? {
          workflow: activeWf,
          runName: liveModel.runName || liveModel.runId || activeWf,
          startedAt: liveModel.startedAt,
          status: liveModel.overallStatus,
        }
      : null;

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

  useEffect(() => {
    const url = new URL(window.location.href);
    activeWf ? url.searchParams.set("wf", activeWf) : url.searchParams.delete("wf");
    window.history.replaceState(null, "", url);
  }, [activeWf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
        return;
      }
      if (e.key === "Escape" && showSettings) {
        e.preventDefault();
        setShowSettings(false);
        return;
      }
      if (e.key === "Escape" && showInsights) {
        e.preventDefault();
        setShowInsights(false);
        return;
      }
      // No modal open — Escape closes the Navigator drawer if it's open.
      if (e.key === "Escape" && drawerOpen) {
        e.preventDefault();
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, showInsights, drawerOpen]);

  // Paused-aware elapsed. New runs carry an accumulator (elapsedBaseMs + runningSince); the live
  // display adds (now - runningSince) ONLY while running, so the clock freezes on pause/done/failed
  // and CONTINUES (not resets) on resume. Legacy runs (no accumulator) fall back to started_at→now/
  // ended, preserving the old behaviour so existing runs still render.
  const elapsed = model.hasAccumulator
    ? fmtElapsedMs(
        (model.elapsedBaseMs ?? 0) +
          (model.overallStatus === "running" && model.runningSince
            ? Math.max(0, now - new Date(model.runningSince).getTime())
            : 0),
      )
    : model.overallStatus === "running"
      ? clockSince(model.startedAt, now)
      : model.overallStatus === "done" || model.overallStatus === "failed"
        ? clockSince(model.startedAt, now, model.endedAt)
        : model.overallStatus === "paused"
          ? clockSince(model.startedAt, now, model.pausedAt)
          : null;
  const runCount = (activeWf && workflows[activeWf]?.history.length) || 0;
  const freshInsightCount = model.runId ? model.knowledge.filter((item) => item.source_run === model.runId).length : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        left={
          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label={drawerOpen ? "Close runs" : "Open runs"}
            aria-expanded={drawerOpen}
            title="Runs"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mist transition-colors hover:bg-panel-2 hover:text-chalk"
          >
            <Icon name={drawerOpen ? "cross" : "menu"} size={18} />
          </button>
        }
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* The Navigator — a hamburger-toggled drawer listing past runs. It OVERLAYS
            the board (absolute within the main area) and slides in/out, so opening
            it never reflows the board content. */}
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                key="nav-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                onClick={() => setDrawerOpen(false)}
                className="absolute inset-0 z-20 bg-ink/40"
              />
              <motion.div
                key="nav-drawer"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                className="absolute inset-y-0 left-0 z-30"
              >
                <WorkflowSidebar
                  workflows={workflows}
                  order={order}
                  viewingRunId={viewing?.runId ?? null}
                  live={liveEntry}
                  liveActive={!viewing && liveStarted}
                  onPickRun={(wf, runId) => setViewing({ wf, runId })}
                  onClear={() => setViewing(null)}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col">
          {model.demo && (
            <div className="flex items-center justify-center gap-2 border-b border-amber/25 bg-amber/10 px-5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber">
              Demo — simulated data
            </div>
          )}

          {model.error && (
            <div className="px-5 pt-4">
              <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
                {model.error}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {boardStarted ? (
              <WorkflowKanban
                model={model}
                notes={model.developerNotes}
                elapsed={elapsed}
              />
            ) : (
              <WaitingState model={model} statusPath={liveSnap.statusPath} />
            )}
          </div>

          {!viewing &&
            liveStarted &&
            liveModel &&
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

          <RunCompleteBanner
            model={model}
            insightCount={freshInsightCount}
            onOpenInsights={() => setShowInsights(true)}
          />

          <HeartbeatMonitor
            beats={monitorBeats}
            // A viewed past run is static — no live arrival, no heart pulse, settle as done.
            arrival={viewingPast ? null : arrival && !arrival.beat.system ? arrival : null}
            order={order}
            mode={monitorMode}
            onMode={setMonitorMode}
            lastBeatIso={viewingPast ? undefined : globalLastBeat}
            conn={viewingPast ? undefined : conn}
            stallSeconds={stallSecondsFor(heartbeatInterval)}
            done={
              viewingPast
                ? true
                : liveModel.overallStatus === "done" || liveModel.overallStatus === "failed"
            }
            knowledge={viewingPast ? (viewedModel as BoardModel).knowledge : liveModel.knowledge}
            doneCount={viewingPast ? (viewedModel as BoardModel).done : liveModel.done}
            totalCount={viewingPast ? (viewedModel as BoardModel).total : liveModel.total}
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
        heartbeatInterval={heartbeatInterval}
        onSetHeartbeatInterval={setHeartbeatInterval}
      />
      <InsightsModal
        open={showInsights}
        onClose={() => setShowInsights(false)}
        workflow={activeWf ?? model.workflow}
        knowledge={model.knowledge}
        runCount={runCount}
        currentRunId={model.runId}
      />
    </div>
  );
}

function statusOf(entry: WorkflowEntry | undefined): string | undefined {
  return (entry?.snap.status as { status?: string } | null)?.status;
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
                {model.total} card{model.total === 1 ? "" : "s"}
              </span>
            </div>
            <h1 className="mt-4 text-xl font-semibold text-chalk">Waiting for the agent to start execution.</h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              Cards will move onto the Kanban board when the agent writes{" "}
              <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs text-cyan">{statusPath}</code>.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-semibold text-chalk">No workflow found.</h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">Create `.conductor/workflow.json`, then run status-init.</p>
          </>
        )}
      </div>
    </div>
  );
}
