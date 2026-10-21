<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import AppShell from '@/components/app/AppShell.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import SaveStatusIndicator from '@/components/common/SaveStatusIndicator.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useBreakpoint } from '@/composables/useBreakpoint';
import {
    INSPECTOR_MAX,
    INSPECTOR_MIN,
    useInspectorWidth,
} from '@/composables/useInspectorWidth';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';
import type { SaveStatus } from '@/types/ui';

// 15 §7.3: a full-viewport shell with regions only; the plan editor, import
// review, furniture builder and proposal builder fill them (05/07). Like every
// layout it is persistent (`resolveLayout` picks it for the editor pages), so
// there is one AppShell, Toaster and ConfirmHost and pages never wrap
// themselves in it.
//
// - The page is the default slot and renders into `#canvas`.
// - `title`, `backHref`, `readOnly`, `saveStatus`, `saveStatusCount`,
//   `savedAt` and `inspectorOpen` are layout props: a page sets them with
//   `defineOptions({ layout: { ... } })` and updates them with
//   `setLayoutProps()`. The handlers are props too (`onSaveStatusClick`,
//   `onUpdate:inspectorOpen`).
// - The other regions are mount points a page fills with
//   `<Teleport defer to="#toolrail">` (also `#topbar-start`, `#topbar-center`,
//   `#topbar-end`, `#banner`, `#inspector`, `#statusbar`). `defer` is needed:
//   the page mounts in the same patch that creates the regions. The named
//   slots remain for direct use.
//
//   desktop  toolrail + canvas + resizable inspector
//   tablet   toolrail + canvas; the inspector is a right Sheet (`inspector-open`)
//   phone    view only: no toolrail, no inspector; back, title and the centre slot remain
withDefaults(
    defineProps<{
        title: string;
        backHref: string;
        readOnly?: boolean;
        saveStatus?: SaveStatus;
        saveStatusCount?: number;
        /** ISO instant of the last save, for "Saved · 2 min ago". */
        savedAt?: string;
    }>(),
    {
        readOnly: false,
        saveStatus: undefined,
        saveStatusCount: undefined,
        savedAt: undefined,
    },
);

const emit = defineEmits<{
    'save-status-click': [];
}>();

const inspectorOpen = defineModel<boolean>('inspectorOpen', { default: false });

const { t } = useI18n();
const { isPhone, isDesktop } = useBreakpoint();
const { width, setWidth } = useInspectorWidth();

function startResize(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;

    target.setPointerCapture(event.pointerId);

    const onMove = (move: PointerEvent): void => {
        // The inspector hugs the right edge, so its width is the distance to it.
        setWidth(window.innerWidth - move.clientX);
    };
    const stop = (): void => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', stop);
        target.removeEventListener('pointercancel', stop);
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
}

function onResizeKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setWidth(width.value + step);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setWidth(width.value - step);
    }
}
</script>

<template>
    <AppShell variant="customer" :offline-banner="false">
        <div class="flex h-dvh flex-col overflow-hidden bg-background">
            <!-- Inside the box: going offline must not push the editor out of the viewport. -->
            <OfflineBanner class="shrink-0" />

            <header
                id="topbar"
                class="flex h-12 shrink-0 items-center gap-2 border-b px-2"
            >
                <div id="topbar-start" class="flex min-w-0 items-center gap-1">
                    <Button
                        as-child
                        variant="ghost"
                        size="icon-lg"
                        class="lg:size-9"
                    >
                        <Link
                            :href="backHref"
                            :aria-label="t('common.actions.back')"
                            :title="t('common.actions.back')"
                        >
                            <component
                                :is="ICONS['arrow-left']"
                                aria-hidden="true"
                            />
                        </Link>
                    </Button>
                    <h1
                        data-main-heading
                        tabindex="-1"
                        class="truncate text-sm font-semibold outline-none"
                    >
                        {{ title }}
                    </h1>
                    <Badge
                        v-if="readOnly"
                        variant="neutral"
                        data-test="read-only"
                        >{{ t('common.read_only') }}</Badge
                    >
                    <SaveStatusIndicator
                        v-if="saveStatus"
                        :status="saveStatus"
                        :count="saveStatusCount"
                        :saved-at="savedAt"
                        :on-click="() => emit('save-status-click')"
                    />
                    <slot name="topbar-start" />
                </div>
                <div id="topbar-center" class="mx-auto flex items-center gap-1">
                    <slot name="topbar-center" />
                </div>
                <div
                    v-if="!isPhone"
                    id="topbar-end"
                    class="flex items-center gap-1"
                >
                    <slot name="topbar-end" />
                </div>
            </header>

            <div v-if="$slots.banner" id="banner" class="shrink-0 border-b">
                <slot name="banner" />
            </div>

            <main
                id="main"
                tabindex="-1"
                class="flex min-h-0 flex-1 outline-none"
            >
                <aside
                    v-if="!isPhone"
                    id="toolrail"
                    :aria-label="t('a11y.tools')"
                    class="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r py-2"
                >
                    <slot name="toolrail" />
                </aside>

                <div id="canvas" class="relative min-w-0 flex-1">
                    <slot name="canvas">
                        <slot />
                    </slot>
                </div>

                <template v-if="isDesktop">
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        tabindex="0"
                        :aria-label="t('a11y.inspector_resize')"
                        :aria-valuenow="width"
                        :aria-valuemin="INSPECTOR_MIN"
                        :aria-valuemax="INSPECTOR_MAX"
                        data-test="inspector-handle"
                        class="w-1 shrink-0 cursor-col-resize touch-none bg-border hover:bg-ring focus-visible:bg-ring focus-visible:outline-none"
                        @pointerdown.prevent="startResize"
                        @keydown="onResizeKey"
                    />
                    <aside
                        id="inspector"
                        :aria-label="t('a11y.inspector')"
                        :style="{ width: `${width}px` }"
                        class="shrink-0 overflow-y-auto"
                    >
                        <slot name="inspector" />
                    </aside>
                </template>
            </main>

            <!-- Tablet: the inspector is a non-modal right sheet. -->
            <Sheet
                v-if="!isPhone && !isDesktop"
                v-model:open="inspectorOpen"
                :modal="false"
            >
                <SheetContent id="inspector" side="right" class="w-80">
                    <SheetHeader class="sr-only">
                        <SheetTitle>{{ t('a11y.inspector') }}</SheetTitle>
                        <SheetDescription>{{
                            t('a11y.inspector')
                        }}</SheetDescription>
                    </SheetHeader>
                    <slot name="inspector" />
                </SheetContent>
            </Sheet>

            <footer
                id="statusbar"
                class="flex h-7 shrink-0 items-center gap-2 border-t px-2 text-xs text-muted-foreground"
            >
                <slot name="statusbar" />
            </footer>
        </div>
    </AppShell>
</template>
