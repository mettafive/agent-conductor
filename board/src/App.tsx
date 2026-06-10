import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EMPTY, useBoardState } from "./lib/useBoardState";
import type { WorkflowEntry } from "./lib/useBoardState";
import { buildModel } from "./lib/merge";
import {
  isChimesMuted,
  isTicksMuted,
  playFailure,
  playSuccess,
  playTick,
  setChimesMuted,
  setTicksMuted,
} from "./lib/sounds";
import { lastBeatIso, useHeartbeatStream } from "./lib/heartbeatStream";
import { useNow } from "./lib/useNow";
import { clockSince, fmtElapsedMs } from "./lib/view";
import { displayName } from "./lib/identity";
import { isFeedLive, hasActiveDispatch } from "./lib/liveness";
import { TopBar } from "./components/TopBar";
import { WorkflowSidebar } from "./components/WorkflowSidebar";
import type { LiveEntry } from "./components/WorkflowSidebar";
import { Icon } from "./components/Icon";
import { WorkflowKanban, RunCompleteBanner } from "./components/WorkflowKanban";
import { Settings } from "./components/Settings";
import { InsightsModal } from "./components/InsightsModal";
import { HeartbeatMonitor, loadMonitorMode } from "./components/HeartbeatMonitor";
import type { MonitorMode } from "./components/HeartbeatMonitor";
import { loadHeartbeatInterval, saveHeartbeatInterval, stallSecondsFor } from "./lib/settings";
import type { StreamBeat } from "./lib/heartbeatStream";
import type { BoardModel, HistoryRun, Snapshot } from "./lib/types";

/** Flatten a viewed (past, static) run's persisted beats into one chronological StreamBeat[] —
 *  the terminal's data source when the navigator is viewing a past run instead of the live stream. */
function pastRunBeats(model: BoardModel): StreamBeat[] {
  const out: StreamBeat[] = [];
  for (const step of model.steps) {
    step.heartbeat.forEach((h, i) => {
      out.push({
        key: `${model.workflow} ${step.id} ${h.iteration ?? ""} ${h.sub ?? ""} ${h.at} ${i}`,
        workflow: model.workflow,
        step: String(step.id),
        title: step.title,
        at: h.at,
        event_at: h.event_at ?? h.at,
        seq: h.seq,
        note: h.note,
        iteration: h.iteration,
        sub: h.sub,
        finalBeat: h.finalBeat === true,
        system: h.system === true,
        control: h.control === true,
        tone: h.tone,
        insight: h.insight,
      });
    });
  }
  // Work-order sort, mirroring the live stream: event_at, then seq, then at.
  out.sort((a, b) => {
    if (a.event_at !== b.event_at) return a.event_at < b.event_at ? -1 : 1;
    const as = typeof a.seq === "number" ? a.seq : Number.POSITIVE_INFINITY;
    const bs = typeof b.seq === "number" ? b.seq : Number.POSITIVE_INFINITY;
    if (as !== bs) return as - bs;
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  });
  return out;
}

const params = new URLSearchParams(window.location.search);

/** The bridge beat between runs: a single calm line + an indeterminate LED-dot
 *  loader in the status color, centered over the cleared board. It spans the real
 *  reset/compose window; reduced-motion drops the dot pulse to a static row. */
