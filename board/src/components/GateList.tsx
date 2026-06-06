import { motion } from "framer-motion";
import type { GateCriterion } from "../lib/types";
import { Icon } from "./Icon";
import { Led } from "./Led";
import { AppearIcon } from "./Appear";

/** Pass / fail / not-yet mark — thin SVG icons that ease in, + a pending LED.
 *  `tone` lets the check inherit the surrounding pill colour. */
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
 * The checker result for a step or sub-step. Shared by the active card, step
 * detail and iteration cards so the look is identical everywhere.
 */
export function GateList({
  criteria,
  bordered = true,
  settled = false,
}: {
  criteria: GateCriterion[];
  bordered?: boolean;
  /** The owning step/sub-step is done. A done step's checker passed to advance, so any
   *  criterion left unrecorded renders as passed — never a stale/"dead" pending check. */
  settled?: boolean;
}) {
  const list = criteria.length ? criteria : [{ text: "pending checker result", name: "Pending checker result", passed: null }];
  return (
    <div className={bordered ? "mt-4 border-t border-line pt-3" : ""}>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-mist">checker</div>
      {list.map((c, i) => {
        // On a settled (done) step, an unrecorded criterion is shown as passed, not pending.
        const passed = c.passed ?? (settled ? true : null);
        const pill = passed === false ? "border-rose/30 text-rose" : passed === true ? "border-mint/30 text-mint" : "border-line-2 text-mist";
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
                title={c.checker ? `checked by ${c.checker}` : undefined}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px] leading-none ${pill}`}
              >
                <Mark passed={passed} size={10} tone />
                check
              </span>
              {c.checker && <span className="font-mono text-[9px] text-mist">{c.checker}</span>}
            </div>
            {/* criterion text — its own full-width line, never squeezed into a narrow column. */}
            <div className="mt-1 font-mono text-[11.5px] leading-snug text-mist-2">
              {c.name ?? c.text}
            </div>
            {c.evidence && <div className="mt-1 text-[11px] leading-snug text-dim">{c.evidence}</div>}
          </motion.div>
        );
      })}
    </div>
  );
}
