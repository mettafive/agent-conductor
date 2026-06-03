import { Nav } from "./components/Nav";
import { CodeBlock } from "./components/CodeBlock";
import { Playground } from "./components/Playground";
import { BoardPreview } from "./components/BoardPreview";
import { Reveal } from "./components/Reveal";
import { EXAMPLES } from "./data/examples";

const QUICKSTART = `conductor: 1.0.0
name: basic-report
description: Research, outline, write, review.

inputs:
  - topic

steps:
  - id: research
    instruction: |
      Research {topic}. Gather five credible sources.
    gate:
      - "At least 5 sources, each with a URL"

  - id: write
    instruction: |
      Write an 800-word report, citing every claim.
    requires: [research]
    gate:
      - "Every claim cites a source"      # soft — self-validated
      - "No placeholder text remains"     # soft
      - check: "test -f report.md"        # hard — must exit 0`;

const STATUS_JSON = `{
  "conductor": "1.0.0",
  "workflow": "basic-report",
  "status": "running",
  "current_step": "write",
  "steps": {
    "research": { "status": "done",    "gate": "passed",  "attempt": 1 },
    "write":    { "status": "running", "gate": "pending", "attempt": 2 }
  }
}`;

const HEARTBEAT_JSON = `"discover-prices": {
  "status": "running",
  "heartbeat": [
    { "at": "…", "note": "3/5 sources found via sitemap." },
    { "at": "…", "note": "PR opened: [run](https://github.com/org/repo/pull/42)." }
  ],
  "learnings": [
    "Pricing pages are usually at /priser or /prislista."
  ]
}`;

const GATE_SNIPPET = `gate:
  - "Output reads naturally"          # soft
  - "No placeholder text remains"     # soft
  - check: "npm test"                 # hard, must exit 0
  - name: "Type-check passes"         # hard, labelled
    check: "tsc --noEmit"`;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-mist">
      {children}
    </span>
  );
}

function SectionHead({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Eyebrow>{kicker}</Eyebrow>
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-chalk sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-3 text-pretty text-mist-2">{sub}</p>}
    </div>
  );
}

