# Heartbeat Guide

A heartbeat is a short pulse an agent writes to itself while a step runs — at least
once per minute. It exists to stop drift: on long steps, agents lose the thread,
optimize the wrong thing, or quietly give up. A good heartbeat re-anchors the agent
to **two** things every time: the step's gate, and the workflow's end `goal`.

This guide is about writing *good* ones. The mechanics (where it goes, the schema)
are in [the spec](./conductor-spec.md#65-heartbeats--agent-self-regulation).

## The shape of a good beat

```json
{ "at": "2026-06-03T15:51:30Z", "note": "3/5 sources found via sitemap. Nav-crawling the last two; gate needs all 5 with URLs." }
```

A good `note` does three things in one or two sentences:

1. **States progress concretely** — "3/5", "23 prices extracted", not "making good
   progress."
2. **Names the bar it's measured against** — the step's gate, or the `goal`.
3. **Says what's next or what's blocking** — so the next beat (and a human) has
   continuity.

## Write each beat with both goals in view

Before writing, read your prior beats, then ask:

- *Am I advancing toward **this step's gate**?* (the local bar)
- *Am I advancing toward the **workflow's `goal`**?* (the global purpose)
- *Am I drifting? Polishing something that doesn't matter? Stuck in a loop?*

If the answer to the drift question is "yes," the heartbeat is where you catch and
correct it — say so in the note and adjust.

## Good vs. weak beats

| Weak | Good |
| --- | --- |
| "Still working." | "Section 2 drafted (320 words). Gate needs every claim cited — 4/6 cited so far." |
| "Found some sources." | "3/5 sources found via sitemap; nav-crawling the remaining two." |
| "Done with the thing." | "Persisted 23 prices for ahlbergs-veterinar. Moving to ale-djurklinik." |
| "Had a problem." | "Sitemap 404s for aleks-djurklinik; falling back to nav crawl from /priser." |

## Surface URLs as links

When you produce a meaningful URL — a PR, a discovered page, an error reference —
put it in the note as a markdown link. The board renders these as clickable links,
so a human reviewing the run never has to dig through a terminal.

```json
{ "at": "…", "note": "PR opened: [daily-price run](https://github.com/org/repo/pull/42). Ready for review." }
```

## Heartbeats in loops

Tag each beat with the `iteration` it belongs to so the board routes it to the
right sub-card:

```json
{ "at": "…", "iteration": "ale-djurklinik", "note": "Sitemap has /behandlingar/priser, fetching." }
```

Before starting a new iteration, read the heartbeats and `learnings` from the ones
before it — that's how the loop gets smarter as it goes instead of repeating the
same discovery each time.

## Learnings: distill, don't dump

`learnings` is a short list (max 5) of **durable** patterns worth carrying forward —
not a log. Promote something into `learnings` when it would change how you approach
the next iteration or the next run:

```json
"learnings": [
  "Swedish vet pricing pages are usually at /priser or /prislista.",
  "Sitemap-first discovery beats nav-first for most clinics."
]
```

When a better learning emerges and you're at the cap, replace the weakest one.

## Cadence

- **At least once per minute** while a step is running.
- Also beat at natural boundaries: finishing a sub-task, hitting a blocker,
  changing strategy, producing an artifact.
- Don't spam — a beat every few seconds with no new information is noise. One
  *informative* beat per minute beats ten empty ones.

## Why it matters

The heartbeat array is append-only, so it's also the **audit trail**. Long after a
run finishes, anyone can open the board's history, expand a step, and read exactly
what the agent was thinking minute by minute — including the links it produced and
the lessons it learned. That's the difference between "it said it was done" and a
reviewable record of how it got there.
