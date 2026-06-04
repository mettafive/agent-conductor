/**
 * The only header inside the main area (Part 4). No badges, no counts, no
 * progress bar. Just: an optional "← live" to leave inspection, the current
 * view name, and a timer for THIS view. The workflow name + overall status live
 * in the sidebar — this line is purely contextual.
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
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line/60 px-4">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim transition-colors hover:text-chalk"
        >
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      )}

      {onBackToLive && (
        <button
          onClick={onBackToLive}
          className="flex shrink-0 items-center gap-1 font-mono text-[11.5px] text-cyan transition-colors hover:text-chalk"
        >
          <span aria-hidden>←</span> live
        </button>
      )}

      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-mist-2">{label}</span>

      {timer && (
        <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-mist">
          {timerPrefix ? `${timerPrefix} ` : ""}
          {timer}
        </span>
      )}
    </div>
  );
}
