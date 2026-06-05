# What makes a board people trust

A conductor turns your skill into a Kanban board an operator *watches*. A **good** board makes them
think: *"I can see the whole job, I trust the greens, I'd hand this to anyone."* Three things get you
there. (Want the depth + the evidence? See [CONDUCTOR.md](../CONDUCTOR.md). You don't need it for this.)

## 1. Show every phase — including the boring ends
Every distinct phase the skill performs gets a card. The phases that **vanish first** are the
**inputs** (recon, research, reading prior state) and **outputs** (publish, link, index, notify) —
they don't make the central artifact, so they quietly get dropped, and the board looks complete while
hiding real work. If the skill does it, it's a card. Never fold a phase into another card's
instructions. Anything you *deliberately* skip → a visible `(skipped: …)` note, never silence.

## 2. Group at one altitude, matched to the work
- **One card = one phase** the operator would name. Mechanical sub-actions ("open file, save") live
  *inside* a card, not as their own cards.
- **Consistent altitude** — siblings comparable in size; no giant card next to a tiny one.
- **Match the count to the work** — a 3-step utility is ~3 cards; a 20-phase pipeline is ~8 with a
  loop. Repetition → a **loop**. A decision → a **visible fork**.

## 3. Name each card like a promise
The title is a **2–4 word headline** a manager reads at a glance, paired with one line of *"green
means …"* (what a green card proves):
- **Specific + honest** — `ship-and-verify` *(green: deployed, snapshot taken, index pinged)*, not
  `stage`. `run-destructive-reset`, not `run-script`.
- **Operator-language** — `buy-dataforseo-recon`, not `dfs-batch`.
- **One convention** — imperative `verb-object`, lowercase-kebab, everywhere.

---

**The test for all three:** open the board and ask — *would I be disappointed, or filled with joy?*
Could I orient at a glance, trust the greens, and be proud to hand it off? That feeling is the score;
coverage, grouping, and naming are just the levers.
