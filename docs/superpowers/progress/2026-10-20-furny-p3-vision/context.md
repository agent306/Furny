# Context for every P3 implementer
Project "Furny": Python FastAPI vision service in /vision (blueprint image/PDF/DXF → editable PlanDocument JSON). Plan: docs/superpowers/plans/2026-10-20-furny-p3-vision.md (do NOT read the whole plan; your brief has your task).
- Spec (binding authority): /home/user/furny-p3/docs/superpowers/specs/ — read the sections your brief cites (06, 18, 03 §1, 17, 19).
- Controller rulings: ./preflight.md (apply every ruling that mentions your task number, plus global ones K1, K2, K5, K12, K18) and the `Ruling:` lines in ./progress.md.
- Standard implementer instructions (MUST follow): /tmp/claude-0/-home-user/ec6e6a1b-ad2e-502a-8b06-2de27e99048f/scratchpad/implementer-instructions.md
- Environment: worktree /home/user/furny-p3 (branch build/p3-vision). Run uv/pytest from /home/user/furny-p3/vision: `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy app`. Git: `git -C /home/user/furny-p3 add <paths>` / `commit`. Never touch other worktrees or /home/user/furny. Python /usr/bin/python3.12 (uv cannot download Python). PyPI reachable. No Docker. NEVER call real LLM/HTTP APIs in tests (use fakes/mocks). requirements.txt is generated with `uv export --no-header --no-dev --no-emit-project --frozen -o requirements.txt`.
- Logging: logger `furny.vision` has propagate=False (use capsys, not caplog, to assert logs).
- Commit messages: conventional commits ending with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01X1MLnD93h3fkmdHrLPbw3u
