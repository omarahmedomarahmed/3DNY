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
| 1 | 0 | Work on `claude/spaces-lab`, as instructed, not on the session's default branch `claude/spaces-lab-lk3n7u` | The owner named the branch explicitly and it is the one Vercel builds a preview from. Both branches pointed at the same commit when the run started, so nothing was lost | Nothing. `git push -u origin claude/spaces-lab-lk3n7u` from the same commits, one command |
| 2 | 0 | Add a development fixture dataset — `fixtures/dev-buildings.json`, served by `/api/buildings` **only** when `SPACES_FIXTURE_DB=1` | This container has no `DATABASE_URL` and no way to get one. Without a fixture the map is empty, no screenshot exists, and none of the seven existing browser harnesses can run — which would make every visual kill criterion in the plan unverifiable | Delete `src/lib/dev-fixture.ts`, the four-line guard in `/api/buildings`, `fixtures/` and `scripts/make-dev-fixture.ts`: ~10 minutes. Cost of doing so is that this branch can no longer be verified anywhere without a database |
| 3 | 0 | Geometry, BINs, heights, floor counts and years in the fixture are real NYC Open Data. Availability and tenancy rows are invented, and every one carries `FIXTURE — synthetic development data` in its own notes | The plan forbids inventing *product* data. Development scaffolding that never reaches production and is labelled in every row is a different thing, and the alternative was no visual verification at all for the whole run | Point the fixture generator at a read-only copy of the real database instead: ~1 hour, and needs a connection string this container does not have |
| 4 | 0 | The fixture is a fallback for the **flag**, never for a database failure. A missing or broken `DATABASE_URL` still errors exactly as it does today | A broker must never be shown invented availability because a query timed out. Silent fallback is how that happens | None available — this one is not worth overturning |
| 5 | 0 | Baseline recorded as 100 passing / 7 failing browser checks before any Explore code was written. The 7 are `verify-add-by-hand` ×5 (needs database writes) and `verify-map-chrome` ×2 (needs a second tower to land under a projected screen point) | A regression detector needs a known-good starting count. Reporting "7 failures" at the end without this baseline would look like damage caused by this work | Nothing to change; this is a measurement, not a choice |
| 6 | 0 | `three` 0.185.1 (MIT) as the only new runtime dependency | The plan settles three.js. MIT is permissive; the module graph actually imported is roughly 170 KB gzipped, well inside the 5 MB load budget | Nothing else in the plan works without it |

---

## Superseded

Move nothing here. Add a new row above that says "supersedes #n", and note the
number here with a one-line reason, so the trail stays readable.

| # | Superseded by | Why |
|---|---|---|
