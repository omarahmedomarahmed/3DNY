# Explore mode — decision log

Every judgement call made during the Explore mode build, written down as it
was made.

**Append to this file the moment a decision is made.** Not at the end of a
sprint, not at the end of the run. A run this long loses context, and a log
reconstructed from memory afterwards is a fiction — it will be confidently
wrong about the reasoning, which is the only part worth keeping.

The last column is the one that matters. It is what lets the owner overturn a
decision without having to reverse-engineer it first: what it would cost, and
what he would get instead. A row without a real answer there is not finished.

Rules for this file:

| | |
|---|---|
| One row per decision | Not per commit, not per sprint |
| Small decisions belong here too | The point is a complete record, not a highlights reel |
| Escalated decisions belong here | With what the owner said, so the reasoning survives |
| Never edit a row after the fact | Add a new row that supersedes it, and say so |

---

## Decisions

| # | Sprint | Decision | Why | What changes if the owner disagrees |
|---|---|---|---|---|
| — | — | *(first entry goes here)* | | |

---

## Superseded

Move nothing here. Add a new row above that says "supersedes #n", and note the
number here with a one-line reason, so the trail stays readable.

| # | Superseded by | Why |
|---|---|---|
