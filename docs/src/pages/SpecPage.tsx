import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { SectionHead, Eyebrow, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { CodeBlock } from "../components/CodeBlock";
import { LiveBoard } from "../components/LiveBoard";
import { Led } from "../components/Led";
import { Icon } from "../components/Icon";

// A real, runnable example checked into the repo: examples/report/SKILL.md
const SKILL = `# Research report

Write a credible, well-sourced report on a given topic for a given audience.

## Steps
1. Research the topic for that audience — gather recent, credible
   sources and capture the key facts and tensions.
2. Outline the report: an intro, three to five body sections, a conclusion.
3. Write the full report from the outline, citing every source inline,
   in a tone that fits the audience.
4. Review the draft critically — fix weak transitions, unsupported
   claims, and filler — and produce the final report.

## Standards
- Every claim in the report cites one of the gathered sources.
- The final report reads as finished work, not a draft.`;

const RUN = `npx conductor-board run examples/report/SKILL.md`;

const VERSION = `conductor-board@3.3.19`;

// Real heartbeat notes (the canonical shape from spec/heartbeat-guide.md), as the
// board renders them: timestamp · card · the agent's own prose.
const HEARTBEATS = `[14:22:01]  Research  3/5 sources found via sitemap. Nav-crawling the
                      last two; gate needs all 5 with URLs.
[14:23:40]  Write     Section 2 drafted (320 words). Gate needs every
                      claim cited — 4/6 cited so far.
[14:25:12]  Review    Final pass done: 2 weak transitions fixed, every
                      claim now cited. Handing off.`;

// Insight modules — the real applied-insight shape (knowledge id, the plain-English
// note, the current→proposed change) rendered as the board's amber insight cards
// rather than a code block.
function InsightModule({ id, note, was, now }: { id: string; note: string; was: string; now: string }) {
  return (
    <div className="rounded-2xl border border-amber/30 bg-amber/[0.06] p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber">◇ insight · {id}</div>
      <p className="mt-2 text-[14px] leading-snug text-mist-2">{note}</p>
      <div className="mt-3 space-y-0.5 rounded-lg border border-line bg-ink/50 px-3 py-2.5 font-mono text-[11px] leading-snug">
        <div className="text-rose/90">− {was}</div>
        <div className="text-mint/90">+ {now}</div>
      </div>
    </div>
  );
}

function Claim({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Reveal className="mx-auto w-full max-w-2xl">
      <h2 className="text-balance text-2xl font-semibold tracking-tight text-chalk">{title}</h2>
      <div className="mt-3 space-y-3 text-pretty leading-relaxed text-mist-2">{children}</div>
      {extra && <div className="mt-5">{extra}</div>}
    </Reveal>
  );
}

const PARALLEL_CARDS = [
  "Write technical launch",
  "Write friendly launch",
  "Write playful launch",
];

const PARALLEL_COLUMNS = ["pending", "running", "checking", "done"] as const;
type ParallelCol = (typeof PARALLEL_COLUMNS)[number];

const PARALLEL_LABEL: Record<ParallelCol, string> = {
  pending: "Pending",
  running: "Running",
  checking: "Checking",
  done: "Done",
};

function ParallelRunDemo() {
  const [phase, setPhase] = useState(0);
  const state: ParallelCol = PARALLEL_COLUMNS[phase % PARALLEL_COLUMNS.length];

  useEffect(() => {
    const timer = setTimeout(() => setPhase((p) => (p + 1) % PARALLEL_COLUMNS.length), state === "done" ? 1600 : 1900);
    return () => clearTimeout(timer);
  }, [phase, state]);

  const beat =
    state === "pending"
      ? "Three bounded outputs share the same upstream facts, so Conductor keeps them as siblings."
      : state === "running"
        ? "All three launch variants are running at the same time; no sibling waits on another."
        : state === "checking"
          ? "Each sibling is checked against its own receipt before the assembly card can unlock."
          : "All siblings passed. The dependent final card can now assemble, not re-do, their work.";

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2 text-left shadow-2xl">
      <div className="flex h-10 items-center gap-2.5 border-b border-line bg-panel/60 px-3">
        <Icon name="loop" size={13} />
        <span className="font-mono text-[12px] text-mist">demo-skill</span>
        <span className="ml-auto rounded-full border border-mint/30 bg-mint/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-mint">
          parallel fan-out
        </span>
      </div>
      <LayoutGroup>
        <div className="grid grid-cols-2 gap-x-5 px-4 py-4 sm:grid-cols-4 sm:gap-x-6">
          {PARALLEL_COLUMNS.map((col) => {
            const cards = state === col ? PARALLEL_CARDS : [];
            return (
              <div key={col} className="min-w-0">
                <div className="mb-1 flex items-center gap-2 border-b border-line px-1 pb-1.5">
                  <Led state={col} />
                  <span className="text-[11px] text-mist">{PARALLEL_LABEL[col]}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-dim">{cards.length}</span>
                </div>
                <div className="min-h-44">
                  <AnimatePresence initial={false}>
                    {cards.map((card) => (
                      <motion.div
                        key={card}
                        layout
                        layoutId={`parallel-${card}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{
                          layout: { duration: 0.46, ease: [0.45, 0, 0.55, 1] },
                          opacity: { duration: 0.18 },
                          y: { duration: 0.18 },
                        }}
                        className="mb-1.5 flex min-h-12 items-center gap-2 rounded-md border border-line bg-panel/60 px-2 py-2"
                      >
                        <Led state={col} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-chalk">{card}</span>
                        <span className="rounded-full border border-line-2 bg-ink/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-mist">
                          parallel
                        </span>
                        {col === "done" && (
                          <span className="text-mint">
                            <Icon name="check" size={12} />
                          </span>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
      <div className="border-t border-line bg-panel/40 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-mist-2">
        {beat}
      </div>
    </div>
  );
}

function GateProof() {
  const rows = [
    ["Card instruction", "Write friendly launch, exactly 80 words, preserve required phrase."],
    ["Worker receipt", "friendly.md written; exact word count checked; required phrase present."],
    ["Checker gate", "Reads artifact + receipt, rejects missing proof, accepts only matching output."],
    ["Unlock", "Dependent assembly card starts at acceptance; worker teardown is off the path."],
  ];

  return (
    <div className="rounded-2xl border border-line bg-panel/35 p-4">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
        <Icon name="check" size={13} />
        Receipt over claim
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-ink/55">
        {rows.map(([label, body]) => (
          <div key={label} className="grid gap-1 px-3 py-3 sm:grid-cols-[9.5rem_1fr] sm:gap-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist">{label}</div>
            <div className="text-[13px] leading-relaxed text-mist-2">{body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SpecPage() {
  return (
    <Page>
      <SectionHead
        kicker="Agent Conductor"
        title="Don't make the agent trustworthy. Make its environment verifiable."
        sub="The bet, borrowed from theorem provers like Lean: you trust the checker, not the prover."
      />

      <div className="mx-auto mt-10 max-w-2xl space-y-5">
        <Reveal>
          <p className="text-pretty leading-relaxed text-mist-2">
            You write a <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">SKILL.md</code> —
            a plain-English description of the job. Conductor compiles it into a verified, ordered plan of
            independent agents, runs them on a live board, and improves the plan a little on every run. It
            drives CLI agents like Claude and Codex, and installs with one{" "}
            <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">npx</code> command.
          </p>
        </Reveal>
        <Reveal>
          <div className="rounded-2xl border border-line bg-panel/35 p-5">
            <div className="grid gap-2 font-mono text-[13px] leading-relaxed text-mist-2 sm:grid-cols-5">
              {[
                "Make the work smaller.",
                "Make each piece checkable.",
                "Make progress visible.",
                "Make results durable.",
                "Make the next run better.",
              ].map((line) => (
                <div key={line} className="rounded-lg border border-line bg-ink/45 px-3 py-2">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
        <Reveal>
          <CodeBlock code={VERSION} lang="text" />
        </Reveal>
        <Reveal>
          <CodeBlock code={SKILL} filename="examples/report/SKILL.md" lang="markdown" />
        </Reveal>
        <Reveal>
          <CodeBlock code={RUN} lang="bash" />
        </Reveal>
      </div>

      <div className="mx-auto mt-20 flex max-w-2xl flex-col gap-16">
        <Claim title="You describe the work. It builds the plan.">
          <p>
            A SKILL.md reads like a brief to a capable teammate — no orchestration syntax, no dependency
            graph by hand. Conductor opens a setup board first, then breaks the skill into discrete units
            of work (cards), each with one concrete, checkable output.
          </p>
        </Claim>

        <Claim title="It won't run a plan it can't verify.">
          <p>
            Conductor never accepts a decomposition on faith. It drafts the plan, an independent checker
            reviews it, and it repairs until the checker passes — phase by phase, each locked before the next
            builds on it. The Lean idea applied to planning: trust the checker, not the author. By the time
            anything runs, the plan has survived its own review.
          </p>
        </Claim>

        <Claim title="It knows what can run at once.">
          <p>
            Conductor reads the shape of the work. Distinct, independent outputs become parallel cards that
            run side by side; a repeated job over a large collection stays one card that covers every item.
            Concurrency where it pays, no card-explosion where it doesn't.
          </p>
          <p>
            That distinction is deliberate: three named launch variants become three sibling cards; hundreds of
            clinics stay a bounded batch unless the skill names a real shard strategy.
          </p>
          <div className="mt-5">
            <ParallelRunDemo />
          </div>
        </Claim>

        <Claim title="It warms the next agent before you need it.">
          <p>
            While a dependency is still running or checking, Conductor can start a no-work prewarm probe for
            the likely-next worker. Setup warms Map Dependencies, Validate Workflow, and the first work card;
            the final-card window warms the integration composer for the next Improve & Run loop. The probe
            never reads files, writes files, or changes status — it only pays the startup cost early.
          </p>
        </Claim>

        <Claim
          title="It narrates itself, live."
          extra={
            <div className="space-y-5">
              <CodeBlock code={HEARTBEATS} lang="text" />
              <div className="overflow-hidden rounded-2xl border border-line bg-panel/30 p-3">
                <LiveBoard />
              </div>
            </div>
          }
        >
          <p>
            When a run starts, a board opens before setup work begins. Cards move through their stages in
            real time, and each worker writes plain-prose notes as it works — start, progress, finish. The
            update terminal is scoped to the visible workflow, so navigating or refreshing does not replay old
            runs into the current one.
          </p>
        </Claim>

        <Claim title="Nothing grades its own work.">
          <p>
            Every card's output is verified by a separate agent — never the one that produced it. The check
            is as strict as the criterion allows: a mechanical test where it can be (the file exists, the
            tests pass, the commit is clean), an independent reviewer where the call is a judgment (is this
            translation faithful?). The gate is derived from the skill's own standards.
          </p>
          <p>
            A downstream card unlocks only after the artifact and receipt are accepted. That makes “done” a
            state transition with evidence, not a worker's claim.
          </p>
          <div className="mt-5">
            <GateProof />
          </div>
        </Claim>

        <Claim
          title="It learns from every run."
          extra={
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
                Applied 2 insights — folded in before the next run
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <InsightModule
                  id="K-001"
                  note="Folded the sitemap path into Research so the next run finds sources without nav-crawling."
                  was="crawl the nav to find sources"
                  now="fetch /sitemap.xml first"
                />
                <InsightModule
                  id="K-002"
                  note="Required inline citations in the Write card so Review has less to fix."
                  was="cite sources at the end"
                  now="cite inline as you write"
                />
              </div>
            </div>
          }
        >
          <p>
            When a card passes, Conductor records any durable efficiency insight — a faster path, a cleaner
            input, a redundant setup step. The next run shows a minimal integration preflight, folds those
            lessons in before work starts, and reports in the update terminal what changed and why.
          </p>
          <p>
            Memory is not treated as truth. An insight counts only when the workflow changes and the updated
            plan passes validation; otherwise it remains open or fails visibly instead of becoming fake memory.
          </p>
        </Claim>

        <Claim title="A large insight can redraw the plan.">
          <p>
            Most lessons sharpen a single step. A large enough one reshapes the structure — reordering work,
            changing what depends on what. Lessons specific to a single run aren't carried forward as noise.
          </p>
        </Claim>

        <Claim title="You stay in control.">
          <ul className="space-y-2">
            <li>
              <span className="text-chalk">Pause and resume</span> a run — it drains in flight, holds, and
              resumes where it left off.
            </li>
            <li>
              <span className="text-chalk">Retry</span> any card until it's right, with feedback that keeps
              the chain consistent.
            </li>
            <li>
              <span className="text-chalk">Comment</span> on cards, <span className="text-chalk">inspect</span>{" "}
              artifacts as they're produced, browse <span className="text-chalk">past runs</span> from a sidebar.
            </li>
          </ul>
        </Claim>

        <Claim title="It runs on what you already use.">
          <p>
            Any CLI agent or provider — Claude, Codex, Gemini, others. One{" "}
            <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">npm install</code>. No
            lock-in, no rewrite.
          </p>
        </Claim>
      </div>

      {/* What it is */}
      <section className="py-20">
        <Reveal>
          <div className="mx-auto max-w-3xl rounded-3xl border border-line bg-panel/30 p-8 sm:p-12">
            <Eyebrow>What it is</Eyebrow>
            <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight text-chalk">
              A verified, self-improving workflow of independent agents — with a board to watch and steer it.
            </h2>
            <div className="mt-4 space-y-4 text-pretty leading-relaxed text-mist-2">
              <p>
                Agent Conductor turns a plain-language SKILL.md into a verified, self-improving workflow of
                independent AI agents, with a live board to watch and steer it. The principle under all of it:
                make the environment verifiable, not the agent trustworthy. Independent checks make wrongness
                cheap to catch; a learning loop makes the same workflow leaner each run; a narrated board makes
                it visible instead of opaque.
              </p>
              <p>
                <span className="text-chalk">Why use it.</span> A single agent is fast but unchecked, and it
                never improves. Conductor gives you work that's verified before you trust it, a system that
                sharpens itself run over run, and a board you can watch and steer.
              </p>
              <p>
                <span className="text-chalk">What it's for.</span> Multi-step jobs you'd otherwise babysit:
                content pipelines, code and refactor workflows, research and synthesis, data enrichment across
                large sets — anywhere you want the output checked, the process visible, and the workflow
                improving as it runs.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* For agents — the single-file contract (preserved) */}
      <section className="pb-16">
        <Reveal>
          <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-line bg-panel/30 p-8 sm:p-12">
            <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <Eyebrow>For agents</Eyebrow>
                <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight text-chalk">
                  Point your agent at one file.
                </h2>
                <p className="mt-3 text-pretty leading-relaxed text-mist-2">
                  <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">CONDUCTOR.md</code>{" "}
                  is a single, self-contained instruction file. Hand it to any agent and it converts your skill
                  into a conductor, runs it, and keeps the status file live — no copy-paste.
                </p>
                <div className="mt-6">
                  <a
                    href="https://github.com/mettafive/agent-conductor/blob/main/CONDUCTOR.md"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm font-medium text-chalk transition-colors hover:bg-panel"
                  >
                    Read CONDUCTOR.md ↗
                  </a>
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-ink-2/70 p-5 font-mono text-xs leading-relaxed text-mist-2">
                <div className="text-mist">
                  <span className="text-dim">#</span> one command, from any skill state
                </div>
                <div className="mt-2">
                  <span className="text-dim">$</span> npx conductor-board@latest run SKILL.md
                </div>
                <div className="mt-3 text-mint">→ setup board appears first</div>
                <div className="text-mint">→ insights integrate before work</div>
                <div className="text-mint">→ prewarmed workers dispatch</div>
                <div className="text-mint">→ repeat runs fold in what they learned</div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}
