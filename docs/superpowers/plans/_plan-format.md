# How Furny implementation plans are written

Every milestone plan (`2026-10-20-furny-pN-*.md`) follows this format (superpowers `writing-plans`). Plans are executed by **subagent-driven development**: a fresh Sonnet-class implementer per task sees ONLY that task's text (plus the plan header and the spec files it is pointed at), then a reviewer checks the task. So each task must be self-sufficient.

## Plan header (mandatory)

```markdown
# [Milestone Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [one sentence]
**Architecture:** [2–3 sentences]
**Tech Stack:** [key tech]
**Spec:** docs/superpowers/specs/2026-10-20-furny-design.md + the section files this plan implements (list them with § numbers)
**Environment:** docs/superpowers/plans/2026-10-20-furny-roadmap.md § "Local environment notes" (PHP 8.4 at /usr/local/bin/php, Composer source installs + composer-seed-dist, yarn via corepack, Postgres `furny`/`furny_test`, Redis, no Docker)

## Global Constraints
[project-wide requirements copied verbatim from the spec, one line each: versions, naming, units (integer mm), money (minor units), ULIDs, i18n (no literal UI strings), camelCase wire format, strict types, etc.]

## Review Focus
[the five input classes / failure modes most likely to bite users that no task's tests would otherwise exercise — one line each, and each one gets a test added to its owning task]
```

## Task structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path`
- Modify: `exact/path`
- Test: `exact/test/path`

**Spec refs:** `0X §a.b`, `0Y §c` (the implementer MUST read these sections before coding)

**Interfaces:**
- Consumes: [exact names/signatures from earlier tasks]
- Produces: [exact names/signatures later tasks rely on]

- [ ] **Step 1: Write the failing test** — test file + test names + key assertions as code with exact spec values
- [ ] **Step 2: Run it, expect FAIL** — exact command + expected failure
- [ ] **Step 3: Implement** — exact signatures/files; one-line approach where a choice exists; code only for algorithms the signature/tests don't determine
- [ ] **Step 4: Run tests, expect PASS** — exact command
- [ ] **Step 5: Quality gates** — e.g. `vendor/bin/pint --test`, `vendor/bin/phpstan analyse`, `yarn lint`, `yarn typecheck` as applicable
- [ ] **Step 6: Commit** — exact `git add` paths + conventional commit message
````

## Rules

- A task = smallest unit with its own test cycle that a reviewer could accept/reject independently. Fold scaffolding/config into the task that needs it.
- The spec is long and normative: **reference spec sections instead of copying them**, but copy exact values (names, numbers, enums) into tests so they are pinned.
- No "TBD", "handle edge cases", "add validation", "write tests for the above". Every step lets the implementer write exactly one reasonable thing.
- Names/types must be consistent across tasks (Interfaces blocks are the contract).
- Commit messages: conventional commits, ending with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01X1MLnD93h3fkmdHrLPbw3u`.
- Tests: PHP = Pest 5 (`vendor/bin/pest`), TS = Vitest (`yarn vitest run`), Python = pytest (`uv run pytest`). DB tests use Postgres `furny_test` (RefreshDatabase), never SQLite.
- Self-review before finishing: spec coverage (list every spec requirement of the milestone and the task covering it), step scan, type consistency, review focus, proportion (plan must not be a transcript of the code).
