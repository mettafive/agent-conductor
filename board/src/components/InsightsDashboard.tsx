import { useState } from "react";
import type { InsightItem, InsightLedger, Suggestion } from "../lib/types";

const CONF_ICON: Record<string, string> = {
  proven: "✅",
  high: "🟢",
  medium: "🟡",
  low: "⚪",
};

function Row({
  item,
  onApply,
  onDismiss,
}: {
  item: InsightItem;
  onApply?: () => void;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const n = item.times_observed || 1;
  const scope = item.scope || "this-conductor";
  const canAct = item.status === "open" && scope === "this-conductor" && item.confidence !== "proven";
  const obs = item.observations ?? [];
  return (
    <div className="rounded-lg border border-line bg-panel/40 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[13px]">{CONF_ICON[item.confidence || "low"] ?? "⚪"}</span>
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-chalk">{item.title}</span>
            <span className="rounded border border-line-2 px-1 font-mono text-[9px] text-mist">
              {item.type}
            </span>
            {item.step && (
              <span className="rounded border border-iris/25 bg-iris/[0.08] px-1 font-mono text-[9px] text-iris">
                {item.step}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-mist">
            {n}× observed
            {item.times_applied ? ` · applied ${item.times_applied}×` : ""}
            {item.impact_when_applied ? ` · ${item.impact_when_applied}` : ""}
          </div>
        </button>
        {canAct && (
          <div className="flex shrink-0 items-center gap-1">
            {onApply && (
              <button
                onClick={onApply}
                className="rounded border border-iris/40 bg-iris/10 px-2 py-0.5 font-mono text-[10px] text-iris hover:bg-iris/15"
              >
                apply
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-mist hover:text-chalk"
              >
                dismiss
              </button>
            )}
          </div>
        )}
        {item.status === "applied" && <span className="shrink-0 font-mono text-[10px] text-mint">applied</span>}
        {item.status === "dismissed" && (
          <span className="shrink-0 font-mono text-[10px] text-line-2">dismissed</span>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2 pl-6">
          {item.rationale && <p className="text-[11px] leading-snug text-mist-2">{item.rationale}</p>}
          {(item.current || item.proposed) && (
            <div className="space-y-1 font-mono text-[10.5px]">
              {item.current && (
                <p className="text-rose/80">
                  <span className="text-line-2">− </span>
                  {item.current}
                </p>
              )}
              {item.proposed && (
                <p className="text-mint/90">
                  <span className="text-line-2">+ </span>
                  {item.proposed}
                </p>
              )}
            </div>
          )}
          {obs.length > 0 && (
            <div className="mt-1">
              <div className="font-mono text-[9px] uppercase tracking-wide text-line-2">
                observations
              </div>
              {obs.map((o, i) => (
                <div key={i} className="flex gap-1.5 py-0.5 text-[10.5px] text-mist">
                  <span className="text-line-2">·</span>
                  <span className="shrink-0 font-mono text-line-2">{o.run}</span>
                  <span className="min-w-0 flex-1">{o.note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  items,
  onApply,
  onDismiss,
}: {
  title: string;
  hint?: string;
  items: InsightItem[];
  onApply?: (i: InsightItem) => void;
  onDismiss?: (i: InsightItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-mist-2">
          {title}
        </h3>
        <span className="font-mono text-[10px] text-line-2">{items.length}</span>
        {hint && <span className="font-mono text-[10px] text-line-2">{hint}</span>}
      </div>
      <div className="space-y-1.5">
        {items.map((i) => (
          <Row
            key={i.key}
            item={i}
            onApply={onApply ? () => onApply(i) : undefined}
            onDismiss={onDismiss ? () => onDismiss(i) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The persistent insights page (§5.5). Browse any time — proven patterns are
 * auto-applied (no clicking required); the dashboard shows how a skill has
 * evolved and routes cross-cutting insights by scope.
 */
export function InsightsDashboard({
  workflow,
  ledger,
  runCount,
  onApply,
  onDismiss,
}: {
  workflow: string;
  ledger?: InsightLedger;
  runCount: number;
  onApply: (items: Suggestion[]) => Promise<{ ok: boolean; error?: string }>;
  onDismiss: (keys: string[]) => void;
}) {
  const items = ledger?.items ?? [];
  const open = items.filter((i) => i.status === "open");
  const local = (c: string) =>
    open.filter((i) => (i.scope || "this-conductor") === "this-conductor" && (i.confidence || "low") === c);
  const proven = items.filter((i) => i.status !== "dismissed" && (i.confidence || "low") === "proven");
  const byScope = (sc: string) => open.filter((i) => (i.scope || "this-conductor") === sc);
  const applied = items.filter((i) => i.status === "applied" && (i.confidence || "low") !== "proven");

  const apply = (i: InsightItem) =>
    onApply([
      {
        id: i.key,
        type: i.type,
        step: i.step,
        scope: i.scope,
        title: i.title,
        current: i.current,
        proposed: i.proposed,
        rationale: i.rationale,
      },
    ]);
  const dismiss = (i: InsightItem) => onDismiss([i.key]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-5 flex items-baseline gap-2.5">
        <span className="text-lg">✨</span>
        <h2 className="font-mono text-lg font-medium text-chalk">{workflow}</h2>
        <span className="font-mono text-[12px] text-mist">
          {runCount} run{runCount === 1 ? "" : "s"} · {items.length} insight
          {items.length === 1 ? "" : "s"}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel/40 px-4 py-8 text-center font-mono text-[12px] text-line-2">
          No insights yet. They accumulate as runs complete — the agent writes
          suggestions, the board escalates the ones it keeps seeing.
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="Proven — auto-applied" hint="no clicking required" items={proven} />
          <Section title="High confidence" items={local("high")} onApply={apply} onDismiss={dismiss} />
          <Section
            title="Emerging — 2–3×, watching"
            items={local("medium")}
            onApply={apply}
            onDismiss={dismiss}
          />
          <Section title="New — 1×" items={local("low")} onApply={apply} onDismiss={dismiss} />
          <Section
            title="📤 Upstream — routed outside this conductor"
            items={byScope("upstream")}
            onDismiss={dismiss}
          />
          <Section title="🧩 Template" items={byScope("template")} onDismiss={dismiss} />
          <Section title="🔧 Tooling — agent-conductor itself" items={byScope("tooling")} onDismiss={dismiss} />
          <Section title="🗂 Corpus" items={byScope("corpus")} onDismiss={dismiss} />
          <Section title="Applied" items={applied} />
        </div>
      )}
    </div>
  );
}
