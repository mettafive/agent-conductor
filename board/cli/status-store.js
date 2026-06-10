import fs from "node:fs";
import path from "node:path";

/**
 * The one concurrency-safe status-mutation primitive. Every status.json write goes
 * through here so parallel siblings (separate worker PROCESSES) can't clobber each
 * other's beats or status fields with the old read-whole / modify / write-whole race.
 *
 *   mutateStatus(statusPath, (status) => { ...change it... })
 *
 * - acquires a CROSS-PROCESS lock (an O_EXCL lockfile, with bounded retry + a
 *   stale-lock steal so a dead holder never deadlocks the run);
 * - reads the file FRESH inside the lock (the mutator never builds on a stale read);
 * - applies the mutator (field change and/or beat append);
 * - writes back ATOMICALLY (temp file + rename — a crash never leaves a partial
 *   status.json);
 * - releases the lock.
 *
 * Sync on purpose: the CLI writers are one-shot processes, and the dispatcher's
 * writes are tiny, so a brief synchronous hold is simpler and correct for both.
 */

const ACQUIRE_TIMEOUT_MS = 5000; // max wait before we steal rather than deadlock
const STALE_LOCK_MS = 15000; // a lock older than this had a dead holder — steal it
const RETRY_MS = 12;

let tmpCounter = 0;

function sleepSync(ms) {
  // A real sleep (not a CPU spin) on the main thread — Node permits Atomics.wait here.
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback spin if SharedArrayBuffer is unavailable */
    }
  }
}

function acquireLock(lockPath) {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx"); // O_CREAT | O_EXCL — fails if it exists
      try {
        fs.writeSync(fd, `${process.pid} ${Date.now()}`);
      } finally {
        fs.closeSync(fd);
      }
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Held. Steal it if the holder is gone (stale) or we've waited too long.
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS;
      } catch {
        continue; // the lock vanished between open and stat — retry immediately
      }
      if (stale || Date.now() > deadline) {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          /* someone else stole it first — retry */
        }
        continue;
      }
      sleepSync(RETRY_MS);
    }
  }
}

function releaseLock(lockPath) {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* already gone */
  }
}

function atomicWrite(statusPath, value) {
  // temp + rename in the SAME directory → the rename is atomic on POSIX, so a
  // reader (the board's file-watch) only ever sees a complete file. The temp name
  // does not end in .json, so feed discovery never picks it up as a workflow.
  const tmp = `${statusPath}.tmp.${process.pid}.${tmpCounter++}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  try {
    fs.renameSync(tmp, statusPath);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * Run `mutator` against a fresh-read status under the cross-process lock and write
 * the result atomically. The mutator may mutate the passed object in place or return
 * a replacement. Returning `null` (when there is no status to read, or the mutator
 * declines) skips the write. Returns the written value (or null).
 */
export function mutateStatus(statusPath, mutator) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const lockPath = `${statusPath}.lock`;
  acquireLock(lockPath);
  try {
    let status = null;
    try {
      status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    } catch {
      status = null; // missing or mid-nothing (we hold the lock, so never mid-write)
    }
    const result = mutator(status);
    const next = result === undefined ? status : result;
    if (next == null) return next;
    atomicWrite(statusPath, next);
    return next;
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Per-run monotonic beat sequence, assigned UNDER THE LOCK at append time — strictly
 * increasing, no duplicates, even under concurrent appends. Stamp a beat with this +
 * its event time so the terminal can sort by (event_at, seq), the order work happened.
 */
export function nextSeq(status) {
  status.beat_seq = (typeof status.beat_seq === "number" ? status.beat_seq : 0) + 1;
  return status.beat_seq;
}

/** Stamp a heartbeat entry with its sequence + event time (event_at defaults to its
 *  display time `at` when the caller didn't capture a distinct emit moment). */
export function stampBeat(status, entry) {
  entry.seq = nextSeq(status);
  if (!entry.event_at) entry.event_at = entry.at;
  return entry;
}
