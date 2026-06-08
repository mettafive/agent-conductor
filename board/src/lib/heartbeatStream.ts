import { useEffect, useMemo, useRef, useState } from "react";
import type { Insight, Scope } from "./types";
import type { WorkflowEntry } from "./useBoardState";

/** One heartbeat, flattened out of its step and tagged with its origin. */
export interface StreamBeat {
  key: string;
  workflow: string;
  step: string;
  title: string;
  at: string;
  note: string;
  insight?: Insight;
  iteration?: string;
  sub?: string;
  finalBeat: boolean;
  system: boolean;
  tone?: "feedback" | "insight";
}

interface RawBeat {
  at?: string;
  note?: string;
  iteration?: string;
  sub?: string;
  finalBeat?: boolean;
  system?: boolean;
  tone?: "feedback" | "insight";
  insight?: { id?: string; type?: string; seed?: string; title?: string; step?: string; scope?: string; confidence?: string };
}

interface RawStep {
  heartbeat?: RawBeat[];
  iterations?: Record<string, Record<string, { heartbeat?: RawBeat[] }>>;
}

const SCOPES: Scope[] = ["this-conductor", "upstream", "template", "tooling", "corpus"];

function scopeOf(value?: string): Scope | undefined {
  return SCOPES.includes(value as Scope) ? (value as Scope) : undefined;
}

function toStreamBeat(
  name: string,
  stepId: string,
  title: string,
  h: RawBeat,
  i: number,
  iteration?: string,
  sub?: string,
): StreamBeat | null {
  if (!h || typeof h.at !== "string" || typeof h.note !== "string") return null;
  return {
    key: `${name} ${stepId} ${iteration ?? ""} ${sub ?? ""} ${h.at} ${i}`,
    workflow: name,
    step: stepId,
    title,
    at: h.at,
    note: h.note,
    iteration: h.iteration ?? iteration,
    sub: h.sub ?? sub,
    finalBeat: h.finalBeat === true,
    system: h.system === true,
    tone: h.tone === "feedback" || h.tone === "insight" ? h.tone : undefined,
    insight:
      h.insight && typeof h.insight.type === "string"
        ? {
            id: h.insight.id,
            type: h.insight.type,
            seed: h.insight.seed ?? h.insight.title ?? "",
            title: h.insight.title,
            step: h.insight.step,
            scope: scopeOf(h.insight.scope),
            confidence: h.insight.confidence,
          }
        : undefined,
  };
}

/**
 * Flatten every heartbeat across every workflow and step into a single stream,
 * sorted oldest → newest. Descends into loop iterations so sub-step beats are
 * part of the stream too. Keys are stable so re-renders and SSE reconnects don't
 * resurface old beats as new.
 */
export function flattenBeats(
  workflows: Record<string, WorkflowEntry>,
  order: string[],
): StreamBeat[] {
  const out: StreamBeat[] = [];
  const push = (b: StreamBeat | null) => {
    if (b) out.push(b);
  };
  for (const name of order) {
    const entry = workflows[name];
    const status = entry?.snap.status as
      | { steps?: Record<string, RawStep> }
      | null;
    let workflowSteps: Array<{ title?: string }> = [];
    try {
      const doc = typeof entry?.snap.workflowJson === "string" ? JSON.parse(entry.snap.workflowJson) : entry?.snap.workflowJson;
      workflowSteps = Array.isArray(doc?.steps) ? doc.steps : [];
    } catch {
      workflowSteps = [];
    }
    const steps = status?.steps ?? {};
    for (const stepId of Object.keys(steps)) {
      const step = steps[stepId];
      const title = workflowSteps[Number(stepId)]?.title || stepId;
      // top-level step beats
      if (Array.isArray(step?.heartbeat)) {
        step.heartbeat.forEach((h, i) => push(toStreamBeat(name, stepId, title, h, i)));
      }
      // loop sub-step beats — descend iterations[item][sub].heartbeat so the
      // monitor, the live heart and the stall timer see EVERY level of activity
      const iters = step?.iterations;
      if (iters && typeof iters === "object") {
        for (const item of Object.keys(iters)) {
          const subs = iters[item] ?? {};
          for (const subId of Object.keys(subs)) {
            const hb = subs[subId]?.heartbeat;
            if (!Array.isArray(hb)) continue;
            hb.forEach((h, i) => push(toStreamBeat(name, stepId, title, h, i, item, subId)));
          }
        }
      }
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

export interface Arrival {
  beat: StreamBeat;
  /** Increments on every fresh batch — drives one-shot effects (tick, pulse). */
  nonce: number;
}

/** How many heartbeat lines the monitor keeps, across run resets. */
export const MAX_LOG = 500;

export interface HeartbeatStream {
  /** Live beats from the current snapshots (resets when a run restarts). */
  beats: StreamBeat[];
  /** Rolling, persistent buffer of the last MAX_LOG beats across runs. */
  log: StreamBeat[];
  /** The newest genuinely-new beat, or null on first load / no new beats. */
  arrival: Arrival | null;
}

/**
 * Subscribe to the flattened heartbeat stream and surface *new* arrivals.
 *
 * The first render seeds the "seen" set silently, so existing beats on page
 * load — and any beat re-sent on an SSE reconnect — never count as arrivals.
 * Only beats that appear after the seed fire `arrival`.
 */
export function useHeartbeatStream(
  workflows: Record<string, WorkflowEntry>,
  order: string[],
): HeartbeatStream {
  const beats = useMemo(() => flattenBeats(workflows, order), [workflows, order]);
  const runSignature = useMemo(
    () =>
      order
        .map((name) => {
          const status = workflows[name]?.snap.status as { run_id?: string } | null;
          return `${name}:${status?.run_id ?? "no-run"}`;
        })
        .join("|"),
    [workflows, order],
  );
  const seen = useRef<Set<string> | null>(null);
  const lastRunSignature = useRef<string>("");
  const nonce = useRef(0);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [log, setLog] = useState<StreamBeat[]>([]);

  useEffect(() => {
    if (lastRunSignature.current !== runSignature) {
      lastRunSignature.current = runSignature;
      seen.current = null;
      setArrival(null);
      setLog([]);
    }
  }, [runSignature]);

  useEffect(() => {
    if (seen.current === null) {
      // Wait for the initial data before baselining. On a refresh the beats load async, so the
      // first render has beats=[]; if we seeded that empty set, the real beats arriving next would
      // all look "fresh" and the latest would re-type on every refresh. Baseline the first
      // NON-empty load instead, so already-present beats never animate.
      if (beats.length === 0) return;
      // first real load — seed silently and prime the buffer with what's already here
      seen.current = new Set(beats.map((b) => b.key));
      setLog(beats.slice(-MAX_LOG));
      return;
    }
    const fresh = beats.filter((b) => !seen.current!.has(b.key));
    if (fresh.length === 0) return;
    for (const b of fresh) seen.current.add(b.key);
    // append to the persistent buffer (survives run resets), cap at MAX_LOG
    setLog((prev) => {
      const next = prev.concat(fresh);
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
    nonce.current += 1;
    setArrival({ beat: fresh[fresh.length - 1], nonce: nonce.current });
  }, [beats, runSignature]);

  return { beats, log, arrival };
}

/** Most recent beat timestamp across the whole stream (drives overdue state). */
export function lastBeatIso(beats: StreamBeat[]): string | undefined {
  return beats.length ? beats[beats.length - 1].at : undefined;
}
