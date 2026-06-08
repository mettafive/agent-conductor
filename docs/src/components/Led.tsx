/**
 * A 6px status LED — the only colour in the UI besides the heart. Glow means
 * "needs attention" (running, failed, stalled); no glow means "settled"
 * (done dim, pending grey). Accepts a board column directly.
 */
const CLS: Record<string, string> = {
  running: "led led-running", // green↔white — neutral focus
  checking: "led led-checking", // green↔amber — warning / checking
  done: "led led-done",
  failed: "led led-failed", // red↔green — something went wrong here
  stalled: "led led-stalled",
  pending: "led led-pending",
  idle: "led led-pending",
};

export function Led({ state, title }: { state: string; title?: string }) {
  return <span className={CLS[state] ?? CLS.pending} title={title} aria-hidden />;
}
