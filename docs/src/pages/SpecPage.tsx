import type { ReactNode } from "react";
import { SectionHead, Eyebrow, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { CodeBlock } from "../components/CodeBlock";
import { LiveBoard } from "../components/LiveBoard";

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

// Real heartbeat notes (the canonical shape from spec/heartbeat-guide.md), as the
// board renders them: timestamp · card · the agent's own prose.
const HEARTBEATS = `[14:22:01]  Research  3/5 sources found via sitemap. Nav-crawling the
                      last two; gate needs all 5 with URLs.
[14:23:40]  Write     Section 2 drafted (320 words). Gate needs every
                      claim cited — 4/6 cited so far.
[14:25:12]  Review    Final pass done: 2 weak transitions fixed, every
                      claim now cited. Handing off.`;

// Real applied-insight closing beat (the buildAppliedSummary shape from integration.js).
const INSIGHTS = `Applied 2 insights.
- K-001: Folded the sitemap path into Research so the next run finds
  sources without nav-crawling.
- K-002: Required inline citations in the Write card so Review has
  less to fix.`;

function Claim({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Reveal className="mx-auto w-full max-w-2xl">
      <h2 className="text-balance text-2xl font-semibold tracking-tight text-chalk">{title}</h2>
      <div className="mt-3 space-y-3 text-pretty leading-relaxed text-mist-2">{children}</div>
      {extra && <div className="mt-5">{extra}</div>}
    </Reveal>
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
            drives any CLI agent — Claude, Codex, Gemini, and similar — and installs with one{" "}
            <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">npm install</code>.
          </p>
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
            graph by hand. Conductor breaks it into discrete units of work (cards), each with one concrete,
            checkable output.
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
            When a run starts, a board opens. Cards move through their stages in real time, and each worker
            writes plain-prose notes as it works — start, progress, finish. Open any card to read its output
            mid-run or leave a comment. It runs in the background, so your terminal stays free.
          </p>
        </Claim>

        <Claim title="Nothing grades its own work.">
          <p>
            Every card's output is verified by a separate agent — never the one that produced it. The check
            is as strict as the criterion allows: a mechanical test where it can be (the file exists, the
            tests pass, the commit is clean), an independent reviewer where the call is a judgment (is this
            translation faithful?). The gate is derived from the skill's own standards.
          </p>
        </Claim>

        <Claim
          title="It learns from every run."
          extra={<CodeBlock code={INSIGHTS} lang="text" />}
        >
          <p>
            When a card passes, Conductor records any insight — a faster path, a cleaner input, a redundant
            step. The next run folds those lessons in before it begins, and reports, in plain sentences, what
            it changed and why.
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
                  <span className="text-dim">$</span> npx conductor-board run SKILL.md
                </div>
                <div className="mt-3 text-mint">→ compiles + verifies the plan</div>
                <div className="text-mint">→ board lights up, cards dispatch</div>
                <div className="text-mint">→ re-run folds in what it learned</div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}
