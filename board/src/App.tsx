import { useEffect, useState } from "react";
import { useBoardState } from "./lib/useBoardState";
import { buildModel } from "./lib/merge";
import { StatusBar } from "./components/StatusBar";
import { Board } from "./components/Board";
import { HistorySidebar } from "./components/HistorySidebar";
import type { BoardModel, RunRecord } from "./lib/types";

export function App() {
  const { model: liveModel, snap, conn, history } = useBoardState();
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("run"),
  );
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // keep the URL in sync so a run is shareable / reloadable
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("run", selected);
    else url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
  }, [selected]);

  // fetch the frozen run when one is selected
  useEffect(() => {
    if (selected === null) {
      setRecord(null);
      return;
    }
    let alive = true;
    setRecord(null);
    fetch(`/history/${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rec: RunRecord | null) => alive && setRecord(rec))
      .catch(() => alive && setSelected(null));
    return () => {
      alive = false;
    };
  }, [selected]);

  // if the selected run vanished from history, drop back to live
  useEffect(() => {
    if (selected && history.length && !history.some((r) => r.run_id === selected)) {
      setSelected(null);
    }
  }, [history, selected]);

  const viewing = selected !== null;
  const model: BoardModel | null = viewing
    ? record
      ? buildModel(record.snapshot)
      : null
    : liveModel;

  const hasRun = !!model && model.total > 0;

  return (
    <>
      <div className="aurora" />
      <div className="flex min-h-screen">
        {sidebarOpen && (
          <HistorySidebar runs={history} selected={selected} onSelect={setSelected} />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar
            model={model ?? liveModel}
            conn={conn}
            viewing={viewing}
            onBackToLive={() => setSelected(null)}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
          />

          {model?.error && (
            <div className="px-5 pt-4">
              <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
                ⚠ {model.error}
              </div>
            </div>
          )}

          {viewing && !record ? (
            <div className="grid flex-1 place-items-center py-28">
              <span className="font-mono text-xs text-mist">loading run…</span>
            </div>
          ) : hasRun && model ? (
            <Board model={model} />
          ) : (
            <WaitingState statusPath={snap.statusPath} hasConductor={!!snap.conductorYaml} />
          )}
        </div>
      </div>
    </>
  );
}

function WaitingState({
  statusPath,
  hasConductor,
}: {
  statusPath: string;
  hasConductor: boolean;
}) {
  return (
    <div className="grid flex-1 place-items-center px-5 py-28">
      <div className="max-w-md text-center">
        <img src="./conductor.svg" alt="" className="mx-auto h-12 w-12 opacity-80" />
        <h1 className="mt-5 text-xl font-semibold text-chalk">Waiting for the agent…</h1>
        <p className="mt-2 text-sm leading-relaxed text-mist">
          No steps yet in{" "}
          <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs text-cyan">
            {statusPath}
          </code>
          . The board updates the moment the agent writes its status file.
        </p>
        {!hasConductor && (
          <p className="mt-3 text-xs text-mist">
            No conductor file found nearby — cards will show status only. Pass{" "}
            <code className="font-mono text-mist-2">--conductor &lt;file&gt;</code> for full
            detail.
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2 font-mono text-xs text-mist">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
          watching for changes
        </div>
      </div>
    </div>
  );
}
