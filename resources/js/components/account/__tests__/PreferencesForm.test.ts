import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const actual = await importOriginal<typeof import('@inertiajs/vue3')>();

    return {
        ...actual,
        usePage: () => testPage,
    };
});

import PreferencesForm from '@/components/account/PreferencesForm.vue';
import { router } from '@inertiajs/vue3';
import { resetPage } from '@/test/inertiaPage';

enableAutoUnmount(afterEach);

const visit = vi.spyOn(router, 'visit').mockImplementation(() => undefined);

beforeEach(() => {
    resetPage();
    visit.mockClear();
    localStorage.clear();
});

function form(props: Record<string, unknown> = {}) {
    return mount(PreferencesForm, {
        props: {
            audience: 'customer',
            unitSystem: 'metric',
            lengthUnit: 'cm',
            timezone: 'Asia/Kolkata',
            timezones: ['Asia/Kolkata', 'Europe/London', 'UTC'],
            ...props,
        },
        attachTo: document.body,
    });
}

function lengthUnit(wrapper: ReturnType<typeof form>): string {
    return (
        wrapper.get('[data-test="length-unit"]').element as HTMLSelectElement
    ).value;
}

function options(wrapper: ReturnType<typeof form>): string[] {
    return wrapper
        .findAll('[data-test="length-unit"] option')
        .map((option) => option.attributes('value') ?? '');
}

describe('PreferencesForm (10 §13.4)', () => {
    it('starts from what the user has, with the units of their system', () => {
        const wrapper = form();

        expect(lengthUnit(wrapper)).toBe('cm');
        expect(options(wrapper)).toEqual(['mm', 'cm', 'm']);
        expect(wrapper.find('[data-slot="sticky-action-bar"]').exists()).toBe(
            false,
        );
    });

    it('resets the length unit to ftin when switching to imperial', async () => {
        const wrapper = form();

        await wrapper.get('[data-test="system-imperial"]').trigger('click');
        await flushPromises();

        expect(lengthUnit(wrapper)).toBe('ftin');
        expect(options(wrapper)).toEqual(['ftin', 'in']);
    });

    it('resets the length unit to mm when switching to metric', async () => {
        const wrapper = form({ unitSystem: 'imperial', lengthUnit: 'in' });

        expect(lengthUnit(wrapper)).toBe('in');

        await wrapper.get('[data-test="system-metric"]').trigger('click');
        await flushPromises();

        expect(lengthUnit(wrapper)).toBe('mm');
        expect(options(wrapper)).toEqual(['mm', 'cm', 'm']);
    });

    it('keeps the length unit the user picked while the system stays', async () => {
        const wrapper = form();

        await wrapper.get('[data-test="system-metric"]').trigger('click');
        await flushPromises();

        expect(lengthUnit(wrapper)).toBe('cm');
    });

    it('shows the save bar once something changed, and discarding brings the values back', async () => {
        const wrapper = form();

        await wrapper.get('[data-test="system-imperial"]').trigger('click');
        await flushPromises();

        expect(wrapper.find('[data-slot="sticky-action-bar"]').exists()).toBe(
            true,
        );

        const discard = wrapper
            .findAll('button')
            .find((button) => button.text() === 'Discard');
        await discard?.trigger('click');
        await flushPromises();

        expect(lengthUnit(wrapper)).toBe('cm');
        expect(options(wrapper)).toEqual(['mm', 'cm', 'm']);
    });

    it('saves the three values to the audience route with camelCase keys', async () => {
        const wrapper = form({ audience: 'admin' });

        await wrapper.get('[data-test="system-imperial"]').trigger('click');
        await flushPromises();
        await wrapper.get('form').trigger('submit');

        expect(visit).toHaveBeenCalledTimes(1);
        expect(visit.mock.calls[0]?.[0]).toBe('/admin/account/preferences');
        expect(visit.mock.calls[0]?.[1]).toMatchObject({
            method: 'put',
            data: {
                unitSystem: 'imperial',
                lengthUnit: 'ftin',
                timezone: 'Asia/Kolkata',
            },
        });
    });

    it('saves the appearance on this device only: choosing it sends nothing', async () => {
        const wrapper = form();

        await wrapper.get('[data-test="appearance-dark"]').trigger('click');
        await flushPromises();

        expect(visit).not.toHaveBeenCalled();
        expect(localStorage.getItem('fs:appearance')).toBe('dark');
    });
});
