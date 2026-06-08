import { useEffect, useRef, useState } from "react";
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
import { clockSince } from "./lib/view";
import { TopBar } from "./components/TopBar";
import { WorkflowKanban } from "./components/WorkflowKanban";
import { Settings } from "./components/Settings";
import { HeartbeatMonitor, loadMonitorMode } from "./components/HeartbeatMonitor";
import type { MonitorMode } from "./components/HeartbeatMonitor";
import { loadHeartbeatInterval, saveHeartbeatInterval, stallSecondsFor } from "./lib/settings";
import type { BoardModel, Snapshot } from "./lib/types";

const params = new URLSearchParams(window.location.search);

export function App() {
  const { workflows, order, conn } = useBoardState();
  const [selectedWf] = useState<string | null>(params.get("wf"));
  const [ticksOn, setTicksOn] = useState(!isTicksMuted());
  const [chimesOn, setChimesOn] = useState(!isChimesMuted());
  const [monitorMode, setMonitorMode] = useState<MonitorMode>(loadMonitorMode);
  const [heartbeatInterval, setHeartbeatInterval] = useState(loadHeartbeatInterval);
  const [showSettings, setShowSettings] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    saveHeartbeatInterval(heartbeatInterval);
  }, [heartbeatInterval]);

  const { beats, log, arrival } = useHeartbeatStream(workflows, order);
  const agentLog = log.filter((b) => !b.system);
  const globalLastBeat = lastBeatIso(beats);

  useEffect(() => {
    if (arrival && !arrival.beat.system) playTick();
  }, [arrival]);

  const activeWf =
    (selectedWf && workflows[selectedWf] ? selectedWf : null) ??
    order.find((n) => statusOf(workflows[n]) === "running") ??
    order[0] ??
    null;

  const liveSnap: Snapshot = (activeWf && workflows[activeWf]?.snap) || EMPTY;
  const liveModel = buildModel(liveSnap);
  const model: BoardModel = liveModel;

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  const liveStarted = !!(
    liveSnap.status &&
    typeof liveSnap.status === "object" &&
    Object.keys((liveSnap.status as { steps?: object }).steps ?? {}).length > 0
  );

  const elapsed =
    model.overallStatus === "running"
      ? clockSince(model.startedAt, now)
      : model.overallStatus === "done" || model.overallStatus === "failed"
        ? clockSince(model.startedAt, now, model.endedAt)
        : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        workflow={activeWf ?? model.workflow}
        status={model.overallStatus}
        elapsed={elapsed}
        done={model.done}
        total={model.total}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* v2 sidebar nav — parked, kept for styling reference.
            <WorkflowSidebar ... /> can come back later as a drawer for past runs. */}
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
            {liveStarted ? (
              <WorkflowKanban model={model} notes={model.developerNotes} />
            ) : (
              <WaitingState model={model} statusPath={liveSnap.statusPath} />
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
            beats={agentLog}
            arrival={arrival && !arrival.beat.system ? arrival : null}
            order={order}
            mode={monitorMode}
            onMode={setMonitorMode}
            lastBeatIso={globalLastBeat}
            conn={conn}
            stallSeconds={stallSecondsFor(heartbeatInterval)}
            done={liveModel.overallStatus === "done" || liveModel.overallStatus === "failed"}
            knowledge={model.knowledge}
            doneCount={model.done}
            totalCount={model.total}
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
        workflow={activeWf ?? model.workflow}
        knowledge={model.knowledge}
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
