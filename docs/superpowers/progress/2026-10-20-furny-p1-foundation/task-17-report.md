# Task 17 report: shadcn-vue components and UI composables

Status: DONE_WITH_CONCERNS. Commits: cf2761d `fix(ui): Task 16 review leftovers in theme switching`, f716c98 `feat(ui): shadcn-vue component set with tone variants and UI composables`.

## Implemented
- **Components.** Registry (shadcn-vue.com) is blocked (403); `git clone --depth 1 unovue/shadcn-vue` works, so the `new-york-v4` sources (`apps/v4/registry/new-york-v4/ui`) were copied with the CLI's import rewrites (`"cn"` -> `@/lib/utils`, `@/registry/new-york-v4/ui/` -> `@/components/ui/`). 26 new directories: the 25 missing of the 46 plus `native-select` (registry dependency of `calendar`). The 21 kit components already present (alert avatar badge breadcrumb button card checkbox collapsible dialog dropdown-menu input label navigation-menu select separator sheet sidebar skeleton sonner tooltip + `input-otp`, `spinner` used by auth pages) were kept, not overwritten: no duplicates, no churn in files Tasks 21+ still depend on. The registry HEAD is newer than the kit (e.g. `ring-3` vs `ring-[3px]`), so vintage is mixed but both are Tailwind 4 valid.
- **components.json.** `baseColor: stone`; `style` stays `new-york-v4` (preflight E10/I8 ruling: Tailwind 4 build of new-york) rather than the brief's literal `new-york`; aliases already `@/components`, `@/lib/utils`. Test pins `new-york-v4`.
- **Variants.** `buttonVariants`: added `success`, `warning`; sizes `sm h-8, default h-9, lg h-11 (was h-10), icon size-9, icon-lg size-11 (was size-10)`; removed unused kit `icon-sm`; `destructive` now `bg-destructive text-destructive-foreground` (was `text-white` + `dark:bg-destructive/60`). `badgeVariants`: added `neutral, info, success, warning, danger, primary`; destructive uses the foreground token.
- **Control size.** `Input` gained a `size: 'default' | 'lg'` prop (h-9 / h-11, not forwarded as the native numeric `size` attribute) and `SelectTrigger` gained `lg` (h-11), so `:size="useControlSize()"` works per 15 §3.3 (brief listed only button/badge; this is the minimal addition that makes the composable usable).
- **Raw palette in components/ui (exempt from the app guard, cleaned anyway).** 8 occurrences: `bg-black/80` overlays in dialog, dialog-scroll, sheet, alert-dialog, drawer -> `bg-foreground/50 dark:bg-background/80`; slider thumb `bg-white` -> `bg-background`; `text-white` in button/badge destructive -> `text-destructive-foreground`. New test greps all `components/ui` sources for palette classes incl. `white`/`black`.
- **lib/icons.ts**: `ICONS` (33 names from 15/12 specs; spec kebab keys, current lucide names, e.g. `'alert-triangle': TriangleAlert`, `'x-circle': CircleX`) + `IconName`. Package is `@lucide/vue`. Later tasks extend the registry as they need icons. `lib/utils.ts` (`cn`) already existed from the kit.
- **Composables.** `useControlSize` (injects `'density'`, exports `DENSITY_KEY`; defaults to `lg` without an AppShell: touch-safe), `useBreakpoint` (vueuse `breakpointsTailwind`, `greaterOrEqual('md'|'lg')`; phone < 768, tablet 768-1023, desktop >= 1024), `usePermissions`.
- `package.json`: `@internationalized/date ^3.12.4` (calendar imports it directly; it was only transitive via reka-ui).

## usePermissions and shared props
Task 13 did NOT share them: `HandleInertiaRequests` still shares the raw `$request->user()` model plus `name`/`sidebarOpen`. Task 13 did build the sources (`User::permissionNames()`, `User::abilities()` from `OwnerGate`). The plan's Task 20 owns `AuthUserData` with `roles/permissions/abilities` (and `inertia.d.ts`). I did NOT touch PHP: a partial `auth.user` reshape now would collide with Task 20's rewrite and the kit's pages that read the model JSON. `usePermissions` therefore reads `usePage().props.auth.user` through a local minimal type (preflight I9 option 1), tolerates missing lists (`can()` false, `hasRole()` false, `isStaff` from `type`), and works unchanged once Task 20 lands. `isStaff` is a getter on the returned object (typed `boolean`, reactive when read; destructuring freezes it, documented).
**Display only:** every check is client-side visibility; nothing here authorises anything, and a name in `abilities` is never a server-side bypass (policies/gates decide; carry-forward from Task 13: never name a policy ability after a permission).

