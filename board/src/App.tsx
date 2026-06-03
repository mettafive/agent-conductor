import { useBoardState } from "./lib/useBoardState";
import { StatusBar } from "./components/StatusBar";
import { Board } from "./components/Board";

export function App() {
  const { model, snap, conn } = useBoardState();
  const hasRun = model.total > 0;

  return (
    <>
      <div className="aurora" />
      <StatusBar model={model} conn={conn} />

      {model.error && (
        <div className="mx-auto max-w-[1400px] px-5 pt-4">
          <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
            ⚠ {model.error}
          </div>
        </div>
      )}

      {hasRun ? (
        <Board model={model} />
      ) : (
        <div className="grid place-items-center px-5 py-28">
          <div className="max-w-md text-center">
            <img src="./conductor.svg" alt="" className="mx-auto h-12 w-12 opacity-80" />
            <h1 className="mt-5 text-xl font-semibold text-chalk">
              Waiting for the agent…
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              No steps yet in{" "}
              <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs text-cyan">
                {snap.statusPath}
              </code>
              . The board updates the moment the agent writes its status file.
            </p>
            {!snap.conductorYaml && (
              <p className="mt-3 text-xs text-mist">
                No conductor file found nearby — cards will show status only.
                Pass <code className="font-mono text-mist-2">--conductor &lt;file&gt;</code> for
                full detail.
              </p>
            )}
            <div className="mt-6 flex items-center justify-center gap-2 font-mono text-xs text-mist">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
              watching for changes
            </div>
          </div>
        </div>
      )}
    </>
  );
}
