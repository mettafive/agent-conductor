import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./Icon";
import { HEARTBEAT_OPTIONS, stallSecondsFor } from "../lib/settings";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", ","], label: "Open / close settings" },
  { keys: ["Esc"], label: "Back to live · close this panel" },
  { keys: ["Ctrl", "`"], label: "Expand / minimize updates" },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-line bg-ink/60 px-1.5 py-0.5 font-mono text-[11px] leading-none text-mist-2">
      {children}
    </kbd>
  );
}

/** Collapsible reference of every keyboard shortcut. */
function Shortcuts() {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 pb-1 pt-3 text-left"
      >
        <span className="text-[11px] uppercase tracking-wide text-dim">Shortcuts</span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="ml-auto text-dim">
          <Icon name="chevronRight" size={13} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-3">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="flex items-center gap-3 py-1.5">
                  <div className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </div>
                  <span className="text-[12.5px] text-mist">{s.label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  onToggleTicks,
  onToggleChimes,
  heartbeatInterval,
  onSetHeartbeatInterval,
}: {
  open: boolean;
  onClose: () => void;
  ticksOn: boolean;
  chimesOn: boolean;
  onToggleTicks: () => void;
  onToggleChimes: () => void;
  heartbeatInterval: number;
  onSetHeartbeatInterval: (seconds: number) => void;
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

              {/* Cadence */}
              <div className="px-5 pb-1 pt-4 text-[11px] uppercase tracking-wide text-dim">Cadence</div>
              <div className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-chalk">Update interval</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-dim">
                    How often the agent checks in. Stall is flagged after ~3 missed updates
                    (now {stallSecondsFor(heartbeatInterval)}s).
                  </div>
                </div>
                <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
                  {HEARTBEAT_OPTIONS.map((o) => (
                    <button
                      key={o.seconds}
                      onClick={() => onSetHeartbeatInterval(o.seconds)}
                      className={`px-2 py-1 font-mono text-[11px] transition-colors ${
                        heartbeatInterval === o.seconds ? "bg-line-2 text-chalk" : "text-dim hover:text-mist"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shortcuts */}
              <Shortcuts />

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
