# Review register

Check-fix cycles on the finished submission. Every finding gets a verdict here.
A finding marked RESOLVED, REJECTED or FOLLOWUP is not re-opened unless there is
new evidence that the fix doesn't hold. That rule is what stops fixes going round
in circles.

**Scope (frozen before round 1):** `api/*.go` (handlers, query, tests), `web/src/*`,
and `e2e/*`.
Out of scope and never edited: `db/`, `docker-compose.yml`, the Dockerfiles and the
`Makefile` (the run environment is fixed), and `DECISIONS.md` (the owner's text).
Real bugs found outside scope are listed under follow-ups.

**Severity:**
- **High:** wrong numbers, or lost or false user data.
- **Medium:** a user-visible malfunction.
- **Low:** code quality, coverage or comments.

The goal is zero findings of any severity. Only High and Medium findings open a
new round; Low findings are fixed within the round that found them.

**A cycle closes** when a review round returns zero findings. The reviewers are told
not to invent findings to avoid saying "converged".

**Verdicts:** RESOLVED (fixed; the fix is checked by grepping the whole artifact, not
just the reported line), REJECTED (with a reason), FOLLOWUP (real, but out of scope).

| ID | Round | Severity | Finding | Verdict | Evidence / commit |
|----|-------|----------|---------|---------|-------------------|

## Follow-ups (out of scope)

| ID | Finding | Why out of scope |
|----|---------|------------------|
