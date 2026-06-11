import { useEffect, type ReactNode } from "react";
import { CodeBlock } from "../components/CodeBlock";
import { useScrollSpy } from "../lib/useScrollSpy";
import { useReveal } from "../lib/useReveal";
import { Nav } from "../components/Nav";
import { FooterNav } from "../components/FooterNav";
import { Icon } from "../components/Icon";

const HOME = import.meta.env.BASE_URL; // "/agent-conductor/"
const GH = "https://github.com/mettafive/agent-conductor";

const CONDUCTOR_JSON = `{
  "conductor": "3.0.0",
  "name": "basic-report",
  "description": "Research, outline, write, review.",
  "steps": [
    {
      "title": "Research",
      "instruction": "Gather five credible sources on {topic}.",
      "summary": "Researches the topic and collects five credible sources for the report.",
      "requires": []
    },
    {
      "title": "Write",
      "instruction": "Write an 800-word report, citing every claim.",
      "summary": "Writes the 800-word report from the research, citing every claim.",
      "requires": [0]
    }
  ]
}`;

const STATUS_JSON = `{
  "workflow": "basic-report",
  "status": "running",
  "goal": "Research, outline, write, review.",
  "current_step": "1",
  "steps": {
    "0": { "status": "done",    "gate": "passed",  "attempt": 1 },
    "1": { "status": "running", "gate": "pending", "attempt": 2,
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

const DIRECTIVES_CMDS = `# Comments and worker insights accumulate as open knowledge
npx conductor-board knowledge --min 1

# The next run applies them before work starts
npx conductor-board run SKILL.md

# Or apply open knowledge by hand
npx conductor-board integrate --dir .conductor/<workflow-name>`;

const CADENCE_NOTE = `# write a concise progress update while a card runs
npx conductor-board update 2 "README still needs receipt wording, so I am rewriting the quick start around instruction-based checking."

# the update terminal is scoped to the visible workflow/preflight,
# so old runs never replay into the current screen.`;

