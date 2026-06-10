import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import type { BoardModel, BoardStep, Column as Col, DeveloperNote } from "../lib/types";
import { fmtDur } from "../lib/format";
import { clockSince } from "../lib/view";
import { renderNote } from "../lib/heartbeat";
import { displayName, phaseLabel, isLifecycle } from "../lib/identity";
import { Led } from "./Led";
import { NoteThread } from "./HeartbeatTimeline";

const BASE_COLS: Col[] = ["pending", "running", "checking", "done"];
const DWELL_MS = 1000;
// After the dwell advances the last cards into Done, hold the LIVE board this long
// so the move-into-Done layout animation (~0.42s) plays out before switching to the
// settled snapshot — otherwise the snapshot teleports the cards and the board
// "stops" before that final animation.
const SETTLE_ANIM_MS = 520;
const FLOW: Col[] = ["pending", "running", "checking", "done"];

interface ArtifactFile {
  path: string;
  name: string;
  size: number;
  mtime: string;
  mime?: string;
  preview_kind?: "text" | "html" | "image" | "pdf" | "download";
}

interface ArtifactContent extends ArtifactFile {
  content: string;
  previewable?: boolean;
  download_url?: string;
  too_large?: boolean;
  max_preview_size?: number;
}

interface SettledSnapshot {
  runId?: string;
  model: BoardModel;
  steps: BoardStep[];
  notes?: DeveloperNote[];
}

const LABEL: Record<Col, string> = {
  pending: "Pending",
  running: "Running",
  checking: "Checking",
  done: "Done",
  failed: "Failed",
};

const MOVE = {
  layout: { duration: 0.42, ease: [0.45, 0, 0.55, 1] },
  default: { duration: 0.18, ease: "easeOut" },
} as const;

function requirementTitles(step: BoardStep, steps: BoardStep[]): string[] {
  return step.requires
    .map((idx) => steps[idx])
    .filter((dep): dep is BoardStep => !!dep && dep.column !== "done")
    .map((dep) => dep.title);
}

function unmetRequirementIndexes(step: BoardStep, steps: BoardStep[]): number[] {
  return step.requires
    .filter((idx) => {
      const dep = steps[idx];
      return !!dep && dep.column !== "done" && !dep.retired;
    })
    .sort((a, b) => a - b);
}

function graphDepths(steps: BoardStep[]): number[] {
  const cache = new Map<number, number>();
  const visiting = new Set<number>();
  const depth = (idx: number): number => {
    if (cache.has(idx)) return cache.get(idx)!;
    if (visiting.has(idx)) return 0;
    visiting.add(idx);
    const step = steps[idx];
    const value = !step || step.requires.length === 0
      ? 0
      : 1 + Math.max(...step.requires.map((req) => depth(req)));
    visiting.delete(idx);
    cache.set(idx, value);
    return value;
  };
  return steps.map((_, idx) => depth(idx));
}

interface PendingBand {
  key: string;
  title: string;
  gateIndexes: number[];
  steps: BoardStep[];
  order: number;
}

function pendingBands(pendingSteps: BoardStep[], allSteps: BoardStep[]): PendingBand[] {
  const depths = graphDepths(allSteps);
  const map = new Map<string, PendingBand>();

  for (const step of pendingSteps) {
    const gateIndexes = unmetRequirementIndexes(step, allSteps);
    const key = gateIndexes.length ? gateIndexes.join(",") : "ready";
    const existing = map.get(key);
    if (existing) {
      existing.steps.push(step);
      existing.order = Math.min(existing.order, step.index);
      continue;
    }

    const gateTitles = gateIndexes
      .map((idx) => allSteps[idx]?.title)
      .filter((title): title is string => !!title);
    map.set(key, {
      key,
      gateIndexes,
      steps: [step],
      title: gateIndexes.length ? `Waiting for · ${gateTitles.join(", ")}` : "Ready",
      order: step.index,
    });
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === "ready") return -1;
    if (b.key === "ready") return 1;
    const aDepth = Math.max(...a.gateIndexes.map((idx) => depths[idx] ?? 0));
    const bDepth = Math.max(...b.gateIndexes.map((idx) => depths[idx] ?? 0));
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.order - b.order;
  });
}

function statusLine(step: BoardStep, steps: BoardStep[], maxAttempts: number): string {
  if (step.column === "pending") {
    const waiting = requirementTitles(step, steps);
    return waiting.length ? `waiting for: ${waiting.join(", ")}` : "ready";
  }
  if (step.column === "running") return `attempt ${step.attempt}/${maxAttempts}`;
  if (step.column === "checking") return "checking";
  if (step.column === "failed") return `attempt ${step.attempt}/${maxAttempts} exhausted`;
  return "passed";
}

function primaryArtifactPath(step: BoardStep): string | undefined {
  return step.artifact || step.receipt;
}

function isPrimaryArtifactFile(file: ArtifactFile, step: BoardStep): boolean {
  const linked = new Set([primaryArtifactPath(step), ...(step.artifacts ?? [])].filter(Boolean));
  return linked.has(file.path);
}

function isPrimaryArtifactPath(file: ArtifactFile, artifactPath?: string): boolean {
  return !!artifactPath && file.path === artifactPath;
}

function canOpenReceipt(step: BoardStep): boolean {
  return Boolean(primaryArtifactPath(step) || (step.artifacts?.length ?? 0) > 0);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size}b`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}kb`;
  return `${(size / 1024 / 1024).toFixed(1)}mb`;
}

function artifactKind(file: Pick<ArtifactFile, "path" | "preview_kind">): ArtifactFile["preview_kind"] {
  if (file.preview_kind) return file.preview_kind;
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "html" || ext === "htm") return "html";
  if (["md", "txt", "json", "log", "csv", "tsv", "js", "ts", "tsx", "css"].includes(ext)) return "text";
  return "download";
}

function artifactKindLabel(file: ArtifactFile): string {
  const kind = artifactKind(file);
  if (kind === "image") return "image";
  if (kind === "pdf") return "pdf";
  if (kind === "html") return "html";
  if (kind === "text") return "text";
  return "file";
}

function isDiagnosticArtifactFile(file: ArtifactFile): boolean {
  return /(^|-)check-prompt\.(txt|md)$/i.test(file.name) || /^attempt-\d+-(compose|check)-(prompt|raw)\.(txt|md)$/i.test(file.name);
}

function isMigrationArtifactFile(file: ArtifactFile): boolean {
  return /^(create-cards|map-dependencies|validate-workflow|migration-plan)\.md$/i.test(file.name);
}

