import { useEffect, type ReactNode } from "react";
import { CodeBlock } from "../components/CodeBlock";
import { useScrollSpy } from "../lib/useScrollSpy";

const HOME = import.meta.env.BASE_URL; // "/agent-conductor/"
const GH = "https://github.com/mettafive/agent-conductor";

const CONDUCTOR_YAML = `conductor: 1.0.0
name: basic-report
description: Research, outline, write, review.

steps:
  - id: research
    instruction: Gather five credible sources on {topic}.
    gate:
      - "At least 5 sources, each with a URL"
  - id: write
    instruction: Write an 800-word report, citing every claim.
    requires: [research]
    gate:
      - "Every claim cites a source"      # soft
      - check: "test -f report.md"        # hard, must exit 0`;

const STATUS_JSON = `{
  "workflow": "basic-report",
  "status": "running",
  "goal": "Research, outline, write, review.",
  "current_step": "write",
  "steps": {
    "research": { "status": "done",    "gate": "passed",  "attempt": 1 },
    "write":    { "status": "running", "gate": "pending", "attempt": 2,
      "heartbeat": [
        { "at": "…", "note": "Drafting section 2. Tracking citations as I go." }
      ]
    }
  }
}`;

const FINALBEAT_JSON = `{
  "at": "2026-06-03T15:53:00Z",
  "note": "5 sources gathered, all with URLs. Handing off to write.",
  "finalBeat": true,
  "handoff": {
    "to": "write",
    "context": "Strongest source is the BLS dataset; cite it for every wage claim.",
    "produced": "sources.json"
  }
}`;

const MULTI_TREE = `.conductor/
├── daily-price/
│   ├── conductor.yaml
│   ├── status.json
│   └── history/
└── treatment-page/
    ├── conductor.yaml
    └── status.json`;

