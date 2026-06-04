import { motion } from "framer-motion";
import type { GateCriterion } from "../lib/types";
import { Icon } from "./Icon";
import { Led } from "./Led";
import { AppearIcon } from "./Appear";

/** Pass / fail / not-yet mark — thin SVG icons that ease in, + a pending LED. */
function Mark({ passed }: { passed?: boolean | null }) {
  if (passed === true)
    return (
      <AppearIcon swap="pass">
        <span className="text-mint">
          <Icon name="check" size={13} />
        </span>
      </AppearIcon>
    );
  if (passed === false)
    return (
      <AppearIcon swap="fail">
        <span className="text-rose">
          <Icon name="cross" size={13} />
        </span>
      </AppearIcon>
    );
  return <Led state="pending" />;
}

/**
 * The gate criteria for a step or sub-step. Shared by the active card, step
 * detail and iteration cards so the look is identical everywhere. The
 * verified/attested distinction is a small text label rather than a 🔒/✋ emoji.
 */
export function GateList({
  criteria,
  bordered = true,
  settled = false,
}: {
  criteria: GateCriterion[];
  bordered?: boolean;
  /** The owning step/sub-step is done. A done step's gates all passed to advance, so any
   *  criterion left unrecorded renders as passed — never a stale/"dead" pending check. */
  settled?: boolean;
}) {
  if (criteria.length === 0) return null;
  return (
    <div className={bordered ? "mt-4 border-t border-line pt-3" : ""}>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-mist">gate</div>
      {criteria.map((c, i) => {
        // On a settled (done) step, an unrecorded criterion is shown as passed, not pending.
        const passed = c.passed ?? (settled ? true : null);
        return (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex items-start gap-2 py-1"
        >
          <span className="mt-0.5 w-3 text-center font-mono text-[11px]">
            <Mark passed={passed} />
          </span>
          <span
            className={`rounded border px-1 py-px font-mono text-[9px] ${
              c.kind === "hard" ? "border-mint/25 text-mint" : "border-line-2 text-mist"
            }`}
          >
            {c.kind}
          </span>
          {c.verified ? (
            <span title="verified by the gate-runner" className="font-mono text-[9px] text-mint">
              verified
            </span>
          ) : passed === true ? (
            <span title="attested by the agent" className="font-mono text-[9px] text-amber/80">
              attested
            </span>
          ) : null}
          <span className="flex-1 font-mono text-[11.5px] leading-snug text-mist-2">
            {c.kind === "hard" && c.name ? c.name : c.text}
            {c.kind === "hard" && typeof c.exitCode === "number" && (
              <span className="ml-1 text-mist">exit {c.exitCode}</span>
            )}
          </span>
        </motion.div>
        );
      })}
    </div>
  );
}
