import type { WorkflowEntry } from "../lib/useBoardState";
import type { BoardStep, HistoryRun, Snapshot } from "../lib/types";
import { useNow } from "../lib/useNow";
import { buildModel } from "../lib/merge";
import { iterationColumn } from "../lib/loop";
import { clockSince } from "../lib/view";
import { Led } from "./Led";
import { Icon } from "./Icon";

const SEL = "bg-line-2/40"; // selected row — a neutral surface lift, never colour

function textFor(col: string, on: boolean): string {
  if (col === "running" || col === "gate") return "text-chalk";
  if (on) return "text-chalk";
  if (col === "pending") return "text-dim";
  return "text-mist"; // done / other
}

/**
 * The clickable step + loop-iteration tree — the only navigator for the main
 * area. Status LEDs carry every bit of state; no badges, counts or fractions.
 * Iteration names are spelled out in full, never truncated.
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

  // §7: improvement runs silently — only structural changes (needing approval)
  // appear in the tree.
  const improve = model.steps.filter((s) => s.phase === "improve" && s.improve?.structural === true);
  const workflow = model.steps.filter((s) => s.phase !== "improve");

  const renderStep = (s: BoardStep) => {
    const on = activeStep === s.id || (!!activeStep && activeStep.startsWith(`${s.id}::`));
    const label = s.phase === "improve" ? s.improve?.title ?? s.id.replace("_improve::", "") : s.id;
    return (
      <div key={s.id}>
        <button
          onClick={() => onSelectStep?.(s.id)}
          className={`flex w-full items-start gap-2.5 rounded px-2 py-1 text-left text-[13px] leading-snug transition-colors duration-150 ${
            on ? SEL : "hover:bg-panel-2/60"
          }`}
        >
          <span className="mt-1.5">
            <Led state={s.column} />
          </span>
          <span className={`min-w-0 flex-1 ${textFor(s.column, on)}`}>{label}</span>
        </button>

        {s.isLoop && s.loop && s.loop.iterations.length > 0 && (
          <div className="ml-5 space-y-0.5">
            {s.loop.iterations.map((it) => {
              const c = iterationColumn(it);
              const iterId = `${s.id}::${it.item}`;
              const onIter = activeStep === iterId;
              return (
                <button
                  key={it.item}
                  onClick={() => onSelectStep?.(iterId)}
                  className={`flex w-full items-start gap-2.5 rounded px-2 py-0.5 text-left text-[12.5px] leading-snug transition-colors duration-150 ${
                    onIter ? SEL : "hover:bg-panel-2/60"
                  }`}
                >
                  <span className="mt-1.5">
                    <Led state={c} />
                  </span>
                  <span className={`min-w-0 flex-1 ${textFor(c, onIter)}`}>{it.item}</span>
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
      <span className="text-[12px] text-dim">{text}</span>
      <span className="h-px flex-1 bg-line" />
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
  const elapsed = overallStatus === "running" ? clockSince(liveStatus?.started_at, now) : null;

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-line bg-panel/60"
    >
      <div className="flex-1 overflow-y-auto board-scroll px-4 py-4">
        {activeWf && liveModel ? (
          <>
            {/* active workflow — name + status · elapsed */}
            <button onClick={() => onPickWorkflow(activeWf)} className="block w-full px-1 text-left">
              <div className="truncate text-[15px] font-semibold text-chalk">{activeWf}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-mist">
                <span>{STATUS_WORD[overallStatus] ?? overallStatus}</span>
                {elapsed && (
                  <>
                    <span className="text-dim">·</span>
                    <span className="tabular-nums">{elapsed}</span>
                  </>
                )}
              </div>
            </button>

            {/* progress tree */}
            <div className="mt-4">
              {selectedRun === null && (
                <StepTree snap={workflows[activeWf].snap} activeStep={activeStep} onSelectStep={onSelectStep} />
              )}
            </div>

            {/* other workflows — compact switcher, only when there's more than one */}
            {others.length > 0 && (
              <div className="mt-5">
                <SectionRule text="Workflows" />
                <div className="space-y-0.5">
                  {others.map((name) => {
                    const st = statusOf(name)?.status ?? "idle";
                    return (
                      <button
                        key={name}
                        onClick={() => onPickWorkflow(name)}
                        className="flex w-full items-center gap-2.5 rounded px-2 py-1 text-left text-[13px] transition-colors duration-150 hover:bg-panel-2/60"
                      >
                        <Led state={st} />
                        <span className="min-w-0 flex-1 truncate text-mist">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="px-1 text-[13px] text-dim">No active workflow.</p>
        )}

        {/* history */}
        <div className="mt-6">
          <SectionRule text="History" />
          {historyGroups.length === 0 ? (
            <p className="px-1 pt-0.5 text-[12px] text-dim">No past runs yet.</p>
          ) : (
            <div className="space-y-0.5 pt-0.5">
              {historyGroups.map(({ name, runs }) => (
                <div key={name}>
                  {historyGroups.length > 1 && (
                    <div className="px-1 pb-0.5 pt-1 text-[11px] text-dim">{name}</div>
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
                          className={`flex w-full items-center gap-2.5 rounded px-2 py-1 text-left transition-colors duration-150 ${
                            active ? SEL : "hover:bg-panel-2/60"
                          }`}
                        >
                          <span className={failed ? "text-rose" : "text-mist"}>
                            <Icon name={failed ? "cross" : "check"} size={13} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-mist">{label}</span>
                          {dur && <span className="shrink-0 text-[11px] tabular-nums text-dim">{dur}</span>}
                        </button>
                        {active && viewingSnap && (
                          <div className="ml-3 mt-0.5 pl-2">
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

      {/* footer — knowledge is a link here, not a persistent counter */}
      {onOpenInsights && (
        <button
          onClick={onOpenInsights}
          className={`flex items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[13px] transition-colors ${
            insightsOpen ? "text-chalk" : "text-mist hover:text-chalk"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2Zm0 0a2 2 0 0 1 2-2h12" />
          </svg>
          Knowledge
        </button>
      )}

      <div
        onPointerDown={startDrag}
        className="absolute inset-y-0 -right-1 w-2 cursor-col-resize"
        title="Drag to resize"
      />
    </aside>
  );
}
