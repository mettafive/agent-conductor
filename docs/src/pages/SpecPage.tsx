import { SectionHead, Eyebrow, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { CodeBlock } from "../components/CodeBlock";
import { Led } from "../components/Led";

const QUICKSTART = `{
  "conductor": "3.0.0",
  "name": "basic-report",
  "description": "Research, outline, write, review.",
  "inputs": ["topic"],
  "steps": [
    {
      "title": "Research",
      "instruction": "Research {topic}. Gather five credible sources.",
      "requires": []
    },
    {
      "title": "Write",
      "instruction": "Write an 800-word report, citing every claim.",
      "requires": [0]
    }
  ]
}`;

const STATUS_JSON = `{
  "workflow": "basic-report",
  "status": "running",
  "run_name": "basic-report-run-4-2026-06-04T12-30",
  "auto_improve": true,
  "current_step": "1",
  "steps": {
    "0": { "status": "done",    "gate": "passed",  "attempt": 1 },
    "1": { "status": "running", "gate": "pending", "attempt": 2 }
  }
}`;

const CHECK_SNIPPET = `npx conductor-board check 0 \\
  --output-file .conductor/outputs/0.md
npx conductor-board gate-result 0 \\
  --passed \\
  --evidence "PASS source-list.json contains 5 credible sources with URLs. SUMMARY: Source list is complete."`;

export function SpecPage() {
  return (
    <Page>
      <SectionHead
        kicker="The spec"
        title="One JSON file. Any agent."
        sub="No SDK, no runtime, no lock-in — the conductor file is the whole contract."
      />

      <div className="mt-12 grid items-start gap-5 lg:grid-cols-2">
        <Reveal>
          <CodeBlock code={QUICKSTART} filename="workflow.json" lang="json" />
        </Reveal>
        <div className="space-y-5">
          <Reveal>
            <div className="rounded-2xl border border-line bg-panel/40 p-6">
              <h3 className="flex items-center gap-2.5 text-base font-semibold text-chalk">
                <Led state="done" /> Every card has an instruction check
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-2">
                Every card is independently verified against its instruction.
                Check prints the comparison prompt; the output must be the work product itself,
                not a report about the work.
              </p>
              <div className="mt-4">
                <CodeBlock code={CHECK_SNIPPET} lang="bash" />
              </div>
            </div>
          </Reveal>
          <Reveal>
            <div className="rounded-2xl border border-line bg-panel/40 p-6">
              <h3 className="flex items-center gap-2.5 text-base font-semibold text-chalk">
                <Led state="running" /> The agent writes its own status
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-2">
                As it works, the agent maintains{" "}
                <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">
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
          { t: "Situational work", d: "Write the situation into the instruction; every card still runs." },
          { t: "Dependencies", d: "requires lists the card indexes that must be done first." },
          { t: "Outputs", d: "output: names data that downstream steps template in." },
        ].map((f) => (
          <Reveal key={f.t} className="h-full">
            <div className="flex h-full flex-col rounded-xl border border-line bg-panel/30 p-5">
              <div className="font-mono text-sm font-medium text-chalk">{f.t}</div>
              <p className="mt-1.5 text-sm text-mist">{f.d}</p>
            </div>
          </Reveal>
        ))}
      </div>

      {/* for agents */}
      <section className="py-16">
        <Reveal>
          <div className="overflow-hidden rounded-3xl border border-line bg-panel/30 p-8 sm:p-12">
            <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <Eyebrow>For agents</Eyebrow>
                <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-chalk">
                  Point your agent at one file.
                </h2>
                <p className="mt-3 text-pretty leading-relaxed text-mist-2">
                  <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-mist-2">
                    CONDUCTOR.md
                  </code>{" "}
                  is a single, self-contained instruction file. Hand it to any agent
                  and it converts your skill into a conductor, saves it, runs it, and
                  keeps the status file live — no copy-paste.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
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
                  <span className="text-dim">#</span> start the board, then tell your agent to go
                </div>
                <div className="mt-2">
                  <span className="text-dim">$</span> npx conductor-board
                </div>
                <div className="mt-3 text-mist">
                  <span className="text-dim">#</span> "Here's my skill. Read CONDUCTOR.md,
                </div>
                <div className="text-mist">&nbsp;&nbsp;convert it to a conductor, and run it."</div>
                <div className="mt-3 text-mint">→ .conductor/workflow.json + status.json</div>
                <div className="text-mint">→ board lights up</div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}
