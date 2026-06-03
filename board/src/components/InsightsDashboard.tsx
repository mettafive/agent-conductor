import { useState } from "react";
import type { KnowledgeEntry } from "../lib/types";

const STATUS_ICON: Record<string, string> = {
  applied: "✅",
  proven: "⚡",
  emerging: "🟡",
  open: "📤",
};

const SCOPE_ICON: Record<string, string> = {
  "this-conductor": "🎯",
  upstream: "📤",
  template: "🧩",
  tooling: "🔧",
  corpus: "🗂",
};

function Row({ k }: { k: KnowledgeEntry }) {
  const [open, setOpen] = useState(false);
  const detail = k.current || k.proposed || k.note;
  return (
    <div className="rounded-lg border border-line bg-panel/40 px-3 py-2">
      <button onClick={() => detail && setOpen((o) => !o)} className="flex w-full items-start gap-2 text-left">
        <span className="mt-0.5 text-[13px]">{STATUS_ICON[k.status] ?? "·"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-chalk">{k.title}</span>
            {k.step && (
              <span className="rounded border border-iris/25 bg-iris/[0.08] px-1 font-mono text-[9px] text-iris">
                {k.step}
              </span>
            )}
            <span className="rounded border border-line-2 px-1 font-mono text-[9px] text-mist">
              {SCOPE_ICON[k.scope] ?? ""} {k.scope}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-mist">
            {k.status} · observed {k.observed}×
            {k.run_applied ? ` · applied ${k.run_applied}` : ""}
          </div>
        </div>
      </button>
      {open && detail && (
        <div className="mt-2 space-y-1 border-t border-line/60 pt-2 pl-6">
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
          {k.note && <p className="text-[11px] leading-snug text-mist-2">{k.note}</p>}
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, items }: { title: string; hint?: string; items: KnowledgeEntry[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-mist-2">{title}</h3>
        <span className="font-mono text-[10px] text-line-2">{items.length}</span>
        {hint && <span className="font-mono text-[10px] text-line-2">{hint}</span>}
      </div>
      <div className="space-y-1.5">
        {items.map((k, i) => (
          <Row key={`${k.title}-${i}`} k={k} />
        ))}
      </div>
    </div>
  );
}

/**
 * The persistent insights page (§5.5 / §10). Reads the conductor's knowledge
 * section — the conductor IS the knowledge base. Browse any time: proven
 * patterns auto-apply in the Phase 0 improvement pass, so this is informational,
 * not an approval step.
 */
export function InsightsDashboard({
  workflow,
  knowledge,
  runCount,
}: {
  workflow: string;
  knowledge: KnowledgeEntry[];
  runCount: number;
}) {
  const local = (status: string) =>
    knowledge.filter((k) => (k.scope || "this-conductor") === "this-conductor" && k.status === status);
  const byScope = (sc: string) => knowledge.filter((k) => (k.scope || "this-conductor") === sc);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-5 flex items-baseline gap-2.5">
        <span className="text-lg">✨</span>
        <h2 className="font-mono text-lg font-medium text-chalk">{workflow}</h2>
        <span className="font-mono text-[12px] text-mist">
          {runCount} run{runCount === 1 ? "" : "s"} · {knowledge.length} knowledge entr
          {knowledge.length === 1 ? "y" : "ies"}
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
          <Section title="⚡ Proven" hint="auto-applies next run" items={local("proven")} />
          <Section title="✅ Applied" items={local("applied")} />
          <Section title="🟡 Emerging — watching" items={local("emerging")} />
          <Section title="📤 Upstream — routed outside this conductor" items={byScope("upstream")} />
          <Section title="🧩 Template" items={byScope("template")} />
          <Section title="🔧 Tooling — agent-conductor itself" items={byScope("tooling")} />
          <Section title="🗂 Corpus" items={byScope("corpus")} />
        </div>
      )}
    </div>
  );
}