function RelaunchOverlay({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
      transition={{ duration: reduceMotion ? 0.18 : 0.25, ease: "easeOut" }}
      // Top-anchored (a stable vh offset), NOT vertically centered: the board
      // container is flex-1, so it resizes when the run-complete banner appears/
      // disappears underneath — a centered overlay would jump with it. Anchoring to
      // the container's stable top keeps "Setting up…" rock-steady through the sweep.
      className="absolute inset-x-0 top-0 bottom-0 z-10 flex items-start justify-center pt-[32vh]"
    >
      <div className="flex flex-col items-center gap-3">
        <p className="text-[14px] tracking-wide text-mist-2">Setting up your next run</p>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-mint"
              animate={reduceMotion ? { opacity: 0.6 } : { opacity: [0.25, 1, 0.25] }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/** The relaunch overlay's NAMED non-success outcome — surfaced instead of a silent
 *  vanish, so Improve & Run always ends on a result the user can read. */
function RelaunchOutcomeBanner({
  outcome,
  onDismiss,
}: {
  outcome: "unconfirmed" | "halted-after-integration-failure";
  onDismiss: () => void;
}) {
  const halted = outcome === "halted-after-integration-failure";
  const text = halted
    ? "Integration failed — the run was halted. Check the terminal."
    : "Couldn't confirm the launch — check the terminal.";
  const tone = halted
    ? "border-rose/40 bg-rose/10 text-rose"
    : "border-[#e0b341]/40 bg-[#e0b341]/10 text-[#e0b341]";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="absolute inset-x-0 top-0 z-20 flex justify-center pt-4"
    >
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        className={`flex items-center gap-2 rounded-md border px-4 py-2 font-mono text-[13px] ${tone}`}
      >
        <span aria-hidden>{halted ? "✕" : "⚠"}</span>
        {text}
        <span className="ml-1 opacity-60">·  dismiss</span>
      </button>
    </motion.div>
  );
}

export function App() {
  const { workflows, order, conn } = useBoardState();
  const [selectedWf, setSelectedWf] = useState<string | null>(params.get("wf"));
  // COLD START — surface on served, never on health. When the board is opened by a run
  // (?starting=1), show an explicit "starting…" state until the first phase feed is live
  // (compile / integration / run), instead of an empty board or a stale completed run.
  const [coldStart, setColdStart] = useState(params.get("starting") === "1");
  // The workflow currently on screen — its IDENTITY sticks across status rebroadcasts.
  const stickyWfRef = useRef<string | null>(null);
  // When an integration (shaping) feed finishes, hold the board on it for a beat so
  // its last card (Validate) visibly settles to done before the work feed takes over.
  const [heldIntegration, setHeldIntegration] = useState<string | null>(null);
  const [ticksOn, setTicksOn] = useState(!isTicksMuted());
  const [chimesOn, setChimesOn] = useState(!isChimesMuted());
  const [monitorMode, setMonitorMode] = useState<MonitorMode>(loadMonitorMode);
  const [heartbeatInterval, setHeartbeatInterval] = useState(loadHeartbeatInterval);
  const [showSettings, setShowSettings] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  // The Navigator drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // A single value drives which past run is loaded onto the board. null = live/default source.
  const [viewing, setViewing] = useState<{ wf: string; runId: string } | null>(null);
  const [viewedModel, setViewedModel] = useState<BoardModel | null>(null);
  // The newest-history fallback model, fetched once when there's no live run.
  const [latestModel, setLatestModel] = useState<BoardModel | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    saveHeartbeatInterval(heartbeatInterval);
  }, [heartbeatInterval]);

  const { beats, log, arrival } = useHeartbeatStream(workflows, order);
  const agentLog = log;
  const globalLastBeat = lastBeatIso(beats);

  useEffect(() => {
    if (arrival && !arrival.beat.system) playTick();
  }, [arrival]);

  // A "run" feed is the work workflow; "compile"/"integration" are the shaping
  // feeds. Prefer the RUN feed so the board never sticks on the migration board
  // when the run is going, and so it auto-advances compile → run on one surface
  // (Fix 2). While compile is the only thing running, the third clause still
  // surfaces it live (Fix 3 — you watch the build, not just the finish).
  const isRunFeed = (n: string) => {
    const v = workflows[n]?.snap?.variant;
    return v !== "compile" && v !== "integration"; // run, or untagged/legacy
  };
  // STICKY: when you're looking at a workflow, it IS the selection — a status
  // rebroadcast must not re-resolve you elsewhere. We hold the viewed IDENTITY
  // (displayName), preferring its run feed so compile → run advances WITHIN it, but
  // a status change never jumps you to a different identity (or a stale fixture).
  const stickyId =
    stickyWfRef.current && workflows[stickyWfRef.current] ? displayName(stickyWfRef.current) : null;
  const stickyChoice = stickyId
    ? (order.find((n) => displayName(n) === stickyId && isRunFeed(n)) ??
       order.find((n) => displayName(n) === stickyId))
    : null;

  // The deliberate ask (the ?wf seed / a navigation) resolves BY IDENTITY — preferring
  // the run feed — so ?wf=landing-forge lands the run, and follows compile → run.
  const selectedChoice = selectedWf
    ? (order.find((n) => displayName(n) === displayName(selectedWf) && isRunFeed(n)) ??
       order.find((n) => displayName(n) === displayName(selectedWf)) ??
       null)
    : null;

  const activeWf =
    // Highest priority: a just-finished integration feed we're holding, so its
    // Validate card settles to done on screen before the work feed switches in.
    (heldIntegration && workflows[heldIntegration] ? heldIntegration : null) ??
    selectedChoice ??
    stickyChoice ??
    // Auto-selection (bare route / first load): only a LIVE feed may grab the wheel —
    // a stale running/paused zombie is excluded (stale-exclusion).
    order.find((n) => isRunFeed(n) && statusOf(workflows[n]) === "running" && isFeedLive(workflows[n], now)) ??
    order.find((n) => statusOf(workflows[n]) === "running" && isFeedLive(workflows[n], now)) ??
    order.find((n) => isRunFeed(n)) ??
    order[0] ??
    null;

  // Remember what's on screen so the next render's sticky holds this identity.
  useEffect(() => {
    if (activeWf) stickyWfRef.current = activeWf;
  }, [activeWf]);

  const liveSnap: Snapshot = (activeWf && workflows[activeWf]?.snap) || EMPTY;
  const liveModel = buildModel(liveSnap);

  // Does the live workflow actually have a run streaming — steps written AND a live
  // pulse? The isFeedLive gate keeps a stale "running" feed (steps written but no recent
  // activity) from posing as the streaming board; a just-finished run stays live via its
  // recent completed_at, and the history fallback shows it once the window lapses.
  const liveStarted = !!(
    liveSnap.status &&
    typeof liveSnap.status === "object" &&
    Object.keys((liveSnap.status as { steps?: object }).steps ?? {}).length > 0 &&
    isFeedLive(activeWf ? workflows[activeWf] : undefined, now)
  );

  // hasActiveDispatch for the displayed live feed — the one liveness signal the pause
  // button reads (a stale "running" with no dispatcher offers no pause). Off for a
  // viewed past run (static — no dispatcher).
  const activeDispatch = !!(activeWf && hasActiveDispatch(workflows[activeWf], now));

  // The newest finished run across all workflows (the active workflow's own newest wins ties via
  // order) — the fallback board source when nothing is streaming.
  const latestEntry = (() => {
    type Latest = { wf: string; run: HistoryRun };
    const wfs = activeWf ? [activeWf, ...order.filter((w) => w !== activeWf)] : order;
    let best: Latest | null = null;
    for (const wf of wfs) {
      const top = workflows[wf]?.history?.[0]; // history is newest-first
      if (!top) continue;
      const bestAt = best ? best.run.completed_at ?? "" : "";
      if (!best || (top.completed_at ?? "") > bestAt) best = { wf, run: top };
    }
    return best;
  })();

  // Load the viewed past run's snapshot whenever the selection changes. The board is then STATIC —
  // incoming SSE updates do not replace it (we never re-derive viewedModel from live state).
  useEffect(() => {
    if (!viewing) {
      setViewedModel(null);
      return;
    }
    let cancelled = false;
    setViewedModel(null);
    fetch(`/api/workflow/${encodeURIComponent(viewing.wf)}/history/${encodeURIComponent(viewing.runId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rec) => {
        if (!cancelled && rec?.snapshot) setViewedModel(buildModel(rec.snapshot as Snapshot));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewing]);

  // Default-source fallback: when not viewing a past run and nothing is live, fetch the newest
  // finished run's snapshot ONCE so the board lands on your last run instead of an empty screen.
  const latestKey = latestEntry ? `${latestEntry.wf}::${latestEntry.run.run_id}` : null;
  useEffect(() => {
    if (viewing || liveStarted || !latestEntry) {
      setLatestModel(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/workflow/${encodeURIComponent(latestEntry.wf)}/history/${encodeURIComponent(latestEntry.run.run_id)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((rec) => {
        if (!cancelled && rec?.snapshot) setLatestModel(buildModel(rec.snapshot as Snapshot));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestKey, viewing, liveStarted]);

  // The cold-start "starting…" frame shows until the first phase feed is actually live —
  // never an empty board or a stale completed run. Cleared the moment a live feed streams.
  const viewingPastEarly = !!(viewing && viewedModel);
  const showStarting = coldStart && !liveStarted && !viewingPastEarly;
  useEffect(() => {
    if (liveStarted) setColdStart(false); // a live feed is serving content → leave "starting"
  }, [liveStarted]);
  useEffect(() => {
    if (!coldStart) return; // safety: never trap in "starting" if nothing ever streams
    const t = setTimeout(() => setColdStart(false), 30000);
    return () => clearTimeout(t);
  }, [coldStart]);

  // ONE VIEW IDENTITY. Every part that answers "which view am I showing" reads this — so
  // no two parts can disagree, and ids that are only unique WITHIN a run (run_id, step.id,
  // beat keys) are never treated as global: they're scoped by the view they live in.
  const viewKey = viewing
    ? `history:${viewing.wf}:${viewing.runId}`
    : activeWf
      ? `live:${activeWf}:${liveModel.runId ?? "no-run"}`
      : "empty";

  // The model for the SELECTED view; null when a history view is still fetching.
  const selectedReady: BoardModel | null =
    (viewing && viewedModel) ? viewedModel
    : viewing ? null // history view, fetch pending → not ready yet
    : (liveStarted || showStarting) ? liveModel
    : latestModel ?? liveModel;

  // HOLD THE OUTGOING UNTIL THE INCOMING IS READY — never flash the prior/live/default
  // model in the navigation gap (same rule as cold start). While the selected view's model
  // isn't ready, keep rendering the last ready (key, model); the crossfade swaps only when
  // the real thing arrives.
  const heldViewRef = useRef<{ key: string; model: BoardModel } | null>(null);
  useEffect(() => {
    if (selectedReady) heldViewRef.current = { key: viewKey, model: selectedReady };
  }, [viewKey, selectedReady]);
  const model: BoardModel = selectedReady ?? heldViewRef.current?.model ?? liveModel;
  const displayKey = selectedReady ? viewKey : heldViewRef.current?.key ?? viewKey;
  // The board is interactive only when showing a real run (selected, or held mid-transition).
  const boardStarted = showStarting
    ? false
    : viewing
      ? !!(viewedModel || heldViewRef.current)
      : liveStarted
        ? true
        : !!latestModel;

  // The terminal's beat source: a viewed past run isn't streaming, so source its persisted beats
  // (flattened from steps[].heartbeat[]); otherwise the live session stream.
  const viewingPast = !!(viewing && viewedModel);
  const monitorBeats = useMemo(
    () => (viewingPast ? pastRunBeats(viewedModel as BoardModel) : agentLog),
    [viewingPast, viewedModel, agentLog],
  );

  // The live run pinned at the top of the drawer — only while a run is genuinely streaming.
  const liveEntry: LiveEntry | null =
    liveStarted && activeWf
      ? {
          workflow: activeWf,
          runName: liveModel.runName || liveModel.runId || activeWf,
          startedAt: liveModel.startedAt,
          status: liveModel.overallStatus,
        }
      : null;

  const prevStatuses = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const name of order) {
      const cur = statusOf(workflows[name]);
      if (!cur) continue;
      const prev = prevStatuses.current[name];
      if (prev !== undefined && prev !== cur) {
        if (cur === "done") playSuccess();
        else if (cur === "failed") playFailure();
      }
      prevStatuses.current[name] = cur;
    }
  }, [workflows, order]);

  // Improve & Run starts a fresh loop. A frozen ?wf pin (selectedWf) would keep
  // the view on the work feed and hide the running integration feed — killing the
  // "watch the insides get integrated" moment. So clear the pin the instant a
  // fresh loop begins: an integration feed goes live, or the active feed's run_id
  // changes. The preference (App.tsx run-feed logic) then lets integration lead.
  // Hold a just-finished integration feed on screen for a beat (so Validate visibly
  // settles to done), then release to let the work feed take over. Fires once per
  // completion: only on a genuine running → done/failed transition.
  const prevIntegStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const n of order) {
      if (workflows[n]?.snap?.variant !== "integration") continue;
      const cur = statusOf(workflows[n]) || "";
      const prev = prevIntegStatus.current[n];
      if (prev === "running" && (cur === "done" || cur === "failed")) {
        setHeldIntegration(n);
        setTimeout(() => setHeldIntegration((h) => (h === n ? null : h)), 1100);
      }
      prevIntegStatus.current[n] = cur;
    }
  }, [workflows, order]);

  // A STATUS/SSE EVENT IS NEVER A DESELECTION. A fresh run-id (a run starting) or an
  // integration feed going live under the SAME canonical workflow is the same selection
  // — not a reason to clear it. selectedWf holds the canonical identity (the stable outer
  // key, not the run-id), so it survives the new run for free: selectedChoice (App.tsx
  // ~160) re-resolves the same identity onto the live feed, and ?wf= holds. (The only
  // deliberate unpin is the user-initiated relaunch in startRelaunch, below.)

  // ── Improve & Run transition (Part B) ──────────────────────────────────────
  // A continuous, eased relaunch: board sweeps away → a "setting up" beat spans
  // the real reset window → the fresh run rides in. Never a cut; the data always
  // wins (the overlay dismisses the moment the fresh run is live, and a hard cap
  // guarantees it never traps the board). prefers-reduced-motion → clean crossfade.
  const reduceMotion = useReducedMotion();
  const [relaunch, setRelaunch] = useState<{ phase: "sweep" | "setup"; fromRunId?: string; setupSince: number } | null>(null);
  // The overlay ALWAYS ends on a named outcome — never a silent 12s vanish. Success
  // (run-running / integration-running) clears the overlay onto the live board; the
  // non-success terminals surface as a named banner instead of disappearing.
  const [relaunchOutcome, setRelaunchOutcome] = useState<
    null | "unconfirmed" | "halted-after-integration-failure"
  >(null);
  const startRelaunch = useCallback(() => {
    setSelectedWf(null); // unpin so the running integration feed can lead
    setRelaunchOutcome(null); // a fresh attempt clears any prior named outcome
    setRelaunch({ phase: "sweep", fromRunId: liveModel.runId, setupSince: 0 });
  }, [liveModel.runId]);

  // Phase 1 → 2: the board has eased away; bring up the setup beat.
  useEffect(() => {
    if (relaunch?.phase !== "sweep") return;
    const t = setTimeout(
      () => setRelaunch((r) => (r ? { ...r, phase: "setup", setupSince: Date.now() } : r)),
      reduceMotion ? 0 : 350,
    );
    return () => clearTimeout(t);
  }, [relaunch?.phase, reduceMotion]);

  // BATON C — advance on a SERVED signal, not a heuristic. The fresh loop is live once
  // its feed is actually SERVED: present in the broadcast `workflows` map (the server
  // only broadcasts feeds it discovered + can render). We require the served feed itself
  // — a running integration feed, or a run feed bearing a NEW run_id — rather than the
  // resolved liveModel.runId, which can change before the new feed is renderable. The
  // overlay never advances on a feed that doesn't yet exist.
  const freshRunLive =
    !!relaunch &&
    order.some((n) => {
      const e = workflows[n]; // absent ⇒ not served (not in the broadcast) ⇒ never advances
      if (!e) return false;
      if (e.snap?.variant === "integration" && statusOf(e) === "running") return true;
      if (isRunFeed(n)) {
        const rid = (e.snap.status as { run_id?: string } | null)?.run_id;
        return !!rid && rid !== relaunch.fromRunId;
      }
      return false;
    });

  // SUCCESS — run-running / integration-running: dismiss onto the LIVE board once the
  // fresh run is served AND the readability floor (~700ms) has elapsed. The live board
  // is itself the named outcome, so no banner is needed; clear any prior one.
  useEffect(() => {
    if (relaunch?.phase !== "setup" || !freshRunLive) return;
    const floor = reduceMotion ? 0 : 700;
    const wait = Math.max(0, floor - (Date.now() - relaunch.setupSince));
    const t = setTimeout(() => {
      setRelaunch(null);
      setRelaunchOutcome(null);
    }, wait);
    return () => clearTimeout(t);
  }, [relaunch?.phase, relaunch?.setupSince, freshRunLive, reduceMotion]);

  // HALTED — integration failed: the run won't come. End on a NAMED outcome, not a
  // vanish. (Detected the moment an integration feed reads failed during the relaunch.)
  useEffect(() => {
    if (!relaunch) return;
    const halted = order.some(
      (n) => workflows[n]?.snap?.variant === "integration" && statusOf(workflows[n]) === "failed",
    );
    if (halted) {
      setRelaunch(null);
      setRelaunchOutcome("halted-after-integration-failure");
    }
  }, [relaunch, order, workflows]);

  // UNCONFIRMED — the cap. The overlay never traps the board, but it never silently
  // vanishes either: if the fresh run never materialised within the window, end on
  // "couldn't confirm launch". (This timer is cancelled the moment success/halt clears
  // `relaunch`, so it only fires when nothing else resolved.)
  useEffect(() => {
    if (!relaunch) return;
    const cap = setTimeout(() => {
      setRelaunch(null);
      setRelaunchOutcome("unconfirmed");
    }, 12000);
    return () => clearTimeout(cap);
  }, [relaunch]);

  // A named non-success outcome lingers long enough to read, then clears itself.
  useEffect(() => {
    if (!relaunchOutcome) return;
    const t = setTimeout(() => setRelaunchOutcome(null), 6000);
    return () => clearTimeout(t);
  }, [relaunchOutcome]);

  // The URL is a SHADOW of the deliberate selection, never of the resolved activeWf.
  // It mirrors `selectedWf` (what you asked for — the ?wf seed or a navigation), and
  // fires only when that deliberately changes. A guessed/resolved feed never reaches
  // the URL, so a refresh can't rehydrate a guess as your intent, and SSE/status churn
  // (which re-resolves activeWf, not selectedWf) never rewrites your address.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedWf) url.searchParams.set("wf", selectedWf);
    else url.searchParams.delete("wf");
    window.history.replaceState(null, "", url);
  }, [selectedWf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
        return;
      }
      if (e.key === "Escape" && showSettings) {
        e.preventDefault();
        setShowSettings(false);
        return;
      }
      if (e.key === "Escape" && showInsights) {
        e.preventDefault();
        setShowInsights(false);
        return;
      }
      // No modal open — Escape closes the Navigator drawer if it's open.
      if (e.key === "Escape" && drawerOpen) {
        e.preventDefault();
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, showInsights, drawerOpen]);

  // Paused-aware elapsed. New runs carry an accumulator (elapsedBaseMs + runningSince); the live
  // display adds (now - runningSince) ONLY while running, so the clock freezes on pause/done/failed
  // and CONTINUES (not resets) on resume. Legacy runs (no accumulator) fall back to started_at→now/
  // ended, preserving the old behaviour so existing runs still render.
  const elapsed = model.hasAccumulator
    ? fmtElapsedMs(
        (model.elapsedBaseMs ?? 0) +
          (model.overallStatus === "running" && model.runningSince
            ? Math.max(0, now - new Date(model.runningSince).getTime())
            : 0),
      )
    : model.overallStatus === "running"
      ? clockSince(model.startedAt, now)
      : model.overallStatus === "done" || model.overallStatus === "failed"
        ? clockSince(model.startedAt, now, model.endedAt)
        : model.overallStatus === "paused"
          ? clockSince(model.startedAt, now, model.pausedAt)
          : null;
  const runCount = (activeWf && workflows[activeWf]?.history.length) || 0;
  const freshInsightCount = model.runId ? model.knowledge.filter((item) => item.source_run === model.runId).length : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        left={
          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label={drawerOpen ? "Close runs" : "Open runs"}
            aria-expanded={drawerOpen}
            title="Runs"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-mist transition-colors hover:bg-panel-2 hover:text-chalk"
          >
            <Icon name={drawerOpen ? "cross" : "menu"} size={18} />
          </button>
        }
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* The Navigator — a hamburger-toggled drawer listing past runs. It OVERLAYS
            the board (absolute within the main area) and slides in/out, so opening
            it never reflows the board content. */}
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                key="nav-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                onClick={() => setDrawerOpen(false)}
                className="absolute inset-0 z-20 bg-ink/40"
              />
              <motion.div
                key="nav-drawer"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                className="absolute inset-y-0 left-0 z-30"
              >
                <WorkflowSidebar
                  workflows={workflows}
                  order={order}
                  viewingKey={viewing ? `${viewing.wf}:${viewing.runId}` : null}
                  live={liveEntry}
                  liveActive={!viewing && liveStarted}
                  onPickRun={(wf, runId) => setViewing({ wf, runId })}
                  onClear={() => setViewing(null)}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col">
          {model.demo && (
            <div className="flex items-center justify-center gap-2 border-b border-amber/25 bg-amber/10 px-5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber">
              Demo — simulated data
            </div>
          )}

          {model.error && (
            <div className="px-5 pt-4">
              <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-2.5 font-mono text-xs text-rose">
                {model.error}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            <motion.div
              className="h-full"
              animate={relaunch ? { opacity: 0, y: reduceMotion ? 0 : -8 } : { opacity: 1, y: 0 }}
              transition={
                relaunch
                  ? { duration: reduceMotion ? 0.18 : 0.35, ease: "easeOut" } // sweep away
                  : reduceMotion
                    ? { duration: 0.18 }
                    : { type: "spring", stiffness: 360, damping: 26 } // ride back in with a settle
              }
            >
              {/* BETWEEN-VIEWS transition: ease the outgoing view out, the incoming in,
                  keyed by the ONE view identity. The held model (above) means we never
                  flash the prior/live/default model in the gap. (Nests cleanly with the
                  inner Summary↔Board crossfade, which handles swaps WITHIN a settled view.) */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={displayKey}
                  className="h-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: "easeInOut" }}
                >
                  {showStarting ? (
                    <StartingState />
                  ) : boardStarted ? (
                    <WorkflowKanban
                      model={model}
                      notes={model.developerNotes}
                      elapsed={elapsed}
                      canonicalKey={(viewing && viewedModel ? viewing.wf : activeWf) ?? undefined}
                      activeDispatch={!viewingPast && activeDispatch}
                      viewKey={displayKey}
                    />
                  ) : (
                    <WaitingState model={model} statusPath={liveSnap.statusPath} />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
            <AnimatePresence>
              {relaunch && <RelaunchOverlay reduceMotion={!!reduceMotion} />}
            </AnimatePresence>
            <AnimatePresence>
              {relaunchOutcome && (
                <RelaunchOutcomeBanner outcome={relaunchOutcome} onDismiss={() => setRelaunchOutcome(null)} />
              )}
            </AnimatePresence>
          </div>

          {!viewing &&
            liveStarted &&
            liveModel &&
            liveModel.overallStatus === "done" &&
            liveModel.nextUp &&
            (liveModel.nextUp.name || (liveModel.nextUp.remaining ?? 0) > 0) && (
              <div className="flex items-center justify-between gap-3 border-t border-line/70 bg-panel/40 px-4 py-1.5 backdrop-blur">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-mist">Up next</span>
                  <span className="truncate text-[12px] text-mist-2">{liveModel.nextUp.name ?? "next batch"}</span>
                  {(liveModel.nextUp.remaining ?? 0) > 0 && (
                    <span className="shrink-0 text-[11px] text-dim">· {liveModel.nextUp.remaining} more</span>
                  )}
                </div>
                <button
                  onClick={() => {
                    void fetch(`/api/workflow/${encodeURIComponent(liveModel.workflow)}/next`, { method: "POST" });
                  }}
                  title="Request the next batch"
                  className="shrink-0 rounded-md border border-mint/40 bg-mint/10 px-2.5 py-1 font-mono text-[11px] text-mint transition-colors hover:bg-mint/20 active:scale-[0.97]"
                >
                  Next →
                </button>
              </div>
            )}

          <RunCompleteBanner
            model={model}
            insightCount={freshInsightCount}
            onOpenInsights={() => setShowInsights(true)}
            onRelaunch={startRelaunch}
            canonicalKey={(viewing && viewedModel ? viewing.wf : activeWf) ?? undefined}
          />

          <HeartbeatMonitor
            beats={monitorBeats}
            // The ONE view identity — switching runs resets the monitor's typing cache so the
            // previous run's beats render settled (don't re-type).
            streamIdentity={displayKey}
            // A viewed past run is static — no live arrival, no heart pulse, settle as done.
            arrival={viewingPast ? null : arrival && !arrival.beat.system ? arrival : null}
            order={order}
            mode={monitorMode}
            onMode={setMonitorMode}
            lastBeatIso={viewingPast ? undefined : globalLastBeat}
            conn={viewingPast ? undefined : conn}
            stallSeconds={stallSecondsFor(heartbeatInterval)}
            done={
              viewingPast
                ? true
                : // Only the WORK run's completion shows "Board complete" — not a
                  // compile/integration feed finishing (and being held), which would
                  // pop the closing line prematurely between integration and the run.
                  !!activeWf &&
                  isRunFeed(activeWf) &&
                  (liveModel.overallStatus === "done" || liveModel.overallStatus === "failed")
            }
            knowledge={viewingPast ? (viewedModel as BoardModel).knowledge : liveModel.knowledge}
            doneCount={viewingPast ? (viewedModel as BoardModel).done : liveModel.done}
            totalCount={viewingPast ? (viewedModel as BoardModel).total : liveModel.total}
          />
        </div>
      </div>

      <Settings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        ticksOn={ticksOn}
        chimesOn={chimesOn}
        onToggleTicks={() => {
          const next = !ticksOn;
          setTicksMuted(!next);
          setTicksOn(next);
        }}
        onToggleChimes={() => {
          const next = !chimesOn;
          setChimesMuted(!next);
          setChimesOn(next);
        }}
        heartbeatInterval={heartbeatInterval}
        onSetHeartbeatInterval={setHeartbeatInterval}
      />
      <InsightsModal
        open={showInsights}
        onClose={() => setShowInsights(false)}
        workflow={activeWf ?? model.workflow}
        knowledge={model.knowledge}
        runCount={runCount}
        currentRunId={model.runId}
      />
    </div>
  );
}

function statusOf(entry: WorkflowEntry | undefined): string | undefined {
  return (entry?.snap.status as { status?: string } | null)?.status;
}


/** The honest cold-start first frame: an explicit "starting…" state, shown until the
 *  first phase feed (compile / integration / run) is live. Never empty, never stale. */
function StartingState() {
  return (
    <div className="grid h-full place-items-center px-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src="./conductor.svg" alt="" className="h-12 w-12 opacity-80" />
        <h1 className="text-xl font-semibold text-chalk">Starting workflow…</h1>
        <p className="max-w-sm text-sm leading-relaxed text-mist">
          Preparing the board. Cards appear the moment the first phase is ready to render.
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-mint"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WaitingState({ model, statusPath }: { model: BoardModel; statusPath: string }) {
  return (
    <div className="grid h-full place-items-center px-5">
      <div className="max-w-md text-center">
        <img src="./conductor.svg" alt="" className="mx-auto h-12 w-12 opacity-80" />
        {model.hasConductor ? (
          <>
            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="font-mono text-sm font-medium text-chalk">{model.workflow}</span>
              <span className="rounded-md border border-line bg-panel px-2 py-0.5 font-mono text-[11px] text-mist">
                {model.total} card{model.total === 1 ? "" : "s"}
              </span>
            </div>
            <h1 className="mt-4 text-xl font-semibold text-chalk">Waiting for the agent to start execution.</h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">
              Cards will move onto the Kanban board when the agent writes{" "}
              <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-xs text-cyan">{statusPath}</code>.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-semibold text-chalk">No workflow found.</h1>
            <p className="mt-2 text-sm leading-relaxed text-mist">Create `.conductor/workflow.json`, then run status-init.</p>
          </>
        )}
      </div>
    </div>
  );
}
