import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { KnowledgeEntry } from "../lib/types";

const STATUS_ORDER = ["open", "emerging", "proven", "applied"];

/** The card an insight came from — used as the insight's title. */
export function cardTitle(k: KnowledgeEntry): string {
  return (
    k.source_card_title ||
    (k.source_card !== undefined ? `Card ${k.source_card}` : k.step ? `Card ${k.step}` : "Workflow")
  );
}

function detailOf(k: KnowledgeEntry): string | undefined {
  return k.detail || k.note || k.current || k.proposed || undefined;
}

/** Full, copyable dump of insights — title, ids, tag, status, and all the metadata
 *  we deliberately hide from the clean view but keep available via Copy. */
export function insightsClipboardText(items: KnowledgeEntry[]): string {
  return items
    .map((k) => {
      const head = [k.id, cardTitle(k), k.tag, k.status].filter(Boolean).join(" · ");
      const body = detailOf(k) ?? "";
      const meta = [
        k.scope ? `scope: ${k.scope}` : null,
        k.source ? `source: ${k.source}` : null,
        typeof k.observed === "number" ? `observed ${k.observed}×` : null,
        k.source_run ? `run ${k.source_run}` : null,
        k.run_applied || k.applied_in ? `applied ${k.run_applied ?? k.applied_in}` : null,
        k.created ? new Date(k.created).toISOString() : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return [head, body, meta ? `(${meta})` : null].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

/** One insight — static, nothing to open. Title is the card it came from; the
 *  sentence sits beneath it; the tag and K-id are the only chips. */
function InsightCard({ k }: { k: KnowledgeEntry }) {
  const detail = detailOf(k);
  return (
    <div className="rounded-lg border border-line bg-panel/40 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[12px] text-chalk">{cardTitle(k)}</span>
        {k.id && (
          <span className="rounded border border-line-2 px-1 font-mono text-[9px] text-dim">{k.id}</span>
        )}
        {k.tag && (
          <span className="rounded border border-amber/25 bg-amber/[0.08] px-1 font-mono text-[9px] text-amber">
            {k.tag}
          </span>
        )}
      </div>
      {detail && <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-2">{detail}</p>}
    </div>
  );
}

function InsightList({ items }: { items: KnowledgeEntry[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map((k, i) => (
        <InsightCard key={`${k.id ?? k.title}-${i}`} k={k} />
      ))}
    </div>
  );
}

/** Earlier insights — the ONLY thing that opens/closes. Fades in (no height
 *  animation) so the long list never jumps the layout while measuring. */
function AccumulatedGroup({ items }: { items: KnowledgeEntry[] }) {
  if (items.length === 0) return null;
  const [open, setOpen] = useState(false);
  const tags = Array.from(new Set(items.map((item) => item.tag).filter(Boolean))) as string[];
  return (
    <div className="rounded-xl border border-line bg-panel/25 p-4">
      <button type="button" onClick={() => setOpen((next) => !next)} className="flex w-full flex-wrap items-baseline gap-2 text-left">
        <h3 className="font-mono text-[13px] font-semibold uppercase tracking-[0.12em] text-chalk">Earlier insights</h3>
        <span className="font-mono text-[10px] text-line-2">{items.length}</span>
        <span className="font-mono text-[10px] text-dim">accumulated across prior runs</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="ml-auto font-mono text-[11px] leading-none text-dim"
        >
          ›
        </motion.span>
      </button>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((status) => {
          const count = items.filter((item) => item.status === status).length;
          if (!count) return null;
          return (
            <span key={status} className="rounded border border-line/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-mist">
              {status} {count}
            </span>
          );
        })}
        {tags.map((tag) => (
          <span key={tag} className="rounded border border-amber/25 bg-amber/[0.08] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-amber">
            {tag} {items.filter((item) => item.tag === tag).length}
          </span>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="earlier"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mt-5"
          >
            <InsightList items={items} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The persistent insights page (§5.5 / §10). The workflow name + Close + Copy
 * live in the modal header. This body shows a slim stat strip, the run's fresh
 * insights as a flat list (always open — nothing to expand), and the earlier
 * insights behind a single collapsible.
 */
export function InsightsDashboard({
  knowledge,
  runCount,
  currentRunId,
}: {
  knowledge: KnowledgeEntry[];
  runCount: number;
  currentRunId?: string;
}) {
  const fresh = currentRunId ? knowledge.filter((k) => k.source_run === currentRunId) : [];
  const accumulated = fresh.length > 0 ? knowledge.filter((k) => k.source_run !== currentRunId) : knowledge;

  return (
    <div className="mx-auto max-w-4xl px-6 py-7">
      <div className="mb-5 font-mono text-[12px] text-mist">
        {runCount} run{runCount === 1 ? "" : "s"} · {knowledge.length} total
        {fresh.length > 0 ? (
          <>
            {" · "}
            <span className="text-mint">{fresh.length} fresh</span>
          </>
        ) : null}
      </div>

      {knowledge.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel/40 px-4 py-8 text-center font-mono text-[12px] text-line-2">
          No knowledge yet. It accumulates in the conductor file as runs complete —
          the agent writes what it learns, and the board escalates the patterns it
          keeps seeing until they auto-apply.
        </div>
      ) : (
        <div className="space-y-6">
          {fresh.length > 0 ? (
            <InsightList items={fresh} />
          ) : (
            <div className="rounded-xl border border-line bg-panel/40 px-4 py-8 text-center font-mono text-[12px] text-line-2">
              No fresh insights for this run yet.
            </div>
          )}
          <AccumulatedGroup items={accumulated} />
        </div>
      )}
    </div>
  );
}
