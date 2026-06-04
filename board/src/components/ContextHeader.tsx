import { Icon } from "./Icon";

/**
 * The contextual bar at the top of the main area. No badges, counts or progress
 * bar. Just: an optional "← live" to leave inspection, the current view name,
 * and a timer for THIS view. The workflow name lives in the header/sidebar.
 */
export function ContextHeader({
  label,
  timer,
  timerPrefix,
  onBackToLive,
  onToggleSidebar,
}: {
  label: string;
  timer?: string | null;
  timerPrefix?: string;
  onBackToLive?: () => void;
  onToggleSidebar?: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim transition-colors hover:text-chalk"
        >
          <Icon name="menu" size={15} />
        </button>
      )}

      {onBackToLive && (
        <button
          onClick={onBackToLive}
          className="flex shrink-0 items-center gap-1 text-[13px] text-mist transition-colors hover:text-chalk"
        >
          <Icon name="arrowLeft" size={14} /> live
        </button>
      )}

      <span className="min-w-0 flex-1 truncate text-[13px] text-mist">{label}</span>

      {timer && (
        <span className="shrink-0 text-[12px] tabular-nums text-dim">
          {timerPrefix ? `${timerPrefix} ` : ""}
          {timer}
        </span>
      )}
    </div>
  );
}
