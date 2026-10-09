# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## 2026-10-09 — data probe, before any code

- Every logical assignment is 15 identical-key rows (14×h + 1×2h) summing to 2/4/5/6/8 h/day. Allocation must SUM all rows; any dedupe gives Ana 0.5h/day instead of 8.
- `hours_per_day` counts working days only. Ana's Atlas runs Mon 12-29 → Sun 01-04 at 8h/day: 40/40 on weekdays, 56/40 on calendar days. 3,111 assignments end on a weekend; counting them nearly triples the over-allocated person-weeks (1,626 → 4,779). Decision: Mon–Fri only.
- Fixture people 1–5 hold the edge cases: Ana at exactly capacity, Bo with a Fri→Mon assignment across a week boundary, Cem a 20h part-timer, Dee 45/40 from overlapping assignments, Eli with 0 capacity and 20h allocated (no division by capacity).
- Default range starts 2025-12-29, which is ISO 2026-W01. Weeks are keyed by Monday date, never by (year, week number).
- `weekly_hours` has no history, so an edit applies to every week, past ones included. The UI says so.
- Query at full production shape (500 people × 105 weeks): ~600 ms, about half JIT. The existing (start_date, end_date) index only bounds one side of an overlap; a better index is deferred because the schema is fixed.
- Plan: `.notes/plan.md`.
- Save flow decided: confirmed patch. The grid changes only on server confirmation, patched from the PATCH response, so no rollback path is needed. Optimistic was rejected because a failed save would flip colours back. Refetch was rejected because it leaves other cached ranges stale.

## API

- Response: `weeks` (Mondays) plus one row per person, with `weeklyHours` and an `allocated[]` array aligned to `weeks`. Capacity isn't repeated per cell because the schema has one value per person, so an edit changes exactly one field on the client.
- Range is widened to whole weeks: Monday of `from` through the week containing `to` (inclusive). Inverted ranges and anything over 106 weeks get a 400. Errors are always JSON `{error}`.
- Perf: the first version used `generate_series` for weeks. The planner estimates 1000 rows for it and enabled JIT, which was ~370 of ~400 ms for 8 weeks. Passing the Go-computed Mondays as a `date[]` brings it to ~20 ms (8 weeks) / ~160 ms (2 years, all 500 people). Verified with EXPLAIN ANALYZE.
- PATCH validates 0–168, rejects unknown fields and string numbers, returns 404 for an unknown id, and returns the stored row. The DB has no CHECK constraint, so the API is the only guard.
- `api/api_test.go` checks the five fixture people against the seeded DB. Run with `docker compose run --rm -v ./api:/src api go test ./...`.
