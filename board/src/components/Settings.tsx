import { AnimatePresence, motion } from "framer-motion";

/** A labelled on/off switch row. `on` = the thing is enabled (sound plays). */
function SwitchRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="flex-1">
        <div className="text-[13px] text-chalk">{label}</div>
        <div className="text-[12px] text-mist">{hint}</div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={`${label}: ${on ? "on" : "off"}`}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
          on ? "bg-mint/70" : "bg-line-2"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-chalk transition-all duration-200 ${
            on ? "left-4" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * The settings panel, toggled with ⌘, (and closed with ⌘, / Esc / backdrop).
 * Holds the genuinely-settable things — sound — plus the knowledge view, which
 * no longer has a sidebar link. A dismissible overlay, never a stuck takeover.
 */
export function Settings({
  open,
  onClose,
  ticksOn,
  chimesOn,
  prewarmAgents,
  onToggleTicks,
  onToggleChimes,
  onTogglePrewarmAgents,
}: {
  open: boolean;
  onClose: () => void;
  ticksOn: boolean;
  chimesOn: boolean;
  prewarmAgents: boolean;
  onToggleTicks: () => void;
  onToggleChimes: () => void;
  onTogglePrewarmAgents: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={onClose}
          className="fixed inset-0 z-50 grid place-items-center bg-ink/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
              <span className="text-[14px] font-medium text-chalk">Settings</span>
              <span className="ml-auto text-[11px] text-dim">⌘, or Esc to close</span>
            </div>

            <div className="board-scroll min-h-0 flex-1 overflow-y-auto">
              {/* Sound — two independent controls */}
              <div className="px-5 pb-1 pt-3 text-[11px] uppercase tracking-wide text-dim">Sound</div>
              <SwitchRow
                label="Update ticks"
                hint="A faint tick on every progress update the agent writes."
                on={ticksOn}
                onToggle={onToggleTicks}
              />
              <SwitchRow
                label="Completion sounds"
                hint="A chime when a run finishes, a tone when it fails."
                on={chimesOn}
                onToggle={onToggleChimes}
              />

              {/* Agents */}
              <div className="px-5 pb-1 pt-4 text-[11px] uppercase tracking-wide text-dim">Agents</div>
              <SwitchRow
                label="Pre-warm agents"
                hint="Default on. Starts safe no-work probes for likely next cards so handoff is faster."
                on={prewarmAgents}
                onToggle={onTogglePrewarmAgents}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
