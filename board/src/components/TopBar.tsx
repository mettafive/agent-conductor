/**
 * The whole global header. Almost nothing: the brand and the active workflow
 * name. No badges, counts, timers or progress bars — those live in the sidebar
 * and the contextual bar. The one heart lives in the heartbeat monitor below.
 */
export function TopBar({ workflow }: { workflow?: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel/60 px-4 backdrop-blur">
      <img src="./conductor.svg" alt="" className="h-4 w-4 opacity-70" />
      <span className="font-mono text-[12px] tracking-wide text-mist">conductor</span>
      {workflow && (
        <>
          <span className="text-dim">/</span>
          <span className="truncate text-[14px] font-medium text-chalk">{workflow}</span>
        </>
      )}
    </header>
  );
}
