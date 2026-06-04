/**
 * A 6px status LED — the only colour in the UI besides the heart. Glow means
 * "needs attention" (running, failed, stalled); no glow means "settled"
 * (done dim, pending grey). Accepts a board column directly.
 */
const CLS: Record<string, string> = {
  running: "led led-running",
  gate: "led led-stalled", // gate-check shares the amber attention glow
  done: "led led-done",
  failed: "led led-failed",
  stalled: "led led-stalled",
  pending: "led led-pending",
  idle: "led led-pending",
};

export function Led({ state, title }: { state: string; title?: string }) {
  return <span className={CLS[state] ?? CLS.pending} title={title} aria-hidden />;
}
