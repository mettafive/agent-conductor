import type { BoardModel } from "../lib/types";
import { renderNote } from "../lib/heartbeat";
import { Icon } from "./Icon";
import { Led } from "./Led";
import { AppearIcon } from "./Appear";

/** Shown when a run is complete — a readable recap of what happened + what was learned,
 *  synthesised from the steps' final heartbeats and insights, then the per-step results. */
export function SummaryView({ model }: { model: BoardModel }) {
  const failed = model.overallStatus === "failed";
  const wf = model.steps.filter((s) => s.phase === "workflow");

  // "What happened" — each step's closing beat (its handoff context, else its last note).
  const happened = wf
    .map((s) => {
      const fb = s.heartbeat.find((h) => h.finalBeat);
      const note = fb?.handoff?.context ?? fb?.note ?? s.heartbeat.at(-1)?.note ?? null;
      return { id: s.id, note, done: s.column === "done" };
    })
    .filter((x) => x.note);

  // Insights the agent surfaced during the run (deduped by seed).
  const seen = new Set<string>();
  const insights = wf
    .flatMap((s) => s.heartbeat)
    .map((h) => h.insight)
    .filter((ins): ins is NonNullable<typeof ins> => !!ins && !seen.has(ins.seed) && !!seen.add(ins.seed));

  const knowledge = model.knowledge ?? [];
  const directives = (model.developerNotes ?? []).filter((n) => n.directive);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex flex-col items-center text-center">
        <AppearIcon swap={failed ? "fail" : "done"}>
          <span className={failed ? "text-rose" : "text-mint"}>
            <Icon name={failed ? "cross" : "check"} size={28} />
          </span>
        </AppearIcon>
        <h2 className="mt-2 text-xl font-medium text-chalk">
          {model.workflow} — {failed ? "failed" : "complete"}
        </h2>
        <p className="mt-1 text-[13px] text-mist">
          {model.unitsDone}/{model.unitsTotal} units
        </p>
      </div>

      {/* What happened — the run's story, from each step's closing beat */}
      {happened.length > 0 && (
        <Section title="What happened">
          <ol className="space-y-2">
            {happened.map((h) => (
              <li key={h.id} className="flex gap-2.5">
                <span className="mt-[3px] shrink-0">
                  <Led state={h.done ? "done" : "failed"} />
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[11px] text-mist">{h.id}</div>
                  <p className="text-[12.5px] leading-snug text-mist-2">{renderNote(h.note!)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* What we learned — insights surfaced + durable knowledge */}
      {(insights.length > 0 || knowledge.length > 0) && (
        <Section title="What we learned">
          <ul className="space-y-1.5">
            {insights.map((ins, i) => (
              <li key={`i${i}`} className="flex gap-2 text-[12px] leading-snug text-mist-2">
                <span className="mt-px shrink-0 rounded bg-amber/15 px-1 font-mono text-[9px] text-amber">
                  {ins.type}
                </span>
                <span className="flex-1">{ins.seed}</span>
              </li>
            ))}
            {knowledge.map((k, i) => (
              <li key={`k${i}`} className="flex gap-2 text-[12px] leading-snug text-mist-2">
                <span className="mt-px shrink-0 rounded bg-line-2/60 px-1 font-mono text-[9px] text-mist">
                  {k.status}
                </span>
                <span className="flex-1">{k.title}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Directives the flow manager set, and what became of them */}
      {directives.length > 0 && (
        <Section title="Directives you set">
          <ul className="space-y-1.5">
            {directives.map((d, i) => (
              <li key={`d${i}`} className="flex gap-2 text-[12px] leading-snug text-mist-2">
                <span
                  className={`mt-px shrink-0 rounded px-1 font-mono text-[9px] ${
                    d.status === "applied"
                      ? "bg-mint/15 text-mint"
                      : d.status === "deferred"
                        ? "bg-line-2/60 text-dim"
                        : "bg-line-2/60 text-mist"
                  }`}
                >
                  {d.status}
                </span>
                <span className="flex-1">
                  {d.text}
                  {d.resolution && <span className="mt-0.5 block text-[10.5px] text-dim">↳ {d.resolution}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Per-step results */}
      <Section title="Steps">
        <div className="space-y-1.5">
          {wf.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2">
              <Led state={s.column} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-chalk">{s.id}</span>
              {s.isLoop && s.loop && (
                <span className="shrink-0 font-mono text-[10px] text-mist">
                  {s.loop.completed}/{s.loop.total}
                </span>
              )}
              {s.criteria.length > 0 && (
                <span className="shrink-0 font-mono text-[10px] text-mist">
                  {s.criteria.filter((c) => c.passed === true).length}/{s.criteria.length} gates
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-mist">{title}</div>
      {children}
    </div>
  );
}
