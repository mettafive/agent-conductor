import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Suggestion } from "../lib/types";

const CONF_DOT: Record<string, string> = {
  high: "bg-mint",
  medium: "bg-amber",
  low: "bg-line-2",
};

function srcTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function DiffLine({ kind, text }: { kind: "before" | "after"; text: string }) {
  return (
    <div
      className={`rounded px-2 py-1 font-mono text-[10.5px] leading-snug ${
        kind === "before"
          ? "bg-rose/10 text-rose/90"
          : "bg-mint/10 text-mint"
      }`}
    >
      <span className="select-none opacity-60">{kind === "before" ? "- " : "+ "}</span>
      {text}
    </div>
  );
}

function Card({
  s,
  state,
  onApply,
  onSkip,
}: {
  s: Suggestion;
  state: "pending" | "applied" | "skipped";
  onApply: () => void;
  onSkip: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: state === "skipped" ? 0.4 : 1,
        y: 0,
        scale: state === "applied" ? 0.985 : 1,
      }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border p-3.5 ${
        state === "applied"
          ? "border-mint/40 bg-mint/[0.06]"
          : "border-line bg-panel/60"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${CONF_DOT[s.confidence ?? "low"]}`} />
        <span className="flex-1 text-sm font-medium text-chalk">{s.title}</span>
        {state === "applied" && <span className="text-xs text-mint">applied ✓</span>}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-4 font-mono text-[10px] text-mist">
        {s.step && <span>step: {s.step}</span>}
        <span className="rounded border border-line-2 px-1">{s.type}</span>
        {s.impact && <span className="text-mint/80">{s.impact}</span>}
        {s.provenance && <span className="text-line-2">{s.provenance}</span>}
      </div>

      {s.rationale && (
        <p className="mt-2 pl-4 text-[11.5px] leading-snug text-mist-2">{s.rationale}</p>
      )}

      {(s.current || s.proposed) && (
        <div className="mt-2 space-y-1 pl-4">
          {s.current && <DiffLine kind="before" text={s.current} />}
          {s.proposed && <DiffLine kind="after" text={s.proposed} />}
        </div>
      )}

      {s.source_heartbeat && (
        <div className="mt-2 pl-4 font-mono text-[10px] text-mist">
          Source: heartbeat at {srcTime(s.source_heartbeat)} 💡
        </div>
      )}

      {state === "pending" && (
        <div className="mt-3 flex gap-2 pl-4">
          <button
            onClick={onApply}
            className="rounded-lg bg-mint/15 px-3 py-1 text-xs font-medium text-mint transition-colors hover:bg-mint/25"
          >
            ✓ Apply
          </button>
          <button
            onClick={onSkip}
            className="rounded-lg border border-line px-3 py-1 text-xs text-mist transition-colors hover:text-chalk"
          >
            Skip
          </button>
        </div>
      )}
    </motion.div>
  );
}

interface Props {
  workflow: string;
  suggestions: Suggestion[];
  onApply: (items: Suggestion[]) => Promise<{ ok: boolean; error?: string }>;
  onDismiss?: (ids: string[]) => void;
  onClose: () => void;
}

export function OptimizationPanel({ workflow, suggestions, onApply, onDismiss, onClose }: Props) {
  const [states, setStates] = useState<Record<string, "pending" | "applied" | "skipped">>({});
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userText, setUserText] = useState("");

  const stateOf = (id: string) => states[id] ?? "pending";
  const pendingIds = suggestions.filter((s) => stateOf(s.id) === "pending").map((s) => s.id);

  const apply = async (ids: string[]) => {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    const items = suggestions.filter((s) => ids.includes(s.id));
    const res = await onApply(items);
    setBusy(false);
    if (res.ok) {
      setStates((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, "applied"])) }));
      setToast(`${ids.length} optimization${ids.length === 1 ? "" : "s"} applied to ${workflow}.conductor.yaml`);
      setTimeout(() => setToast(null), 4000);
    } else {
      setToast(`⚠ ${res.error ?? "Could not apply — conductor left unchanged."}`);
      setTimeout(() => setToast(null), 5000);
    }
  };

  const skip = (id: string) => {
    setStates((prev) => ({ ...prev, [id]: "skipped" }));
    onDismiss?.([id]); // persist the decision to the ledger
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="absolute inset-y-0 right-0 z-40 flex w-[400px] max-w-full flex-col border-l border-line bg-ink-2/95 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <span className="text-base">✨</span>
        <span className="font-medium text-chalk">Insights</span>
        <span className="grid h-5 min-w-5 place-items-center rounded-md bg-iris/15 px-1 font-mono text-[11px] text-iris">
          {suggestions.length}
        </span>
        <span
          title="Accumulated across runs and kept in .conductor/insights.md"
          className="font-mono text-[10px] text-mist"
        >
          open
        </span>
        <button onClick={onClose} className="ml-auto text-mist hover:text-chalk" title="Close">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        <AnimatePresence initial={false}>
          {suggestions.map((s) => (
            <Card
              key={s.id}
              s={s}
              state={stateOf(s.id)}
              onApply={() => apply([s.id])}
              onSkip={() => skip(s.id)}
            />
          ))}
        </AnimatePresence>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (userText.trim()) {
              setToast("Your suggestion was noted (source: user).");
              setUserText("");
              setTimeout(() => setToast(null), 3000);
            }
          }}
          className="rounded-xl border border-dashed border-line-2 p-2"
        >
          <input
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder="💬 Add your own suggestion…"
            className="w-full bg-transparent px-1.5 py-1 text-xs text-mist-2 outline-none placeholder:text-mist"
          />
        </form>
      </div>

      <div className="flex items-center gap-2 border-t border-line p-3">
        <button
          onClick={() => apply(pendingIds)}
          disabled={pendingIds.length === 0 || busy}
          className="flex-1 rounded-lg bg-gradient-to-b from-iris to-iris-deep px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy ? "Applying…" : `Apply ${pendingIds.length} selected`}
        </button>
        <button
          onClick={() => {
            if (pendingIds.length) onDismiss?.(pendingIds);
            onClose();
          }}
          className="rounded-lg border border-line px-3 py-2 text-sm text-mist transition-colors hover:text-chalk"
        >
          Dismiss all
        </button>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="pointer-events-none absolute inset-x-3 bottom-20 rounded-lg border border-line bg-panel px-3 py-2 text-center text-[11px] text-chalk shadow-xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
