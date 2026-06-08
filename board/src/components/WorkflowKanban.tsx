import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { BoardModel, BoardStep, Column as Col, DeveloperNote } from "../lib/types";
import { fmtDur } from "../lib/format";
import { clockSince } from "../lib/view";
import { renderNote } from "../lib/heartbeat";
import { postComment } from "../lib/groups";
import { useNow } from "../lib/useNow";
import { Led } from "./Led";
import { HeartbeatTimeline } from "./HeartbeatTimeline";

const BASE_COLS: Col[] = ["pending", "running", "checking", "done"];
const DWELL_MS = 1000;
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

function evidenceSummary(step: BoardStep): string | null {
  const text = step.criteria.find((c) => c.evidence)?.evidence;
  if (!text) return null;
  return text.replace(/\s+/g, " ").trim();
}

function usefulOneLine(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return /[A-Za-z0-9ÅÄÖåäö]/.test(cleaned) ? cleaned : null;
}

function checkerSummary(step: BoardStep): string | null {
  const summaryCandidate = step.criteria.find((c) => usefulOneLine(c.checked_summary) || usefulOneLine(c.summary));
  const summary = usefulOneLine(summaryCandidate?.checked_summary) ?? usefulOneLine(summaryCandidate?.summary);
  if (summary) return summary;
  const text = evidenceSummary(step);
  if (!text) return null;
  const withoutInlineSummary = text.replace(/\bSUMMARY\s*:\s*.*$/i, "").trim();
  const cleaned = withoutInlineSummary.replace(/^(PASS|FAIL)\s*(?:[.—:;-]\s*)?/i, "").trim();
  if (!/[A-Za-z0-9ÅÄÖåäö]/.test(cleaned)) return null;
  const firstFact = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  return firstFact.length > 120 ? `${firstFact.slice(0, 117)}...` : firstFact;
}

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

