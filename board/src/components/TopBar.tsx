import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./Icon";
import { Led } from "./Led";

/**
 * The global header — brand + active workflow name (the "main title" row) and,
 * when viewing past/inspected work, a prominent "Back to live" button. The sidebar
 * COLLAPSE control lives inside the drawer (top-right); the header only carries the
 * EXPAND affordance, and only while the sidebar is closed — so the nav toggle isn't a
 * permanent fixture of a bar that isn't about navigation. It animates in/out so the
 * title slides over smoothly rather than jumping.
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
    <header className="flex h-12 shrink-0 items-center border-b border-line bg-panel/60 px-3 backdrop-blur">
      <AnimatePresence initial={false}>
        {onToggleSidebar && !sidebarOpen && (
          <motion.button
            key="expand"
            initial={{ width: 0, opacity: 0, marginRight: 0 }}
            animate={{ width: 28, opacity: 1, marginRight: 10 }}
            exit={{ width: 0, opacity: 0, marginRight: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            onClick={onToggleSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="grid h-7 shrink-0 place-items-center overflow-hidden rounded-md text-mist transition-colors hover:bg-panel-2 hover:text-chalk"
          >
            <Icon name="arrowRight" size={16} />
          </motion.button>
        )}
      </AnimatePresence>

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
          className="ml-3 flex shrink-0 items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 py-1 pl-2.5 pr-1.5 text-[12px] text-chalk transition-colors hover:border-mint/50 hover:bg-panel"
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