function orderedArtifactFiles(files: ArtifactFile[]): ArtifactFile[] {
  return [...files].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function isMarkdown(file: Pick<ArtifactFile, "path" | "preview_kind">): boolean {
  return artifactKind(file) === "text" && /\.md(?:$|\?)/i.test(file.path);
}

function rawArtifactUrl(workflow: string, artifactPath: string): string {
  return `/api/workflow/${encodeURIComponent(workflow)}/artifact-raw?path=${encodeURIComponent(artifactPath)}`;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded border border-line bg-panel/70 px-1 py-0.5 font-mono text-[0.92em] text-mint">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function MarkdownPreview({ text, workflow }: { text: string; workflow: string }) {
  const blocks: Array<
    | { type: "heading"; level: number; text: string }
    | { type: "image"; alt: string; src: string }
    | { type: "paragraph"; lines: string[] }
    | { type: "list"; ordered: boolean; items: string[] }
    | { type: "code"; lang: string; text: string }
    | { type: "table"; rows: string[][] }
  > = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang: fence[1] ?? "", text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (image) {
      blocks.push({ type: "image", alt: image[1].trim(), src: image[2].trim() });
      i += 1;
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows: string[][] = [line, lines[i + 1]]
        .filter((_, rowIndex) => rowIndex === 0)
        .map((row) => row.trim().slice(1, -1).split("|").map((cell) => cell.trim()));
      i += 2;
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().slice(1, -1).split("|").map((cell) => cell.trim()));
        i += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+[.)]\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, "").trim());
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*\|.+\|\s*$/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }

  return (
    <div className="max-w-[82ch] space-y-4 text-[13px] leading-7 text-mist-2">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
          return (
            <Tag
              key={index}
              className={
                block.level === 1
                  ? "border-b border-line pb-2 text-[22px] font-semibold leading-tight text-chalk"
                  : block.level === 2
                    ? "pt-2 text-[16px] font-semibold leading-snug text-chalk"
                    : "font-mono text-[11px] uppercase tracking-[0.14em] text-mint"
              }
            >
              {renderInlineMarkdown(block.text)}
            </Tag>
          );
        }
        if (block.type === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-md border border-line bg-panel/55 p-3 font-mono text-[12px] leading-6 text-mist"
            >
              {block.text}
            </pre>
          );
        }
        if (block.type === "image") {
          return (
            <figure key={index} className="overflow-hidden rounded-md border border-line bg-panel/30">
              <img
                src={/^(https?:|data:|blob:|\/api\/)/i.test(block.src) ? block.src : rawArtifactUrl(workflow, block.src)}
                alt={block.alt}
                className="max-h-[560px] w-full bg-ink object-contain"
              />
              <figcaption className="px-3 py-2 font-mono text-[10px] text-dim">
                {block.alt || block.src}
              </figcaption>
            </figure>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={index}
              className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="overflow-x-auto rounded-md border border-line bg-panel/25">
              <table className="w-full border-collapse text-left font-mono text-[11px]">
                <thead className="bg-panel/70 text-mint">
                  <tr>
                    {block.rows[0]?.map((cell, cellIndex) => (
                      <th key={cellIndex} className="border-b border-line px-3 py-2 font-medium">
                        {renderInlineMarkdown(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-line/70">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 text-mist">
                          {renderInlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={index} className="text-mist-2">
            {renderInlineMarkdown(block.lines.join(" "))}
          </p>
        );
      })}
    </div>
  );
}

function columnPath(from: Col, to: Col): Col[] {
  if (from === to) return [];
  if (to === "failed") return ["failed"];
  if (from === "failed") return [to];
  const a = FLOW.indexOf(from);
  const b = FLOW.indexOf(to);
  if (a !== -1 && b !== -1 && b > a) return FLOW.slice(a + 1, b + 1);
  return [to];
}

function useDwellSteps(steps: BoardStep[], enabled: boolean, replayInitial: boolean): BoardStep[] {
  const [display, setDisplay] = useState<Record<string, { column: Col; enteredAt: number; queue: Col[] }>>({});

  useEffect(() => {
    if (!enabled) {
      setDisplay({});
      return;
    }

    const now = Date.now();
    setDisplay((prev) => {
      const next: Record<string, { column: Col; enteredAt: number; queue: Col[] }> = {};
      for (const step of steps) {
        const initial = replayInitial && step.column !== "pending"
          ? { column: "pending" as Col, enteredAt: now, queue: columnPath("pending", step.column) }
          : { column: step.column, enteredAt: now, queue: [] };
        const current = prev[step.id] ?? initial;
        const lastQueued = current.queue.at(-1) ?? current.column;
        const additions = columnPath(lastQueued, step.column);
        next[step.id] = {
          ...current,
          queue: additions.length ? [...current.queue, ...additions] : current.queue,
        };
      }
      return next;
    });
  }, [enabled, replayInitial, steps]);

  useEffect(() => {
    if (!enabled) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const step of steps) {
      const state = display[step.id];
      if (!state || state.queue.length === 0) continue;
      const wait = Math.max(0, DWELL_MS - (Date.now() - state.enteredAt));
      timers.push(
        setTimeout(() => {
          setDisplay((prev) => {
            const current = prev[step.id];
            if (!current || current.queue.length === 0) return prev;
            const [column, ...queue] = current.queue;
            return {
              ...prev,
              [step.id]: { column, queue, enteredAt: Date.now() },
            };
          });
        }, wait),
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [display, enabled, steps]);

  if (!enabled) return steps;
  return steps.map((step) => {
    const shown = display[step.id]?.column;
    return shown ? { ...step, column: shown } : step;
  });
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function attemptLabel(step: BoardStep, maxAttempts: number): string {
  const attempt = Math.max(1, Number(step.attempt || 1));
  if (step.column === "failed") return `failed after ${Math.max(attempt, maxAttempts)}`;
  return attempt === 1 ? "1st try" : `${ordinal(attempt)} try`;
}

function completionSort(a: BoardStep, b: BoardStep): number {
  const at = a.completed_at || a.started_at || "";
  const bt = b.completed_at || b.started_at || "";
  if (at && bt && at !== bt) return at < bt ? -1 : 1;
  if (at && !bt) return -1;
  if (!at && bt) return 1;
  return a.index - b.index;
}

function totalRetries(steps: BoardStep[]): number {
  return steps.reduce((n, step) => n + Math.max(0, Number(step.attempt || 1) - 1), 0);
}

function stepTone(step: BoardStep): "green" | "amber" | "red" {
  if (step.column === "failed") return "red";
  return Number(step.attempt || 1) > 1 ? "amber" : "green";
}

function toneClasses(tone: "green" | "amber" | "red") {
  if (tone === "red") return {
    dot: "bg-rose shadow-[0_0_0_4px_rgba(251,113,133,0.15)]",
    border: "border-l-rose bg-rose/5",
    meta: "text-rose",
    icon: "✕",
  };
  if (tone === "amber") return {
    dot: "bg-amber shadow-[0_0_0_4px_rgba(245,158,11,0.16)]",
    border: "border-l-amber",
    meta: "text-amber",
    icon: "✓",
  };
  return {
    dot: "bg-mint shadow-[0_0_0_4px_rgba(52,211,153,0.14)]",
    border: "border-l-mint",
    meta: "text-mint",
    icon: "✓",
  };
}

/**
 * The shared RUN-HEADER. Rendered in BOTH the live and settled board views as the
 * thin run-row at the top of the board area. LEFT carries the run name plus the
 * status cluster ([Led + status] · done/total · elapsed) lifted out of the
 * masthead; RIGHT carries the `Insights N` button. The Summary/Board toggle only
 * renders when the run has settled (there's no summary during a live run).
 */
function CompletionHeader({
  model,
  steps,
  view,
  onView,
  settled,
  elapsed,
  canonicalKey,
  activeDispatch = false,
}: {
  model: BoardModel;
  steps: BoardStep[];
  view: "summary" | "board";
  onView: (view: "summary" | "board") => void;
  settled: boolean;
  elapsed?: string | null;
  canonicalKey?: string;
  activeDispatch?: boolean;
}) {
  const failedCards = steps.filter((s) => s.column === "failed");
  const failed = failedCards.length;
  const totalTime = clockSince(model.startedAt, Date.now(), model.endedAt);
  const retries = totalRetries(steps);
  const shownStatus = model.overallStatus ?? "idle";
  // One identity, one display scheme: the base name from the canonical key (never the
  // inner JSON title), plus a phase badge. Falls back to model.workflow only if no key.
  const key = canonicalKey ?? model.workflow;
  const baseName = displayName(key);
  const phase = phaseLabel(key, shownStatus);
  const phaseClass =
    shownStatus === "paused"
      ? "border-[#9db8de]/40 bg-[#9db8de]/10 text-[#9db8de]"
      : shownStatus === "failed"
        ? "border-rose/40 bg-rose/10 text-rose"
        : isLifecycle(key)
          ? "border-iris/40 bg-iris/10 text-iris"
          : shownStatus === "done"
            ? "border-line-2 bg-panel text-mist"
            : "border-mint/40 bg-mint/10 text-mint";
  const [reasonOpen, setReasonOpen] = useState(false);

  // The "why did it fail" payload: prefer the run-level failed_reason/failed_step
  // (written by complete.js on terminal failure), fall back to the failed card's
  // last_feedback heartbeat / dispatch note. Drives the failed-reason modal.
  const failedCard =
    (model.failedStep ? failedCards.find((s) => s.id === model.failedStep) : undefined) ?? failedCards[0];
  const failedCardFeedback =
    failedCard?.heartbeat?.filter((h) => h.tone === "feedback").at(-1)?.note ??
    failedCard?.heartbeat?.at(-1)?.note;
  const failureReason = model.failedReason || failedCardFeedback || null;
  const canShowReason = (shownStatus === "failed" || failed > 0) && !!(failureReason || failedCard);

  // Pause/resume — optimistic: the click registers AT ONCE (the button flips to
  // Pausing…/Resuming…), cleared when the broadcast confirms the real status.
  const [pending, setPending] = useState<null | "pause" | "resume">(null);
  useEffect(() => {
    if (pending === "pause" && shownStatus === "paused") setPending(null);
    if (pending === "resume" && shownStatus === "running") setPending(null);
  }, [pending, shownStatus]);

  // Pause visibility reads the ONE shared signal — hasActiveDispatch(entry), computed by
  // App and passed in. No second definition here: the navigator, board, and pause button
  // can't disagree about what's alive.

  return (
    <div className="shrink-0 border-b border-line bg-ink/95">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-5 py-7">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <Led state={model.overallStatus} />
            {/* base name = the canonical identity (matches the navigator); the phase
                badge carries status/lifecycle — never the inner "Migrating…" title. */}
            <h2 className="truncate text-[20px] font-semibold text-chalk">{baseName}</h2>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] ${phaseClass}`}>
              {phase}
            </span>
          </div>
          {/* status cluster — done/total · elapsed (the phase lives in the badge above) */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[14px] text-mist-2">
            <span className="tabular-nums">
              {model.done}/{model.total}
            </span>
            {(elapsed || totalTime) && (
              <>
                <span className="text-dim">·</span>
                <span className="tabular-nums text-mist">{elapsed ?? totalTime}</span>
              </>
            )}
            {retries > 0 && (
              <>
                <span className="text-dim">·</span>
                <span>{retries} retries</span>
              </>
            )}
            {failed > 0 && (
              <>
                <span className="text-dim">·</span>
                {canShowReason ? (
                  <button
                    type="button"
                    onClick={() => setReasonOpen(true)}
                    title="Show why it failed"
                    className="text-rose underline decoration-rose/40 underline-offset-2 transition-colors hover:decoration-rose"
                  >
                    {failed} failed
                  </button>
                ) : (
                  <span className="text-rose">{failed} failed</span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Pause / Resume — shown only when there's ACTIVE DISPATCH to drain (hidden for
              compile/integration and for a stale "running" with no live dispatcher). Posts
              the CANONICAL key, registers the click optimistically, and never navigates. */}
          {activeDispatch && (
            <button
              type="button"
              disabled={!!pending}
              onClick={() => {
                const action = shownStatus === "paused" ? "resume" : "pause";
                setPending(action); // optimistic — the click shows at once
                fetch(`/api/workflow/${encodeURIComponent(key)}/${action}`, { method: "POST" }).catch(() => setPending(null));
              }}
              title={
                shownStatus === "paused"
                  ? "Resume — dispatch the next card"
                  : "Pause — let in-flight cards finish, then hold (no new cards start)"
              }
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-2 bg-panel/60 px-3 py-1.5 font-mono text-[13px] text-mist-2 transition-[colors,transform] hover:bg-panel hover:text-chalk active:scale-[0.97] disabled:opacity-70"
            >
              {pending === "pause" && shownStatus !== "paused"
                ? "⏸ Pausing…"
                : pending === "resume" && shownStatus !== "running"
                  ? "▶ Resuming…"
                  : shownStatus === "paused"
                    ? "▶ Resume"
                    : "⏸ Pause"}
            </button>
          )}
          {/* Summary/Board toggle — only when settled (no summary during a live run). */}
          {settled && (
            <div className="flex rounded-md border border-line bg-panel p-0.5 text-[15px]">
              <button
                className={`rounded px-3 py-1 ${view === "summary" ? "bg-panel-2 text-chalk" : "text-mist hover:text-chalk"}`}
                type="button"
                onClick={() => onView("summary")}
              >
                Summary
              </button>
              <button
                className={`rounded px-3 py-1 ${view === "board" ? "bg-panel-2 text-chalk" : "text-mist hover:text-chalk"}`}
                type="button"
                onClick={() => onView("board")}
              >
                Board
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Failed-reason modal — clicking the failed badge opens WHY: the run-level
          failed_reason + failed step, plus the failed card's last feedback. */}
      <AnimatePresence>
        {reasonOpen && (
          <CardModal
            eyebrow="Failed"
            title={failedCard ? failedCard.title : "Run failed"}
            onClose={() => setReasonOpen(false)}
          >
            <div className="space-y-4">
              {model.failedStep && (
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
                  Failed at step {model.failedStep}
                </div>
              )}
              {failureReason ? (
                <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-3">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-rose/80">
                    Reason
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mist-2">
                    {failureReason}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-mist-2">No failure detail was recorded.</p>
              )}
            </div>
          </CardModal>
        )}
      </AnimatePresence>
    </div>
  );
}

// One beat of the gloss: a spine node + a single quiet line; the full check
// waits behind a click, the insight behind a tap on the amber marker.
function GlossRow({
  model,
  step,
  maxAttempts,
  onArtifact,
}: {
  model: BoardModel;
  step: BoardStep;
  maxAttempts: number;
  onArtifact: (step: BoardStep) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState<"criteria" | "insights" | null>(null);

  const tone = stepTone(step);
  const cls = toneClasses(tone);
  const failed = step.column === "failed";
  const dur = fmtDur(step.started_at, step.completed_at);
  // tries only on the right now; duration moved to the far-left gutter.
  const triesLine = attemptLabel(step, maxAttempts);
  const canBrowseArtifacts = canOpenReceipt(step);

  // Insight marker: only when a knowledge entry was authored from this card.
  const cardInsights = (model.knowledge || []).filter(
    (k) => String(k.source_card ?? "") === String(step.id) && k.source_run === model.runId,
  );
  const hasInsight = cardInsights.length > 0;

  // Summary resolution — best available, two clean sentences, authored at the
  // source. If the card has a verdict, show the CHECKER summary (outcome);
  // otherwise show the COMPOSER summary (intent) from the workflow step def.
  // Nothing is generated here on the live path.
  const verdictCriterion = step.criteria.find((c) => typeof c.passed === "boolean");
  const checkerSummary = verdictCriterion?.summary ?? null;
  const summaryCriterion = step.criteria.find((c) => c.summary || c.checked_summary || c.evidence);
  const summaryLine = checkerSummary ?? summaryCriterion?.summary ?? step.summary ?? null;
  const checkedLine = summaryCriterion?.checked_summary ?? null;
  const evidence = step.criteria.find((c) => c.evidence)?.evidence ?? null;
  const failingCriterion = step.criteria.find((c) => c.passed === false);

  // Dedup logic: when the verdict has no real summary/checked_summary (facets
  // collapsed — the hand-authored case where `summary` is just firstSentence of
  // the evidence), the summary is a prefix of the evidence and would duplicate
  // it. In that case show the full evidence once and skip the SUMMARY/CHECKED
  // lines. Otherwise render clean SUMMARY + CHECKED, deduped against each other.
  const normalize = (s: string | null) => (s ? s.replace(/\s+/g, " ").trim() : "");
  const evNorm = normalize(evidence);
  const sumNorm = normalize(summaryLine);
  const chkNorm = normalize(checkedLine);
  const isPrefixOfEvidence = (s: string) => !!s && !!evNorm && evNorm.startsWith(s.replace(/\.\.\.$/, ""));
  const summaryDerivedFromEvidence =
    (!summaryLine && !checkedLine && !!evidence) ||
    (!checkedLine && isPrefixOfEvidence(sumNorm)) ||
    (isPrefixOfEvidence(sumNorm) && isPrefixOfEvidence(chkNorm));
  const summaryEqualsChecked = !!sumNorm && sumNorm === chkNorm;

  return (
    <motion.div layout className="relative">
      {/* the gloss row — [dur] · node · title · tries. a quiet row within the panel. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if ((window.getSelection()?.toString().length ?? 0) > 0) return;
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-3.5 transition-colors hover:bg-panel-2/30 ${
          failed ? "bg-rose/[0.04]" : ""
        }`}
      >
        {/* duration gutter — far left, left-aligned, quiet muted mono. Done cards
            with no measurable duration default to 0s; pending stay blank. */}
        <span className={`w-14 shrink-0 text-left font-mono text-[12px] tabular-nums ${failed ? "text-rose/70" : "text-mist"}`}>
          {dur || (step.column === "done" ? "0s" : "")}
        </span>

        {/* spine node — smaller; colored by tone (spine threads its center) */}
        <div className="relative z-10 grid h-5 w-5 shrink-0 place-items-center">
          <div className={`grid h-4 w-4 place-items-center rounded-full border border-line bg-ink font-mono text-[10px] ${cls.meta} ${cls.dot}`}>
            {cls.icon}
          </div>
        </div>

        {/* title — the story, given the room */}
        <h3 className={`min-w-0 flex-1 truncate text-[16px] font-medium leading-snug ${failed ? "text-rose" : "text-chalk"}`}>
          {step.title}
        </h3>

        {/* stat — tries only now (duration moved to the left gutter) */}
        <span className={`shrink-0 font-mono text-[13px] ${failed ? "text-rose" : "text-mist-2"}`}>
          {triesLine}
        </span>
      </div>

      {/* the click — inquiry: the full check beneath the beat */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="ml-[100px] mt-3 space-y-4 border-l border-line pb-3 pl-7 pr-2 pt-2">
              {/* failing criterion — loud, only on failure */}
              {failed && failingCriterion && (
                <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-rose">Failed check</div>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-mist-2">
                    {failingCriterion.summary || failingCriterion.evidence || failingCriterion.name || failingCriterion.text}
                  </p>
                </div>
              )}

              {/* one verdict — clean & full, deduped. When the verdict has no
                  real summary/checked_summary (facets collapsed), show the full
                  evidence once instead of a summary that duplicates it. */}
              {summaryDerivedFromEvidence ? (
                evidence && (
                  <p className={`whitespace-pre-wrap text-[15px] leading-snug ${failed ? "text-rose" : "text-mist-2"}`}>
                    {evidence}
                  </p>
                )
              ) : (
                <>
                  {summaryLine && (
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist-2">Summary</div>
                      <p className={`mt-1 whitespace-pre-wrap text-[15px] leading-snug ${failed ? "text-rose" : "text-mist-2"}`}>
                        {summaryLine}
                      </p>
                    </div>
                  )}
                  {checkedLine && !summaryEqualsChecked && (
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist-2">Checked</div>
                      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-mist-2">{checkedLine}</p>
                    </div>
                  )}
                </>
              )}

              {/* button row — Artifact · Criteria · Insights, each its own surface */}
              <div className="flex flex-wrap gap-2">
                {canBrowseArtifacts && (
                  <button
                    type="button"
                    onClick={() => onArtifact(step)}
                    className="rounded-md border border-mint/30 bg-mint/10 px-2.5 py-1 font-mono text-[12px] text-mint transition-colors hover:bg-mint/20"
                  >
                    Artifact
                  </button>
                )}
                {step.criteria.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDrawer((d) => (d === "criteria" ? null : "criteria"))}
                    className={`rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                      drawer === "criteria"
                        ? "border-[#3b82f6]/40 bg-[#3b82f6]/25 text-[#93c5fd]"
                        : "border-[#3b82f6]/40 bg-[#3b82f6]/15 text-[#93c5fd] hover:bg-[#3b82f6]/25"
                    }`}
                  >
                    Criteria
                  </button>
                )}
                {hasInsight && (
                  <button
                    type="button"
                    onClick={() => setDrawer((d) => (d === "insights" ? null : "insights"))}
                    className={`rounded-md border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                      drawer === "insights"
                        ? "border-amber/40 bg-amber/[0.12] text-amber"
                        : "border-amber/25 text-amber hover:bg-amber/10"
                    }`}
                  >
                    Insights
                  </button>
                )}
              </div>

              {/* Criteria drawer — ✓/✕/· list + full raw evidence behind it */}
              <AnimatePresence initial={false}>
                {drawer === "criteria" && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3">
                      <ul className="space-y-1">
                        {step.criteria.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-[14px] leading-snug text-mist-2">
                            <span
                              className={`mt-0.5 shrink-0 font-mono ${
                                c.passed === false ? "text-rose" : c.passed === true ? "text-mint" : "text-mist"
                              }`}
                            >
                              {c.passed === false ? "✕" : c.passed === true ? "✓" : "·"}
                            </span>
                            <span className="min-w-0">{c.name || c.text || c.summary}</span>
                          </li>
                        ))}
                      </ul>
                      {evidence && (
                        <div className="rounded-md border border-line/60 bg-panel/30 px-3 py-2">
                          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">Evidence</div>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-mist">{evidence}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Insights drawer — title · detail · tag chip · K-id */}
              <AnimatePresence initial={false}>
                {drawer === "insights" && hasInsight && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1.5">
                      {cardInsights.map((k, i) => (
                        <div key={k.id ?? i} className="rounded-lg border border-line bg-panel/40 px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[13px] text-chalk">{k.title}</span>
                            {k.id && <span className="rounded border border-line-2 px-1 font-mono text-[10px] text-mist">{k.id}</span>}
                            {k.tag && (
                              <span className="rounded border border-amber/25 bg-amber/[0.08] px-1 font-mono text-[10px] text-amber">{k.tag}</span>
                            )}
                          </div>
                          {(k.detail || k.note) && (
                            <p className="mt-1.5 text-[13px] leading-relaxed text-mist-2">{k.detail || k.note}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CompletionTimeline({
  model,
  steps,
  maxAttempts,
}: {
  model: BoardModel;
  steps: BoardStep[];
  maxAttempts: number;
}) {
  const rows = [...steps].sort(completionSort);
  const [artifactStep, setArtifactStep] = useState<BoardStep | null>(null);

  return (
    <>
      <div className="px-5 py-5">
        <div className="mx-auto max-w-[820px]">
          {/* one elevated panel — the whole gloss reads as a single component */}
          <div className="rounded-xl border border-line bg-panel/40 p-2 shadow-[0_1px_0_0_rgba(255,255,255,0.02),0_8px_24px_-12px_rgba(0,0,0,0.6)]">
            <div className="relative">
              {/* the spine — a vertical thread centered on the node dots.
                  left = row px-3 (12) + dur gutter w-14 (56) + gap-3 (12) + node half (10) = 90px.
                  inset top/bottom by one dot-center offset (row py-3.5=14 + node half 10 = 24)
                  so it runs first→last dot center. */}
              <div className="pointer-events-none absolute bottom-[24px] left-[90px] top-[24px] w-px bg-line" />
              <div className="relative divide-y divide-line/40">
                {rows.map((step) => (
                  <GlossRow
                    key={step.id}
                    model={model}
                    step={step}
                    maxAttempts={maxAttempts}
                    onArtifact={setArtifactStep}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {artifactStep && (
          <ArtifactModal
            workflow={model.workflow}
            step={artifactStep}
            onClose={() => setArtifactStep(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

interface CompileSummary {
  ready?: boolean;
  workflow_name?: string | null;
  card_count?: number;
  edge_count?: number;
  card_attempts?: number | null;
  dependency_attempts?: number | null;
}

interface IntegrationChange {
  type?: "edit" | "add" | "remove";
  card?: number | null;
  title?: string;
  change?: string;
  knowledge_id?: string;
}

interface IntegrationSummary {
  run_id: string;
  processed: number;
  applied: number;
  edited: number;
  reordered?: number;
  added: number;
  retired?: number;
  dismissed: number;
  changes: IntegrationChange[];
  dismissed_items: { id: string; reason?: string }[];
  artifact?: string;
}

function isCompileLifecycle(model: BoardModel, steps: BoardStep[]): boolean {
  return (
    model.workflow === "Migrating skill to conductor" ||
    steps.some((step) => step.title === "Create Cards") &&
      steps.some((step) => step.title === "Map Dependencies") &&
      steps.some((step) => step.title === "Validate Workflow")
  );
}

function isIntegrationLifecycle(model: BoardModel, steps: BoardStep[]): boolean {
  return (
    model.workflow === "Integrating insights" ||
    steps.some((step) => step.title === "Apply instruction insights") &&
      steps.some((step) => step.title === "Validate updated workflow")
  );
}

function IntegrationSummaryPanel({
  summary,
  starting,
  error,
  onStart,
}: {
  summary: IntegrationSummary;
  starting?: boolean;
  error?: string | null;
  // Optional: integration is no longer a gate (the run applies it automatically),
  // so this panel is display-only unless a caller still wants a launch button.
  onStart?: () => void;
}) {
  const applied = summary.applied ?? 0;
  const dismissed = summary.dismissed ?? 0;
  const added = summary.added ?? 0;
  const retired = summary.retired ?? 0;
  const reordered = summary.reordered ?? 0;

  return (
    <div className="mt-4 rounded-md border border-line bg-panel/70 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-mint">Integration complete</div>
      <div className="mt-2 font-mono text-[11px] leading-relaxed text-mist">
        <div>{summary.processed} knowledge item{summary.processed === 1 ? "" : "s"} processed</div>
        <div>{applied} applied · {added} new card{added === 1 ? "" : "s"} · {reordered} order edit{reordered === 1 ? "" : "s"} · {retired} retired · {dismissed} dismissed</div>
      </div>

      {(summary.changes?.length > 0 || summary.dismissed_items?.length > 0) && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          {summary.changes?.map((change, index) => {
            const glyph = change.type === "add" ? "+" : change.type === "remove" ? "-" : "edit";
            return (
              <div key={`${change.knowledge_id || "change"}-${index}`} className="grid gap-1 text-[12px] leading-snug text-mist">
                <div className="flex gap-2 text-chalk">
                  <span className="w-8 shrink-0 font-mono text-mint">{glyph}</span>
                  <span>
                    Card {change.card ?? "?"}{change.title ? ` — ${change.title}` : ""}
                  </span>
                </div>
                <div className="ml-10 text-mist">{change.change || "Instruction updated."}</div>
                {change.knowledge_id && <div className="ml-10 font-mono text-[10px] text-dim">{change.knowledge_id}</div>}
              </div>
            );
          })}
          {summary.dismissed_items?.map((item) => (
            <div key={item.id} className="grid gap-1 text-[12px] leading-snug text-mist">
              <div className="flex gap-2 text-chalk">
                <span className="w-8 shrink-0 font-mono text-rose">x</span>
                <span>{item.id}</span>
              </div>
              <div className="ml-10 text-mist">Dismissed: {item.reason || "No longer relevant."}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="mt-3 text-[11px] text-rose">{error}</div>}
      {onStart && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            disabled={starting}
            onClick={onStart}
            className="rounded-md border border-mint/40 bg-mint/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-mint transition-colors hover:bg-mint/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
          >
            {starting ? "Starting..." : "Start Run"}
          </button>
        </div>
      )}
    </div>
  );
}

function IntegrationCompletePanel({
  model,
  canonicalKey,
}: {
  model: BoardModel;
  canonicalKey?: string;
}) {
  const [summary, setSummary] = useState<IntegrationSummary | null>(null);
  // Every request resolves by the canonical discovery key — never the inner JSON title
  // (which on a lifecycle feed is "Integrating insights" / "Migrating skill to conductor"
  // and mis-resolves on the server).
  const postKey = canonicalKey ?? model.workflow;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflow/${encodeURIComponent(postKey)}/integration-summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [postKey]);

  // Display-only: integration is applied automatically as the run's leading
  // shaping cards — it is no longer a gate that needs a "Start Run" click.
  return (
    <div className="border-b border-line bg-panel/40 px-5 py-4">
      <div className="mx-auto max-w-[1180px] rounded-md border border-line bg-ink/50 p-4">
        {summary ? (
          <IntegrationSummaryPanel summary={summary} />
        ) : (
          <div className="font-mono text-[11px] text-mist">Integration complete. Loading summary…</div>
        )}
      </div>
    </div>
  );
}

function CompileCompletePanel({
  model,
  steps,
  onOpenArtifact,
  canonicalKey,
}: {
  model: BoardModel;
  steps: BoardStep[];
  onOpenArtifact: (step: BoardStep) => void;
  canonicalKey?: string;
}) {
  const [summary, setSummary] = useState<CompileSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artifactSteps = steps.filter((step) => canOpenReceipt(step));
  // Resolve by the canonical discovery key, never the inner "Migrating skill to
  // conductor" title (which is the compile feed's title and mis-resolves on the server).
  const postKey = canonicalKey ?? model.workflow;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflow/${encodeURIComponent(postKey)}/compile-summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [postKey]);

  // One click launches the whole run (compile reuse → integrate → dispatch) on
  // the server, in the background; the board goes live via SSE. No second confirm.
  async function startRun() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflow/${encodeURIComponent(postKey)}/start-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `start failed: ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  const findings = [
    summary?.card_attempts ? `cards passed in ${summary.card_attempts} attempt${summary.card_attempts === 1 ? "" : "s"}` : null,
    summary?.dependency_attempts
      ? `dependencies passed in ${summary.dependency_attempts} attempt${summary.dependency_attempts === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <div className="border-b border-line bg-panel/40 px-5 py-4">
      <div className="mx-auto max-w-[1180px] rounded-md border border-line bg-ink/50 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-mint">Migration complete</div>
            <h3 className="mt-1 text-[15px] font-medium text-chalk">
              {summary?.workflow_name || "Compiled workflow"} is ready to run
            </h3>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mist">
              <span>{summary?.card_count ?? model.total} cards</span>
              {typeof summary?.edge_count === "number" && <span>{summary.edge_count} dependency edges</span>}
              {findings.map((finding) => (
                <span key={finding}>{finding}</span>
              ))}
            </div>
            {artifactSteps.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {artifactSteps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => onOpenArtifact(step)}
                    className="rounded border border-mint/30 bg-mint/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mint transition-colors hover:bg-mint/20"
                  >
                    {step.title}
                  </button>
                ))}
              </div>
            )}
            {error && <div className="mt-2 text-[11px] text-rose">{error}</div>}
          </div>
          <button
            type="button"
            disabled={starting || summary?.ready === false}
            onClick={() => void startRun()}
            className="shrink-0 rounded-md border border-mint/40 bg-mint/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-mint transition-colors hover:bg-mint/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
          >
            {starting ? "Starting..." : "Start Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Thin, sticky run-complete banner — mounted above the heartbeat terminal in App,
 *  so the outcome + Improve & Run stay reachable from BOTH the summary and board
 *  views. Animates in when the run settles; self-guards to normal execution runs
 *  (not the compile / integration lifecycle workflows). */
export function RunCompleteBanner({
  model,
  insightCount = 0,
  onOpenInsights,
  onRelaunch,
  canonicalKey,
}: {
  model: BoardModel;
  /** Fresh-insight count for this run (App-computed); shown as an inline badge. */
  insightCount?: number;
  /** Opens the insights modal. */
  onOpenInsights?: () => void;
  /** Fires on click to drive the App-level relaunch transition (board sweep →
   *  setup beat → fresh run rides in). The POST below still launches the run. */
  onRelaunch?: () => void;
  /** The canonical discovery key — every POST resolves by it, never the inner title. */
  canonicalKey?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This component stays mounted across runs (only the inner banner shows/hides),
  // so `starting` does NOT reset on its own. Once the launched run is live again,
  // re-enable the button — otherwise it stays disabled (faint/"Starting...") after
  // the next completion until a full page refresh.
  useEffect(() => {
    if (model.overallStatus === "running") setStarting(false);
  }, [model.overallStatus]);

  const settled = model.overallStatus === "done" || model.overallStatus === "failed";
  const steps = model.steps.filter((s) => s.phase === "workflow");
  const show =
    settled && steps.length > 0 && !isCompileLifecycle(model, steps) && !isIntegrationLifecycle(model, steps);

  const knowledge = model.knowledge || [];
  const agentOpen = knowledge.filter(
    (k) => (k.source || "agent") !== "human" && (k.status === "open" || k.status === "emerging"),
  );
  const appliedCount = knowledge.filter((k) => k.status === "applied").length;
  const openKnowledge = knowledge.filter((k) => k.status === "open");
  const passed = steps.filter((s) => s.column === "done").length;
  const failedCount = steps.filter((s) => s.column === "failed").length;
  const totalTime = clockSince(model.startedAt, Date.now(), model.endedAt);
  const buttonLabel = openKnowledge.length > 0 ? "Improve & Run" : "Run Again";

  // One click → the server launches the whole run (compile reuse → integrate-if-
  // insights → dispatch) in the background. The board resets and goes live in the
  // SAME window via SSE — no second confirm, no terminal.
  async function startRun() {
    if (starting) return;
    setStarting(true);
    setError(null);
    onRelaunch?.(); // kick off the board sweep → setup beat the instant the click lands
    try {
      const res = await fetch(`/api/workflow/${encodeURIComponent(canonicalKey ?? model.workflow)}/start-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `start failed: ${res.status}`);
      // success: the run is launching; the banner will fall away as the board
      // goes live. Leave `starting` set through that transition.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0 border-t border-line bg-panel/80 backdrop-blur"
        >
          {(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-mint">
                  {failedCount > 0 ? "Run finished" : "Run complete"}
                </div>
                <div className="mt-0.5 truncate text-[16.5px] font-medium text-chalk">
                  {model.workflow} finished{totalTime ? ` in ${totalTime}` : ""}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-mist">
                  <span>
                    {passed} of {steps.length} card{steps.length === 1 ? "" : "s"} passed
                  </span>
                  {failedCount > 0 && <span className="text-rose">· {failedCount} failed</span>}
                  {agentOpen.length > 0 && (
                    <span>
                      · {agentOpen.length} new insight{agentOpen.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {appliedCount > 0 && <span>· {appliedCount} insight{appliedCount === 1 ? "" : "s"} applied</span>}
                </div>
                {error && <div className="mt-1 text-[10.5px] text-rose">{error}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {onOpenInsights && (
                  <button
                    type="button"
                    onClick={onOpenInsights}
                    className="flex shrink-0 items-center gap-2 rounded-md border border-amber/40 bg-amber/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-amber transition-colors hover:bg-amber/25"
                    title={insightCount > 0 ? `${insightCount} fresh insight${insightCount === 1 ? "" : "s"} this run` : "Open insights"}
                  >
                    <span>View insights from run</span>
                    {insightCount > 0 && (
                      <span className="rounded-sm bg-amber/20 px-1 text-[10px] tabular-nums">{insightCount}</span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void startRun()}
                  className="shrink-0 rounded-md border border-mint/40 bg-mint/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-mint transition-[colors,transform] hover:bg-mint/25 active:scale-[0.97] disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
                >
                  {starting ? "Starting..." : buttonLabel}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ArtifactModal({
  workflow,
  step,
  onClose,
}: {
  workflow: string;
  step: BoardStep;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<ArtifactContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const artifactPath = primaryArtifactPath(step);
  const linkedArtifactPaths = useMemo(
    () => [artifactPath, ...(step.artifacts ?? [])].filter((path): path is string => Boolean(path)),
    [artifactPath, step.artifacts?.join("\u0000")],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workflow/${encodeURIComponent(workflow)}/artifacts`)
      .then((res) => {
        if (!res.ok) throw new Error(`artifact list failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data.files) ? data.files : [];
        setFiles(next);
        const linked = orderedArtifactFiles(
          next.filter((file: ArtifactFile) => linkedArtifactPaths.includes(file.path)),
        );
        const artifact = next.find((file: ArtifactFile) => isPrimaryArtifactPath(file, artifactPath));
        setSelectedPath(artifact?.path ?? artifactPath ?? linked[0]?.path ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflow, artifactPath, linkedArtifactPaths.join("\u0000")]);

  useEffect(() => {
    if (!selectedPath) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setError(null);
    fetch(
      `/api/workflow/${encodeURIComponent(workflow)}/artifact?path=${encodeURIComponent(selectedPath)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`artifact preview failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setContent(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflow, selectedPath]);

  useEffect(() => {
    setCopied(false);
  }, [selectedPath, content?.content]);

  const artifactFiles = useMemo(() => {
    const artifact: ArtifactFile[] = files.filter((file) => isPrimaryArtifactFile(file, step));
    const artifactPath = primaryArtifactPath(step);
    if (artifactPath && !artifact.some((file) => file.path === artifactPath)) {
      artifact.push({ path: artifactPath, name: artifactPath.split("/").at(-1) ?? artifactPath, size: 0, mtime: "" });
    }
    return orderedArtifactFiles(artifact).sort((a, b) => {
      if (a.path === artifactPath) return -1;
      if (b.path === artifactPath) return 1;
      return 0;
    });
  }, [files, step, artifactPath]);

  const imageArtifacts = useMemo(() => artifactFiles.filter((file) => artifactKind(file) === "image"), [artifactFiles]);
  const selectedIsPrimaryReceipt = selectedPath === artifactPath && !!content && isMarkdown(content);
  const visibleArtifactFiles = useMemo(
    () => (artifactPath ? artifactFiles.filter((file) => file.path === artifactPath) : artifactFiles),
    [artifactFiles, artifactPath],
  );
  const unembeddedImageArtifacts = useMemo(
    () => imageArtifacts.filter((file) => !content?.content?.includes(file.path)),
    [imageArtifacts, content?.content],
  );
  const orderedFiles = useMemo(() => orderedArtifactFiles(files).filter((file) => !isDiagnosticArtifactFile(file)), [files]);
  const otherRunFiles = useMemo(
    () => orderedFiles.filter((file) => !visibleArtifactFiles.some((visible) => visible.path === file.path)),
    [orderedFiles, visibleArtifactFiles],
  );
  const executionFiles = useMemo(
    () => otherRunFiles.filter((file) => !isMigrationArtifactFile(file)),
    [otherRunFiles],
  );
  const migrationFiles = useMemo(
    () => otherRunFiles.filter((file) => isMigrationArtifactFile(file)),
    [otherRunFiles],
  );

  async function copyContent() {
    if (!content?.content) return;
    await navigator.clipboard.writeText(content.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const renderFileButton = (file: ArtifactFile, label?: string) => (
    <button
      key={file.path}
      type="button"
      onClick={() => setSelectedPath(file.path)}
      className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
        selectedPath === file.path
          ? "border-mint/40 bg-mint/10 text-chalk"
          : "border-line bg-panel/40 text-mist hover:bg-panel hover:text-chalk"
      }`}
    >
      {label && <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-mint">{label}</div>}
      <div className="truncate font-mono text-[11px]">{file.path}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-dim">
        <span>{artifactKindLabel(file)}</span>
        <span>·</span>
        <span>{formatBytes(file.size)}</span>
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18 }}
        className="flex h-[82vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-lg border border-line bg-ink shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line bg-panel/60 px-4 py-3">
          <Led state={step.column} />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">Artifact</div>
            <h2 className="truncate text-[15px] font-medium text-chalk">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line bg-panel px-2 py-1 font-mono text-[11px] text-mist hover:text-chalk"
          >
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden grid-cols-[320px_minmax(0,1fr)]">
          <aside className="board-scroll min-h-0 overflow-y-auto overscroll-contain border-r border-line bg-ink/30 p-3">
            {loading ? (
              <div className="font-mono text-[11px] text-dim">Loading artifact...</div>
            ) : files.length === 0 ? (
              <div className="rounded border border-line bg-panel/40 p-3 text-[12px] text-dim">
                No artifacts found in `.conductor/artifacts`.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleArtifactFiles.map((file) => renderFileButton(file, "artifact"))}
                {artifactFiles.length === 0 && (
                  <div className="rounded border border-line bg-panel/40 p-3 text-[12px] leading-snug text-dim">
                    No artifact is linked to this card.
                  </div>
                )}
                {executionFiles.length > 0 && (
                  <>
                    <div className="pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                      Execution
                    </div>
                    {executionFiles.map((file) => renderFileButton(file))}
                  </>
                )}
                {migrationFiles.length > 0 && (
                  <>
                    <div className="mt-3 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                      Migration
                    </div>
                    {migrationFiles.map((file) => renderFileButton(file))}
                  </>
                )}
              </div>
            )}
          </aside>

          <main className="flex min-h-0 min-w-0 overflow-hidden flex-col">
            {error && (
              <div className="border-b border-rose/30 bg-rose/10 px-4 py-2 font-mono text-[11px] text-rose">
                {error}
              </div>
            )}
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
              <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-mist">
                {selectedPath ?? "No artifact selected"}
              </div>
              {content && <span className="font-mono text-[10px] text-dim">{formatBytes(content.size)}</span>}
              {content?.content && (
                <button
                  type="button"
                  onClick={() => void copyContent()}
                  className="rounded border border-line bg-panel px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mist transition-colors hover:text-chalk"
                >
                  {copied ? "copied" : "copy"}
                </button>
              )}
              {content?.download_url && (
                <a
                  href={content.download_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-line bg-panel px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mist transition-colors hover:text-chalk"
                >
                  open raw
                </a>
              )}
            </div>
            <div className="board-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-ink/20 px-6 py-5">
              {contentLoading ? (
                <div className="font-mono text-[11px] text-dim">Loading preview...</div>
              ) : content && artifactKind(content) === "image" && content.download_url ? (
                <div className="flex min-h-full items-center justify-center">
                  <img
                    src={content.download_url}
                    alt={content.name}
                    className="max-h-full max-w-full rounded-md border border-line bg-panel object-contain"
                  />
                </div>
              ) : content && artifactKind(content) === "pdf" && content.download_url ? (
                <iframe
                  src={content.download_url}
                  title={content.name}
                  className="h-full min-h-[640px] w-full rounded-md border border-line bg-panel"
                />
              ) : content && artifactKind(content) === "html" && content.download_url ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-line bg-panel/40 p-3 text-[12px] leading-snug text-mist">
                    HTML is shown as source below. Use open raw to inspect the rendered page in a browser tab.
                  </div>
                  <pre className="min-h-full max-w-[78ch] whitespace-pre-wrap break-words font-mono text-[13px] leading-7 text-mist-2">
                    {content.content}
                  </pre>
                </div>
              ) : content && (content.previewable === false || artifactKind(content) === "download") ? (
                <div className="rounded-md border border-line bg-panel/40 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                    {content.too_large ? "Too large to preview" : "Downloadable artifact"}
                  </div>
                  <div className="mt-2 text-[13px] text-chalk">{content.path}</div>
                  <div className="mt-1 font-mono text-[11px] text-dim">
                    {content.mime ?? "application/octet-stream"} · {formatBytes(content.size)}
                    {content.mtime ? ` · saved ${new Date(content.mtime).toLocaleString()}` : ""}
                  </div>
                  {content.too_large && (
                    <div className="mt-2 text-[12px] leading-snug text-mist">
                      This file is larger than the inline preview limit
                      {content.max_preview_size ? ` (${formatBytes(content.max_preview_size)})` : ""}.
                    </div>
                  )}
                  {content.download_url && (
                    <a
                      href={content.download_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex rounded border border-mint/30 bg-mint/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-mint hover:bg-mint/20"
                    >
                      open file
                    </a>
                  )}
                </div>
              ) : content ? (
                <div className="space-y-5">
                  {unembeddedImageArtifacts.length > 0 && selectedIsPrimaryReceipt && (
                    <div className="space-y-3">
                      {unembeddedImageArtifacts.map((file) => (
                        <figure
                          key={file.path}
                          className="overflow-hidden rounded-md border border-line bg-panel/30"
                        >
                          <img src={rawArtifactUrl(workflow, file.path)} alt={file.name} className="max-h-[560px] w-full bg-ink object-contain" />
                          <figcaption className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] text-dim">
                            <span className="truncate">{file.path}</span>
                            <span>{formatBytes(file.size)}</span>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  {isMarkdown(content) ? (
                    <MarkdownPreview text={content.content} workflow={workflow} />
                  ) : (
                    <pre className="min-h-full max-w-[78ch] whitespace-pre-wrap break-words font-mono text-[13px] leading-7 text-mist-2">
                      {content.content}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-[12px] text-dim">
                  Select an artifact to preview.
                </div>
              )}
            </div>
          </main>
        </div>
      </motion.div>
    </div>
  );
}

function PendingColumnCards({
  steps,
  allSteps,
  model,
  notes,
  maxAttempts,
  openCards,
  onToggle,
}: {
  steps: BoardStep[];
  allSteps: BoardStep[];
  model: BoardModel;
  notes?: DeveloperNote[];
  maxAttempts: number;
  openCards: Set<string>;
  onToggle: (id: string) => void;
}) {
  const bands = useMemo(() => pendingBands(steps, allSteps), [steps, allSteps]);

  return (
    <div className="space-y-3">
      {bands.map((band) => (
        <div key={band.key}>
          {/* The "Waiting for · …" band header is gone — it cluttered the initial
              view. The waiting-for detail now lives inside each card's open view;
              the column stays a clean title list (ready cards still lead, and keep
              their mint edge). */}
          <AnimatePresence mode="popLayout" initial={false}>
            {band.steps.map((step) => (
              <WorkflowCard
                key={step.id}
                step={step}
                allSteps={allSteps}
                model={model}
                notes={notes}
                maxAttempts={maxAttempts}
                variant="pending"
                open={openCards.has(step.id)}
                onToggle={() => onToggle(step.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

/** A centered modal shell — same chrome as ArtifactModal/InsightsModal: dimmed
 *  backdrop, a fade/scale panel with a header (title + Close), click-backdrop
 *  and Esc to close, stopPropagation on the panel so clicks inside don't bubble
 *  to the card. Used by the Insight and Condition card modals. */
function CardModal({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[min(640px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-dim">{eyebrow}</div>
            )}
            <div className="truncate text-[15px] font-medium leading-snug text-chalk">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 font-mono text-[12px] text-mist transition-colors hover:border-line-2 hover:text-chalk"
          >
            Close
          </button>
        </div>
        <div className="board-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function WorkflowCard({
  step,
  allSteps,
  model,
  notes,
  maxAttempts,
  variant = "default",
  open = false,
  onToggle,
}: {
  step: BoardStep;
  allSteps: BoardStep[];
  model: BoardModel;
  notes?: DeveloperNote[];
  maxAttempts: number;
  variant?: "default" | "pending";
  // open/closed is owned by the board (keyed by step.id) so it SURVIVES the card
  // moving columns — moving rows used to remount the card and reset it to closed.
  open?: boolean;
  onToggle?: () => void;
}) {
  // shim so the existing `setOpen((v) => !v)` call sites keep working; the actual
  // toggle is owned by the board (the arg is ignored — it just flips this card).
  const setOpen = (_next?: boolean | ((v: boolean) => boolean)) => onToggle?.();
  // The "BAM": integration (shaping) cards land with a spring-overshoot when they
  // arrive after a relaunch — the one moment of impact. Reduced motion → plain fade.
  const reduceMotion = useReducedMotion();
  const bam = step.phase === "shaping" && !reduceMotion;
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [insightModalOpen, setInsightModalOpen] = useState(false);
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const dur = fmtDur(step.started_at, step.completed_at);
  const latest = step.heartbeat.filter((h) => !h.system).at(-1) ?? step.heartbeat.at(-1);
  // Short rolling history of the agent's PROSE beats (not mechanical system pings),
  // restored into the card alongside the latest-beat summary — the in-card
  // narration the terminal consolidation moved out. Newest last; capped.
  const proseBeats = step.heartbeat.filter((h) => !h.system && typeof h.note === "string" && h.note.trim());
  const recentBeats = proseBeats.slice(-5);
  const finalBeat = step.heartbeat.find((h) => h.finalBeat);
  const cardNotes = (notes || []).filter(
    (n) => n.status !== "removed" && (n.step === step.id || n.card === step.id || n.card_title === step.title),
  );
  const passed = step.criteria.filter((c) => c.passed === true).length;
  const gateTotal = step.criteria.length;
  const canBrowseArtifacts = canOpenReceipt(step);
  const pendingVariant = variant === "pending";
  // Derived "ready / next": a pending card whose deps are all done — unblocked,
  // next to go. PURE DISPLAY: an adornment WITHIN pending, not a move/new column,
  // and deliberately NOT a running state (no green motion that would fake progress
  // or hide a real stall). Quiet mint edge + a small frontier dot.
  const isReady = pendingVariant && step.ready;
  // The checker verdict (authored human-readable: SUMMARY/MADE/CHECKED + evidence) and the
  // failing criterion — folded into the timeline's Passed/Failed beat, never shown as a wall.
  const verdict = step.criteria.find((c) => c.summary || c.evidence || c.made_summary || c.checked_summary);
  const failingCriterion = step.criteria.find((c) => c.passed === false);
  // Insight for this card: the knowledge entry(ies) authored from this card, plus the live beat.
  const cardInsights = (model.knowledge || []).filter((k) => String(k.source_card ?? "") === String(step.id) && k.source_run === model.runId);
  const beatInsight = step.heartbeat.find((h) => h.insight)?.insight;
  const hasInsight = cardInsights.length > 0 || !!beatInsight;
  const isRunning = step.column === "running" || step.column === "checking";
  // One summary line, best available: live heartbeat while running; once the card
  // has a verdict, the CHECKER summary (outcome); otherwise the COMPOSER summary
  // (intent) from the workflow step def. Authored at the source, never generated.
  const verdictCriterion = step.criteria.find((c) => typeof c.passed === "boolean");
  const checkerSummary = verdictCriterion?.summary ?? null;
  const summaryLine = isRunning
    ? latest?.note
    : checkerSummary || verdict?.summary || verdict?.evidence || step.summary;
  const [pulse, setPulse] = useState(false);
  const prevAt = useRef<string | undefined>(undefined);
  const seeded = useRef(false);

  useEffect(() => {
    const at = latest?.at;
    if (!seeded.current) {
      seeded.current = true;
      prevAt.current = at;
      return;
    }
    if (at && at !== prevAt.current) {
      prevAt.current = at;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 760);
      return () => clearTimeout(t);
    }
  }, [latest?.at]);

  return (
    <>
      <motion.div
        layout
        layoutId={`workflow-card-${step.id}`}
        initial={bam ? { opacity: 0, scale: 0.96 } : { opacity: 0 }}
        animate={bam ? { opacity: 1, scale: 1 } : { opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={bam ? { ...MOVE, scale: { type: "spring", stiffness: 520, damping: 18 } } : MOVE}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className={`mb-2 rounded-lg border bg-panel-2/40 px-3.5 py-3 transition-colors duration-200 hover:border-line-2 hover:bg-panel-2/70 ${
          isReady
            ? "border-line border-l-2 border-l-mint/70 ring-1 ring-inset ring-mint/15"
            : "border-line"
        } ${pulse ? (open ? "beat-flash-faint" : "beat-flash") : ""}`}
      >
        {/* The collapsed summary (header + meta + latest preview) toggles the
            card. The expanded body below does NOT toggle, so its text
            (instruction, checker verdict, comments) can be selected and copied.
            We also bail when there's an active text selection so a drag that
            ends here doesn't collapse the card. */}
        <div
          className="cursor-pointer"
          onClick={() => {
            if ((window.getSelection()?.toString().length ?? 0) > 0) return;
            setOpen((v) => !v);
          }}
        >
        {/* line 1 — dot · title · attempt · comment count · insight marker */}
        <div className="flex items-center gap-2.5">
          <Led state={step.column} />
          <span className="min-w-0 flex-1 truncate text-[16px] text-chalk">{step.title}</span>
          {step.phase === "shaping" && (
            <span
              title="shaping — rewrites the plan before the work runs"
              className="flex shrink-0 items-center gap-1 rounded-full border border-iris/40 bg-iris/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-iris"
            >
              shaping
            </span>
          )}
          {step.kind === "parallel" && (
            <span
              title={step.rationale || "parallel sibling — runs concurrently with its siblings"}
              className="flex shrink-0 items-center gap-1 rounded-full border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan"
            >
              parallel
            </span>
          )}
          {isReady && (
            <span
              title="next — dependencies met, queued to go"
              className="flex shrink-0 items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-mint"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_0_3px_rgba(52,211,153,0.18)]" />
              next
            </span>
          )}
          {!pendingVariant && step.attempt > 1 && (
            <span title={`${step.attempt} attempts`} className="shrink-0 text-[13px] text-mist">
              attempt {step.attempt}
            </span>
          )}
          {!pendingVariant && cardNotes.length > 0 && (
            <span
              className="shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-mist-2"
              title={`${cardNotes.length} comment${cardNotes.length === 1 ? "" : "s"}`}
            >
              {cardNotes.length}
            </span>
          )}
          {!pendingVariant && step.column === "done" && (
            <span className="shrink-0 text-[15px] leading-none text-mint" title="done">✓</span>
          )}
        </div>
        {/* Collapsed shows the title only. Status, checks, duration and the
            summary all move into the open view below. */}
        </div>
        <AnimatePresence initial={false}>
          {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 space-y-2.5 border-t border-line pt-2.5">
              {/* status meta — moved out of the collapsed view: status · checks · duration · handoff */}
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-mist">
                <span className={pendingVariant ? "text-mist" : `capitalize ${step.column === "pending" ? "text-mist" : ""}`}>
                  {pendingVariant
                    ? (requirementTitles(step, allSteps).length
                        ? `Waiting for: ${requirementTitles(step, allSteps).join(", ")}`
                        : "Ready")
                    : statusLine(step, allSteps, maxAttempts)}
                </span>
                {!pendingVariant && gateTotal > 0 && (
                  <span className="tabular-nums">
                    {passed}/{gateTotal} checks
                  </span>
                )}
                {!pendingVariant && dur && <span className="tabular-nums">{dur}</span>}
                {!pendingVariant && finalBeat && <span title="handed off">→ {finalBeat.handoff?.to ?? "handed off"}</span>}
              </div>

              {/* summary — moved out of the collapsed view; full text in the open view */}
              {!pendingVariant && summaryLine && (
                <p className="text-[15px] leading-snug text-mist-2">{renderNote(summaryLine)}</p>
              )}

              {/* in-card narration: the agent's recent prose heartbeats, newest last */}
              {recentBeats.length > 1 && (
                <div className="space-y-1 border-l border-line pl-3">
                  {recentBeats.map((b, i) => (
                    <p key={`${b.at}-${i}`} className="text-[13px] leading-snug text-mist">
                      {renderNote(b.note)}
                    </p>
                  ))}
                </div>
              )}

              {/* failing criterion — loud, only on failure */}
              {step.column === "failed" && failingCriterion && (
                <div className="rounded-md border border-rose/40 bg-rose/10 px-2.5 py-2">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-rose">Failed check</div>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-mist-2">
                    {failingCriterion.summary || failingCriterion.evidence || failingCriterion.name || failingCriterion.text}
                  </p>
                </div>
              )}

              {/* footer drawers — Artifact (always) · Insight (if present) ·
                  Condition (only once the card is DONE — before there's a verdict
                  it's empty and just confusing). */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {canBrowseArtifacts && (
                  <button
                    type="button"
                    onClick={() => setArtifactOpen(true)}
                    className="rounded-md border border-mint/30 bg-mint/10 px-2.5 py-1 font-mono text-[12px] text-mint transition-colors hover:bg-mint/20"
                  >
                    Artifact
                  </button>
                )}
                {hasInsight && (
                  <button
                    type="button"
                    onClick={() => setInsightModalOpen(true)}
                    className="rounded-md border border-amber/30 bg-amber/10 px-2.5 py-1 font-mono text-[12px] text-amber transition-colors hover:bg-amber/20"
                  >
                    Insight
                  </button>
                )}
                {step.column === "done" && (
                <button
                  type="button"
                  onClick={() => setConditionModalOpen(true)}
                  className="rounded-md border border-[#3b82f6]/40 bg-[#3b82f6]/15 px-2.5 py-1 font-mono text-[12px] text-[#93c5fd] transition-colors hover:bg-[#3b82f6]/25"
                >
                  Condition
                </button>
                )}
              </div>

              {/* comments — exactly ONE section, at the very bottom of the card. A comment attaches to
                  the CARD (the step), not an activity beat: it posts with card = step.id, so the exact
                  heartbeat it was left on never matters. cardNotes surfaces every note scoped to this
                  step (by step id, card id, or title), so older per-activity notes still appear here.
                  stopPropagation keeps clicks/keys inside from toggling the card. */}
              {!pendingVariant && (
                <div
                  className="mt-2.5 border-t border-line pt-2.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <NoteThread
                    notes={cardNotes}
                    workflow={model.workflow}
                    step={step.id}
                    card={step.id}
                    cardTitle={step.title}
                  />
                </div>
              )}
            </div>
          </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {artifactOpen && (
          <ArtifactModal
            workflow={model.workflow}
            step={step}
            onClose={() => setArtifactOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Insight modal — the card's insight(s): title · sentence · amber tag · K-id,
          reusing the insights-item styling. */}
      <AnimatePresence>
        {insightModalOpen && hasInsight && (
          <CardModal eyebrow="Insight" title={step.title} onClose={() => setInsightModalOpen(false)}>
            <div className="space-y-1.5">
              {cardInsights.length > 0
                ? cardInsights.map((k, i) => (
                    <div key={k.id ?? i} className="rounded-lg border border-line bg-panel/40 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px] text-chalk">{k.title}</span>
                        {k.id && <span className="rounded border border-line-2 px-1 font-mono text-[10px] text-mist">{k.id}</span>}
                        {k.tag && (
                          <span className="rounded border border-amber/25 bg-amber/[0.08] px-1 font-mono text-[10px] text-amber">{k.tag}</span>
                        )}
                      </div>
                      {(k.detail || k.note) && (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-mist-2">{k.detail || k.note}</p>
                      )}
                    </div>
                  ))
                : beatInsight && (
                    <div className="rounded-lg border border-line bg-panel/40 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px] text-chalk">{beatInsight.title || beatInsight.seed}</span>
                        {beatInsight.id && (
                          <span className="rounded border border-line-2 px-1 font-mono text-[10px] text-mist">{beatInsight.id}</span>
                        )}
                        {beatInsight.type && (
                          <span className="rounded border border-amber/25 bg-amber/[0.08] px-1 font-mono text-[10px] text-amber">{beatInsight.type}</span>
                        )}
                      </div>
                    </div>
                  )}
            </div>
          </CardModal>
        )}
      </AnimatePresence>

      {/* Condition modal — failing criterion (loud, on failure) → criteria list → checker verdict */}
      <AnimatePresence>
        {conditionModalOpen && (
          <CardModal eyebrow="Condition" title={step.title} onClose={() => setConditionModalOpen(false)}>
            <div className="space-y-2">
              {/* on a failure, lead loud with the failing criterion */}
              {step.column === "failed" && failingCriterion && (
                <div className="rounded-md border border-rose/40 bg-rose/10 px-2.5 py-2">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-rose">Failed check</div>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-snug text-mist-2">
                    {failingCriterion.summary || failingCriterion.evidence || failingCriterion.name || failingCriterion.text}
                  </p>
                </div>
              )}

              {/* criteria / condition list */}
              {step.criteria.length > 0 && (
                <ul className="space-y-0.5">
                  {step.criteria.map((c, i) => (
                    <li key={i} className="flex gap-1.5 text-[13px] leading-snug text-mist-2">
                      <span
                        className={
                          c.passed === true ? "text-mint" : c.passed === false ? "text-rose" : "text-mist"
                        }
                      >
                        {c.passed === true ? "✓" : c.passed === false ? "✕" : "·"}
                      </span>
                      <span>{c.name || c.text || c.summary}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* the checker verdict — made/checked summaries + the full evidence */}
              {verdict && (
                <div className="space-y-1.5">
                  {verdict.made_summary && (
                    <p className="text-[13px] leading-snug text-mist-2">
                      <span className="text-mist">made · </span>
                      {verdict.made_summary}
                    </p>
                  )}
                  {verdict.checked_summary && (
                    <p className="text-[13px] leading-snug text-mist-2">
                      <span className="text-mist">checked · </span>
                      {verdict.checked_summary}
                    </p>
                  )}
                  {verdict.evidence && (
                    <div className="border border-line/70 bg-ink/30 px-2 py-1.5 rounded text-[12px] text-mist-2 whitespace-pre-wrap">
                      {verdict.evidence}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardModal>
        )}
      </AnimatePresence>
    </>
  );
}

export function WorkflowKanban({
  model,
  notes,
  elapsed,
  canonicalKey,
  activeDispatch = false,
}: {
  model: BoardModel;
  notes?: DeveloperNote[];
  /** App-computed run elapsed clock (live ticking; falls back to total time when absent). */
  elapsed?: string | null;
  /** The canonical IDENTITY key (server discovery key / activeWf) — the one true id for
   *  display + the pause API. The inner model.workflow JSON title is never shown as identity. */
  canonicalKey?: string;
  /** hasActiveDispatch(entry) for the displayed feed — the one signal the pause button reads. */
  activeDispatch?: boolean;
}) {
  const [settledView, setSettledView] = useState<"summary" | "board">("board");
  const [settledSnapshot, setSettledSnapshot] = useState<SettledSnapshot | null>(null);
  // Render work AND shaping cards on the board (shaping = the integration cards
  // that lead the run); only the auto-injected Phase-0 "improve" cards are kept
  // off the main board. On an ordinary work feed there are no shaping cards, so
  // this is identical to the old workflow-only filter.
  const allRawSteps = model.steps.filter((s) => s.phase !== "improve");
  const rawSteps = allRawSteps.filter((s) => !s.retired);
  const rawSettled = model.overallStatus === "done" || model.overallStatus === "failed";
  const steps = useDwellSteps(rawSteps, rawSteps.length > 0, false);
  const allSteps = useDwellSteps(allRawSteps, allRawSteps.length > 0, false);
  // The dwell has just moved the last cards into Done/Failed. Don't switch to the
  // settled snapshot immediately — that teleports the cards and cuts the final
  // move-into-Done animation. Wait SETTLE_ANIM_MS so the live board plays it first.
  const allSettledNow =
    rawSettled && steps.every((s) => s.column === "done" || s.column === "failed");
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!allSettledNow) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), SETTLE_ANIM_MS);
    return () => clearTimeout(t);
  }, [allSettledNow]);
  const [compileArtifactStep, setCompileArtifactStep] = useState<BoardStep | null>(null);
  // Per-card open/closed lives HERE (keyed by step.id), not in each card, so a
  // card keeps its open/closed state when it moves columns — moving rows used to
  // remount the card and snap it shut.
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const toggleCard = (id: string) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    // Capture ONLY when the run is genuinely all-settled (not merely the delayed
    // `settled` flag mid-transition) — so a freshly-started run is never captured.
    if (settled && allSettledNow && steps.length > 0) {
      setSettledSnapshot((prev) => {
        if (prev && prev.runId === model.runId && prev.model === model && prev.steps === steps && prev.notes === notes) {
          return prev;
        }
        return { runId: model.runId, model, steps, notes };
      });
      return;
    }
    setSettledSnapshot((prev) => {
      if (!prev) return prev;
      // Release on EITHER signal: a new run replaced the old (run_id changed —
      // Improve & Run's fresh loop), OR the live run is simply active again (a true
      // resume that legitimately kept its run_id must also un-freeze).
      const runChanged = !!model.runId && !!prev.runId && model.runId !== prev.runId;
      const liveActive = !allSettledNow && steps.length > 0;
      return runChanged || liveActive ? null : prev;
    });
  }, [settled, allSettledNow, steps, model, notes]);

  const latchedSettled = !settled && !!settledSnapshot && (!model.runId || model.runId === settledSnapshot.runId);
  const displayModel = settled ? model : latchedSettled ? settledSnapshot.model : model;
  const displaySteps = settled ? steps : latchedSettled ? settledSnapshot.steps : steps;
  const displayAllSteps = settled
    ? allSteps
    : latchedSettled
      ? settledSnapshot.model.steps.filter((s) => s.phase !== "improve")
      : allSteps;
  const displayNotes = settled ? notes : latchedSettled ? settledSnapshot.notes : notes;
  const cols: Col[] = displaySteps.some((s) => s.column === "failed") ? [...BASE_COLS, "failed"] : BASE_COLS;
  const maxAttempts = displayModel.maxAttempts;
  const compileLifecycle = isCompileLifecycle(displayModel, displaySteps);
  const integrationLifecycle = isIntegrationLifecycle(displayModel, displaySteps);

  if ((settled || latchedSettled) && displaySteps.length > 0) {
    return (
      <LayoutGroup>
        {/* scrollbar-gutter:stable reserves the scrollbar lane in BOTH views, so
            the centered header/title never shifts horizontally when one view
            scrolls and the other doesn't (that was the "title leaps" jump). */}
        <div className="board-scroll h-full overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          <CompletionHeader
            model={displayModel}
            steps={displaySteps}
            view={settledView}
            onView={setSettledView}
            settled
            elapsed={elapsed}
            canonicalKey={canonicalKey}
            activeDispatch={activeDispatch}
          />
          {/* Execution run-complete banner moved to a sticky bar above the heartbeat
              terminal (App → RunCompleteBanner), so it stays visible in both views. */}
          {/* Eased crossfade on the Summary ↔ Board swap. mode="wait" lets the
              outgoing view fade out before the incoming one fades in; the keyed
              motion.div drives a clean opacity (+tiny y) transition. Height is not
              animated, so the swap can't re-introduce the layout jump. */}
          {/* Crossfade keyed on view + run id: swapping the Summary/Board toggle OR
              loading a different past run does a clean opacity crossfade. The board
              STRUCTURE renders identical every time — no per-card entrance stagger. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${settledView}:${displayModel.runId ?? ""}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
              {settledView === "summary" ? (
                <>
                  {compileLifecycle && (
                    <CompileCompletePanel model={displayModel} steps={displaySteps} onOpenArtifact={setCompileArtifactStep} canonicalKey={canonicalKey} />
                  )}
                  {integrationLifecycle && <IntegrationCompletePanel model={displayModel} canonicalKey={canonicalKey} />}
                  <CompletionTimeline model={displayModel} steps={displaySteps} maxAttempts={maxAttempts} />
                </>
              ) : (
                <div>
                  <div className={`mx-auto grid max-w-[1400px] grid-cols-1 gap-x-4 gap-y-4 px-5 py-6 sm:grid-cols-2 ${cols.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                    {cols.map((col) => {
                      const inCol = displaySteps.filter((s) => s.column === col);
                      return (
                        <section key={col} className="min-w-0">
                          <div className="mb-2 flex items-center gap-2 border-b border-line px-2 py-2">
                            <Led state={col} />
                            <h2 className="text-[14px] font-medium text-chalk">{LABEL[col]}</h2>
                            <span className="ml-auto rounded-full bg-panel-2/60 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-mist">
                              {inCol.length}
                            </span>
                          </div>
                          {col === "pending" ? (
                            <PendingColumnCards
                              steps={inCol}
                              allSteps={displayAllSteps}
                              model={displayModel}
                              notes={displayNotes}
                              maxAttempts={maxAttempts}
                              openCards={openCards}
                              onToggle={toggleCard}
                            />
                          ) : (
                            <div>
                              <AnimatePresence mode="popLayout" initial={false}>
                                {inCol.map((step) => (
                                  <WorkflowCard
                                    key={step.id}
                                    step={step}
                                    allSteps={displayAllSteps}
                                    model={displayModel}
                                    notes={displayNotes}
                                    maxAttempts={maxAttempts}
                                    open={openCards.has(step.id)}
                                    onToggle={() => toggleCard(step.id)}
                                  />
                                ))}
                              </AnimatePresence>
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          <AnimatePresence>
            {compileArtifactStep && (
              <ArtifactModal
                workflow={model.workflow}
                step={compileArtifactStep}
                onClose={() => setCompileArtifactStep(null)}
              />
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    );
  }

  return (
    <LayoutGroup>
      <div className="h-full overflow-y-auto">
        {/* The shared run-header — live state. Same component as the settled view;
            the Summary/Board toggle is gated off since no summary exists mid-run. */}
        <CompletionHeader
          model={displayModel}
          steps={displaySteps}
          view={settledView}
          onView={setSettledView}
          settled={false}
          elapsed={elapsed}
          canonicalKey={canonicalKey}
          activeDispatch={activeDispatch}
        />
        <div className={`mx-auto grid max-w-[1400px] grid-cols-1 gap-x-4 gap-y-4 px-5 py-6 sm:grid-cols-2 ${cols.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {cols.map((col) => {
            const inCol = steps.filter((s) => s.column === col);
            return (
              <section key={col} className="min-w-0">
                <div className="mb-2 flex items-center gap-2 border-b border-line px-2 py-2">
                  <Led state={col} />
                  <h2 className="text-[14px] font-medium text-chalk">{LABEL[col]}</h2>
                  <span className="ml-auto rounded-full bg-panel-2/60 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-mist">
                    {inCol.length}
                  </span>
                </div>
                {col === "pending" ? (
                  <PendingColumnCards
                    steps={inCol}
                    allSteps={allSteps}
                    model={model}
                    notes={notes}
                    maxAttempts={maxAttempts}
                    openCards={openCards}
                    onToggle={toggleCard}
                  />
                ) : (
                  <div>
                    <AnimatePresence mode="popLayout" initial={false}>
                      {inCol.map((step) => (
                        <WorkflowCard
                          key={step.id}
                          step={step}
                          allSteps={allSteps}
                          model={model}
                          notes={notes}
                          maxAttempts={maxAttempts}
                          open={openCards.has(step.id)}
                          onToggle={() => toggleCard(step.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </LayoutGroup>
  );
}