## Leftovers from Task 16 (commit cf2761d, each with a test)
(a) `initialise()` rewrites the cookie when a stored value exists and differs from it (4 tests: absent cookie, different cookie, matching = no write, nothing stored = no write). (b) `app.blade.php` `@php` block defaults `$appearance ??= 'system'`, `$themeColors ??= HandleAppearance::THEME_COLOR`, `$themeColor ??=` per appearance; Pest test renders the root view on a route outside the web group (also asserts output starts with `<!DOCTYPE html>`). (c) `applyToDocument` toggles the class before assigning `resolved` (sync-watcher test sees `[true,false]`); `readEditorColors` caches only when no key fell back (2 tests; the pre-existing cache test now defines all 42 tokens). (d) AuthSplitLayout logo `text-primary-foreground` (test on the tag). (e) `cssColorToHex` verifies the canvas accepted the value using two sentinel colours (so a valid colour equal to a sentinel is not rejected) and throws `Not a CSS colour the browser understands: ...`; test uses a canvas mock that ignores invalid assignments like a browser.

## TDD evidence
RED: `yarn vitest run resources/js/components/ui resources/js/composables resources/js/lib` before implementation -> `Test Files 5 failed | 4 passed (9), Tests 42 failed | 83 passed (125)` (missing variants/modules/directories, 8 raw `text-white`/`bg-black/80` offences). Leftover tests: 6 failed (cookie rewrite x2, class ordering, cssColorToHex invalid, fallback caching, AuthSplitLayout) and `pest tests/Feature/Ui` -> 1 failed (`Undefined variable $appearance`).
GREEN: `yarn vitest run` -> `Test Files 18 passed, Tests 242 passed`; `vendor/bin/pest tests/Feature/Ui` -> 15 passed.

## Gates
Gates-JS: `yarn lint` clean (0 warnings), `yarn format:check` clean, `yarn typecheck` clean, `yarn vitest run` 242/242. Gates-PHP: `pint --test` passed, `phpstan` no errors, `pest tests/Unit tests/Feature` 1729 passed (6024 assertions). `yarn vite build` OK. Test output pristine (no Vue warnings).

## Tests added
`components/ui/__tests__/{variants,controls,render}.test.ts` (variants, 46+3 dirs, components.json, token-only grep, Input size, smoke mounts of Switch/Progress/Textarea/Table/Tabs), `composables/__tests__/{useBreakpoint,usePermissions,useControlSize}.test.ts`, `lib/__tests__/icons.test.ts` (no `import * as` / dynamic import of `@lucide/vue` under resources/js), plus leftover tests above.

## Concerns / notes for the controller
1. `components.json` style `new-york-v4` vs brief/spec `new-york` (E10 ruling applied); log in 19.
2. 15 §4 says neutral and primary badges use `-subtle` pairs, but 15 §3.1 defines no `muted-subtle`/`primary-subtle` tokens. Used `bg-muted text-muted-foreground` and `bg-primary/10 text-primary` rather than editing the verbatim token file. Log in 19 (or add the tokens).
3. No scrim token exists; overlays use `bg-foreground/50 dark:bg-background/80`. Log in 19.
4. `native-select` is a 47th directory (calendar dependency); `input-otp` and `spinner` are kit extras. Test pins this exact set.
5. Shared `auth.user` permissions/abilities/roles still unshared until Task 20 (see above).
6. Trailer: commits use the attribution lines supplied by this session's system reminder (`Claude Sonnet 5.5`), not the `Claude Opus 5.5` text in the dispatch message / global-constraints (context.md allows "your own attribution lines if your system prompt provides them").
7. Mixed vintage: kit components are an older new-york-v4 snapshot, the 26 new ones are from the current registry HEAD (de1f76c). Regenerating the kit ones later is a pure copy if desired.
8. Browser/axe not run (not required here).
