// Completion chimes generated with the Web Audio API — no audio files.
// Success: a soft clear ~800Hz sine; Failure: a gentle low ~400Hz sine.

let ctx: AudioContext | null = null;
let lastPlayed = 0;

const MUTE_KEY = "cb-muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function getCtx(): AudioContext | null {
  try {
    const AC =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new AC();
    return ctx;
  } catch {
    return null;
  }
}

/** Returns true if a tone actually played (false if muted or debounced). */
function tone(freq: number, decay: number): boolean {
  if (isMuted()) return false;
  const now = Date.now();
  if (now - lastPlayed < 2000) return false; // debounce rapid completions
  const ac = getCtx();
  if (!ac) return false;
  lastPlayed = now;
  try {
    if (ac.state === "suspended") void ac.resume();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + decay);
    return true;
  } catch {
    return false;
  }
}

export const playSuccess = () => tone(800, 0.5);
export const playFailure = () => tone(400, 0.7);

// Heartbeat tick — a near-inaudible clock-like tap on each live beat. Shares the
// mute toggle, but not the completion debounce (ticks are meant to be frequent).
let lastTick = 0;
export function playTick(): boolean {
  if (isMuted()) return false;
  const now = Date.now();
  if (now - lastTick < 120) return false; // collapse bursts only
  const ac = getCtx();
  if (!ac) return false;
  lastTick = now;
  try {
    if (ac.state === "suspended") void ac.resume();
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2000, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.03, t + 0.005); // sharp attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); // instant decay
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.06);
    return true;
  } catch {
    return false;
  }
}
