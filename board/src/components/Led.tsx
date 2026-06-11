/**
 * A 6px status LED — the only colour in the UI besides the heart. Glow means
 * "needs attention" (running, failed, stalled); no glow means "settled"
 * (done dim, pending grey). Accepts a board column directly.
 */
const CLS: Record<string, string> = {
  running: "led led-running", // green↔white — neutral focus
  checking: "led led-gate", // green↔amber — warning / checking
  done: "led led-done",
  failed: "led led-failed", // red↔green — something went wrong here
  paused: "led led-paused", // calm steady blue — held on purpose, not failed
  stalled: "led led-stalled",
  pending: "led led-pending",
  idle: "led led-pending",
};

export function Led({ state, title }: { state: string; title?: string }) {
  const active = state === "running" || state === "checking";
  const syncMs = 1900;
  const delay = active ? `-${(Date.now() % syncMs) / 1000}s` : undefined;
  return (
    <span
      className={CLS[state] ?? CLS.pending}
      style={delay ? { animationDelay: delay } : undefined}
      title={title}
      aria-hidden
    />
  );
}
