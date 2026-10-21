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

    it('is a polite status region without a click handler', () => {
        const wrapper = mount(SaveStatusIndicator, {
            props: { status: 'saving' },
        });

        expect(wrapper.element.tagName).toBe('SPAN');
        expect(wrapper.attributes('role')).toBe('status');
        expect(wrapper.attributes('aria-live')).toBe('polite');
        expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
        expect(wrapper.find('svg').classes()).toContain('animate-spin');
    });

    it('is a button with a destructive tone when it has a click handler', async () => {
        const onClick = vi.fn();
        const wrapper = mount(SaveStatusIndicator, {
            props: { status: 'invalid', count: 2, onClick },
        });

        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.attributes('type')).toBe('button');
        expect(wrapper.classes()).toContain('bg-danger-subtle');
        expect(wrapper.classes()).toContain('min-h-11');

        await wrapper.trigger('click');

        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
