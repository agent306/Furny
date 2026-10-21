import { flushPromises, mount } from '@vue/test-utils';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'vue/compiler-sfc';
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
// It parses each template (not line by line), so multi-line elements and text
// nodes are seen. Flagged: a literal string in a naming attribute, and any
// text node with words that is not an interpolation.
const UI_ROOT = 'resources/js/components/ui';
const NAMING_ATTRIBUTES = new Set([
    'aria-label',
    'aria-description',
    'aria-roledescription',
    'title',
    'alt',
    'placeholder',
    'label',
]);
const WORDS = /[A-Za-z]{2,}/;
const ELEMENT = 1;
const TEXT = 2;
const ATTRIBUTE = 6;

type Node = {
    type: number;
    tag?: string;
    content?: string;
    props?: { type: number; name: string; value?: { content: string } }[];
    children?: Node[];
    loc: { start: { line: number } };
};

function bareLabels(files: Record<string, string>): string[] {
    const found: string[] = [];

    function walk(file: string, node: Node): void {
        if (node.type === ELEMENT) {
            for (const prop of node.props ?? []) {
                const value = prop.value?.content ?? '';

                if (prop.type === ATTRIBUTE && NAMING_ATTRIBUTES.has(prop.name) && WORDS.test(value)) {
                    found.push(`${file}:${prop.name}="${value}"`);
                }
            }
        } else if (node.type === TEXT && WORDS.test(node.content ?? '')) {
            found.push(`${file}:${node.loc.start.line}: text "${(node.content ?? '').trim()}"`);
        }

        for (const child of node.children ?? []) {
            walk(file, child);
        }
    }

    for (const [file, source] of Object.entries(files)) {
        const { descriptor } = parse(source, { filename: file });
        const ast = descriptor.template?.ast as Node | undefined;

        for (const child of ast?.children ?? []) {
            walk(file, child);
        }
    }

    return found;
}

describe('vendored ui components', () => {
    it('contain no bare English label or text in a template', () => {
        const files = Object.fromEntries(
            (readdirSync(UI_ROOT, { recursive: true }) as string[])
                .filter((file) => file.endsWith('.vue'))
                .map((file) => [file, readFileSync(`${UI_ROOT}/${file}`, 'utf8')]),
        );

        expect(Object.keys(files).length).toBeGreaterThan(100);
        expect(bareLabels(files)).toEqual([]);
    });

    it('the guard is not vacuous: it sees multi-line and nested bare text', () => {
        const offenders = bareLabels({
            'A.vue': '<template><span class="sr-only">Close</span></template>',
            'B.vue': '<template><nav\n  aria-label="breadcrumb"\n  :class="x"\n/></template>',
            'C.vue': '<template><SheetTitle>Sidebar</SheetTitle></template>',
            'D.vue': '<template><span class="sr-only">\n  More pages\n</span></template>',
            'E.vue': '<template><div><p><b>Deep text</b></p></div></template>',
            'F.vue': '<template><span class="hidden sm:block">First</span></template>',
        });
        const clean = bareLabels({
            'G.vue': '<template><span class="sr-only">{{ t("a11y.more") }}</span><nav :aria-label="t(\'a\')" /></template>',
            'H.vue': '<template><span aria-hidden="true">…</span><slot /></template>',
        });

        expect(offenders).toHaveLength(6);
        expect(clean).toEqual([]);
    });
});
