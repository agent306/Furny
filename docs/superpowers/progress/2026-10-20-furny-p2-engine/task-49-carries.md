# Task 49 — carries (binding; preflight.md I10, I11)

1. I10: the `useEngineWorker` fallback test uses `vi.stubGlobal('Worker', undefined)` (restore with `vi.unstubAllGlobals()`).
2. I11: tests outside the engine may import `engine/testing/*`; the 01 §5.2 single-entry rule (`engine/index.ts` only) applies to production code only. Production code outside the engine imports only from the engine index.
3. Composables must clean up on scope dispose (terminate the worker, reject pending calls, clear timers) — a teardown timer leak is the known AppShell flake pattern; do not add another.
4. Interfaces from earlier tasks: computeBom (42), nestSheets (43), priceBom/estimateFurniture (44), diffFurniture (45), cutListCsv (46) — reuse exactly as exported from engine/index.ts.
