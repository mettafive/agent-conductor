import type { ReactNode } from "react";

/**
 * The permanent MASTHEAD: app identity only. Left→right it carries the Navigator
 * hamburger (the `left` slot), a thin divider, the Conductor mark + wordmark, and
 * the build-time injected version. Run-specific state lives in the run-header
 * (CompletionHeader), never here.
 */
export function TopBar({
  left,
}: {
  /** A leading control (the Navigator hamburger) rendered before the identity cluster. */
  left?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-panel/60 px-3 backdrop-blur">
      {left}

      {/* thin vertical divider between the hamburger and the identity cluster */}
      <span className="h-5 w-px shrink-0 bg-line" aria-hidden />

      {/* The Conductor mark + wordmark + version — the app's permanent identity. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px] bg-mint shadow-[0_0_10px_rgba(52,211,153,0.5)]"
          aria-hidden
        />
        <span className="text-[13px] font-semibold tracking-tight text-chalk">Conductor</span>
        <span className="font-mono text-[10px] tabular-nums text-dim">v{__APP_VERSION__}</span>
      </div>

      {/* RIGHT: reserved — never put run-specific things here. */}
    </header>
  );
}
