### Task 17: shadcn-vue components and UI composables

**Files:**
- Create: `resources/js/components/ui/**` (46 components: `accordion alert alert-dialog aspect-ratio avatar badge breadcrumb button calendar card checkbox collapsible combobox command context-menu dialog drawer dropdown-menu hover-card input label navigation-menu number-field pagination pin-input popover progress radio-group range-calendar resizable scroll-area select separator sheet sidebar skeleton slider sonner switch table tabs tags-input textarea toggle toggle-group tooltip`), `resources/js/lib/utils.ts`, `resources/js/lib/icons.ts`, `resources/js/composables/{useControlSize,useBreakpoint,usePermissions}.ts`
- Modify: `components.json` (style `new-york`, baseColor `stone`, cssVariables `true`, aliases `@/components`, `@/lib/utils`), `components/ui/button/index.ts`, `components/ui/badge/index.ts`
- Test: `resources/js/components/ui/__tests__/variants.test.ts`, `resources/js/composables/__tests__/{useBreakpoint,usePermissions,useControlSize}.test.ts`, `resources/js/lib/__tests__/icons.test.ts`

**Spec refs:** `15 §4`, `§3.3` (control heights, density), `§6`, `§8` (`usePermissions`), `§13` (icons registry)

**Interfaces:**
- Consumes: Task 16 tokens.
- Produces: `buttonVariants` with variants `default, secondary, outline, ghost, link, destructive, success, warning` and sizes `sm, default, lg, icon, icon-lg`; `badgeVariants` with `default, secondary, outline, destructive, neutral, info, success, warning, danger, primary`; `cn()`; `ICONS` registry + `type IconName` (named lucide imports only); `useControlSize(): ComputedRef<'lg' | 'default'>` (injects `density`), `useBreakpoint(): { isPhone, isTablet, isDesktop, canEdit }` (`@vueuse/core` `breakpointsTailwind`; phone < 768, tablet 768–1023, desktop ≥ 1024), `usePermissions(): { can(nameOrGate: string): boolean; canAny(...names: string[]): boolean; isStaff: boolean; hasRole(role: string): boolean }` (reads `auth.user.permissions ∪ auth.user.abilities`).

- [ ] **Step 1: Write the failing tests** — `buttonVariants({ variant: 'success' })` contains `bg-success` and `text-success-foreground`; `buttonVariants({ size: 'icon-lg' })` contains `size-11`; `badgeVariants({ variant: 'info' })` contains `bg-info-subtle` and `text-info-subtle-foreground`; all 46 component directories exist; `useBreakpoint` with mocked width 375 → `isPhone true, canEdit false`, 820 → `isTablet true, canEdit true`, 1280 → `isDesktop true`; `usePermissions` with `permissions: ['orders.view']`, `abilities: ['settings.manage_restricted']` → `can('orders.view')`, `can('settings.manage_restricted')` true, `can('catalog.manage')` false, `canAny('catalog.manage','orders.view')` true, `isStaff` from `type`; `useControlSize` → `'lg'` under `provide('density','comfortable')`, `'default'` under `compact`; `icons.test.ts` asserts no `import * as` from `@lucide/vue` anywhere in `resources/js`.
- [ ] **Step 2: Run, expect FAIL** — `yarn vitest run resources/js/components/ui resources/js/composables resources/js/lib`
- [ ] **Step 3: Implement** — `yarn dlx shadcn-vue@latest add <names…>`; if the registry is unreachable through the proxy, clone `https://github.com/unovue/shadcn-vue` (depth 1) and copy the `new-york` registry sources of the same components. Replace any raw palette class in generated files with semantic tokens.
- [ ] **Step 4: Run tests, expect PASS** — same as Step 2.
- [ ] **Step 5: Quality gates** — Gates-JS.
- [ ] **Step 6: Commit** — `git add components.json resources/js/components/ui resources/js/lib resources/js/composables package.json yarn.lock` → `feat(ui): shadcn-vue component set with tone variants and UI composables` + trailer.