export function App() {
  return (
    <>
      <div className="aurora" />
      <div className="grid-fade" />
      <Nav />

      <main id="top" className="mx-auto max-w-6xl px-5 pt-16">
        {/* ---------------- HERO ---------------- */}
        <section className="grid items-center gap-10 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-24">
          <div>
            <Eyebrow>
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              open source · MIT · zero-dependency spec
            </Eyebrow>
            <h1 className="mt-5 text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-chalk sm:text-6xl">
              Stop agents from{" "}
              <span className="bg-gradient-to-r from-iris via-iris to-cyan bg-clip-text text-transparent">
                skipping steps.
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-pretty text-lg leading-relaxed text-mist-2">
              Agent Conductor is a portable spec and a live local Kanban board for
              orchestrating AI agent workflows with{" "}
              <span className="text-chalk">gated steps</span>. Each step must pass
              its gate before the next one unlocks.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#playground"
                className="rounded-xl bg-gradient-to-b from-iris to-iris-deep px-5 py-3 text-sm font-medium text-white shadow-lg shadow-iris/20 transition-transform hover:-translate-y-0.5"
              >
                Try the playground
              </a>
              <a
                href="#spec"
                className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm text-chalk transition-colors hover:border-iris/40"
              >
                Read the spec
              </a>
            </div>
            <div className="mt-7 flex items-center gap-2 font-mono text-sm text-mist">
              <span className="text-line-2">$</span>
              <span className="text-mist-2">npx conductor-board</span>
              <span className="h-4 w-px animate-pulse bg-iris" />
            </div>
          </div>

          <Reveal>
            <div className="relative">
              <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-tr from-iris/10 to-cyan/10 blur-2xl" />
              <Playground />
            </div>
          </Reveal>
        </section>

        {/* ---------------- PROBLEM / SOLUTION ---------------- */}
        <section className="py-16">
          <div className="grid gap-5 md:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-line bg-panel/40 p-7">
                <div className="mb-4 inline-grid h-9 w-9 place-items-center rounded-lg border border-rose/30 bg-rose/10 text-rose">
                  ✕
                </div>
                <h3 className="text-lg font-semibold text-chalk">
                  The problem
                </h3>
                <p className="mt-2 text-pretty leading-relaxed text-mist-2">
                  You hand an agent twelve steps and hope. Around step seven it
                  decides the rest is implied, declares victory, and hands you a
                  half-finished thing that <em>looks</em> done. Long workflows rot
                  because nothing forces the agent to clear each bar.
                </p>
              </div>
            </Reveal>
            <Reveal>
              <div className="h-full rounded-2xl border border-iris/20 bg-iris/[0.04] p-7">
                <div className="mb-4 inline-grid h-9 w-9 place-items-center rounded-lg border border-mint/30 bg-mint/10 text-mint">
                  ✓
                </div>
                <h3 className="text-lg font-semibold text-chalk">
                  The solution
                </h3>
                <p className="mt-2 text-pretty leading-relaxed text-mist-2">
                  Gated steps. Each step carries criteria that must all pass
                  before the next unlocks. <span className="text-chalk">Soft
                  gates</span> capture taste; <span className="text-chalk">hard
                  gates</span> run real checks. Fail a gate and the agent retries
                  — it never skips.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------- SPEC ---------------- */}
        <section id="spec" className="py-20">
          <SectionHead
            kicker="The spec"
            title="One YAML file. Any agent."
            sub="No SDK, no runtime, no lock-in. The conductor file is the entire contract between you and the agent."
          />

          <div className="mt-12 grid items-start gap-5 lg:grid-cols-2">
            <Reveal>
              <CodeBlock code={QUICKSTART} filename="conductor.yaml" lang="yaml" />
            </Reveal>
            <div className="space-y-5">
              <Reveal>
                <div className="rounded-2xl border border-line bg-panel/40 p-6">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-chalk">
                    <span className="h-2 w-2 rounded-full bg-iris" /> Two kinds of
                    gate
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-2">
                    Mix plain-language self-validation with executable checks in a
                    single gate. Soft for <em>is this good?</em>, hard for{" "}
                    <em>is this true?</em>
                  </p>
                  <div className="mt-4">
                    <CodeBlock code={GATE_SNIPPET} lang="yaml" />
                  </div>
                </div>
              </Reveal>
              <Reveal>
                <div className="rounded-2xl border border-line bg-panel/40 p-6">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-chalk">
                    <span className="h-2 w-2 rounded-full bg-cyan" /> The agent
                    writes its own status
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-mist-2">
                    As it works, the agent maintains{" "}
                    <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-cyan">
                      .conductor/status.json
                    </code>
                    . The board watches that file and updates live.
                  </p>
                  <div className="mt-4">
                    <CodeBlock code={STATUS_JSON} filename="status.json" lang="json" />
                  </div>
                </div>
              </Reveal>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              {
                t: "Conditions",
                d: "type: condition routes the flow with if_true / if_false.",
                c: "text-amber",
              },
              {
                t: "Rejoins",
                d: "then: brings a branch back to the main line.",
                c: "text-iris",
              },
              {
                t: "Outputs",
                d: "output: names data that downstream steps template in.",
                c: "text-cyan",
              },
            ].map((f) => (
              <Reveal key={f.t}>
                <div className="rounded-xl border border-line bg-panel/30 p-5">
                  <div className={`font-mono text-sm font-medium ${f.c}`}>
                    {f.t}
                  </div>
                  <p className="mt-1.5 text-sm text-mist">{f.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------- PLAYGROUND ---------------- */}
        <section id="playground" className="py-20">
          <SectionHead
            kicker="Live playground"
            title="Paste a conductor. Watch it become a flow."
            sub="Edit the YAML on the left and the graph redraws on the right — conditions branch, dependencies dash, outputs label. The same engine drives the board."
          />
          <Reveal className="mt-12">
            <Playground />
          </Reveal>
        </section>

        {/* ---------------- EXAMPLES ---------------- */}
        <section id="examples" className="py-20">
          <SectionHead
            kicker="Examples"
            title="Three patterns to steal from"
            sub="From a simple linear pipeline to a gates-heavy review with a security branch."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <Reveal key={ex.id}>
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel/40">
                  <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                    <span className="font-mono text-sm text-chalk">{ex.name}</span>
                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] ${
                        ex.accent === "iris"
                          ? "border-iris/30 bg-iris/10 text-iris"
                          : ex.accent === "cyan"
                            ? "border-cyan/30 bg-cyan/10 text-cyan"
                            : "border-mint/30 bg-mint/10 text-mint"
                      }`}
                    >
                      {ex.pattern}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="flex-1 text-sm leading-relaxed text-mist-2">
                      {ex.tagline}
                    </p>
                    <a
                      href={`https://github.com/mettafive/agent-conductor/blob/main/examples/${ex.id}.yaml`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-mist transition-colors hover:text-chalk"
                    >
                      view source
                      <span aria-hidden>↗</span>
                    </a>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------- BOARD ---------------- */}
        <section id="board" className="py-20">
          <SectionHead
            kicker="The board"
            title="npx conductor-board"
            sub="A local Kanban board watches the status file and moves each step through Pending → Running → Gate Check → Done as the agent works. Every completed run is archived to a browsable history sidebar."
          />
          <div className="mt-7 flex justify-center">
            <code className="rounded-lg border border-line bg-ink-2/80 px-4 py-2 font-mono text-xs text-mist-2">
              <span className="text-line-2">$</span> npx conductor-board{"  "}
              <span className="text-mist">
                → Board live at http://localhost:3042
              </span>
            </code>
          </div>
          <Reveal className="mt-8">
            <BoardPreview />
          </Reveal>
          <p className="mt-6 text-center font-mono text-xs text-mist">
            board, run history & CLI ship in the conductor-board package
          </p>
        </section>

        {/* ---------------- HEARTBEATS ---------------- */}
        <section id="heartbeats" className="py-20">
          <SectionHead
            kicker="Self-regulation"
            title="Agents that check in"
            sub="On long steps, agents drift. A heartbeat is a pulse the agent writes to itself at least once a minute — re-anchoring to the step's gate and the workflow's goal. The board shows it live, links and all."
          />
          <div className="mt-12 grid items-center gap-5 lg:grid-cols-2">
            <Reveal>
              <CodeBlock code={HEARTBEAT_JSON} filename="status.json" lang="json" />
            </Reveal>
            <Reveal>
              <div className="rounded-2xl border border-cyan/30 bg-panel/50 p-4 pulse-ring">
                <div className="flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-iris/10">
                    <svg width="13" height="13" viewBox="0 0 24 24" className="text-iris">
                      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3" />
                    </svg>
                  </span>
                  <span className="flex-1 font-mono text-[13px] text-chalk">discover-prices</span>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan" />
                </div>
                <div className="mt-2 flex items-start gap-1.5 pl-7 text-[11.5px] italic leading-snug text-mist">
                  <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-cyan" />
                  PR opened:{" "}
                  <span className="text-cyan underline-offset-2 hover:underline">
                    run ↗
                  </span>
                  . Ready for review.
                </div>
                <div className="mt-3 rounded-lg border border-cyan/20 bg-cyan/[0.06] px-2.5 py-2 ml-7">
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-cyan">
                    learnings
                  </div>
                  <div className="flex gap-1.5 text-[11px] text-mist-2">
                    <span className="text-cyan">·</span>
                    <span>Pricing pages are usually at /priser or /prislista.</span>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-line pt-2 pl-7">
                  {[
                    ["2m ago", "Found /priser via nav, 23 items."],
                    ["90s ago", "Sitemap had /prislista — 18 prices."],
                    ["30s ago", "PR opened, ready for review."],
                  ].map(([t, n]) => (
                    <div key={t} className="flex gap-2">
                      <span className="shrink-0 font-mono text-[9px] text-line-2">{t}</span>
                      <span className="text-[11px] text-mist-2">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
          <p className="mt-6 text-center text-sm text-mist">
            Append-only audit trail — and when a beat carries an{" "}
            <span className="text-amber">💡 insight</span>, it becomes a post-run
            optimization you apply back to the conductor. The workflow improves
            itself. See the{" "}
            <a
              href="https://github.com/mettafive/agent-conductor/blob/main/spec/heartbeat-guide.md"
              target="_blank"
              rel="noreferrer"
              className="text-cyan underline-offset-2 hover:underline"
            >
              Heartbeat Guide ↗
            </a>
            .
          </p>
        </section>

        {/* ---------------- FOR AGENTS ---------------- */}
        <section id="agents" className="py-20">
          <Reveal>
            <div className="overflow-hidden rounded-3xl border border-line bg-panel/30 p-8 sm:p-12">
              <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
                <div>
                  <Eyebrow>For agents</Eyebrow>
                  <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-chalk">
                    Point your agent at one file.
                  </h2>
                  <p className="mt-3 text-pretty leading-relaxed text-mist-2">
                    <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-cyan">
                      CONDUCTOR.md
                    </code>{" "}
                    is a single, self-contained instruction file. Hand it to any
                    agent and it converts your skill into a conductor, saves it,
                    runs it, and keeps the status file live — no copy-paste, no
                    "put this YAML here."
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <a
                      href="https://github.com/mettafive/agent-conductor/blob/main/CONDUCTOR.md"
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-iris/40 bg-iris/10 px-5 py-3 text-sm font-medium text-iris transition-colors hover:bg-iris/15"
                    >
                      Read CONDUCTOR.md ↗
                    </a>
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-ink-2/70 p-5 font-mono text-xs leading-relaxed text-mist-2">
                  <div className="text-mist">
                    <span className="text-line-2">#</span> start the board, then tell
                    your agent to go
                  </div>
                  <div className="mt-2">
                    <span className="text-line-2">$</span> npx conductor-board
                  </div>
                  <div className="mt-3 text-mist">
                    <span className="text-line-2">#</span> "Here's my skill. Read
                    CONDUCTOR.md,
                  </div>
                  <div className="text-mist">
                    <span className="text-line-2"> </span>{" "}
                    convert it to a conductor, and run it."
                  </div>
                  <div className="mt-3 text-mint">
                    → .conductor/conductor.yaml + status.json
                  </div>
                  <div className="text-mint">→ board lights up ✓</div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ---------------- CTA ---------------- */}
        <section className="py-20">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-panel/60 to-ink-2 p-10 text-center sm:p-16">
              <div className="absolute -top-24 left-1/2 -z-10 h-48 w-96 -translate-x-1/2 rounded-full bg-iris/20 blur-3xl" />
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-chalk sm:text-4xl">
                Conduct your agents.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-pretty text-mist-2">
                Grab the spec, write a conductor, hand it to any agent. MIT
                licensed and community-first.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <a
                  href="https://github.com/mettafive/agent-conductor"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-gradient-to-b from-iris to-iris-deep px-5 py-3 text-sm font-medium text-white shadow-lg shadow-iris/20 transition-transform hover:-translate-y-0.5"
                >
                  View on GitHub
                </a>
                <a
                  href="https://github.com/mettafive/agent-conductor/blob/main/spec/conductor-spec.md"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm text-chalk transition-colors hover:border-iris/40"
                >
                  Read the full spec
                </a>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src="/agent-conductor/conductor.svg" alt="" className="h-6 w-6" />
            <span className="font-mono text-sm text-mist">
              agent-conductor
            </span>
          </div>
          <p className="font-mono text-xs text-mist">
            MIT © mettafive · built to be conducted
          </p>
        </div>
      </footer>
    </>
  );
}
