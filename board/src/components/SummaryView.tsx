import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BoardModel, KnowledgeEntry } from "../lib/types";
import { renderNote } from "../lib/heartbeat";
import { fmtDurCompact } from "../lib/format";
import { Icon } from "./Icon";
import { Led } from "./Led";
import { AppearIcon } from "./Appear";

/** Shown when a run is complete. Kept deliberately spare: the outcome (Produced), then ONE clean
 *  list of the insights gathered THIS run. Applied/standing knowledge is not repeated here — it
 *  lives in the Insights tab. The per-step recap is demoted behind a count. */
export function SummaryView({ model }: { model: BoardModel }) {
  const failed = model.overallStatus === "failed";
  const wf = model.steps.filter((s) => s.phase === "workflow");
  const duration = fmtDurCompact(model.startedAt, model.endedAt);

  // Outcome — what the run actually produced (the headline), from each step's finalBeat handoff.
  const produced = Array.from(
    new Set(
      wf
        .flatMap((s) => s.heartbeat.filter((h) => h.finalBeat).map((h) => h.handoff?.produced))
        .filter((p): p is string => !!p && p.trim().length > 0),
    ),
  );

  // What happened — each step's closing beat + its gate/loop tally, ONE line.
  const happened = wf.map((s) => {
    const fb = s.heartbeat.find((h) => h.finalBeat);
    const note = fb?.handoff?.context ?? fb?.note ?? s.heartbeat.at(-1)?.note ?? null;
    const gates = s.criteria.length
      ? `${s.criteria.filter((c) => c.passed === true).length}/${s.criteria.length} checks`
      : null;
    const loop = s.isLoop && s.loop ? `${s.loop.completed}/${s.loop.total}` : null;
    return { id: s.id, title: s.title, note, column: s.column, gates, loop };
  });

  // Insights gathered THIS run — one clean list. Prefer the run id; fall back to lifecycle
  // status when no run id is set. Applied/standing knowledge is intentionally excluded.
  const knowledge = model.knowledge ?? [];
  const thisRun = model.runId
    ? knowledge.filter((k) => k.source_run === model.runId)
    : knowledge.filter((k) => k.status === "emerging" || k.status === "open");
  const earlierCount = knowledge.length - thisRun.length;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex flex-col items-center text-center">
        <AppearIcon swap={failed ? "fail" : "done"}>
          <span className={failed ? "text-rose" : "text-mint"}>
            <Icon name={failed ? "cross" : "check"} size={28} />
          </span>
        </AppearIcon>
        <h2 className="mt-2 text-xl font-medium text-chalk">{failed ? "Run failed" : "Run complete"}</h2>
        <p className="mt-1 font-mono text-[12px] text-mist">
          {model.workflow} · {model.unitsDone}/{model.unitsTotal} units
          {duration ? ` · ${duration}` : ""}
        </p>
      </div>

      {/* Produced — the actual result, surfaced first */}
      {produced.length > 0 && (
        <Section title="Produced">
          <ul className="space-y-1.5">
            {produced.map((p, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] leading-snug text-mist-2"
              >
                <span className="mt-[3px] shrink-0 text-mint">
                  <Icon name="check" size={11} />
                </span>
                <span className="min-w-0 flex-1">{renderNote(p)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Insights gathered this run — one clean list, each expandable. */}
      <Section title="Insights gathered this run" emphasis>
        {thisRun.length === 0 ? (
          <p className="text-[12px] leading-snug text-mist">No new insights this run.</p>
        ) : (
          <ul className="divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-panel">
            {thisRun.map((k, i) => (
              <InsightItem key={k.id ?? i} k={k} />
            ))}
          </ul>
        )}
        {earlierCount > 0 && (
          <p className="mt-2 font-mono text-[10px] text-dim">
            + {earlierCount} earlier insight{earlierCount === 1 ? "" : "s"} kept in the conductor — see the Insights tab.
          </p>
        )}
      </Section>

      {/* What happened — context, collapsed behind a count. */}
      {happened.length > 0 && <Happened steps={happened} />}
    </div>
  );
}

/** One insight — title is the clickable summary; clicking smoothly reveals its captured depth
 *  (the detail/evidence, any current→proposed change, and where/how often it was seen). */
function InsightItem({ k }: { k: KnowledgeEntry }) {
  const [open, setOpen] = useState(false);
  const detail = k.detail || k.note;
  const hasDetail = !!(detail || k.current || k.proposed);
  const meta = [k.tag, k.scope, k.observed ? `seen ${k.observed}×` : null].filter(Boolean).join(" · ");
  return (
    <li className="px-3 text-[12px] leading-snug">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-start gap-1.5 py-2 text-left text-chalk ${hasDetail ? "hover:text-chalk" : "cursor-default"}`}
      >
        {hasDetail ? (
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mt-px shrink-0 text-[10px] leading-none text-dim"
          >
            ›
          </motion.span>
        ) : (
          <span className="mt-px shrink-0 text-[10px] text-transparent">›</span>
        )}
        <span className="flex-1">{k.title}</span>
        {k.id && <span className="shrink-0 font-mono text-[9px] text-dim">{k.id}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            key="d"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mb-2 ml-3.5 space-y-1.5 border-l border-line pl-2.5">
              {detail && <p className="text-[11.5px] leading-snug text-mist">{detail}</p>}
              {(k.current || k.proposed) && (
                <div className="space-y-0.5 font-mono text-[10.5px] leading-snug">
                  {k.current && <div className="text-rose/80">− {k.current}</div>}
                  {k.proposed && <div className="text-mint/80">+ {k.proposed}</div>}
                </div>
              )}
              {meta && <div className="text-[10px] text-dim">{meta}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function Section({
  title,
  children,
  emphasis,
}: {
  title: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className={emphasis ? "mt-7" : "mt-6"}>
      <div className={`mb-2 font-mono text-[10px] uppercase tracking-wide ${emphasis ? "text-chalk" : "text-mist"}`}>
        {title}
      </div>
      {children}
    </div>
  );
}

type Happen = { id: string; title: string; note: string | null; column: string; gates: string | null; loop: string | null };

/** The per-step recap — context, not the payoff. Collapsed behind a count; one tight line per step. */
function Happened({ steps }: { steps: Happen[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-mist hover:opacity-80"
      >
        What happened <span className="text-dim">· {steps.length} steps</span>
        <motion.span aria-hidden animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease: "easeOut" }} className="text-dim">
          ›
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="space-y-2.5 overflow-hidden"
          >
            {steps.map((h) => (
              <li key={h.id} className="flex gap-2.5">
                <span className="mt-[3px] shrink-0">
                  <Led state={h.column} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-chalk">{h.title}</span>
                    {h.loop && <span className="font-mono text-[10px] text-mist">{h.loop}</span>}
                    {h.gates && <span className="font-mono text-[10px] text-mist">{h.gates}</span>}
                  </div>
                  {h.note && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-snug text-mist-2">{renderNote(h.note)}</p>
                  )}
                </div>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