const MULTI_TREE = `.conductor/
├── daily-price/
│   ├── workflow.json
│   ├── status.json
│   └── history/
└── treatment-page/
    ├── workflow.json
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
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="reveal scroll-mt-24" id={id}>
      {kicker && <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-mist">{kicker}</div>}
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
  ["good-instructions", "Good instructions"],
  ["checker-results", "Checker results"],
  ["no-skip", "Nothing gets skipped"],
  ["activity-cards", "Activity cards"],
  ["comments", "Comments & steering"],
  ["monitor", "Update stream"],
  ["multiple", "Multiple workflows"],
  ["history", "History & replay"],
  ["done-screen", "The done screen"],
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
    dot: "bg-mint",
    text: "text-mint",
    border: "border-mint/30",
    body: "The agent is executing the step's instruction. The focus LED pulses green→white; the card streams the latest heartbeat. If beats go quiet it slows and a stall dot turns amber.",
  },
  {
    name: "Checking",
    dot: "bg-amber",
    text: "text-amber",
    border: "border-amber/30",
    body: "The instruction is done and an independent checker is evaluating the output before the card can advance.",
  },
  {
    name: "Done",
    dot: "bg-mint",
    text: "text-mint",
    border: "border-mint/30",
    body: "The checker passed. The step is locked in, its output (if any) is recorded, and the next step unlocks.",
  },
  {
    name: "Failed",
    dot: "bg-rose",
    text: "text-rose",
    border: "border-rose/30",
    body: "The checker failed and the workflow stopped here. Appears as a side column only when something fails — the agent retries before it ever lands here.",
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
      <Nav active="guide" />

      <main className="mx-auto max-w-5xl px-5 pt-10">
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
            A live, local Kanban board that watches an agent work through an
            independently checked workflow in real time. Each step is a card;
            cards move across columns as the agent works, gets checked, and
            completes them. One command, zero
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
            <div className="sticky top-20">
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
                You hand Conductor a <Code>SKILL.md</Code>. The board opens before
                setup starts, shows Create Cards / Map Dependencies / Validate
                Workflow, then hands off into integration if open insights exist,
                and finally into the regular Kanban run. Underneath, the board
                still watches <Code>.conductor/status.json</Code> and redraws the
                instant anything changes.
              </P>
              <P>
                The board is a live control surface, but the files stay the source
                of truth. You can pause, resume, rerun, improve, inspect artifacts,
                and leave comments; the dispatcher and workers still move cards
                only when their status and checker results allow it.
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
                      ["Board", "The local web app opened by npx conductor-board run SKILL.md. Watches .conductor/ and updates live over Server-Sent Events."],
                      ["Workflow", "One workflow.json + its status.json. The board can show several side by side."],
                      ["Card", "A unit of work in the workflow. Has a title, instruction, generated summary, and requires list; its array index is its identity."],
                      ["Checker", "An independent reviewer that compares the card's output to its instruction before it moves to Done."],
                      ["Column", "A lane representing a step's state: Pending, Running, Checking, Done (and Failed)."],
                      ["Update", "A timestamped Codex-style progress note: concise context about what the agent learned, decided, changed, or is handing off."],
                      ["Handoff", "The closing update of a card — what the next card needs to know."],
                      ["Comment", "A note you leave on a card. It becomes a human knowledge item the next integration pass must apply or dismiss with a reason."],
                      ["Integration preflight", "The minimal Apply instruction insights / Validate updated workflow screen that runs before regular work when open insights exist."],
                      ["Prewarm", "A no-work probe that starts likely-next agents early, then yields to the real worker only after dependencies pass."],
                      ["Run", "One execution of a workflow, identified by run_id. Completed runs are archived to history."],
                      ["Insight", "A durable optimization captured from a worker or human comment and folded into the next run before work starts."],
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
              <H2 id="columns" kicker="The lanes">Pending → Running → Checking → Done</H2>
              <P>
                Every card flows left to right. A card only advances when its checker
                passes; if the checker fails, the agent{" "}
                <strong className="text-chalk">retries the card — it never skips
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
              <H2 id="card" kicker="The card">Anatomy of a card</H2>
              <P>Click any card to expand it. A card carries everything about its work unit:</P>
              <ul className="space-y-2 text-sm text-mist-2">
                {[
                  ["Identity", "the card's array index and title; a loop icon for loop cards."],
                      ["Checker", "the independent instruction check, with pass, fail, or pending state."],
                  ["Updates", "a vertical timeline of the agent's concise progress notes, newest first, scoped to this card and workflow."],
                  ["Handoff", "the closing update showing what the next step needs to know."],
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
                      "Watch cards move across the columns live.",
                      "Expand a card to read its updates and checker results.",
                      "Review instructions before the first run.",
                      "Comment on a card to steer the next run.",
                      "Open the update stream to follow every agent note in one place.",
                      "Switch between running workflows in the sidebar.",
                      "Browse history and freeze any past run to its final state.",
                      "Click Improve & Run to fold open insights into the next run.",
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
                      "Write each instruction so an independent checker can evaluate it.",
                      "Save cards and workflow under the scoped .conductor/<skill>/ folder.",
                      "Create status.json with every card pending.",
                      "Mark each card running → checking → done, updating checker state.",
                      "Write Codex-style updates when the agent learns, decides, changes, or hands off.",
                      "Resolve every open insight — apply or dismiss with a reason.",
                      "Close each card with a clear handoff update.",
                      "Retry on a failed checker result — never skip.",
                      "Capture durable efficiency insights only when they help future runs.",
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
                <a href={`${GH}/blob/main/setup.conductor.json`} target="_blank" rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">setup.conductor.json ↗</a>)
                and it handles the whole contract.
              </P>
            </section>

            {/* GETTING STARTED */}
            <section className="space-y-4">
              <H2 id="getting-started" kicker="Getting started">One command to a live board</H2>
              <ol className="space-y-4">
                {[
                  ["Run the skill", <>Run <Code>npx conductor-board@latest run SKILL.md</Code>. It opens the board before setup work starts.</>],
                  ["Watch setup", <>Create Cards, Map Dependencies, and Validate Workflow move first. When accepted, the regular workflow is ready.</>],
                  ["Let integration lead if needed", <>If <Code>knowledge.json</Code> has open insights, the minimal integration preflight applies them and validates the updated workflow before work starts.</>],
                  ["Watch the run", <>Cards move through Pending, Running, Checking, and Done. Likely-next workers prewarm while dependencies finish.</>],
                  ["Improve & Run again", <>At completion, use Improve & Run to fold new insights into the next lap on the same board.</>],
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
                <CodeBlock code={CONDUCTOR_JSON} filename="workflow.json" lang="json" />
                <CodeBlock code={STATUS_JSON} filename="status.json" lang="json" />
              </div>
            </section>

            {/* GOOD INSTRUCTIONS */}
            <section className="space-y-4">
              <H2 id="good-instructions" kicker="The standard">What makes a good instruction</H2>
              <P>
                A checker is only useful when the instruction gives it a concrete bar:
                <strong className="text-chalk"> would this output satisfy the request?</strong>
                The common failure is an instruction that only names an activity
                without naming the expected evidence, scope, or deliverable.
              </P>
              <ul className="space-y-2.5 text-sm text-mist-2">
                {[
                  ["Substance, not surface", "Say what correct, faithful, and complete means for this card, not just what file shape should exist."],
                  ["Name the evidence", "If the card needs sources, prices, tests, pages, or screenshots, say so in the instruction."],
                  ["Show the work product", "The output must be the content, code, data, diff, source list, or artifact itself. A report about what was done should fail."],
                  ["Define the scope", "A checker needs to know how many items, which audience, and what dimensions matter."],
                  ["Avoid self-reporting", "Do not ask the work agent to say it is done. Ask for output an independent checker can inspect."],
                  ["Fold vague work", "If a unit of work cannot be checked against a concrete instruction, fold it into a card that can."],
                ].map(([k, v]) => (
                  <li key={k} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-iris" />
                    <span><strong className="text-chalk">{k}</strong> — {v}</span>
                  </li>
                ))}
              </ul>
              <P>
                A green check should mean the output satisfied the card instruction.
                The full agent contract lives in{" "}
                <a href={`${GH}/blob/main/CONDUCTOR.md`} target="_blank" rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">CONDUCTOR.md ↗</a>.
              </P>
            </section>

            {/* CHECKER RESULTS */}
            <section className="space-y-4">
              <H2 id="checker-results" kicker="Before Done">Checker results</H2>
              <P>
                A card does not move to Done just because the work agent says it is
                finished. An independent checker records a verdict first:
              </P>
              <ol className="space-y-4">
                {[
                  ["A skill becomes cards", <>Each independently verifiable unit of work becomes a card.</>],
                  ["Each card has an instruction", <>That instruction is the checker contract.</>],
                  ["The checker records a verdict", <>Use <Code>gate-result</Code> with pass/fail evidence.</>],
                  ["Then complete consumes it", <>A failed result retries the card; a passed result moves it to Done.</>],
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
            </section>

            {/* NO SKIP */}
            <section className="space-y-4">
              <H2 id="no-skip" kicker="Coverage is structural">Nothing gets skipped</H2>
              <P>
                The whole point of the board is that an agent can't quietly drop work.
                Three guarantees make that structural rather than aspirational:
              </P>
              <div className="space-y-3">
                {[
                  ["A loop can't close with work left undone", "Every iteration is frontloaded as pending the moment it's scoped, so the plan is visible before any card moves. A loop-coverage guard refuses to advance while any iteration is still incomplete — and lists the ones missed. A frontloaded item left pending is a skipped page, not a finished loop."],
                  ["Integration blocks half-applied changes", "Open insights are applied and independently checked before work starts. If integration fails, the work run does not begin on a half-updated plan."],
                  ["A failed checker result forces fix-and-retry", "A failed result sends the card back into Running. The agent fixes and re-attempts — it never skips ahead. Failed appears only as a side column when something truly stops."],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-panel/30 p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-mint"><Icon name="check" size={14} /></span>
                      <span className="font-mono text-sm font-medium text-chalk">{k}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-mist-2">{v}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* ACTIVITY CARDS */}
            <section className="space-y-4">
              <H2 id="activity-cards" kicker="A run reads as a story">Updates make the run legible</H2>
              <P>
                Updates are not a log of every command. They are short preambles
                in the Codex style: what the agent has learned so far, what that
                implies, and what it is about to do next. A good update helps a
                human understand the run without reading the private reasoning.
              </P>
              <P>
                The agent writes updates with <Code>conductor-board update</Code>.
                Avoid mechanical notes like "reading README" or "checker passed";
                write the context the user would be glad to know, such as "README
                still needs receipt wording, so I am rewriting the quick start
                around instruction-based checking."
              </P>
            </section>

            {/* DIRECTIVES */}
            <section className="space-y-4">
              <H2 id="comments" kicker="The flow-manager loop">You steer the run with comments</H2>
              <P>
                The board isn't just a window — it's a steering wheel.{" "}
                <strong className="text-chalk">Leave a comment on a card</strong> and it
                becomes a human knowledge item. The next integration preflight reads
                open human notes alongside agent insights and must either fold them
                into the relevant card instruction or dismiss them with a concrete reason.
              </P>
              <ul className="space-y-2 text-sm text-mist-2">
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
                  <span><strong className="text-chalk">Apply it</strong> — weave the requested change into the relevant existing card instruction and validate the updated workflow.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  <span><strong className="text-chalk">Dismiss it</strong> — only with a real reason, such as a conflict with a required rule or a note that is not actionable.</span>
                </li>
              </ul>
              <P>
                The integration preflight is the flow-manager loop made visible:
                you watch a run, drop a note where it matters, and the next lap
                explicitly applies or dismisses it before any work card starts.
              </P>
              <CodeBlock code={DIRECTIVES_CMDS} filename="steer the run" lang="bash" />
            </section>

            {/* MONITOR */}
            <section className="space-y-4">
              <H2 id="monitor" kicker="Self-regulation">The update stream</H2>
              <P>
                A terminal-style panel pinned to the bottom of the board streams
                updates from the visible workflow or preflight as they land — the
                agent talking to you in real time without old runs leaking into the
                current screen. It has three states: a{" "}
                <strong className="text-chalk">minimized</strong> bar showing the
                latest update typing in character by character, an{" "}
                <strong className="text-chalk">expanded</strong> terminal with
                filter pills (by workflow, or insights-only), auto-scroll with a
                jump-to-latest pill, and a <strong className="text-chalk">hidden</strong>{" "}
                state that tucks it away behind a heart in the corner. Toggle it
                with <Code>Ctrl + `</Code>.
              </P>
              <P>
                A small heart keeps the rhythm. It's{" "}
                <strong className="text-mint">green while beating</strong> — pulsing on
                each new beat — and turns{" "}
                <strong className="text-amber">amber when it goes quiet</strong>, so a
                stalled agent is visible at a glance. The stall timer resets on{" "}
                <em>every</em> beat, finalBeats included, so the cooldown starts fresh
                after each step's handoff and the agent gets natural transition time.
              </P>
              <P>
                Worker notes are plain prose: what changed, what was learned, what
                is being checked, or what the next card needs. System beats mark
                transitions like Checking, Passed, Pausing, Resuming, and the handoff
                from setup/integration into dispatch.
              </P>
              <CodeBlock code={CADENCE_NOTE} filename="heartbeat cadence" lang="bash" />
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
                state, updates and all, so you can read exactly what happened.
                A <Code>?run=&lt;id&gt;</Code> link deep-links straight to it.
              </P>
            </section>

            {/* DONE SCREEN */}
            <section className="space-y-4">
              <H2 id="done-screen" kicker="When a run ends">A distilled done screen</H2>
              <P>
                A finished run doesn't dump its data at you. The completion screen is{" "}
                <strong className="text-chalk">distilled</strong> — built to be read,
                with the detail one click away:
              </P>
              <ul className="space-y-2 text-sm text-mist-2">
                {[
                  ["Produced, first", "What actually shipped leads the screen — the artifacts, pages, or PRs the run produced, before anything else."],
                  ["A tight per-step recap", "One line per step of what it accomplished, not a status table."],
                  ["Learnings as a digest", "Grouped into New this run, Applied at start, and Open — each expandable to the evidence behind it."],
                  ["Up next", "When the work came from a queue, a handoff prompt names the next run and how many remain, so you can keep going."],
                ].map(([k, v]) => (
                  <li key={k} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-iris" />
                    <span><strong className="text-chalk">{k}</strong> — {v}</span>
                  </li>
                ))}
              </ul>
              <P>
                The run timer freezes when the run ends. Improve & Run reuses the same
                board: integration preflight appears only when open insights exist, then
                the work cards ease back in.
              </P>
            </section>

            {/* IMPROVE */}
            <section className="space-y-4">
              <H2 id="improve" kicker="The loop closes">A workflow that improves itself</H2>
              <P>
                The same update stream that keeps an agent on track can carry an{" "}
                <span className="inline-block h-1.5 w-1.5 translate-y-px rounded-full bg-amber" />{" "}
                <span className="text-amber">insight</span> — a faster path, a
                missing known input, a redundant verification step, or a human comment.
                After a card passes, the efficiency learner keeps only lessons that
                should help a future run, not one-off observations.
              </P>
              <P>
                Open insights are applied automatically by the integration preflight:
                Apply instruction insights, then Validate updated workflow. The top
                component stays minimal; detailed what/why notes stream in the
                terminal. If the checker rejects an integration patch, it repairs and
                retries before any regular work can start.
              </P>
              <P>
                Each step also ends with a clear handoff update that passes context to
                the next step without loss:
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
                <span className="text-mist-2">npx conductor-board@latest run SKILL.md</span>
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

      <FooterNav />
    </div>
  );
}
