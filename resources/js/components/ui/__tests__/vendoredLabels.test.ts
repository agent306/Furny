import { flushPromises, mount } from '@vue/test-utils';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, provide } from 'vue';
import { Breadcrumb, BreadcrumbEllipsis } from '@/components/ui/breadcrumb';
import { CommandDialog } from '@/components/ui/command';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
} from '@/components/ui/pagination';
import {
    Sidebar,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
} from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { createI18n, I18N_KEY } from '@/lib/i18n';

// Every label the vendored components add on their own goes through t() (15 §15,
// §14 item 9). A made-up catalogue proves the lookup, not the English.
const translated = createI18n({
    locale: 'xx',
    messages: {
        'common.loading': 'Laedt',
        'common.actions.close': 'Schliessen',
        'a11y.breadcrumb': 'Brotkrumen',
        'a11y.more': 'Mehr',
        'a11y.more_pages': 'Weitere Seiten',
        'a11y.toggle_sidebar': 'Seitenleiste umschalten',
        'a11y.sidebar': 'Seitenleiste',
        'a11y.sidebar_description': 'Zeigt die mobile Seitenleiste.',
        'a11y.command_palette': 'Befehlspalette',
        'a11y.command_palette_description': 'Befehl suchen',
    },
});

function mountTranslated(child: () => ReturnType<typeof h>) {
    return mount(
        defineComponent({
            setup() {
                provide(I18N_KEY, translated);
            },
            render: child,
        }),
        { attachTo: document.body },
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe('vendored labels use t()', () => {
    it('Spinner is a status named Loading', () => {
        const wrapper = mountTranslated(() => h(Spinner));

        expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe(
            'Laedt',
        );
    });

    it('Breadcrumb names its landmark', () => {
        const wrapper = mountTranslated(() => h(Breadcrumb));

        expect(wrapper.get('nav').attributes('aria-label')).toBe('Brotkrumen');
    });

    it('BreadcrumbEllipsis has a screen-reader label', () => {
        const wrapper = mountTranslated(() => h(BreadcrumbEllipsis));

        expect(wrapper.get('.sr-only').text()).toBe('Mehr');
    });

    it('PaginationEllipsis has a screen-reader label', () => {
        const wrapper = mountTranslated(() =>
            h(Pagination, { total: 200, itemsPerPage: 10, page: 5 }, () =>
                h(PaginationContent, null, () => h(PaginationEllipsis, { index: 1 })),
            ),
        );

        expect(wrapper.get('[data-slot="pagination-ellipsis"] .sr-only').text()).toBe(
            'Weitere Seiten',
        );
    });

    it('SidebarTrigger and SidebarRail are named', () => {
        const wrapper = mountTranslated(() =>
            h(SidebarProvider, null, () => [h(SidebarTrigger), h(SidebarRail)]),
        );

        expect(wrapper.get('[data-slot="sidebar-trigger"] .sr-only').text()).toBe(
            'Seitenleiste umschalten',
        );

        const rail = wrapper.get('[data-slot="sidebar-rail"]');

        expect(rail.attributes('aria-label')).toBe('Seitenleiste umschalten');
        expect(rail.attributes('title')).toBe('Seitenleiste umschalten');
    });

    it('the mobile Sidebar sheet is titled and described', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({
            matches: true,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
        }));

        const wrapper = mountTranslated(() =>
            h(SidebarProvider, null, () => [h(SidebarTrigger), h(Sidebar)]),
        );

        await wrapper.get('[data-slot="sidebar-trigger"]').trigger('click');
        await flushPromises();

        expect(document.body.textContent).toContain('Seitenleiste');
        expect(document.body.textContent).toContain('Zeigt die mobile Seitenleiste.');
    });

    it('CommandDialog defaults its hidden title and description to the catalogue', async () => {
        mountTranslated(() => h(CommandDialog, { open: true }));
        await new Promise((resolve) => setTimeout(resolve));

        expect(document.body.textContent).toContain('Befehlspalette');
        expect(document.body.textContent).toContain('Befehl suchen');
    });
});

// A source guard so the next vendored component cannot bring bare English back.
const UI_ROOT = 'resources/js/components/ui';
const BARE_LABELS = [
    /\saria-label="[A-Za-z]/,
    /\stitle="[A-Za-z]/,
    /class="sr-only">\s*[A-Za-z]/,
    /<(?:SheetTitle|SheetDescription|DialogTitle|DialogDescription)>\s*[A-Za-z]/,
];

function bareLabels(files: Record<string, string>): string[] {
    return Object.entries(files).flatMap(([file, source]) =>
        source
            .split('\n')
            .map((line, index) => ({ line, number: index + 1 }))
            .filter(({ line }) => BARE_LABELS.some((pattern) => pattern.test(line)))
            .map(({ line, number }) => `${file}:${number}: ${line.trim()}`),
    );
}

describe('vendored ui components', () => {
    it('contain no bare English label in a template', () => {
        const files = Object.fromEntries(
            (readdirSync(UI_ROOT, { recursive: true }) as string[])
                .filter((file) => file.endsWith('.vue'))
                .map((file) => [file, readFileSync(`${UI_ROOT}/${file}`, 'utf8')]),
        );

        expect(Object.keys(files).length).toBeGreaterThan(100);
        expect(bareLabels(files)).toEqual([]);
    });

    it('the guard is not vacuous', () => {
        expect(
            bareLabels({
                'A.vue': '<span class="sr-only">Close</span>',
                'B.vue': '<nav aria-label="breadcrumb">',
                'C.vue': '<SheetTitle>Sidebar</SheetTitle>',
                'D.vue': '<span class="sr-only">{{ t("a11y.more") }}</span>',
            }),
        ).toHaveLength(3);
    });
});
