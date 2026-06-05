import { motion } from "framer-motion";
import type { GateCriterion } from "../lib/types";
import { Icon } from "./Icon";
import { Led } from "./Led";
import { AppearIcon } from "./Appear";

/** Pass / fail / not-yet mark — thin SVG icons that ease in, + a pending LED.
 *  `tone` lets the check inherit the surrounding pill colour (so an attested pass
 *  reads amber, a verified pass reads mint) instead of forcing its own. */
function Mark({ passed, size = 13, tone = false }: { passed?: boolean | null; size?: number; tone?: boolean }) {
  if (passed === true)
    return (
      <AppearIcon swap="pass">
        <span className={tone ? "" : "text-mint"}>
          <Icon name="check" size={size} />
        </span>
      </AppearIcon>
    );
  if (passed === false)
    return (
      <AppearIcon swap="fail">
        <span className="text-rose">
          <Icon name="cross" size={size} />
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
        // A passed criterion is either verified (gate-runner observed it) or merely attested by
        // the agent. We keep that trust signal — but as a tint on the kind pill + a tooltip, never
        // as a word competing with the criterion text for the horizontal line.
        const attested = passed === true && !c.verified;
        const pill =
          c.kind === "hard"
            ? attested
              ? "border-amber/30 text-amber/90" // hard, but only attested — softer amber
              : "border-mint/30 text-mint" // hard + verified
            : "border-line-2 text-mist"; // soft (judgment) — neutral
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="py-1.5"
          >
            {/* badge line — the mark lives INSIDE the kind pill, so nothing competes for the
                criterion text's horizontal space. */}
            <div className="flex items-center gap-1.5">
              <span
                title={c.verified ? "verified by the gate-runner" : attested ? "attested by the agent" : undefined}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px] leading-none ${pill}`}
              >
                <Mark passed={passed} size={10} tone />
                {c.kind}
              </span>
              {c.kind === "hard" && typeof c.exitCode === "number" && (
                <span className="font-mono text-[9px] text-mist">exit {c.exitCode}</span>
              )}
            </div>
            {/* criterion text — its own full-width line, never squeezed into a narrow column. */}
            <div className="mt-1 font-mono text-[11.5px] leading-snug text-mist-2">
              {c.kind === "hard" && c.name ? c.name : c.text}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
