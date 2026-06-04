import { Icon } from "./Icon";
import { Led } from "./Led";

/**
 * The global header. A directional toggle for the sidebar (→ to open, ← to
 * collapse), the brand + active workflow name, and — when viewing past or
 * inspected work — a prominent "Back to live" button. The name truncates so it
 * and the button always share one row. The one heart lives in the monitor below.
 */
export function TopBar({
  workflow,
  sidebarOpen,
  onToggleSidebar,
  showBackToLive,
  onBackToLive,
}: {
  workflow?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  showBackToLive?: boolean;
  onBackToLive?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-panel/60 px-3 backdrop-blur">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-mist transition-colors hover:bg-panel-2 hover:text-chalk"
        >
          <Icon name={sidebarOpen ? "arrowLeft" : "arrowRight"} size={16} />
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <img src="./conductor.svg" alt="" className="h-4 w-4 shrink-0 opacity-70" />
        <span className="shrink-0 font-mono text-[12px] tracking-wide text-mist">conductor</span>
        {workflow && (
          <>
            <span className="shrink-0 text-dim">/</span>
            <span className="min-w-0 truncate text-[14px] font-medium text-chalk">{workflow}</span>
          </>
        )}
      </div>

      {showBackToLive && (
        <button
          onClick={onBackToLive}
          title="Back to the live run (Esc)"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 py-1 pl-2.5 pr-1.5 text-[12px] text-chalk transition-colors hover:border-mint/50 hover:bg-panel"
        >
          <Led state="running" />
          <span className="flex items-center gap-1">
            <Icon name="arrowLeft" size={13} /> Back to live
          </span>
          <kbd className="rounded border border-line bg-ink/60 px-1 font-mono text-[10px] leading-none text-dim">
            esc
          </kbd>
        </button>
      )}
    </header>
  );
}
