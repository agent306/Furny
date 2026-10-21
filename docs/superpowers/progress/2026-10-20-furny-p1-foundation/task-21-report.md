# Task 21 report: layouts, app shell, public pages, PWA manifest, placeholder dashboards

Commit: `e0e61ab feat(ui): layouts, app shell, welcome/legal/error pages and PWA manifest` (base `ee46e7f`, one commit, no fix commit needed).
Status: DONE_WITH_CONCERNS (concerns are spec deviations and limits listed at the end; nothing is failing).

## What was implemented

### Frontend (Vue / TS)
- Layouts (`resources/js/layouts`): `CustomerLayout`, `AdminLayout`, `EditorLayout`, `AuthLayout` (prop `variant: 'default'|'wide'`, plus optional `title`/`description` for the kit auth pages, C16), and `resolveLayout.ts` (default layout per page name; `Legal/*` and `Error` follow the audience: staff, customer, or guest with a wide AuthLayout). `Welcome` declares `layout: [AuthLayout, { variant: 'wide' }]`.
- `components/app`: `AppShell`, `AppHeader` (customer and admin variants), `AppSidebar`, `MobileTabBar`, `UserMenu`, `NotificationBell`, `ThemeToggle`, plus small helpers `AppLogo`, `AppFooter`, `LegalDocument`, `ThemeMenuItems`.
- `components/common`: `OfflineBanner`, `SaveStatusIndicator`.
- `lib/customerNav.ts`, `lib/adminNav.ts` (+ `visibleNav` permission filter), `lib/flashToast.ts` (the flash bridge, replaces the kit's `router.on('flash')` helper), `composables/useRouteFocus.ts`, `composables/useInspectorWidth.ts`.
- Pages: `Welcome`, `Error`, `Legal/Terms`, `Legal/Privacy`, `Customer/Dashboard`, `Admin/Dashboard` (placeholders).
- `AppShell` (carries applied): provides `DENSITY_KEY` (customer and phone comfortable, admin >= 768 compact); mounts `ConfirmHost`, `TooltipProvider`, `Toaster` (bottom-right >= 768, top-center below, `richColors`, `closeButton`, 3 visible, translated close and container labels), `OfflineBanner`, skip link to `#main`, a polite route announcer. Flash is passed to vue-sonner as a plain string; once per visit (response flash object identity or an explicit `flash.id`). No `v-html` anywhere (source guard test).
- Focus after navigation: on an Inertia `navigate` to another page (component or path changed) focus moves to `#main h1` (given `tabindex=-1` if missing) else `#main`; reloads and query-only changes leave focus alone; the document title is announced.
- Kit removal: deleted `layouts/AppLayout.vue`, `layouts/app/**`, `layouts/auth/**`, `pages/Dashboard.vue`, kit `components/{AppContent,AppHeader,AppLogo,AppLogoIcon,AppShell,AppSidebar,AppSidebarHeader,Breadcrumbs,NavFooter,NavMain,NavUser,PlaceholderPattern,UserInfo,UserMenuContent}.vue`; `LEGACY_KIT_FILES` pruned. Kept (still imported by the kit auth pages until Tasks 25/26/31): `AlertError`, `InputError`, `PasswordInput`, `TextLink` and `pages/Auth/*`. The old Task 16 test that read the deleted `AuthSplitLayout.vue` was removed from `no-raw-palette.test.ts`.
- `app.ts`: layout resolver, title `{page title} · {app.name}` (no literal product name), progress colour `var(--primary)` with 250 ms delay, `initializeFlashToast` removed.
- Vendored ui through `t()`: `Spinner`, `Breadcrumb` (nav label), `BreadcrumbEllipsis`, `PaginationEllipsis`, `SidebarTrigger`, `SidebarRail`, `Sidebar` mobile sheet title and description, `CommandDialog` defaults. New keys under `a11y.*`, `common.loading` reused. A source guard test fails on bare `aria-label="…"`, `title="…"`, `sr-only` text or Sheet/Dialog title text in `components/ui`.
- Sidebar: the vendored `Sidebar` and `SidebarProvider` switch to the offcanvas sheet below 1024 px (15 §7.2: tablet and phone), upstream used 768.
- Icons registry gained: `folder, hourglass, layout-dashboard, loader-circle, lock, log-out, map-pin-off, menu, monitor, moon, refresh-cw, sun, user, wifi-off`.

### Backend
- Controllers: `WelcomeController` (guest -> `Welcome {canRegister}` from `auth.allow_customer_registration`; customer -> `customer.dashboard`; staff -> `admin.dashboard`), `LegalController` (`businessName`, `updatedOn = '2026-10-20'`), `ManifestController`, `Customer\DashboardController`, `Admin\DashboardController`.
- Routes: `welcome`, `legal.terms`, `legal.privacy`, `manifest` in `routes/web.php` (old `home`/`dashboard` routes removed); `routes/customer.php` (`customer.dashboard`, `/dashboard`) and `routes/admin.php` (`admin.dashboard`, `/admin`) registered through `withRouting(then:)` in `bootstrap/app.php` with the temporary `['web','auth']` groups for Task 23 to replace.
- Error pages: `App\Support\Http\ErrorPage` wired with `$exceptions->respond(...)`. Inertia `Error` for 403/404/419/429/503, and 500 only when `app.debug` is false. Props are `status` only; exception data never reaches props or markup. Keeps `Retry-After`, `Allow`, `X-RateLimit-*` headers. JSON/API requests are left alone. A URL that matches no route never enters the `web` group, so the shared props are added by hand (guest). If rendering the page throws, the original response is returned.
- Manifest: per request, `application/manifest+json`, `Cache-Control: public, max-age=3600`; `name` = business name, `short_name` = `mb_substr(app.name, 0, 12)`, `id/start_url/scope '/'`, `display standalone`, colours `#fbfaf7`, three icons (`purpose any/any/maskable`).
- `scripts/generate-icons.php` (GD, 4x supersampled) draws the walnut `#6b4a33` rounded-square set with a white house + panel glyph; outputs committed in `public/icons/` (`app-192`, `app-512`, `app-maskable-512`, `apple-touch-icon-180`, `notification-192`, `badge-72`). Old kit `public/apple-touch-icon.png` deleted. `app.blade.php` links the manifest, the new touch icon and `apple-mobile-web-app-capable`.
- Sidebar cookie carry: nothing on the server reads it any more (the admin shell's `SidebarProvider` reads and writes `sidebar_state` in the browser only), so `sidebar_state` was removed from `encryptCookies(except: …)` and the `sidebarOpen` shared prop and its type were dropped. A stray plain cookie of that name is simply discarded by the decryptor (tested).
- Task 20 minors: (a) `logoUrl()` pinned to `model_type` + `model_id` + `collection_name = logo` (`BusinessProfile::LOGO_COLLECTION`), test with another collection and another owner; (b) double-struck `𝟚𝟘` and monospace `𝟷𝟾𝟿` digit tests; (c) i18nBoot misleading title fixed and a default-wiring test added (real `sessionStorage`, stubbed `location`, plus a throwing `sessionStorage` getter); (d) manifest read memoised (static, `forgetManifest()`), test proves one file read across two requests; (e) soft-deleted orders excluded from `staffCounters` test (passed immediately: the soft-delete scope is applied by `toBase()`).
- Lang: `common`, `a11y`, `legal`, `errors`, `notifications`, `dashboard` per the brief, plus `auth_ui.welcome.*` and `roles.names.*`. `i18n:export` output regenerated and committed.
- `tests/Pest.php`: Feature tests now call `withoutVite()` (see concerns).

## Tests and results

| Suite | Command | Result |
|---|---|---|
| Vitest | `yarn vitest run` | 59 files, 1044 tests passed (baseline 891), no stderr noise |
| Pest Unit + Feature | `vendor/bin/pest --testsuite=Unit,Feature --parallel` | 1816 passed (7194 assertions) |
| Pest Browser | `PLAYWRIGHT_BROWSERS_PATH=…/scratchpad/pw-browsers vendor/bin/pest tests/Browser` after `yarn vite build` | 38 passed (37 new in `LayoutsTest` + the smoke test) |
| Gates-PHP | `pint --test`, `phpstan analyse` (level 8), Pest | all pass |
| Gates-JS | `yarn lint && yarn format:check && yarn typecheck && yarn vitest run` | all pass |
| Gates-Gen | `typescript:transform` (no diff), `i18n:export` (regenerated, committed) | clean |

New tests: `tests/Feature/Pages/{WelcomeTest,LegalPagesTest,ManifestTest,ErrorPageTest,DashboardsTest}.php`; additions to `SharedPropsTest`; `tests/Browser/LayoutsTest.php`; Vitest: `components/app/__tests__/{AppShell,NotificationBell,UserMenu}`, `components/common/__tests__/SaveStatusIndicator`, `components/ui/__tests__/vendoredLabels`, `layouts/__tests__/{AdminLayout,AuthLayout,CustomerLayout,EditorLayout,resolveLayout}`, `pages/__tests__/pages`, `lib/__tests__/{flashToast,nav}`, `composables/__tests__/useInspectorWidth`.

Browser coverage (LayoutsTest): no horizontal scroll at 375/820/1280 on welcome, customer dashboard, admin dashboard, terms, privacy, error page, login and register (the kit pages inside the new AuthLayout); exactly one h1 on six pages; skip link focus and target; tab bar shown at 375 and hidden at 820 with every tab >= 44 px; axe (serious and worse) clean on `/`, `/terms`, `/privacy`, `/admin`. A negative control (`assertSee` of absent text) failed as it should, and axe is confirmed present (`typeof window.axe === 'object'`). I looked at screenshots of welcome, customer (375) and admin (1280) pages.

### TDD evidence
- RED `vendor/bin/pest tests/Feature/Pages`: `49 failed, 3 passed` (routes and pages did not exist); GREEN after implementation: `52 passed`.
- RED `yarn vitest run resources/js/components/ui/__tests__/vendoredLabels.test.ts`: 7 of 9 failed (Spinner, Breadcrumb, ellipses, trigger/rail, CommandDialog, source guard); GREEN after routing the labels through `t()`: all pass (91 tests across `components/ui`).
- RED logo test: `Failed asserting that '/storage/1/other.png' is null`; GREEN after the constrained query.
- Memo test mutation check: with the memo disabled it fails with `Method get(...) should be called exactly 1 times but called 2 times`; restored, it passes.
- Soft-deleted counters test and the double-struck/monospace digit tests passed on first run (the behaviour already held). One expectation of mine was wrong (`𝟷𝟾𝟿` is 189, not 789) and was fixed in the test, not the code.

## Files changed
124 files (see `git show --stat e0e61ab`). Key paths: `resources/js/layouts/*`, `resources/js/components/app/*`, `resources/js/pages/{Welcome,Error}.vue`, `resources/js/pages/{Legal,Customer,Admin}/*`, `app/Http/Controllers/{Welcome,Legal,Manifest}Controller.php`, `app/Http/Controllers/{Customer,Admin}/DashboardController.php`, `app/Support/Http/ErrorPage.php`, `routes/{web,customer,admin}.php`, `bootstrap/app.php`, `resources/views/app.blade.php`, `scripts/generate-icons.php`, `public/icons/*`, `resources/lang/en/*`, `eslint.config.js`, `tests/**`.

## Self-review findings (fixed before committing)
- ThemeToggle and the header needed a `TooltipProvider` ancestor; `AppShell` supplies it (a test mounts the toggle inside one on purpose).
- `class` fallthrough on renderless components (`DropdownMenu`) warned: `ThemeToggle` is wrapped in a div instead.
- `SidebarMenuButton` with a tooltip replaces `data-slot` with `tooltip-trigger`; tests select `data-sidebar="menu-button"`.
- Tests that wiped `document.body` before auto-unmount caused `nextSibling` errors; they unmount instead.
- A guard test matched the word `v-html` in a comment of `flashToast.ts`; the comment was reworded.
- `useNow({interval})` does not exist in this VueUse; `SaveStatusIndicator` uses `useIntervalFn`.
- `phpstan` rejected `headers->all()` into `set()`; the header copy uses `get()`.

## Concerns, deviations and limits (for the controller; log in 19 where relevant)
1. **Welcome copy namespace.** 10 §4.1 names `welcome.tagline`, but `welcome` is not in the 15 §15.2 namespace list and the brief lists no `welcome.php`. The strings live in `auth_ui.welcome.*`.
2. **Offcanvas below 1024 px** needed edits to the vendored `Sidebar.vue` (`md:` -> `lg:`) and `SidebarProvider.vue` (`max-width: 1023px`). Upstream shadcn switches at 768.
3. **Account menu on phones.** 15 §7 shows no account control on phones (customer: bell only; admin: trigger, title, bell) but the tab bar has no Account tab until Task 34, so `UserMenu` stays visible at every width as the only logout. Hide it on phones when Task 34 adds the Account tab. The admin `ThemeToggle` is hidden on phones (theme lives in `UserMenu`).
4. **Not built (their dependencies do not exist yet):** `CreditBadge` (P5), `useUserChannel()` / live bell updates (P8), the admin top-bar order search (needs `admin.orders.index`), the customer `VerifyContactBanner` (Task 34 region; the `#banner` slot exists), the phone bottom `Drawer` for the editor inspector (05/07). The Customer nav and tab bar hold only the dashboard until later tasks append items.
5. **Staff counters.** `AppSidebar` requests `staffCounters` with a partial reload when a visible nav item has a `counter`; no current item does, so it is unexercised outside the AdminLayout test (which mocks a richer nav).
6. **Unmatched URLs render as a guest.** A 404 for a URL that matches no route never starts the session (no `web` group), so a signed-in user sees the guest wide layout; the shared props are still present. A 404 raised inside a route (policies, model binding) renders in the audience layout. A catch-all `Route::fallback` would fix it but needs a name that Task 23's route-name rules must allow, so it was not added.
7. **Flash replay on history navigation.** Flash is deduped per response object and by optional `flash.id`; Inertia restores the old props on Back, which can show that visit's toast again. The server does not send an id yet.
8. **Manifest route sits in the `web` group** (14 §2 `PUB web`), so the response carries the session cookie next to `Cache-Control: public`. Task 22 (cookie/header hardening) may want to drop session middleware for it.
9. **Test environment robustness.** The CI PHP job runs Pest with no `public/build`, and existing HTML-rendering tests (e.g. `AppearanceCookieTest`, 12 of 15 fail without a build) depend on one. `tests/Pest.php` now calls `withoutVite()` for the Feature suite so these tests (and the new page tests, whose components are missing from a stale build) do not need assets. Browser tests still use the real build (`yarn vite build` first).
10. `tests/Browser/Screenshots/` (capital S, what the plugin writes on failure) is not covered by the lowercase `/tests/Browser/screenshots` entry in `.gitignore`; I did not change it.
11. After Task 23 the staff login lands on Fortify's `home` (`/dashboard`, a customer route) and relies on Task 23's staff redirect.
12. `i18n-keys.test.ts` was extended: `tabLabelKey` is scanned and `roles.names.{role}` is checked against the generated `StaffRole` union. Dynamic keys I build (`errors.pages.{status}`, `common.save_status.{status}`) are covered by explicit tests.

---

# Fix round 1

Commits: `515cc00 fix(http): fallback 404 in the web group, stateless manifest, native Inertia flash` and `8604e4f fix(ui): route focus across layouts, live save status, persistent EditorLayout, native flash toasts`.

## Results
| Suite | Result |
|---|---|
| Vitest | 1069 passed (1044 before), no stderr output |
| Pest Unit + Feature (`--testsuite=Unit,Feature --parallel`) | 1821 passed |
| Pest Browser (after `yarn vite build`, PLAYWRIGHT_BROWSERS_PATH workaround) | 40 passed |
| Pint, PHPStan, `yarn lint`, `format:check`, `typecheck`, Gates-Gen (`typescript:transform`, `i18n:export`) | clean |

## Items
1. **Route focus across a layout change.** `useRouteFocus` now keeps the last page at module level (`resetRouteFocus()` for tests); the first shell of a load starts from its own page, a later shell inherits it. The announcement is emptied before it is set again, so an identical title is announced on consecutive navigations, and the timer is cleared on dispose (also guarded against the `nextTick` after dispose). Tests (AppShell): mount shell A, unmount, mount B, fire `navigate` -> focus reaches the h1 and the title is announced (mutating `last ??=` back to per-instance makes it fail); consecutive same title toggles through ''; `vi.getTimerCount()` is 0 after unmount. Browser: after clicking Terms, focus is on `#main h1` and the announcer starts with "Terms of service".
2. **SaveStatusIndicator.** The root is now an always-present `role="status" aria-live="polite"` span; the button or span sits inside it. Tests: unit (both forms, text change re-renders in the region) and through EditorLayout (`#topbar [aria-live="polite"] button[data-status=invalid]`, then status change updates the region).
3. **Fallback.** `Route::fallback(fn () => abort(404))->name('fallback')` in `routes/web.php` (the `web:` group). Test: signed-in customer and staff requesting unmatched URLs get 404, component `Error`, `auth.user` present with their type and name; guest gets `auth.user = null` with `app`, `business`, `i18n`. A 419 raised early in the group still gets the shared props through the hand-share fallback (tested).
4. **Stateless manifest.** `withoutMiddleware([EncryptCookies, AddQueuedCookiesToResponse, StartSession, ShareErrorsFromSession, PreventRequestForgery])` (Laravel 13's CSRF middleware also sets a cookie). Test: no `Set-Cookie` and no cookies, with or without a session cookie on the request.
5. **Native flash (Task 20 contract change).** The shared `flash` prop is removed from `HandleInertiaRequests` and `SharedPageProps` (and its Task 20 tests replaced). Controllers must now call `Inertia::flash('success'|'error'|'info'|'warning', trans_icu(...))`; Inertia sends it once as the top-level `flash` and the history never stores it. `FlashMessages` is now the `flashDataType` of `InertiaConfig`. Client: `AppShell` reads `page.flash` in `onMounted` and subscribes to Inertia's `flash` router event; the bridge still dedupes by flash object/`id`. Browser test: a flashed redirect shows the toast, then Terms and Back add no toast (MutationObserver count 0). **Real bug found by that test:** reading the flash in `setup` showed nothing because a toast created before the vue-sonner `Toaster` has mounted is lost (and the dedupe then swallowed the event); the read moved to `onMounted`. Server test: `Inertia::flash` appears as top-level `flash`, not in `props`, and is gone on the next request. Task 23 flows that planned `redirect()->with('error', ...)` (inactive, session expired, verify required) must use `Inertia::flash('error', ...)` instead.
6. **EditorLayout is persistent.** `resolveLayout` returns it for `EDITOR_PAGES` (`Customer/Plans/Edit`, `Customer/Imports/Review`, `Customer/Furniture/Edit`, `Admin/Plans/Edit`, `Admin/Furniture/Edit`, `Admin/Orders/ProposalItemEdit`, `Admin/Presets/Builder`) before the area prefixes. The page is the default slot and renders into `#canvas`; props and handlers (`title`, `backHref`, `readOnly`, `saveStatus`, `saveStatusCount`, `savedAt`, `inspectorOpen`, `onSaveStatusClick`, `onUpdate:inspectorOpen`) are layout props (`defineOptions({ layout: {...} })`, `setLayoutProps`); the other regions are mount points filled with `<Teleport defer to="#toolrail">` (`defer` is required, the regions are created in the same patch). Named slots remain for direct use. `AppShell` gained `offlineBanner` (default true); the editor passes false and renders `OfflineBanner` inside its `h-dvh` box. The title h1 carries `data-main-heading`, and `focusMainHeading` targets `#main h1, h1[data-main-heading]`. Tests: an editor page mounts exactly one AppShell, ConfirmHost and skip link; Teleports land in toolrail, inspector and topbar-end; layout props including the click handler work; a source guard fails if any page mentions `EditorLayout`; the offline banner is a single node inside the `h-dvh` box; focus goes to the topbar h1.
7. **Sidebar cookie.** Writing the round-trip test exposed that the vendored `SidebarProvider` reads the cookie only once, at module load (a `withDefaults` expression), so a remount after visiting another layout would ignore a newer `sidebar_state`. `AdminLayout` now passes `default-open` computed at mount. Tests: no cookie / `true` -> expanded, `false` -> collapsed, toggle writes the cookie and the next mount reads it, Ctrl+B writes it each way.
8. **Pagination and the guard.** `PaginationFirst`/`PaginationLast` use `common.pagination.first|last` for text and `aria-label` (tested with a made-up catalogue). The vendored-label guard now parses each template with `vue/compiler-sfc` and flags literal naming attributes and any text node with words (multi-line elements and nested text included); its non-vacuity test covers six offenders and two clean templates. It first failed on exactly First and Last.
9. **`report()`** in `ErrorPage::render`'s catch; test with `Exceptions::fake()` and a missing root view (`InvalidArgumentException` reported, original response returned).
10. **Carry for Task 23 (not done here):** add a test that a customer requesting `/admin` gets 403/404, and make the route-name rules accept the `fallback` route (name `fallback`, audience `public`; also `manifest`, `legal.*`, `welcome`).

## Notes
- Concern 5 of the first report (toast replay on Back) and concern 6 (unmatched URLs as guest) and concern 8 (manifest session cookie) are resolved by this round; concern 3 (UserMenu on phones) and the others stand.
- `routes/web.php` now imports five middleware classes for the manifest exclusion; Task 22 can move that into its stateless route group if it adds one.

---

# Fix round 2

Commit: see `git log` (`fix(ui): always render the editor regions; bare 404 for assets; 405 Error page`).

| Suite | Result |
|---|---|
| Vitest | 1078 passed (1069 before) |
| Pest Unit + Feature (serial) | 1833 passed |
| Pest Browser (after `yarn vite build`, PLAYWRIGHT_BROWSERS_PATH workaround) | 40 passed |
| Pint, PHPStan, lint, prettier, typecheck, Gates-Gen | clean |

## Important: EditorLayout Teleport targets at every breakpoint
Chosen design: **always render every region and only show or hide it** (`v-show`), instead of a provide/inject registry. A Teleport resolves its target once, so a target that came and went (the tablet Sheet content, `v-if` regions) never received the page's content or warned on phones; one persistent element per region also survives a resize across breakpoints, and pages keep plain `<Teleport defer to="#inspector">` markup instead of registering through a composable. The registry stays the fallback if a region ever needs per-breakpoint markup.
- `#toolrail` and `#topbar-end`: rendered always, `v-show="!isPhone"`.
- `#inspector`: one `aside` always rendered. Desktop: always shown, width from the resize handle (the handle itself is desktop only). Tablet: an absolute right panel (`absolute inset-y-0 right-0 z-20 w-80`) over the canvas, shown only while `inspector-open`, with a 44 px close button and Escape. Phone: hidden (view only). The vendored Sheet is no longer used by the layout.
- Tests: tablet starts closed, content is delivered into the closed panel, the same element becomes visible once opened (and `update:inspectorOpen(false)` is emitted by the close button and by Escape); phone: regions exist but are not visible, no handle, no `Teleport` console warning; desktop: no regression; every breakpoint renders the page into all three regions without Vue warnings; a breakpoint change keeps the same inspector element and its content. The old phone expectation "toolrail/inspector not rendered" became "rendered but hidden", per the ruling.

## Minor
1. **Missing assets and API paths.** `Route::any('{path}')` named `unmatched.plain`, registered last in `bootstrap/app.php`'s `then:` closure (so no later real route with a dot in its path is shadowed) and outside the `web` group: `build/*`, `api/*` and any path ending in an extension get a bare 404 (JSON `{message}` for `api/*`, text otherwise) with no session, no `Set-Cookie`, no Inertia page. Tests: `/build/assets/x.js`, `/build/missing`, `/some/where/missing.css`, `/favicon-gone.ico`, `/api/nope`, `/api/v1/deep/nope`; real routes and extension-less unknown URLs are unchanged. While doing this I found my fallback route from round 1 was a closure, which would break `route:cache`/`optimize`; the fallback and the plain route now use invokable controllers (`NotFoundController`, `PlainNotFoundController`), and a test fails on any closure action defined outside vendor/tests.
2. **405.** Added to `ErrorPage`'s handled statuses, to the `Error.vue` status union (icon `lock`, no Reload) and `errors.pages.405` ("That action isn't available here."). Test: a signed-in POST to an unmatched URL renders component `Error`, status 405, with the shared props. The router raises 405 before the `web` group runs, so that page is rendered with guest-level auth props in a real request (no session yet); only GET 404s are in the user's layout. A catch-all for write methods would remove the 405 for existing GET-only URLs too, so it was not added.
3. **Flash across a layout swap.** `layouts/__tests__/flashAcrossLayouts.test.ts` mounts the real `AuthLayout`, unmounts it, mounts `CustomerLayout` with a flash on the page and then fires Inertia's `flash` event: exactly one toast; the reverse order (event first) also gives one; the next page without a flash adds none.

## For spec 19
- Specs 14 and 15 (§8 shared props, §10.3 toasts) still describe a shared `flash` prop; it is now Inertia v3's top-level page flash (`Inertia::flash`).
- New route names to allow in the route-name rules (Task 23): `fallback`, `unmatched.plain` (audience `public`).
- `EditorLayout` is persistent and its regions are Teleport targets (15 §7.3 says "slots").

---

# Fix round 3

Tablet inspector panel focus (`EditorLayout.vue`):
- **Focus in:** when the tablet panel opens, the previously focused element is remembered and focus moves to the close button.
- **Escape:** a window `keydown` listener is added only while the tablet panel is open (also when it is mounted open) and removed on close and on dispose. It closes the panel on Escape wherever focus is, and ignores an event that is already `defaultPrevented` (an inner popover's Escape).
- **Focus out:** on close (Escape or the button) focus returns to the remembered element if it is still connected.
- The aside's own `@keydown.esc` is gone. The close button is labelled `a11y.inspector_close` ("Close inspector"). The stale test is renamed ("renders the title as the page's one h1 …").
- Tests (6 new): opening moves focus to the close button; Escape with focus on the toggle closes the panel and leaves focus on the toggle; focus returns to the toggle after Escape inside and after the close button; Escape with `preventDefault` from an inner element leaves the panel open (removing the `defaultPrevented` check makes it fail); the listener is inactive while closed and after unmount; desktop is unaffected.

Results: Vitest 1084 passed, Browser 40 passed (after `yarn vite build`, workaround), lint, prettier, typecheck, Pint and Gates-Gen (`i18n:export` regenerated and committed, `typescript:transform` no diff) clean. No PHP changed this round.