/* ---------- small layout helpers (match the landing-page design) ---------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-mist">
      {children}
    </span>
  );
}

function H2({ id, kicker, children }: { id: string; kicker?: string; children: ReactNode }) {
  return (
    <div className="scroll-mt-24" id={id}>
      {kicker && <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-iris">{kicker}</div>}
      <h2 className="text-balance text-2xl font-semibold tracking-tight text-chalk sm:text-3xl">
        <a href={`#${id}`} className="group">
          {children}
          <span className="ml-2 text-mist opacity-0 transition-opacity group-hover:opacity-100">#</span>
        </a>
      </h2>
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-pretty leading-relaxed text-mist-2">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-[0.85em] text-cyan">{children}</code>
  );
}

const TOC = [
  ["overview", "Overview"],
  ["concepts", "Concepts"],
  ["columns", "The columns"],
  ["card", "Anatomy of a card"],
  ["surfaces", "Two surfaces"],
  ["getting-started", "Getting started"],
  ["monitor", "Heartbeat monitor"],
  ["multiple", "Multiple workflows"],
  ["history", "History & replay"],
  ["improve", "Self-improvement"],
];

const COLUMNS = [
  {
    name: "Pending",
    dot: "bg-line-2",
    text: "text-mist",
    border: "border-line",
    body: "The step hasn't started. Its dependencies (requires:) aren't all done yet, or the agent simply hasn't reached it.",
  },
  {
    name: "Running",
    dot: "bg-cyan",
    text: "text-cyan",
    border: "border-cyan/30",
    body: "The agent is executing the step's instruction. The card streams the latest heartbeat and pulses; if no beat lands for 90s it flags a possible stall.",
  },
  {
    name: "Gate Check",
    dot: "bg-amber",
    text: "text-amber",
    border: "border-amber/30",
    body: "The instruction is done and the agent is evaluating the gate — running every hard check and self-validating every soft criterion before it's allowed to advance.",
  },
  {
    name: "Done",
    dot: "bg-mint",
    text: "text-mint",
    border: "border-mint/30",
    body: "Every gate criterion passed. The step is locked in, its output (if any) is recorded, and the next step unlocks.",
  },
  {
    name: "Failed",
    dot: "bg-rose",
    text: "text-rose",
    border: "border-rose/30",
    body: "A gate could not be satisfied and the workflow stopped here. Appears as a side column only when something fails — the agent retries before it ever lands here.",
  },
];

export function BoardGuide() {
  const active = useScrollSpy(TOC.map(([id]) => id));

  // Honour a deep-link hash on load: the target only exists once React (and the
  // async code highlighter) has rendered, so the browser's own jump misses it.
  // Native smooth scroll respects each section's scroll-margin-top.
  useEffect(() => {
    if (!window.location.hash) return;
    const id = window.location.hash;
    const t = setTimeout(() => {
      document.querySelector(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen">
      {/* top bar */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line/70 bg-ink/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href={HOME} className="flex items-center gap-2.5">
            <img src={`${HOME}conductor.svg`} alt="" className="h-7 w-7" />
            <span className="font-mono text-sm font-medium tracking-tight text-chalk">
              agent-conductor
            </span>
            <span className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-mist">
              Board guide
            </span>
          </a>
          <div className="flex items-center gap-1">
            <a href={HOME} className="rounded-lg px-3 py-2 text-sm text-mist transition-colors hover:text-chalk">
              ← Home
            </a>
            <a
              href={GH}
              target="_blank"
              rel="noreferrer"
              className="ml-1 flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-sm text-chalk transition-colors hover:border-iris/50 hover:bg-panel-2"
            >
              GitHub ↗
            </a>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-24">
        {/* hero */}
        <div className="border-b border-line pb-10">
          <Eyebrow>
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            User guide · Features
          </Eyebrow>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-chalk sm:text-5xl">
            The Kanban Board
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-mist-2">
            A live, local Kanban board that watches an agent work through a gated
            workflow in real time. Each step is a card; cards move across columns
            as the agent executes, gates, and completes them. One command, zero
            cloud, nothing to configure.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-line bg-ink-2/80 px-4 py-2 font-mono text-sm">
            <span className="text-line-2">$</span>
            <span className="text-mist-2">npx conductor-board</span>
            <span className="text-mist">→ http://localhost:3042</span>
          </div>
        </div>

        <div className="grid gap-12 py-12 lg:grid-cols-[200px_minmax(0,1fr)]">
          {/* sticky ToC */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-mist">
                On this page
              </div>
              <ul className="space-y-1.5 border-l border-line">
                {TOC.map(([id, label]) => {
                  const on = active === id;
                  return (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        aria-current={on ? "true" : undefined}
                        className={`-ml-px flex items-center gap-2 border-l py-0.5 pl-3 text-sm transition-all duration-200 ${
                          on
                            ? "border-iris font-medium text-chalk"
                            : "border-transparent text-mist hover:border-iris/50 hover:text-chalk"
                        }`}
                      >
                        <span
                          className={`h-1 w-1 shrink-0 rounded-full transition-all duration-200 ${
                            on ? "scale-100 bg-iris" : "scale-0 bg-transparent"
                          }`}
                        />
                        {label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* content */}
          <article className="max-w-3xl space-y-16">
            {/* OVERVIEW */}
            <section className="space-y-4">
              <H2 id="overview" kicker="Overview">What the board is</H2>
              <P>
                You hand an agent a <Code>conductor.yaml</Code> — a workflow broken
                into <strong className="text-chalk">gated steps</strong>. As the
                agent works, it writes its progress to{" "}
                <Code>.conductor/status.json</Code>. The board watches that file
                and redraws itself the instant anything changes. No SDK, no
                polling loop you maintain, no integration — the agent just keeps a
                JSON file current and the board reflects it.
              </P>
              <P>
                The board is <strong className="text-chalk">observational</strong>.
                It's a window into what the agent is doing, not a control panel you
                drive. The agent moves the cards; you watch, expand a card to read
                its heartbeats, browse past runs, and — when a run finishes — apply
                the improvements it proposed for itself.
              </P>
            </section>

            {/* CONCEPTS */}
            <section className="space-y-4">
              <H2 id="concepts" kicker="Concepts">The vocabulary</H2>
              <P>A handful of terms cover everything on the board.</P>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {[
                      ["Board", "The local web app you open with npx conductor-board. Watches .conductor/ and updates live over Server-Sent Events."],
                      ["Workflow", "One conductor.yaml + its status.json. The board can show several side by side."],
                      ["Step", "A unit of work in the workflow — rendered as a card. Has an instruction and a gate."],
                      ["Gate", "The criteria a step must pass before the next unlocks. Soft (self-validated) or hard (a shell check that must exit 0)."],
                      ["Column", "A lane representing a step's state: Pending, Running, Gate Check, Done (and Failed)."],
                      ["Heartbeat", "A timestamped note the agent appends to a step at least once a minute, so you can see its thinking."],
                      ["finalBeat", "The closing heartbeat of a step — a summary plus a handoff that carries context to the next step."],
                      ["Run", "One execution of a workflow, identified by run_id. Completed runs are archived to history."],
                      ["Insight → Suggestion", "A heartbeat can flag an improvement; after the run, those become suggestions you apply back to the conductor."],
                    ].map(([term, def], i) => (
                      <tr key={term} className={i % 2 ? "bg-panel/20" : ""}>
                        <td className="whitespace-nowrap border-r border-line px-4 py-2.5 align-top font-mono text-[12px] text-iris">
                          {term}
                        </td>
                        <td className="px-4 py-2.5 align-top text-mist-2">{def}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* COLUMNS */}
            <section className="space-y-4">
              <H2 id="columns" kicker="The lanes">Pending → Running → Gate Check → Done</H2>
              <P>
                Every step flows left to right. A step only advances when its gate
                passes; if a gate fails, the agent{" "}
                <strong className="text-chalk">retries the step — it never skips
                it</strong>, so cards move back into Running rather than jumping
                ahead.
              </P>
              <div className="space-y-3">
                {COLUMNS.map((c) => (
                  <div key={c.name} className={`rounded-xl border ${c.border} bg-panel/30 p-4`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                      <span className={`font-mono text-sm font-medium ${c.text}`}>{c.name}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-mist-2">{c.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ANATOMY */}
            <section className="space-y-4">
              <H2 id="card" kicker="The card">Anatomy of a step card</H2>
              <P>Click any card to expand it. A card carries everything about its step:</P>
              <ul className="space-y-2 text-sm text-mist-2">
                {[
                  ["Identity", "the step id and its position in the workflow; a fork icon for condition steps, a loop icon for loops."],
                  ["Gates", "each criterion with a soft / hard label and a ✓ / ✕ / ○ as the agent records pass, fail, or not-yet-checked."],
                  ["Heartbeats", "a vertical timeline of the agent's notes, newest first, with relative time while running and absolute time once done."],
                  ["finalBeat", "the closing beat, marked ·→, showing the handoff to the next step."],
                  ["Loops", "for loop steps, a per-iteration breakdown with its own status dots and filter tabs."],
                  ["Retries", "an ×N badge when a step has been attempted more than once."],
                ].map(([k, v]) => (
                  <li key={k} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-iris" />
                    <span><strong className="text-chalk">{k}</strong> — {v}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* TWO SURFACES */}
            <section className="space-y-4">
              <H2 id="surfaces" kicker="Two surfaces">For humans, and for agents</H2>
              <P>
                The board separates the two audiences cleanly. Humans get a view to
                watch and steer by; agents get a simple file contract to write.
              </P>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-panel/30 p-5">
                  <div className="font-mono text-xs uppercase tracking-wider text-cyan">Human surface</div>
                  <p className="mt-2 text-sm leading-relaxed text-mist-2">What you do in the browser:</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-mist-2">
                    {[
                      "Watch steps move across the columns live.",
                      "Expand a card to read its heartbeats and gates.",
                      "Open the heartbeat monitor to follow every beat in one stream.",
                      "Switch between running workflows in the sidebar.",
                      "Browse history and freeze any past run to its final state.",
                      "Apply the suggestions a finished run proposes.",
                      "Mute the completion / tick sounds.",
                    ].map((t) => (
                      <li key={t} className="flex gap-2">
                        <span className="text-cyan">·</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-line bg-panel/30 p-5">
                  <div className="font-mono text-xs uppercase tracking-wider text-iris">Agent surface</div>
                  <p className="mt-2 text-sm leading-relaxed text-mist-2">What the agent writes:</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-mist-2">
                    {[
                      "Save the workflow to .conductor/conductor.yaml.",
                      "Create .conductor/status.json with every step pending.",
                      "Mark each step running → done, updating gate state.",
                      "Append a heartbeat at least once a minute.",
                      "Close each step with a finalBeat handoff.",
                      "Retry on a failed gate — never skip.",
                      "Before status: done, write 3–5 suggestions.",
                    ].map((t) => (
                      <li key={t} className="flex gap-2">
                        <span className="text-iris">·</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <P>
                Agents don't need to learn an API. Point one at{" "}
                <a href={`${GH}/blob/main/CONDUCTOR.md`} target="_blank" rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">CONDUCTOR.md ↗</a>{" "}
                (or the self-bootstrapping{" "}
                <a href={`${GH}/blob/main/setup.conductor.yaml`} target="_blank" rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">setup.conductor.yaml ↗</a>)
                and it handles the whole contract.
              </P>
            </section>

            {/* GETTING STARTED */}
            <section className="space-y-4">
              <H2 id="getting-started" kicker="Getting started">Four steps to a live board</H2>
              <ol className="space-y-4">
                {[
                  ["Start the board", <>Run <Code>npx conductor-board</Code> in your project. It opens your browser at <Code>http://localhost:3042</Code> and starts watching <Code>.conductor/</Code>. (Prefer fewer keystrokes? <Code>npx 3042</Code> is an alias.)</>],
                  ["Point your agent at the workflow", <>Tell your agent: <em>"Read CONDUCTOR.md, convert my skill into a conductor, save it, and run it."</em> It writes <Code>.conductor/conductor.yaml</Code> and maintains <Code>status.json</Code>.</>],
                  ["Watch it run", <>Cards appear and move through the columns as the agent works. Expand any card to read its heartbeats; open the monitor to follow the whole stream.</>],
                  ["Review & improve", <>When the run finishes, browse it in history — and apply any optimization suggestions back to the conductor for next time.</>],
                ].map(([title, body], i) => (
                  <li key={i} className="flex gap-4">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-iris/30 bg-iris/10 font-mono text-sm text-iris">
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-medium text-chalk">{title}</div>
                      <p className="mt-1 text-sm leading-relaxed text-mist-2">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="grid gap-4 lg:grid-cols-2">
                <CodeBlock code={CONDUCTOR_YAML} filename="conductor.yaml" lang="yaml" />
                <CodeBlock code={STATUS_JSON} filename="status.json" lang="json" />
              </div>
            </section>

            {/* MONITOR */}
            <section className="space-y-4">
              <H2 id="monitor" kicker="Self-regulation">The heartbeat monitor</H2>
              <P>
                A terminal-style panel pinned to the bottom of the board streams
                every heartbeat, from every step, as it lands — the agent talking
                to you in real time. It has three states: a{" "}
                <strong className="text-chalk">minimized</strong> bar showing the
                latest beat typing in character by character, an{" "}
                <strong className="text-chalk">expanded</strong> terminal with
                filter pills (by workflow, or insights-only), auto-scroll with a
                jump-to-latest pill, and a <strong className="text-chalk">hidden</strong>{" "}
                state that tucks it away behind a heart in the corner. Toggle it
                with <Code>Ctrl + `</Code>.
              </P>
              <P>
                A small heart keeps the rhythm — it pulses on each new beat and{" "}
                <strong className="text-chalk">weakens</strong> (slower, dimmer, an
                amber glow) if no beat lands for 90 seconds, so a stalled agent is
                visible at a glance. The 90s timer resets on{" "}
                <em>every</em> beat, finalBeats included — so the cooldown starts
                fresh after each step's handoff, giving the agent natural
                transition time.
              </P>
            </section>

            {/* MULTIPLE */}
            <section className="space-y-4">
              <H2 id="multiple" kicker="Parallel work">Running several workflows</H2>
              <P>
                Give each workflow its own subdirectory under <Code>.conductor/</Code>{" "}
                and the board shows them all — grouped and switchable in the
                sidebar, with the running ones up top and a live elapsed timer on
                each. The flat <Code>.conductor/status.json</Code> layout still
                works for a single workflow.
              </P>
              <CodeBlock code={MULTI_TREE} filename=".conductor/" lang="text" />
            </section>

            {/* HISTORY */}
            <section className="space-y-4">
              <H2 id="history" kicker="Durability">History &amp; replay</H2>
              <P>
                When a run reaches <Code>done</Code> or <Code>failed</Code>, the
                board archives a self-contained copy — the final status plus the
                conductor that produced it — to <Code>.conductor/history/</Code>.
                The sidebar's <strong className="text-chalk">History</strong>{" "}
                section groups past runs by workflow with a pass/fail badge and
                duration. Click one and the board freezes to that run's final
                state, heartbeats and all, so you can read exactly what happened.
                A <Code>?run=&lt;id&gt;</Code> link deep-links straight to it.
              </P>
            </section>

            {/* IMPROVE */}
            <section className="space-y-4">
              <H2 id="improve" kicker="The loop closes">A workflow that improves itself</H2>
              <P>
                The same heartbeat that keeps an agent on track can carry an{" "}
                <span className="text-amber">💡 insight</span> — a faster path, a
                too-strict gate, a missing instruction. Before a run ends, the
                agent distills those into a few <strong className="text-chalk">suggestions</strong>.
                When the run finishes, the board surfaces them with a before/after
                diff and a one-click <strong className="text-chalk">Apply</strong>{" "}
                that edits the conductor (with a backup and a re-validation pass).
                The workflow gets better every time it runs.
              </P>
              <P>
                Each step also ends with a <strong className="text-chalk">finalBeat</strong> —
                a summary and a handoff that passes context to the next step
                without loss:
              </P>
              <CodeBlock code={FINALBEAT_JSON} filename="status.json" lang="json" />
            </section>

            {/* CTA */}
            <section className="rounded-2xl border border-line bg-panel/40 p-8 text-center">
              <h2 className="text-2xl font-semibold tracking-tight text-chalk">
                Start the board.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-pretty text-mist-2">
                One command. Point any agent at the spec and watch it work.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line bg-ink-2/80 px-4 py-2 font-mono text-sm">
                <span className="text-line-2">$</span>
                <span className="text-mist-2">npx conductor-board</span>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <a href={HOME} className="rounded-xl border border-line-2 bg-panel/60 px-5 py-3 text-sm text-chalk transition-colors hover:border-iris/40">
                  ← Back to home
                </a>
                <a
                  href={`${GH}/blob/main/spec/conductor-spec.md`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-chalk px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-white"
                >
                  Read the spec ↗
                </a>
              </div>
            </section>
          </article>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src={`${HOME}conductor.svg`} alt="" className="h-6 w-6" />
            <span className="font-mono text-sm text-mist">agent-conductor</span>
          </div>
          <p className="font-mono text-xs text-mist">MIT © mettafive · built to be conducted</p>
        </div>
      </footer>
    </div>
  );
}
