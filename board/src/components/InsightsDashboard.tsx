import { useMemo, useState } from "react";
import type { KnowledgeEntry } from "../lib/types";

const STATUS_DOT: Record<string, string> = {
  applied: "bg-mint", // green — settled, in the conductor
  proven: "bg-amber", // amber — will auto-apply next run
  emerging: "bg-mist", // grey — still watching
  open: "bg-dim",
};

const STATUS_ORDER = ["open", "emerging", "proven", "applied"];

function cardIndex(k: KnowledgeEntry): number {
  const n = Number(k.source_card ?? k.step);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function cardTitle(k: KnowledgeEntry): string {
  return k.source_card_title || (k.source_card !== undefined ? `Card ${k.source_card}` : k.step ? `Card ${k.step}` : "Workflow");
}

function groupByCard(items: KnowledgeEntry[]) {
  const map = new Map<string, { key: string; title: string; index: number; items: KnowledgeEntry[] }>();
  for (const item of items) {
    const title = item.source_card_title ? cardTitle(item) : item.source_card !== undefined || item.step ? cardTitle(item) : "Workflow";
    const index = item.source_card_title || item.source_card !== undefined || item.step ? cardIndex(item) : Number.MAX_SAFE_INTEGER - 1;
    const key = `${index}:${title}`;
    const group = map.get(key) ?? { key, title, index, items: [] };
    group.items.push(item);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => a.index - b.index || a.title.localeCompare(b.title));
}

function Row({ k }: { k: KnowledgeEntry }) {
  const [open, setOpen] = useState(false);
  const detail = k.detail || k.note || k.current || k.proposed;
  return (
    <div className="rounded-lg border border-line bg-panel/40 px-3 py-2">
      <button onClick={() => detail && setOpen((o) => !o)} className="flex w-full items-start gap-2 text-left">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[k.status] ?? "bg-dim"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-chalk">{k.title}</span>
            {k.id && (
              <span className="rounded border border-line-2 px-1 font-mono text-[9px] text-dim">
                {k.id}
              </span>
            )}
            {k.tag && (
              <span className="rounded border border-amber/25 bg-amber/[0.08] px-1 font-mono text-[9px] text-amber">
                {k.tag}
              </span>
            )}
            {k.step && !k.source_card_title && (
              <span className="rounded border border-cyan/25 bg-cyan/[0.08] px-1 font-mono text-[9px] text-cyan">
                {k.step}
              </span>
            )}
            {k.scope && (
              <span className="rounded border border-line-2 px-1 font-mono text-[9px] text-mist">
                {k.scope}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-mist">
            {k.source || "agent"} · {k.status}
            {typeof k.observed === "number" ? ` · observed ${k.observed}×` : ""}
            {k.source_card_title ? ` · ${k.source_card_title}` : ""}
            {k.source_run ? ` · run ${k.source_run}` : ""}
            {k.created ? ` · ${new Date(k.created).toLocaleString()}` : ""}
            {k.run_applied || k.applied_in ? ` · applied ${k.run_applied ?? k.applied_in}` : ""}
          </div>
        </div>
      </button>
      {open && detail && (
        <div className="mt-2 space-y-1 border-t border-line/60 pt-2 pl-6">
          {k.detail && <p className="text-[11px] leading-snug text-mist-2">{k.detail}</p>}
          {k.note && <p className="text-[11px] leading-snug text-mist-2">{k.note}</p>}
          {k.current && (
            <p className="font-mono text-[10.5px] text-rose/80">
              <span className="text-line-2">− </span>
              {k.current}
            </p>
          )}
          {k.proposed && (
            <p className="font-mono text-[10.5px] text-mint/90">
              <span className="text-line-2">+ </span>
              {k.proposed}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CardGroupList({ items }: { items: KnowledgeEntry[] }) {
  const groups = useMemo(() => groupByCard(items), [items]);
  if (items.length === 0) return null;
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-mint/80" />
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-mist-2">
              {group.title}
            </h3>
            <span className="font-mono text-[10px] text-line-2">{group.items.length}</span>
          </div>
          <div className="space-y-1.5">
            {group.items.map((k, i) => (
              <Row key={`${k.id ?? k.title}-${i}`} k={k} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

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
        <span className="ml-auto font-mono text-[10px] text-dim">{open ? "hide" : "show"}</span>
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
      {open && (
        <div className="mt-5">
          <CardGroupList items={items} />
        </div>
      )}
    </div>
  );
}

/**
 * The persistent insights page (§5.5 / §10). Reads the conductor's knowledge
 * section — the conductor IS the knowledge base. Browse any time: proven
 * patterns auto-apply in the Phase 0 improvement pass, so this is informational,
 * not an execution step.
 */
export function InsightsDashboard({
  workflow,
  knowledge,
  runCount,
  currentRunId,
}: {
  workflow: string;
  knowledge: KnowledgeEntry[];
  runCount: number;
  currentRunId?: string;
}) {
  const fresh = currentRunId ? knowledge.filter((k) => k.source_run === currentRunId) : [];
  const accumulated = fresh.length > 0 ? knowledge.filter((k) => k.source_run !== currentRunId) : knowledge;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5 flex items-baseline gap-2.5">
        <h2 className="font-mono text-lg font-medium text-chalk">{workflow} · insights</h2>
        <span className="font-mono text-[12px] text-mist">
          {runCount} run{runCount === 1 ? "" : "s"} · {knowledge.length} total
          {fresh.length > 0 ? ` · ${fresh.length} fresh` : ""}
        </span>
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
            <CardGroupList items={fresh} />
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
