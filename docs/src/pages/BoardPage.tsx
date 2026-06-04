import { SectionHead, Page } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { LiveBoard } from "../components/LiveBoard";
import { Icon } from "../components/Icon";
import { Led } from "../components/Led";
import { CodeBlock } from "../components/CodeBlock";

const BASE = import.meta.env.BASE_URL;

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

const LEDS: { state: string; label: string; meaning: string }[] = [
  { state: "running", label: "green → white", meaning: "Running — the focus. Alive and fine." },
  { state: "gate", label: "green → amber", meaning: "Gate check / a warning. Worth a glance." },
  { state: "failed", label: "red → green", meaning: "Something went wrong in here." },
  { state: "done", label: "dim green", meaning: "Done and settled." },
  { state: "pending", label: "grey", meaning: "Pending — not started." },
];

export function BoardPage() {
  return (
    <Page>
      <SectionHead
        kicker="The board"
        title="npx conductor-board"
        sub="Watches the status file and moves every step through the columns, live."
      />
      <div className="mt-7 flex justify-center">
        <code className="rounded-lg border border-line bg-ink-2/80 px-4 py-2 font-mono text-xs text-mist-2">
          <span className="text-dim">$</span> npx conductor-board{"  "}
          <span className="text-mist">→ Board live at http://localhost:3042</span>
        </code>
      </div>
      <Reveal className="mx-auto mt-8 max-w-5xl">
        <LiveBoard />
      </Reveal>
      <p className="mt-6 text-center font-mono text-xs text-mist">
        a live demo — the real board, running.
      </p>

      {/* LED color language */}
      <section className="py-16">
        <SectionHead
          kicker="The color language"
          title="Color is a signal, not decoration"
          sub="The only colour is a small status LED — your eye moves only when it should."
        />
        <div className="mx-auto mt-10 max-w-xl divide-y divide-line rounded-2xl border border-line bg-panel/40">
          {LEDS.map((l) => (
            <div key={l.state} className="flex items-center gap-3.5 px-5 py-3.5">
              <Led state={l.state} />
              <span className="w-28 shrink-0 font-mono text-[12px] text-mist-2">{l.label}</span>
              <span className="text-sm text-mist">{l.meaning}</span>
            </div>
          ))}
        </div>
      </section>

      {/* heartbeats */}
      <section className="py-12">
        <SectionHead
          kicker="Self-regulation"
          title="Agents that check in"
          sub="A pulse the agent writes to itself on long steps, shown live."
        />
        <div className="mt-12 grid items-center gap-5 lg:grid-cols-2">
          <Reveal>
            <CodeBlock code={HEARTBEAT_JSON} filename="status.json" lang="json" />
          </Reveal>
          <Reveal>
            <div className="rounded-2xl border border-line bg-panel/50 p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-panel-2 text-mist">
                  <Icon name="loop" size={13} />
                </span>
                <span className="flex-1 font-mono text-[13px] text-chalk">discover-prices</span>
                <Led state="running" />
              </div>
              <div className="mt-2 flex items-start gap-1.5 pl-7 text-[11.5px] leading-snug text-mist">
                PR opened: <span className="text-mist-2 underline-offset-2 hover:underline">run ↗</span>. Ready for review.
              </div>
              <div className="mt-3 space-y-1.5 border-t border-line pt-2 pl-7">
                {[
                  ["2m ago", "Found /priser via nav, 23 items."],
                  ["90s ago", "Sitemap had /prislista — 18 prices."],
                  ["30s ago", "PR opened, ready for review."],
                ].map(([t, n]) => (
                  <div key={t} className="flex gap-2">
                    <span className="shrink-0 font-mono text-[9px] text-dim">{t}</span>
                    <span className="text-[11px] text-mist-2">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
        <p className="mt-6 text-center text-sm text-mist">
          An append-only audit trail — and when a beat carries an{" "}
          <span className="inline-block h-1.5 w-1.5 translate-y-px rounded-full bg-amber" /> insight, it
          becomes a post-run optimization you fold back into the conductor. The full
          board tour lives in the{" "}
          <a href={`${BASE}kanban.html`} className="text-mist-2 underline-offset-2 hover:text-chalk hover:underline">
            Board guide
          </a>
          .
        </p>
      </section>
    </Page>
  );
}
