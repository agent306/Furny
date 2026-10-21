import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import LengthInput from '@/components/inputs/LengthInput.vue';
import { DENSITY_KEY } from '@/composables/useControlSize';

beforeEach(() => resetPage({ auth: { user: { type: 'customer' } } }));

type Wrapper = ReturnType<typeof mountInput>;

function mountInput(props: Record<string, unknown> = {}, attrs = {}) {
    return mount(LengthInput, {
        props: { modelValue: 1000, unit: 'mm', min: 300, max: 6000, ...props },
        attrs,
    });
}

function updates(wrapper: Wrapper): unknown[] {
    return (wrapper.emitted('update:modelValue') ?? []).map(([v]) => v);
}

function commits(wrapper: Wrapper): unknown[] {
    return (wrapper.emitted('commit') ?? []).map(([v]) => v);
}

async function typeAndEnter(wrapper: Wrapper, text: string) {
    const input = wrapper.get('input');

    await input.trigger('focus');
    await input.setValue(text);
    await input.trigger('keydown', { key: 'Enter' });
}

describe('LengthInput', () => {
    describe('Enter parses and commits', () => {
        it.each(['2400', '2400mm', '2400 mm', '240cm', '2.4m', '2,400 mm'])(
            '%s emits 2400 (update:modelValue and commit)',
            async (text) => {
                const wrapper = mountInput();

                await typeAndEnter(wrapper, text);

                expect(updates(wrapper)).toEqual([2400]);
                expect(commits(wrapper)).toEqual([2400]);
                expect(
                    wrapper.get('input').attributes('aria-invalid'),
                ).toBeUndefined();
                expect(wrapper.get('input').element.value).toBe('2400');
            },
        );

        it('a bare number is in the unit prop: cm 240 is 2400 mm', async () => {
            const wrapper = mountInput({ unit: 'cm' });

            await typeAndEnter(wrapper, '240');

            expect(updates(wrapper)).toEqual([2400]);
            expect(wrapper.get('input').element.value).toBe('240');
        });

        it('a bare number in m', async () => {
            const wrapper = mountInput({ unit: 'm' });

            await typeAndEnter(wrapper, '2.4');

            expect(updates(wrapper)).toEqual([2400]);
            expect(wrapper.get('input').element.value).toBe('2.4');
        });

        it('rounds half away from zero to whole millimetres', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '2400.5');

            expect(updates(wrapper)).toEqual([2401]);
            expect(wrapper.get('input').element.value).toBe('2401');
        });

        it('thousands separator paste: 2,400 mm is 2400 (master §6.1)', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '2,400 mm');

            expect(updates(wrapper)).toEqual([2400]);
        });

        it('a decimal comma: 2,4 m is 2400', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '2,4 m');

            expect(updates(wrapper)).toEqual([2400]);
        });

        it('typing alone emits nothing', async () => {
            const wrapper = mountInput();

            await wrapper.get('input').setValue('2400');

            expect(updates(wrapper)).toEqual([]);
            expect(commits(wrapper)).toEqual([]);
        });
    });

    describe('blur', () => {
        it('commits a valid value', async () => {
            const wrapper = mountInput();
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('2500');
            await input.trigger('blur');

            expect(updates(wrapper)).toEqual([2500]);
            expect(commits(wrapper)).toEqual([2500]);
        });

        it('does not commit an invalid value, and keeps the text', async () => {
            const wrapper = mountInput();
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('abc');
            await input.trigger('blur');

            expect(updates(wrapper)).toEqual([]);
            expect(commits(wrapper)).toEqual([]);
            expect(input.element.value).toBe('abc');
            expect(input.attributes('aria-invalid')).toBe('true');
        });

        it('empty clears the model without a commit', async () => {
            const wrapper = mountInput();
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('');
            await input.trigger('blur');

            expect(updates(wrapper)).toEqual([null]);
            expect(commits(wrapper)).toEqual([]);
            expect(input.attributes('aria-invalid')).toBeUndefined();
        });

        it('empty is an error when required', async () => {
            const wrapper = mountInput({ required: true });
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('');
            await input.trigger('blur');

            expect(updates(wrapper)).toEqual([]);
            expect(input.attributes('aria-invalid')).toBe('true');
            expect(input.attributes('aria-required')).toBe('true');
        });
    });

    describe('validation', () => {
        it('100 below min 300 is out of range', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '100');

            expect(updates(wrapper)).toEqual([]);
            expect(wrapper.get('input').attributes('aria-invalid')).toBe(
                'true',
            );
            expect(wrapper.get('input').element.value).toBe('100');
            expect(wrapper.text()).toContain(
                'Must be between 300 mm and 6000 mm.',
            );
        });

        it('7000 above max 6000 is out of range', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '7m');

            expect(updates(wrapper)).toEqual([]);
            expect(wrapper.text()).toContain('Must be between 300 mm');
        });

        it('bounds are inclusive', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '300');
            await typeAndEnter(wrapper, '6000');

            expect(updates(wrapper)).toEqual([300, 6000]);
        });

        it('range message uses the field unit', async () => {
            const wrapper = mountInput({ unit: 'm' });

            await typeAndEnter(wrapper, '0.1');

            expect(wrapper.text()).toContain('Must be between 0.3 m and 6 m.');
        });

        it('one-sided bounds get their own message', async () => {
            const lower = mountInput({ max: undefined });
            await typeAndEnter(lower, '100');
            expect(lower.text()).toContain('Must be at least 300 mm.');

            const upper = mountInput({ min: undefined });
            await typeAndEnter(upper, '7000');
            expect(upper.text()).toContain('Must be at most 6000 mm.');
        });

        it('abc is units.errors.invalid_length', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, 'abc');

            expect(updates(wrapper)).toEqual([]);
            expect(wrapper.get('input').attributes('aria-invalid')).toBe(
                'true',
            );
            expect(wrapper.text()).toContain(
                'Enter a length like 2400, 240cm or 7\'10".',
            );
        });

        it.each([
            'NaN',
            'Infinity',
            '-Infinity',
            '1e3',
            '1E3',
            '0x10',
            '12abc',
        ])('%s is invalid', async (text) => {
            const wrapper = mountInput({ min: undefined, max: undefined });

            await typeAndEnter(wrapper, text);

            expect(updates(wrapper)).toEqual([]);
            expect(commits(wrapper)).toEqual([]);
            expect(wrapper.get('input').attributes('aria-invalid')).toBe(
                'true',
            );
        });

        it('feet and inches say so instead of "invalid"', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, '7\'10"');

            expect(updates(wrapper)).toEqual([]);
            expect(wrapper.text()).toContain('not supported yet');
            expect(wrapper.text()).not.toContain('7\'10"');
        });

        it('a negative is rejected unless min allows it', async () => {
            const rejected = mountInput({ min: undefined });
            await typeAndEnter(rejected, '-50');
            expect(updates(rejected)).toEqual([]);
            expect(rejected.text()).toContain('Must be at least 0 mm.');

            const belowMin = mountInput();
            await typeAndEnter(belowMin, '-50');
            expect(updates(belowMin)).toEqual([]);

            const allowed = mountInput({ min: -100 });
            await typeAndEnter(allowed, '-50');
            expect(updates(allowed)).toEqual([-50]);
            expect(allowed.get('input').element.value).toBe('-50');
        });

        it('links the error to the input with aria-describedby', async () => {
            const wrapper = mountInput({}, { 'aria-describedby': 'hint' });

            await typeAndEnter(wrapper, 'abc');

            const ids = (
                wrapper.get('input').attributes('aria-describedby') ?? ''
            ).split(' ');

            expect(ids[0]).toBe('hint');
            expect(wrapper.get(`[id="${ids[1]}"]`).text()).toContain(
                'Enter a length like',
            );
        });

        it('a valid commit clears the error', async () => {
            const wrapper = mountInput();

            await typeAndEnter(wrapper, 'abc');
            await typeAndEnter(wrapper, '2400');

            expect(wrapper.text()).not.toContain('Enter a length like');
            expect(
                wrapper.get('input').attributes('aria-invalid'),
            ).toBeUndefined();
        });

        it('the invalid prop marks the field invalid', () => {
            expect(
                mountInput({ invalid: true })
                    .get('input')
                    .attributes('aria-invalid'),
            ).toBe('true');
        });
    });

    describe('keyboard', () => {
        async function press(wrapper: Wrapper, key: string, modifiers = {}) {
            await wrapper
                .get('input')
                .trigger('keydown', { key, ...modifiers });
        }

        it('ArrowUp steps +10 and ArrowDown -10', async () => {
            const wrapper = mountInput({ modelValue: 2400 });

            await press(wrapper, 'ArrowUp');
            expect(updates(wrapper)).toEqual([2410]);
            expect(wrapper.get('input').element.value).toBe('2410');

            await press(wrapper, 'ArrowDown');
            await press(wrapper, 'ArrowDown');
            expect(updates(wrapper)).toEqual([2410, 2400, 2390]);
        });

        it('Shift is x10, Alt is x0.1 (min 1 mm), PageUp/PageDown x10', async () => {
            const wrapper = mountInput({ modelValue: 2400 });

            await press(wrapper, 'ArrowUp', { shiftKey: true });
            await press(wrapper, 'ArrowDown', { shiftKey: true });
            await press(wrapper, 'ArrowUp', { altKey: true });
            await press(wrapper, 'ArrowDown', { altKey: true });
            await press(wrapper, 'PageUp');
            await press(wrapper, 'PageDown');

            expect(updates(wrapper)).toEqual([
                2500, 2400, 2401, 2400, 2500, 2400,
            ]);
        });

        it('Alt step never goes below 1 mm', async () => {
            const wrapper = mountInput({ modelValue: 2400, step: 5 });

            await press(wrapper, 'ArrowUp', { altKey: true });

            expect(updates(wrapper)).toEqual([2401]);
        });

        it('honours a custom step', async () => {
            const wrapper = mountInput({ modelValue: 2400, step: 25 });

            await press(wrapper, 'ArrowUp');
            await press(wrapper, 'ArrowUp', { shiftKey: true });

            expect(updates(wrapper)).toEqual([2425, 2675]);
        });

        it('steps are in mm whatever the display unit', async () => {
            const wrapper = mountInput({ modelValue: 2400, unit: 'cm' });

            await press(wrapper, 'ArrowUp');

            expect(updates(wrapper)).toEqual([2410]);
            expect(wrapper.get('input').element.value).toBe('241');
        });

        it('clamps to max and min', async () => {
            const top = mountInput({ modelValue: 5995 });

            await press(top, 'ArrowUp');
            expect(updates(top)).toEqual([6000]);
            await press(top, 'ArrowUp');
            expect(updates(top)).toEqual([6000]);

            const bottom = mountInput({ modelValue: 305 });

            await press(bottom, 'ArrowDown', { shiftKey: true });
            expect(updates(bottom)).toEqual([300]);
        });

        it('without a min it does not go below 0', async () => {
            const wrapper = mountInput({ modelValue: 5, min: undefined });

            await press(wrapper, 'ArrowDown');

            expect(updates(wrapper)).toEqual([0]);
        });

        it('a negative min lets stepping go negative', async () => {
            const wrapper = mountInput({ modelValue: 5, min: -100 });

            await press(wrapper, 'ArrowDown');

            expect(updates(wrapper)).toEqual([-5]);
        });

        it('steps from the typed text, not the stale model', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('3000');
            await press(wrapper, 'ArrowUp');

            expect(updates(wrapper)).toEqual([3010]);
        });

        it('steps from typed text even when it is out of range, then clamps', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('7000');
            await press(wrapper, 'ArrowDown');

            expect(updates(wrapper)).toEqual([6000]);
        });

        it('steps from the last valid value when the text is junk', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('abc');
            await press(wrapper, 'ArrowUp');

            expect(updates(wrapper)).toEqual([2410]);
            expect(input.attributes('aria-invalid')).toBeUndefined();
        });

        it('stepping from empty starts at 0, clamped', async () => {
            const wrapper = mountInput({ modelValue: null });

            await press(wrapper, 'ArrowUp');

            expect(updates(wrapper)).toEqual([300]);
        });

        it('prevents the default caret movement', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const event = new KeyboardEvent('keydown', {
                key: 'ArrowUp',
                cancelable: true,
            });

            wrapper.get('input').element.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
        });

        it('Escape restores the last valid value and clears the error', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('abc');
            await input.trigger('keydown', { key: 'Enter' });
            expect(input.attributes('aria-invalid')).toBe('true');

            await input.trigger('keydown', { key: 'Escape' });

            expect(input.element.value).toBe('2400');
            expect(input.attributes('aria-invalid')).toBeUndefined();
            expect(wrapper.text()).not.toContain('Enter a length like');
            expect(updates(wrapper)).toEqual([]);
        });

        it('Escape restores the value committed last, not the original', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await typeAndEnter(wrapper, '2500');
            await input.setValue('9');
            await input.trigger('keydown', { key: 'Escape' });

            expect(input.element.value).toBe('2500');
        });

        it('Escape on unchanged text lets the event through (a dialog can close)', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            });
            const stop = vi.spyOn(event, 'stopPropagation');

            wrapper.get('input').element.dispatchEvent(event);

            expect(stop).not.toHaveBeenCalled();
        });

        it('Escape while editing is swallowed so a dialog stays open', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await input.setValue('9');

            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            });
            const stop = vi.spyOn(event, 'stopPropagation');

            input.element.dispatchEvent(event);

            expect(stop).toHaveBeenCalled();
        });
    });

    describe('display', () => {
        it('shows the value and a non-editable unit suffix', () => {
            const wrapper = mountInput({ modelValue: 2400 });

            expect(wrapper.get('input').element.value).toBe('2400');
            expect(wrapper.get('[data-testid="length-unit"]').text()).toBe(
                'mm',
            );
            expect(wrapper.get('input').classes()).toContain('font-mono');
        });

        it.each([
            ['cm', '240'],
            ['m', '2.4'],
        ])('unit %s displays %s', (unit, value) => {
            const wrapper = mountInput({ modelValue: 2400, unit });

            expect(wrapper.get('input').element.value).toBe(value);
            expect(wrapper.get('[data-testid="length-unit"]').text()).toBe(
                unit,
            );
        });

        it('null is empty, with the placeholder', () => {
            const wrapper = mountInput({
                modelValue: null,
                placeholder: '2400',
            });

            expect(wrapper.get('input').element.value).toBe('');
            expect(wrapper.get('input').attributes('placeholder')).toBe('2400');
        });

        it('unit defaults to the user length unit', () => {
            resetPage({
                auth: { user: { type: 'customer', lengthUnit: 'cm' } },
            });

            const wrapper = mountInput({ unit: undefined, modelValue: 2400 });

            expect(wrapper.get('[data-testid="length-unit"]').text()).toBe(
                'cm',
            );
            expect(wrapper.get('input').element.value).toBe('240');
        });

        it('imperial units fall back to millimetres in P1', async () => {
            const wrapper = mountInput({ unit: 'ftin', modelValue: 2400 });

            expect(wrapper.get('input').element.value).toBe('2400');
            expect(wrapper.get('[data-testid="length-unit"]').text()).toBe(
                'mm',
            );

            await typeAndEnter(wrapper, '2500');
            expect(updates(wrapper)).toEqual([2500]);
        });

        it('follows an outside change while not focused', async () => {
            const wrapper = mountInput({ modelValue: 2400 });

            await wrapper.setProps({ modelValue: 3000 });

            expect(wrapper.get('input').element.value).toBe('3000');
        });

        it('leaves the text alone while focused', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');

            await input.trigger('focus');
            await input.setValue('30');
            await wrapper.setProps({ modelValue: 3000 });

            expect(input.element.value).toBe('30');
        });

        it('selects all text on focus', async () => {
            const wrapper = mountInput({ modelValue: 2400 });
            const input = wrapper.get('input');
            const select = vi.spyOn(input.element, 'select');

            await input.trigger('focus');

            expect(select).toHaveBeenCalled();
        });
    });

    describe('accessibility (15 §9.7, §14)', () => {
        it('is a spinbutton with value, text and bounds', () => {
            const input = mountInput({ modelValue: 2400 }).get('input');

            expect(input.attributes('role')).toBe('spinbutton');
            expect(input.attributes('aria-valuenow')).toBe('2400');
            expect(input.attributes('aria-valuetext')).toBe('2400 mm');
            expect(input.attributes('aria-valuemin')).toBe('300');
            expect(input.attributes('aria-valuemax')).toBe('6000');
        });

        it('aria-valuetext is in the display unit', () => {
            const input = mountInput({ modelValue: 2400, unit: 'cm' }).get(
                'input',
            );

            expect(input.attributes('aria-valuenow')).toBe('2400');
            expect(input.attributes('aria-valuetext')).toBe('240 cm');
        });

        it('omits the value and the max that do not exist', () => {
            const input = mountInput({
                modelValue: null,
                min: undefined,
                max: undefined,
            }).get('input');

            expect(input.attributes('aria-valuenow')).toBeUndefined();
            expect(input.attributes('aria-valuetext')).toBeUndefined();
            expect(input.attributes('aria-valuemax')).toBeUndefined();
        });

        it('aria-valuemin is the implicit floor of 0 when there is no min', () => {
            const input = mountInput({ min: undefined }).get('input');

            expect(input.attributes('aria-valuemin')).toBe('0');
        });

        it('a negative min is the floor', () => {
            expect(
                mountInput({ min: -100 })
                    .get('input')
                    .attributes('aria-valuemin'),
            ).toBe('-100');
        });

        it('aria-valuenow follows a committed change', async () => {
            const wrapper = mountInput({ modelValue: 2400 });

            await typeAndEnter(wrapper, '2500');

            expect(wrapper.get('input').attributes('aria-valuenow')).toBe(
                '2500',
            );
        });

        it('uses text input mode (decimal would block ft/in quotes on iOS)', () => {
            const input = mountInput().get('input');

            expect(input.attributes('inputmode')).toBe('text');
            expect(input.attributes('autocomplete')).toBe('off');
            expect(input.attributes('spellcheck')).toBe('false');
        });

        it('passes id, aria-label and disabled to the input, class to the wrapper', () => {
            const wrapper = mountInput(
                {},
                {
                    id: 'width',
                    'aria-label': 'Width',
                    disabled: true,
                    class: 'w-40',
                },
            );
            const input = wrapper.get('input');

            expect(input.attributes('id')).toBe('width');
            expect(input.attributes('aria-label')).toBe('Width');
            expect(input.attributes('disabled')).toBeDefined();
            expect(wrapper.classes()).toContain('w-40');
        });

        it('takes id, ariaLabel and disabled as props (15 §9.7)', () => {
            const input = mountInput({
                id: 'depth',
                ariaLabel: 'Depth',
                disabled: true,
            }).get('input');

            expect(input.attributes('id')).toBe('depth');
            expect(input.attributes('aria-label')).toBe('Depth');
            expect(input.attributes('disabled')).toBeDefined();
        });

        it('has a 44 px target (h-11) in comfortable density, h-9 in compact', () => {
            expect(mountInput().get('input').classes()).toContain('h-11');

            const compact = mount(LengthInput, {
                props: { modelValue: 1 },
                global: { provide: { [DENSITY_KEY]: 'compact' } },
            });

            expect(compact.get('input').classes()).toContain('h-9');
        });
    });
});
