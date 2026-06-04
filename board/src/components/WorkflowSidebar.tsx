import type { WorkflowEntry } from "../lib/useBoardState";
import type { BoardStep, HistoryRun, Snapshot } from "../lib/types";
import { useNow } from "../lib/useNow";
import { buildModel } from "../lib/merge";
import { iterationColumn } from "../lib/loop";
import { clockSince } from "../lib/view";

/**
 * Status glyph for the progress tree (Part 1.1 / Part 2). No emoji — a muted
 * green check for done, a solid accent dot for active, a dim dot for pending.
 */
function Glyph({ col }: { col: string }) {
  if (col === "done") return <span className="text-mint/80">✓</span>;
  if (col === "failed") return <span className="text-rose">✗</span>;
  if (col === "gate") return <span className="text-amber">●</span>;
  if (col === "running") return <span className="text-cyan">●</span>;
  return <span className="text-dim">·</span>;
}

/**
 * The clickable step + loop-iteration tree — the only navigator for the main
 * area. Checkmarks and dots, no badges, no counts, no progress fractions; the
 * icons carry the state. Iteration names are spelled out in full, never
 * truncated (Part 1.1).
 */
function StepTree({
  snap,
  activeStep,
  onSelectStep,
}: {
  snap: Snapshot;
  activeStep?: string | null;
  onSelectStep?: (id: string | null) => void;
}) {
  const model = buildModel(snap);
  if (!model.steps.length) return null;

  // §7: improvement runs silently. Only structural changes (needing approval)
  // appear in the tree; text/read-knowledge/validate cards are hidden.
  const improve = model.steps.filter((s) => s.phase === "improve" && s.improve?.structural === true);
  const workflow = model.steps.filter((s) => s.phase !== "improve");

  const renderStep = (s: BoardStep) => {
    const on = activeStep === s.id || (!!activeStep && activeStep.startsWith(`${s.id}::`));
    const label = s.phase === "improve" ? s.improve?.title ?? s.id.replace("_improve::", "") : s.id;
    return (
      <div key={s.id}>
        <button
          onClick={() => onSelectStep?.(s.id)}
          className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left font-mono text-[12px] leading-snug transition-colors ${
            on ? "bg-cyan/10" : "hover:bg-panel/60"
          }`}
        >
          <span className="mt-px w-3 shrink-0 text-center text-[11px]">
            <Glyph col={s.column} />
          </span>
          <span
            className={`min-w-0 flex-1 ${
              s.column === "running" || s.column === "gate"
                ? "text-chalk"
                : on
                  ? "text-chalk"
                  : s.column === "pending"
                    ? "text-dim"
                    : "text-mist-2"
            }`}
          >
            {label}
          </span>
        </button>

        {s.isLoop && s.loop && s.loop.iterations.length > 0 && (
          <div className="ml-3.5 space-y-0.5 border-l border-line/40 pl-2.5">
            {s.loop.iterations.map((it) => {
              const c = iterationColumn(it);
              const iterId = `${s.id}::${it.item}`;
              const onIter = activeStep === iterId;
              return (
                <button
                  key={it.item}
                  onClick={() => onSelectStep?.(iterId)}
                  className={`flex w-full items-start gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[11.5px] leading-snug transition-colors ${
                    onIter ? "bg-cyan/10" : "hover:bg-panel/60"
                  }`}
                >
                  <span className="mt-px w-3 shrink-0 text-center text-[11px]">
                    <Glyph col={c} />
                  </span>
                  <span
                    className={`min-w-0 flex-1 ${
                      c === "running" || c === "gate"
                        ? "text-chalk"
                        : onIter
                          ? "text-chalk"
                          : c === "pending"
                            ? "text-dim"
                            : "text-mist-2"
                    }`}
                  >
                    {it.item}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      {improve.length > 0 && (
        <>
          <SectionRule text="Awaiting approval" />
          {improve.map(renderStep)}
          <div className="h-1.5" />
        </>
      )}
      {workflow.map(renderStep)}
    </div>
  );
}

function SectionRule({ text }: { text: string }) {
  return (
    <div className="mb-1 mt-1 flex items-center gap-2 px-1">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-dim">
        {text}
      </span>
      <span className="h-px flex-1 bg-line/50" />
    </div>
  );
}

interface LiveStatus {
  status?: string;
  started_at?: string;
  run_id?: string;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact duration for the history list — "45s" / "18m" / "1h 3m". */
function fmtDur(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATUS_WORD: Record<string, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  idle: "Idle",
};

interface Props {
  workflows: Record<string, WorkflowEntry>;
  order: string[];
  activeWf: string | null;
  selectedRun: string | null;
  onPickWorkflow: (name: string) => void;
  onPickRun: (wf: string, runId: string) => void;
  width: number;
  onResize: (w: number) => void;
  activeStep?: string | null;
  onSelectStep?: (id: string | null) => void;
  viewingSnap?: Snapshot | null;
  onOpenInsights?: () => void;
  insightsOpen?: boolean;
}

export function WorkflowSidebar({
  workflows,
  order,
  activeWf,
  selectedRun,
  onPickWorkflow,
  onPickRun,
  width,
  onResize,
  activeStep,
  onSelectStep,
  viewingSnap,
  onOpenInsights,
  insightsOpen,
}: Props) {
  const now = useNow(1000);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => onResize(Math.max(248, Math.min(380, ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const statusOf = (name: string) => workflows[name]?.snap.status as LiveStatus | null;
  const liveStatus = activeWf ? statusOf(activeWf) : null;
  const liveModel = activeWf ? buildModel(workflows[activeWf].snap) : null;
  const others = order.filter((n) => n !== activeWf);

  // every workflow with at least one past run to browse
  const historyGroups = order
    .map((name) => {
      const status = statusOf(name);
      const isRunning = status?.status === "running";
      const runs = (workflows[name]?.history ?? []).filter(
        (h) => !(isRunning && h.run_id === status?.run_id),
      );
      return { name, runs };
    })
    .filter((g) => g.runs.length > 0);

  const overallStatus = liveStatus?.status ?? "idle";
  const elapsed =
    overallStatus === "running" ? clockSince(liveStatus?.started_at, now) : null;

  return (
    <aside
      style={{ width }}
      className="relative flex h-screen shrink-0 flex-col border-r border-line bg-ink-2/60 backdrop-blur"
    >
      {/* brand */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <img src="./conductor.svg" alt="" className="h-4 w-4 opacity-80" />
        <span className="font-mono text-[11px] tracking-wide text-mist">conductor</span>
      </div>

      <div className="flex-1 overflow-y-auto board-scroll px-3 py-3">
        {activeWf && liveModel ? (
          <>
            {/* active workflow — the one global piece of identity (Part 4) */}
            <button
              onClick={() => onPickWorkflow(activeWf)}
              className="block w-full px-1 text-left"
            >
              <div className="truncate font-mono text-[13px] font-medium text-chalk">{activeWf}</div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-mist">
                <span
                  className={
                    overallStatus === "running"
                      ? "text-cyan"
                      : overallStatus === "failed"
                        ? "text-rose"
                        : overallStatus === "done"
                          ? "text-mint/80"
                          : "text-mist"
                  }
                >
                  {STATUS_WORD[overallStatus] ?? overallStatus}
                </span>
                {elapsed && (
                  <>
                    <span className="text-dim">·</span>
                    <span className="tabular-nums">{elapsed}</span>
                  </>
                )}
              </div>
            </button>

            {/* progress tree */}
            <div className="mt-3">
              {selectedRun === null && (
                <StepTree snap={workflows[activeWf].snap} activeStep={activeStep} onSelectStep={onSelectStep} />
              )}
            </div>

            {/* other workflows — a compact switcher, only when there's more than one */}
            {others.length > 0 && (
              <div className="mt-4">
                <SectionRule text="Workflows" />
                <div className="space-y-0.5">
                  {others.map((name) => {
                    const st = statusOf(name)?.status ?? "idle";
                    return (
                      <button
                        key={name}
                        onClick={() => onPickWorkflow(name)}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[12px] transition-colors hover:bg-panel/60"
                      >
                        <span className="w-3 shrink-0 text-center text-[11px]">
                          <Glyph col={st === "running" ? "running" : st} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-mist-2">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="px-1 font-mono text-[11px] text-dim">No active workflow.</p>
        )}

        {/* history */}
        <div className="mt-5">
          <SectionRule text="History" />
          {historyGroups.length === 0 ? (
            <p className="px-1 pt-0.5 font-mono text-[11px] text-dim">No past runs yet.</p>
          ) : (
            <div className="space-y-0.5 pt-0.5">
              {historyGroups.map(({ name, runs }) => (
                <div key={name}>
                  {historyGroups.length > 1 && (
                    <div className="px-1 pb-0.5 pt-1 font-mono text-[10px] text-mist">{name}</div>
                  )}
                  {runs.map((r: HistoryRun) => {
                    const active = activeWf === name && selectedRun === r.run_id;
                    const failed = r.status === "failed";
                    const label = r.run_name || fmtDate(r.completed_at || r.archived_at || r.started_at);
                    const dur = fmtDur(r.started_at, r.completed_at);
                    return (
                      <div key={r.run_id}>
                        <button
                          onClick={() => onPickRun(name, r.run_id)}
                          className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                            active ? "bg-cyan/10" : "hover:bg-panel/60"
                          }`}
                        >
                          <span className="w-3 shrink-0 text-center text-[11px]">
                            <Glyph col={failed ? "failed" : "done"} />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mist-2">
                            {label}
                          </span>
                          {dur && (
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-dim">
                              {dur}
                            </span>
                          )}
                        </button>
                        {active && viewingSnap && (
                          <div className="ml-2.5 mt-0.5 border-l border-line/50 pl-2">
                            <StepTree snap={viewingSnap} activeStep={activeStep} onSelectStep={onSelectStep} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* footer — knowledge is a link here, not a persistent counter (Part 1) */}
      {onOpenInsights && (
        <button
          onClick={onOpenInsights}
          className={`flex items-center gap-2 border-t border-line px-4 py-2.5 text-left font-mono text-[11px] transition-colors ${
            insightsOpen ? "text-cyan" : "text-mist hover:text-chalk"
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2Zm0 0a2 2 0 0 1 2-2h12" />
          </svg>
          Knowledge
        </button>
      )}

      {/* drag-to-resize handle */}
      <div
        onPointerDown={startDrag}
        className="absolute inset-y-0 -right-1 w-2 cursor-col-resize"
        title="Drag to resize"
      />
    </aside>
  );
}