function shortEvidence(step: BoardStep): string | null {
  return checkerSummary(step);
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

function cleanOneLine(text: unknown, limit = 150): string | null {
  if (text === undefined || text === null) return null;
  const raw =
    typeof text === "string"
      ? text
      : typeof text === "object"
        ? JSON.stringify(text)
        : String(text);
  const cleaned = raw
    .replace(/^\s*(PASS|FAIL|MADE|CHECKED|SUMMARY)\s*[—:-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const first = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  return first.length > limit ? `${first.slice(0, limit - 3)}...` : first;
}

function madeSummary(step: BoardStep): string {
  const criterionMade = step.criteria.find((c) => c.made_summary)?.made_summary;
  const handoffProduced = step.heartbeat.find((h) => h.handoff?.produced)?.handoff?.produced;
  const finalContext = step.heartbeat.find((h) => h.finalBeat)?.handoff?.context;
  const output = step.output_value;
  const latestAgent = step.heartbeat.filter((h) => !h.system).at(-1)?.note;
  return (
    cleanOneLine(criterionMade) ??
    cleanOneLine(handoffProduced) ??
    cleanOneLine(output) ??
    cleanOneLine(finalContext) ??
    cleanOneLine(latestAgent) ??
    cleanOneLine(step.instruction) ??
    "Completed the requested work for this card."
  );
}

function checkedSummary(step: BoardStep): string {
  return checkerSummary(step) ?? (step.column === "failed" ? "Checker did not record a passing summary." : "Checker verified the instruction was satisfied.");
}

function CardComments({
  workflow,
  step,
  notes,
}: {
  workflow: string;
  step: BoardStep;
  notes: DeveloperNote[];
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleNotes = notes.filter((note) => note.status !== "removed");

  async function submit() {
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    setError(null);
    const ok = await postComment(workflow, {
      step: step.id,
      card: step.id,
      cardTitle: step.title,
      text: value,
      directive: false,
    });
    setSaving(false);
    if (!ok) {
      setError("Could not save comment.");
      return;
    }
    setText("");
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">Comments</div>
        {visibleNotes.length > 0 && (
          <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[8px] text-dim">
            {visibleNotes.length}
          </span>
        )}
      </div>

      {visibleNotes.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
          {visibleNotes.map((note) => (
            <div key={note.id} className="rounded border border-line/70 bg-ink/30 px-2 py-1.5 text-[11px] leading-snug text-mist">
              <div className="mb-1 flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.12em]">
                <span className="text-dim">comment</span>
                <span className="text-dim">{new Date(note.updated_at ?? note.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div>{note.text}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 rounded border border-line/70 bg-panel/30 p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Leave a comment for this card..."
          className="h-16 w-full resize-none rounded border border-line bg-ink/60 px-2 py-1.5 text-[11px] leading-snug text-mist outline-none placeholder:text-dim focus:border-mint/40"
        />
        <div className="mt-1.5 flex items-center gap-2">
          {error && <span className="text-[10px] text-rose">{error}</span>}
          <button
            type="button"
            disabled={!text.trim() || saving}
            onClick={() => void submit()}
            className="ml-auto rounded border border-mint/30 bg-mint/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-mint transition-colors hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
          >
            {saving ? "saving" : "comment"}
          </button>
        </div>
      </div>
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

function CompletionHeader({
  model,
  steps,
  view,
  onView,
}: {
  model: BoardModel;
  steps: BoardStep[];
  view: "summary" | "board";
  onView: (view: "summary" | "board") => void;
}) {
  const failed = steps.filter((s) => s.column === "failed").length;
  const totalTime = clockSince(model.startedAt, Date.now(), model.endedAt);
  const retries = totalRetries(steps);

  return (
    <div className="shrink-0 border-b border-line bg-ink/95 px-5 py-4">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Led state={model.overallStatus} />
            <h2 className="truncate text-[16px] font-semibold text-chalk">{model.workflow}</h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mist">
            <span>{totalTime || "0s"} total</span>
            <span>{model.total} cards</span>
            {retries > 0 && <span>{retries} retries</span>}
            {model.insightCount > 0 && <span>{model.insightCount} insights</span>}
            {failed > 0 && <span className="text-rose">{failed} failed</span>}
          </div>
        </div>
        <div className="flex rounded-md border border-line bg-panel p-0.5 text-[12px]">
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
      </div>
    </div>
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
        <div className="mx-auto max-w-[1180px]">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.09, delayChildren: 0.04 } },
            }}
            className="relative space-y-3.5"
          >
            <div className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-line md:block" />
            {rows.map((step) => {
              const tone = stepTone(step);
              const cls = toneClasses(tone);
              const made = madeSummary(step);
              const checked = checkedSummary(step);
              const dur = fmtDur(step.started_at, step.completed_at);
              const elapsed = fmtDur(model.startedAt, step.completed_at || step.started_at);
              const meta = `${attemptLabel(step, maxAttempts)}${dur ? ` · ${dur}` : ""}`;
              const proofLabel = step.column === "failed" ? "Failed check" : "Passed check";
              const canBrowseArtifacts = canOpenReceipt(step);

              return (
                <motion.div
                  key={step.id}
                  layout
                  variants={{
                    hidden: { opacity: 0, y: 12, scale: 0.985 },
                    show: { opacity: 1, y: 0, scale: 1 },
                  }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                  className="relative grid gap-2.5 md:grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] md:items-stretch md:gap-4"
                >
                  <div className={`rounded-md border border-line bg-panel px-4 py-3 ${tone === "red" ? "border-l-2 border-l-rose bg-rose/5" : ""}`}>
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${tone === "red" ? "bg-rose" : tone === "amber" ? "bg-amber" : "bg-mint"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <h3 className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-chalk">{step.title}</h3>
                          {canBrowseArtifacts && (
                            <button
                              type="button"
                              onClick={() => setArtifactStep(step)}
                              className="shrink-0 rounded border border-mint/30 bg-mint/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-mint transition-colors hover:bg-mint/20"
                              title="Open this card's artifact"
                            >
                              artifact
                            </button>
                          )}
                        </div>
                        <p className="mt-1.5 text-[12px] leading-snug text-mist">{made}</p>
                      </div>
                    </div>
                  </div>

                  <div className="relative hidden min-h-[92px] md:flex md:items-center md:justify-center">
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
                    <div className={`relative grid h-9 w-9 place-items-center rounded-full border border-line bg-ink font-mono text-[13px] ${cls.meta} ${cls.dot}`}>
                      {cls.icon}
                    </div>
                    <div className="absolute top-[calc(50%+25px)] whitespace-nowrap rounded bg-ink px-1 font-mono text-[10px] text-dim">
                      {elapsed || "0s"}
                    </div>
                  </div>

                  <div className={`rounded-md border border-line bg-panel px-4 py-3 ${cls.border}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{proofLabel}</div>
                        <p className={`mt-1.5 text-[12px] leading-snug ${tone === "red" ? "text-rose" : "text-mist"}`}>{checked}</p>
                      </div>
                      <div className={`shrink-0 font-mono text-[10px] leading-snug ${cls.meta}`}>
                        <div>{meta}</div>
                        <div className="mt-0.5 text-right text-dim md:hidden">{elapsed || "0s"}</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
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
  starting: boolean;
  error: string | null;
  onStart: () => void;
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
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          disabled={starting}
          onClick={onStart}
          className="rounded-md border border-mint/40 bg-mint/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-mint transition-colors hover:bg-mint/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
        >
          {starting ? "Starting..." : "Start Run"}
        </button>
        {!starting && <span className="font-mono text-[11px] text-dim">review the changes, then start when ready</span>}
      </div>
    </div>
  );
}

function IntegrationCompletePanel({
  model,
}: {
  model: BoardModel;
}) {
  const [summary, setSummary] = useState<IntegrationSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflow/${encodeURIComponent(model.workflow)}/integration-summary`)
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
  }, [model.workflow]);

  async function startRun() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflow/${encodeURIComponent(model.workflow)}/start-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, run_id: summary?.run_id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `start failed: ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="border-b border-line bg-panel/40 px-5 py-4">
      <div className="mx-auto max-w-[1180px] rounded-md border border-line bg-ink/50 p-4">
        {summary ? (
          <IntegrationSummaryPanel
            summary={summary}
            starting={starting}
            error={error}
            onStart={() => void startRun()}
          />
        ) : (
          <div className="font-mono text-[11px] text-mist">
            Integration complete. {error ? <span className="text-rose">{error}</span> : "Loading summary..."}
          </div>
        )}
      </div>
    </div>
  );
}

function CompileCompletePanel({
  model,
  steps,
  onOpenArtifact,
}: {
  model: BoardModel;
  steps: BoardStep[];
  onOpenArtifact: (step: BoardStep) => void;
}) {
  const [summary, setSummary] = useState<CompileSummary | null>(null);
  const [integration, setIntegration] = useState<IntegrationSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const artifactSteps = steps.filter((step) => canOpenReceipt(step));

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflow/${encodeURIComponent(model.workflow)}/compile-summary`)
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
  }, [model.workflow]);

  async function startRun(confirmed = false, runId?: string) {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflow/${encodeURIComponent(model.workflow)}/start-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed, run_id: runId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `start failed: ${res.status}`);
      if (body.integration_required && body.summary) {
        setIntegration(body.summary);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
            {integration ? (
              <IntegrationSummaryPanel
                summary={integration}
                starting={starting}
                error={error}
                onStart={() => void startRun(true, integration.run_id)}
              />
            ) : (
              <>
                {error && <div className="mt-2 text-[11px] text-rose">{error}</div>}
              </>
            )}
          </div>
          {!integration && (
            <button
              type="button"
              disabled={starting || summary?.ready === false}
              onClick={() => void startRun()}
              className="shrink-0 rounded-md border border-mint/40 bg-mint/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-mint transition-colors hover:bg-mint/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
            >
              {starting ? "Starting..." : "Start Run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ExecutionCompletePanel({
  model,
  steps,
  notes,
}: {
  model: BoardModel;
  steps: BoardStep[];
  notes?: DeveloperNote[];
}) {
  const [integration, setIntegration] = useState<IntegrationSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleNotes = (notes || []).filter((note) => note.status !== "removed");
  const knowledge = model.knowledge || [];
  const agentInsights = knowledge.filter((item) => (item.source || "agent") !== "human");
  const humanInsights = knowledge.filter((item) => item.source === "human");
  const agentOpen = agentInsights.filter((item) => item.status === "open" || item.status === "emerging");
  const humanOpen = humanInsights.filter((item) => item.status === "open" || item.status === "emerging");
  const appliedCount = knowledge.filter((item) => item.status === "applied").length;
  const openKnowledge = (model.knowledge || []).filter((item) => item.status === "open");
  const passed = steps.filter((step) => step.column === "done").length;
  const failed = steps.filter((step) => step.column === "failed").length;
  const totalTime = clockSince(model.startedAt, Date.now(), model.endedAt);
  const buttonLabel = openKnowledge.length > 0 ? "Improve & Run" : "Run Again";

  async function startRun(confirmed = false, runId?: string) {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflow/${encodeURIComponent(model.workflow)}/start-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed, run_id: runId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `start failed: ${res.status}`);
      if (body.integration_required && body.summary) {
        setIntegration(body.summary);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="border-b border-line bg-panel/40 px-5 py-4">
      <div className="mx-auto max-w-[1180px] rounded-md border border-line bg-ink/50 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-mint">Run complete</div>
            <h3 className="mt-1 text-[15px] font-medium text-chalk">
              {model.workflow} finished{totalTime ? ` in ${totalTime}` : ""}
            </h3>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mist">
              <span>{passed}/{steps.length} passed</span>
              {failed > 0 && <span className="text-rose">{failed} failed</span>}
              {agentOpen.length > 0 && <span>{agentOpen.length} agent insight{agentOpen.length === 1 ? "" : "s"} open</span>}
              {humanOpen.length > 0 && <span>{humanOpen.length} comment insight{humanOpen.length === 1 ? "" : "s"} open</span>}
              {appliedCount > 0 && <span>{appliedCount} applied</span>}
            </div>

            {(knowledge.length > 0 || visibleNotes.length > 0) && (
              <div className="mt-4 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
                <KnowledgePreview
                  title="Agent insights"
                  empty="No agent insights yet."
                  items={agentInsights}
                  preferred={["open", "emerging", "proven", "applied"]}
                />
                <KnowledgePreview
                  title="Your comments"
                  empty="No comment insights yet."
                  items={humanInsights}
                  preferred={["open", "emerging", "applied"]}
                  fallbackNotes={visibleNotes}
                />
              </div>
            )}

            {integration && (
              <IntegrationSummaryPanel
                summary={integration}
                starting={starting}
                error={error}
                onStart={() => void startRun(true, integration.run_id)}
              />
            )}
            {!integration && error && <div className="mt-2 text-[11px] text-rose">{error}</div>}
          </div>

          {!integration && (
            <button
              type="button"
              disabled={starting}
              onClick={() => void startRun()}
              className="shrink-0 rounded-md border border-mint/40 bg-mint/15 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.1em] text-mint transition-colors hover:bg-mint/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-dim"
            >
              {starting ? "Starting..." : buttonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgePreview({
  title,
  empty,
  items,
  preferred,
  fallbackNotes,
}: {
  title: string;
  empty: string;
  items: BoardModel["knowledge"];
  preferred: string[];
  fallbackNotes?: DeveloperNote[];
}) {
  const ordered = [...items].sort((a, b) => {
    const ai = preferred.indexOf(a.status);
    const bi = preferred.indexOf(b.status);
    const ar = ai === -1 ? 99 : ai;
    const br = bi === -1 ? 99 : bi;
    if (ar !== br) return ar - br;
    return String(b.id || b.title).localeCompare(String(a.id || a.title));
  });
  const counts = ordered.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const shown = ordered.slice(0, 5);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">{title}</div>
        {preferred.map((status) =>
          counts[status] ? (
            <span key={status} className="rounded border border-line/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-mist">
              {status} {counts[status]}
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-1.5 space-y-1.5">
        {shown.map((item, index) => (
          <div key={`${item.id || item.title}-${index}`} className="rounded border border-line/70 bg-panel/40 px-2 py-1.5 text-[11px] leading-snug text-mist">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`font-mono text-[9px] uppercase tracking-[0.1em] ${item.status === "open" ? "text-amber" : item.status === "applied" ? "text-mint" : "text-mist"}`}>
                {item.status}
              </span>
              {item.tag && <span className="rounded bg-amber/[0.08] px-1 font-mono text-[9px] text-amber">{item.tag}</span>}
              {item.source_card_title && <span className="text-dim">{item.source_card_title}</span>}
            </div>
            <div className="mt-0.5 text-chalk">{item.title}</div>
            {(item.detail || item.note) && <div className="mt-1 text-dim">{item.detail || item.note}</div>}
          </div>
        ))}
        {shown.length === 0 &&
          (fallbackNotes?.length ? (
            fallbackNotes.slice(0, 5).map((note) => (
              <div key={note.id} className="rounded border border-line/70 bg-panel/40 px-2 py-1.5 text-[11px] leading-snug text-mist">
                <span className="text-chalk">{note.card_title || `Card ${note.card || note.step}`}</span>
                <div className="mt-1 text-dim">{note.text}</div>
              </div>
            ))
          ) : (
            <div className="rounded border border-line/60 bg-panel/20 px-2 py-2 font-mono text-[10px] text-dim">{empty}</div>
          ))}
        {ordered.length > shown.length && (
          <div className="font-mono text-[10px] text-dim">+{ordered.length - shown.length} more</div>
        )}
      </div>
    </div>
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
              <div className="font-mono text-[11px] text-dim">loading artifact...</div>
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
                <div className="font-mono text-[11px] text-dim">loading preview...</div>
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
}: {
  steps: BoardStep[];
  allSteps: BoardStep[];
  model: BoardModel;
  notes?: DeveloperNote[];
  maxAttempts: number;
}) {
  const bands = useMemo(() => pendingBands(steps, allSteps), [steps, allSteps]);

  return (
    <div className="space-y-3">
      {bands.map((band) => (
        <div key={band.key}>
          <div className="mb-1.5 flex items-center gap-2 px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${band.key === "ready" ? "bg-mint/70" : "bg-dim/70"}`} />
            <span>{band.title}</span>
          </div>
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
              />
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function WorkflowCard({
  step,
  allSteps,
  model,
  notes,
  maxAttempts,
  variant = "default",
}: {
  step: BoardStep;
  allSteps: BoardStep[];
  model: BoardModel;
  notes?: DeveloperNote[];
  maxAttempts: number;
  variant?: "default" | "pending";
}) {
  const [open, setOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const now = useNow(5000);
  const evidence = shortEvidence(step);
  const dur = fmtDur(step.started_at, step.completed_at);
  const fullEvidence = step.criteria.find((c) => c.evidence)?.evidence;
  const latest = step.heartbeat.filter((h) => !h.system).at(-1) ?? step.heartbeat.at(-1);
  const finalBeat = step.heartbeat.find((h) => h.finalBeat);
  const cardNotes = (notes || []).filter(
    (n) => n.status !== "removed" && (n.step === step.id || n.card === step.id || n.card_title === step.title),
  );
  const passed = step.criteria.filter((c) => c.passed === true).length;
  const gateTotal = step.criteria.length;
  const canBrowseArtifacts = canOpenReceipt(step);
  const hasDetail = true;
  const pendingVariant = variant === "pending";
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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={MOVE}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className={`cursor-pointer rounded-md border-b border-line px-2.5 py-2.5 transition-colors duration-200 hover:bg-panel-2/50 ${
          pulse ? (open ? "beat-flash-faint" : "beat-flash") : ""
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Led state={step.column} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-chalk">{step.title}</span>
          {!pendingVariant && cardNotes.length > 0 && (
            <span
              className="shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-mist"
              title={`${cardNotes.length} comment${cardNotes.length === 1 ? "" : "s"}`}
            >
              {cardNotes.length} comment{cardNotes.length === 1 ? "" : "s"}
            </span>
          )}
          {!pendingVariant && canBrowseArtifacts && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setArtifactOpen(true);
              }}
              className="shrink-0 rounded border border-mint/30 bg-mint/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-mint transition-colors hover:bg-mint/20"
              title="Open this card's artifact"
            >
              artifact
            </button>
          )}
          {!pendingVariant && step.attempt > 1 && (
            <span title={`${step.attempt} attempts`} className="shrink-0 text-[11px] text-dim">
              attempt {step.attempt}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[18px] text-[11px] text-dim">
        <span className={pendingVariant ? "text-dim" : step.column === "pending" ? "text-mist" : ""}>
          {pendingVariant ? (unmetRequirementIndexes(step, allSteps).length ? "pending" : "ready") : statusLine(step, allSteps, maxAttempts)}
        </span>
        {!pendingVariant && gateTotal > 0 && (
          <span className="tabular-nums">
            {passed}/{gateTotal} checks
          </span>
        )}
        {!pendingVariant && dur && <span className="tabular-nums">{dur}</span>}
        {!pendingVariant && finalBeat && <span title="handed off">→ {finalBeat.handoff?.to ?? "handed off"}</span>}
        </div>
        {!pendingVariant && latest && (
        <div
          title={latest.note}
          className="mt-2 flex items-start gap-2 pl-[18px] text-[12px] leading-snug text-mist"
        >
          {latest.insight && (
            <span
              className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-amber"
              title="carries an insight"
            />
          )}
          <span className="whitespace-pre-wrap break-words">{renderNote(latest.note)}</span>
        </div>
        )}
        {step.column === "done" && evidence && (
          <div className="mt-2 line-clamp-2 pl-[18px] text-[11px] leading-snug text-mist">{evidence}</div>
        )}
        <AnimatePresence initial={false}>
          {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 space-y-2 border-t border-line pt-2 pl-7">
              {gateTotal > 0 && (
                <div className="space-y-1">
                  {step.criteria.map((c, i) => (
                    <div key={i} className="text-[11px] leading-snug text-mist">
                      <span className={c.passed === true ? "text-mint" : c.passed === false ? "text-rose" : "text-dim"}>
                        {c.passed === true ? "✓" : c.passed === false ? "×" : "·"}
                      </span>{" "}
                      {c.summary || c.name || c.text}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">Instruction</div>
                <p className="mt-1 text-[11px] leading-snug text-mist">{step.instruction}</p>
              </div>
              {step.heartbeat.length > 0 && (
                <HeartbeatTimeline
                  entries={step.heartbeat}
                  learnings={step.learnings}
                  now={now}
                  running={step.column === "running" || step.column === "checking"}
                  loop={step.loop}
                  cardOverviews={step.cardOverviews}
                  notes={notes}
                  step={step.id}
                />
              )}
              {fullEvidence && (
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">Checker</div>
                  <p className="mt-1 whitespace-pre-wrap rounded border border-line/70 bg-ink/30 px-2 py-1.5 text-[11px] leading-snug text-mist">
                    {fullEvidence}
                  </p>
                </div>
              )}
              <CardComments workflow={model.workflow} step={step} notes={cardNotes} />
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
    </>
  );
}

export function WorkflowKanban({
  model,
  notes,
}: {
  model: BoardModel;
  notes?: DeveloperNote[];
}) {
  const [settledView, setSettledView] = useState<"summary" | "board">("summary");
  const [settledSnapshot, setSettledSnapshot] = useState<SettledSnapshot | null>(null);
  const allRawSteps = model.steps.filter((s) => s.phase === "workflow");
  const rawSteps = allRawSteps.filter((s) => !s.retired);
  const rawSettled = model.overallStatus === "done" || model.overallStatus === "failed";
  const steps = useDwellSteps(rawSteps, rawSteps.length > 0, false);
  const allSteps = useDwellSteps(allRawSteps, allRawSteps.length > 0, false);
  const settled =
    rawSettled && steps.every((s) => s.column === "done" || s.column === "failed");
  const [compileArtifactStep, setCompileArtifactStep] = useState<BoardStep | null>(null);

  useEffect(() => {
    if (settled && steps.length > 0) {
      setSettledSnapshot((prev) => {
        if (prev && prev.runId === model.runId && prev.model === model && prev.steps === steps && prev.notes === notes) {
          return prev;
        }
        return { runId: model.runId, model, steps, notes };
      });
      return;
    }
    setSettledSnapshot((prev) => {
      if (prev && model.runId && prev.runId && model.runId !== prev.runId) return null;
      return prev;
    });
  }, [settled, steps, model, notes]);

  const latchedSettled = !settled && !!settledSnapshot && (!model.runId || model.runId === settledSnapshot.runId);
  const displayModel = settled ? model : latchedSettled ? settledSnapshot.model : model;
  const displaySteps = settled ? steps : latchedSettled ? settledSnapshot.steps : steps;
  const displayAllSteps = settled
    ? allSteps
    : latchedSettled
      ? settledSnapshot.model.steps.filter((s) => s.phase === "workflow")
      : allSteps;
  const displayNotes = settled ? notes : latchedSettled ? settledSnapshot.notes : notes;
  const cols: Col[] = displaySteps.some((s) => s.column === "failed") ? [...BASE_COLS, "failed"] : BASE_COLS;
  const maxAttempts = displayModel.maxAttempts;
  const compileLifecycle = isCompileLifecycle(displayModel, displaySteps);
  const integrationLifecycle = isIntegrationLifecycle(displayModel, displaySteps);

  if ((settled || latchedSettled) && displaySteps.length > 0) {
    return (
      <LayoutGroup>
        <div className="board-scroll h-full overflow-y-auto">
          <CompletionHeader model={displayModel} steps={displaySteps} view={settledView} onView={setSettledView} />
          {settledView === "summary" && compileLifecycle && (
            <CompileCompletePanel model={displayModel} steps={displaySteps} onOpenArtifact={setCompileArtifactStep} />
          )}
          {settledView === "summary" && integrationLifecycle && (
            <IntegrationCompletePanel model={displayModel} />
          )}
          {settledView === "summary" && !compileLifecycle && !integrationLifecycle && (
            <ExecutionCompletePanel
              model={displayModel}
              steps={displaySteps}
              notes={displayNotes}
            />
          )}
          {settledView === "summary" ? (
            <CompletionTimeline model={displayModel} steps={displaySteps} maxAttempts={maxAttempts} />
          ) : (
            <div>
              <div className={`mx-auto grid max-w-[1400px] grid-cols-1 gap-x-4 gap-y-4 px-5 py-6 sm:grid-cols-2 ${cols.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                {cols.map((col) => {
                  const inCol = displaySteps.filter((s) => s.column === col);
                  return (
                    <section key={col} className="min-w-0">
                      <div className="mb-1 flex items-center gap-2 border-b border-line px-2 pb-1.5">
                        <Led state={col} />
                        <h2 className="text-[11px] text-mist">{LABEL[col]}</h2>
                        <span className="ml-auto text-[11px] tabular-nums text-dim">{inCol.length}</span>
                      </div>
                      {col === "pending" ? (
                        <PendingColumnCards
                          steps={inCol}
                          allSteps={displayAllSteps}
                          model={displayModel}
                          notes={displayNotes}
                          maxAttempts={maxAttempts}
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
        <div className={`mx-auto grid max-w-[1400px] grid-cols-1 gap-x-4 gap-y-4 px-5 py-6 sm:grid-cols-2 ${cols.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {cols.map((col) => {
            const inCol = steps.filter((s) => s.column === col);
            return (
              <section key={col} className="min-w-0">
                <div className="mb-1 flex items-center gap-2 border-b border-line px-2 pb-1.5">
                  <Led state={col} />
                  <h2 className="text-[11px] text-mist">{LABEL[col]}</h2>
                  <span className="ml-auto text-[11px] tabular-nums text-dim">{inCol.length}</span>
                </div>
                {col === "pending" ? (
                  <PendingColumnCards
                    steps={inCol}
                    allSteps={allSteps}
                    model={model}
                    notes={notes}
                    maxAttempts={maxAttempts}
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
