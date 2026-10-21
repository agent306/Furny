import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, provide } from 'vue';
import type { Component, VNodeChild } from 'vue';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogScrollContent,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Pagination,
    PaginationContent,
    PaginationFirst,
    PaginationLast,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from '@/components/ui/sheet';
import { createI18n, I18N_KEY } from '@/lib/i18n';
import type { I18n } from '@/lib/i18n';

// The overlays' close buttons are labelled through t('common.actions.close'),
// never a literal. A made-up translation proves the lookup, not the English.
const translated = createI18n({
    locale: 'xx',
    messages: { 'common.actions.close': 'Schliessen' },
});

afterEach(() => {
    document.body.innerHTML = '';
});

async function openOverlay(
    root: Component,
    content: Component,
    title: Component,
    description: Component,
    extra: () => VNodeChild = () => null,
    catalogue: I18n | null = translated,
): Promise<void> {
    mount(
        defineComponent({
            // A component-level provide overrides the app's catalogue.
            setup() {
                if (catalogue !== null) {
                    provide(I18N_KEY, catalogue);
                }
            },
            render: () =>
                h(root, { open: true }, () =>
                    h(content, null, () => [
                        h(title, () => 'Title'),
                        h(description, () => 'Description'),
                        extra(),
                    ]),
                ),
        }),
        { attachTo: document.body },
    );

    // The portal mounts on the next tick.
    await flushPromises();
}

describe('overlay close labels use t()', () => {
    it('DialogContent', async () => {
        await openOverlay(
            Dialog,
            DialogContent,
            DialogTitle,
            DialogDescription,
        );

        expect(
            document.body.querySelector('[data-slot="dialog-close"]')
                ?.textContent,
        ).toBe('Schliessen');
    });

    it('DialogScrollContent', async () => {
        await openOverlay(
            Dialog,
            DialogScrollContent,
            DialogTitle,
            DialogDescription,
        );

        expect(document.body.querySelector('.sr-only')?.textContent).toBe(
            'Schliessen',
        );
    });

    it('SheetContent', async () => {
        await openOverlay(Sheet, SheetContent, SheetTitle, SheetDescription);

        expect(document.body.querySelector('.sr-only')?.textContent).toBe(
            'Schliessen',
        );
    });

    it('DialogFooter showCloseButton', async () => {
        await openOverlay(
            Dialog,
            defineComponent({
                render: () =>
                    h(DialogContent, { showCloseButton: false }, () => [
                        h(DialogTitle, () => 'Title'),
                        h(DialogDescription, () => 'Description'),
                        h(DialogFooter, { showCloseButton: true }),
                    ]),
            }),
            DialogTitle,
            DialogDescription,
        );

        expect(
            document.body.querySelector('[data-slot="dialog-footer"]')
                ?.textContent,
        ).toBe('Schliessen');
    });

    it('English comes from the real catalogue', async () => {
        await openOverlay(
            Dialog,
            DialogContent,
            DialogTitle,
            DialogDescription,
            () => null,
            null,
        );

        expect(
            document.body.querySelector('[data-slot="dialog-close"]')
                ?.textContent,
        ).toBe('Close');
    });
});

describe('pagination labels use t()', () => {
    function mountPagination(catalogue: I18n | null) {
        return mount(
            defineComponent({
                setup() {
                    if (catalogue !== null) {
                        provide(I18N_KEY, catalogue);
                    }
                },
                render: () =>
                    h(Pagination, { total: 50, itemsPerPage: 10, page: 2 }, () =>
                        h(PaginationContent, null, () => [
                            h(PaginationFirst),
                            h(PaginationPrevious),
                            h(PaginationNext),
                            h(PaginationLast),
                        ]),
                    ),
            }),
        );
    }

    it('Previous and Next come from the catalogue, as visible text and name', () => {
        const wrapper = mountPagination(
            createI18n({
                locale: 'xx',
                messages: {
                    'common.pagination.first': 'Erste',
                    'common.pagination.last': 'Letzte',
                    'common.pagination.previous': 'Zurueck',
                    'common.pagination.next': 'Weiter',
                },
            }),
        );
        const previous = wrapper.get('[data-slot="pagination-previous"]');
        const next = wrapper.get('[data-slot="pagination-next"]');

        expect(previous.text()).toBe('Zurueck');
        expect(next.text()).toBe('Weiter');
        // The text is hidden below sm, so the button needs its own name.
        expect(previous.attributes('aria-label')).toBe('Zurueck');
        const first = wrapper.get('[data-slot="pagination-first"]');
        const last = wrapper.get('[data-slot="pagination-last"]');

        expect(first.text()).toBe('Erste');
        expect(last.text()).toBe('Letzte');
        expect(first.attributes('aria-label')).toBe('Erste');
        expect(last.attributes('aria-label')).toBe('Letzte');
        expect(next.attributes('aria-label')).toBe('Weiter');
    });

    it('English comes from the real catalogue', () => {
        const wrapper = mountPagination(null);

        expect(wrapper.get('[data-slot="pagination-previous"]').text()).toBe(
            'Previous',
        );
        expect(wrapper.get('[data-slot="pagination-next"]').text()).toBe('Next');
    });
});
