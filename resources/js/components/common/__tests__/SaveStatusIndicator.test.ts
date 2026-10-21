import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
    };
});

import SaveStatusIndicator from '@/components/common/SaveStatusIndicator.vue';
import en from '@/lang/generated/en.json';
import { resetPage } from '@/test/inertiaPage';
import type { SaveStatus } from '@/types/ui';

const STATUSES: SaveStatus[] = [
    'saved',
    'saving',
    'dirty',
    'offline',
    'error',
    'conflict',
    'invalid',
];

beforeEach(() => resetPage({ business: { locale: 'en-IN' } }));

describe('SaveStatusIndicator (15 §9.31)', () => {
    it('has a translation for every status', () => {
        for (const status of STATUSES) {
            expect(en, status).toHaveProperty(`common.save_status.${status}`);
        }
    });

    it.each([
        ['saved', 'Saved'],
        ['saving', 'Saving…'],
        ['dirty', 'Unsaved changes'],
        ['offline', 'Offline — changes kept on this device'],
        ['error', "Couldn't save"],
        ['conflict', 'Conflict'],
    ] as const)('renders %s as %s', (status, text) => {
        expect(mount(SaveStatusIndicator, { props: { status } }).text()).toBe(
            text,
        );
    });

    it('shows how long ago it saved', () => {
        const savedAt = new Date(Date.now() - 2 * 60_000).toISOString();
        const wrapper = mount(SaveStatusIndicator, {
            props: { status: 'saved', savedAt },
        });

        expect(wrapper.text()).toMatch(/^Saved · 2 min(utes?)? ago$/);
    });

    it('pluralises the problems of the invalid status', () => {
        const one = mount(SaveStatusIndicator, {
            props: { status: 'invalid', count: 1 },
        });
        const many = mount(SaveStatusIndicator, {
            props: { status: 'invalid', count: 3 },
        });

        expect(one.text()).toBe('Fix 1 problem to save');
        expect(many.text()).toBe('Fix 3 problems to save');
    });

    it('is always inside one polite status region, a plain span without a click handler', () => {
        const wrapper = mount(SaveStatusIndicator, {
            props: { status: 'saving' },
        });
        const region = wrapper.get('[data-test="save-status-region"]');
        const inner = region.get('[data-status]');

        expect(wrapper.element).toBe(region.element);
        expect(region.attributes('role')).toBe('status');
        expect(region.attributes('aria-live')).toBe('polite');
        expect(inner.element.tagName).toBe('SPAN');
        expect(inner.find('svg').attributes('aria-hidden')).toBe('true');
        expect(inner.find('svg').classes()).toContain('animate-spin');
    });

    it('is a button with a destructive tone inside the same live region when it has a click handler', async () => {
        const onClick = vi.fn();
        const wrapper = mount(SaveStatusIndicator, {
            props: { status: 'invalid', count: 2, onClick },
        });
        const button = wrapper.get('[data-status="invalid"]');

        expect(wrapper.attributes('aria-live')).toBe('polite');
        expect(wrapper.attributes('role')).toBe('status');
        expect(button.element.parentElement).toBe(wrapper.element);
        expect(button.element.tagName).toBe('BUTTON');
        expect(button.attributes('type')).toBe('button');
        expect(button.classes()).toContain('bg-danger-subtle');
        expect(button.classes()).toContain('min-h-11');
        expect(button.attributes('aria-live')).toBeUndefined();

        await button.trigger('click');

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('re-renders the text inside the live region when the status changes', async () => {
        const wrapper = mount(SaveStatusIndicator, {
            props: { status: 'saving' },
        });

        await wrapper.setProps({ status: 'saved' });

        expect(wrapper.get('[aria-live="polite"]').text()).toBe('Saved');
    });
});
