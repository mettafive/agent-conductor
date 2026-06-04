// Completion chimes generated with the Web Audio API — no audio files.
// Success: a soft clear ~800Hz sine; Failure: a gentle low ~400Hz sine.

let ctx: AudioContext | null = null;
let lastPlayed = 0;

// Two independent controls: the heartbeat ticks (frequent, ambient) and the
// completion chimes (success / failure). Either can be muted on its own.
const TICKS_KEY = "cb-mute-ticks";
const CHIMES_KEY = "cb-mute-chimes";

function getFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string, muted: boolean): void {
  try {
    localStorage.setItem(key, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const isTicksMuted = () => getFlag(TICKS_KEY);
export const setTicksMuted = (m: boolean) => setFlag(TICKS_KEY, m);
export const isChimesMuted = () => getFlag(CHIMES_KEY);
export const setChimesMuted = (m: boolean) => setFlag(CHIMES_KEY, m);

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
  if (isChimesMuted()) return false;
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
  if (isTicksMuted()) return false;
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
