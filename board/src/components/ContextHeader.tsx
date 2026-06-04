/**
 * The contextual bar at the top of the main area. Just the current view name
 * and a timer for THIS view — no badges, counts or controls. The sidebar toggle
 * and the "Live" button live in the global header.
 */
export function ContextHeader({
  label,
  timer,
  timerPrefix,
}: {
  label: string;
  timer?: string | null;
  timerPrefix?: string;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-5">
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
