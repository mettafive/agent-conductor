import { useState } from "react";
import type { BoardModel, KnowledgeEntry } from "../lib/types";
import { renderNote } from "../lib/heartbeat";
import { Icon } from "./Icon";
import { Led } from "./Led";
import { AppearIcon } from "./Appear";

/** Shown when a run is complete — a distilled recap, not a data dump: what it PRODUCED first,
 *  then a tight one-line-per-step story, then learnings grouped into a digest (what this run did
 *  + what's new up front; the backlog folded behind a count). */
export function SummaryView({ model }: { model: BoardModel }) {
  const failed = model.overallStatus === "failed";
  const wf = model.steps.filter((s) => s.phase === "workflow");

  // Outcome — what the run actually produced (the headline), from each step's finalBeat handoff.
  const produced = Array.from(
    new Set(
      wf
        .flatMap((s) => s.heartbeat.filter((h) => h.finalBeat).map((h) => h.handoff?.produced))
        .filter((p): p is string => !!p && p.trim().length > 0),
    ),
  );

  // What happened — each step's closing beat + its gate/loop tally, ONE line (absorbs the old "Steps").
  const happened = wf.map((s) => {
    const fb = s.heartbeat.find((h) => h.finalBeat);
    const note = fb?.handoff?.context ?? fb?.note ?? s.heartbeat.at(-1)?.note ?? null;
    const gates = s.criteria.length
      ? `${s.criteria.filter((c) => c.passed === true).length}/${s.criteria.length} gates`
      : null;
    const loop = s.isLoop && s.loop ? `${s.loop.completed}/${s.loop.total}` : null;
    return { id: s.id, note, column: s.column, gates, loop };
  });

  // What we learned — grouped by lifecycle stage, each insight expandable to its note + change.
  const knowledge = model.knowledge ?? [];
  const emerging = knowledge.filter((k) => k.status === "emerging"); // found this run, feeds forward
  const proven = knowledge.filter((k) => k.status === "proven"); // trusted, auto-applied at start
  const standing = knowledge.filter((k) => k.status === "applied"); // durable changes already baked in
  const open = knowledge.filter((k) => k.status === "open"); // noticed, not yet acted on
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

      {/* What happened — one tight line per step, gate/loop tally inline, note clamped */}
      <Section title="What happened">
        <ol className="space-y-2.5">
          {happened.map((h) => (
            <li key={h.id} className="flex gap-2.5">
              <span className="mt-[3px] shrink-0">
                <Led state={h.column} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-chalk">{h.id}</span>
                  {h.loop && <span className="font-mono text-[10px] text-mist">{h.loop}</span>}
                  {h.gates && <span className="font-mono text-[10px] text-mist">{h.gates}</span>}
                </div>
                {h.note && (
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-mist-2">{renderNote(h.note)}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* What we learned — what this run found + what shaped it up front; the rest collapsed.
          Every insight expands to its note + current→proposed, so the depth is there on demand. */}
      {knowledge.length > 0 && (
        <Section title="What we learned">
          {emerging.length > 0 && <LearnGroup label="New this run" hint="found here, feeds the next run" tone="amber" items={emerging} />}
          {proven.length > 0 && <LearnGroup label="Applied at start" hint="trusted lessons auto-applied in Phase 0" tone="mint" items={proven} />}
          {standing.length > 0 && <LearnGroup label="Standing rules" tone="dim" items={standing} collapsible />}
          {open.length > 0 && <LearnGroup label="Open — needs action" tone="dim" items={open} collapsible />}
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
    </div>
  );
}

const TONE = {
  amber: { dot: "bg-amber", txt: "text-amber" },
  mint: { dot: "bg-mint", txt: "text-mint" },
  dim: { dot: "bg-line-2", txt: "text-mist" },
} as const;

/** A lifecycle group of insights. Surfaced groups show inline; `collapsible` ones fold behind
 *  a count. Every item inside is independently expandable to its full context. */
function LearnGroup({
  label,
  hint,
  tone,
  items,
  collapsible,
}: {
  label: string;
  hint?: string;
  tone: keyof typeof TONE;
  items: KnowledgeEntry[];
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const t = TONE[tone];
  return (
    <div className="mb-3">
      <button
        onClick={() => collapsible && setOpen((v) => !v)}
        className={`mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide ${t.txt} ${
          collapsible ? "hover:opacity-80" : "cursor-default"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
        {label} <span className="text-mist">· {items.length}</span>
        {hint && <span className="font-sans normal-case tracking-normal text-dim">— {hint}</span>}
        {collapsible && <span className="text-dim">{open ? "▾" : "▸"}</span>}
      </button>
      {open && (
        <ul className="space-y-0.5 pl-3.5">
          {items.map((k, i) => (
            <InsightItem key={i} k={k} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One insight — the title is the clickable summary; clicking reveals its captured depth
 *  (the evidence `note`, any `current → proposed` change, and where/how often it was seen). */
function InsightItem({ k }: { k: KnowledgeEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(k.note || k.current || k.proposed);
  const meta = [k.scope, k.step, k.observed ? `seen ${k.observed}×` : null].filter(Boolean).join(" · ");
  return (
    <li className="text-[12px] leading-snug">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-start gap-1.5 py-0.5 text-left text-mist-2 ${
          hasDetail ? "hover:text-chalk" : "cursor-default"
        }`}
      >
        <span className={`mt-px shrink-0 text-[9px] ${hasDetail ? "text-dim" : "text-transparent"}`}>
          {open ? "▾" : "▸"}
        </span>
        <span className="flex-1">{k.title}</span>
      </button>
      {open && hasDetail && (
        <div className="mb-1 ml-3 space-y-1.5 border-l border-line pl-2.5">
          {k.note && <p className="text-[11.5px] leading-snug text-mist">{k.note}</p>}
          {(k.current || k.proposed) && (
            <div className="space-y-0.5 font-mono text-[10.5px] leading-snug">
              {k.current && <div className="text-rose/80">− {k.current}</div>}
              {k.proposed && <div className="text-mint/80">+ {k.proposed}</div>}
            </div>
          )}
          {meta && <div className="text-[10px] text-dim">{meta}</div>}
        </div>
      )}
    </li>
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
