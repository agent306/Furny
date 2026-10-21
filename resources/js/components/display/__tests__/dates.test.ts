import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import DateText from '@/components/display/DateText.vue';
import RelativeTime from '@/components/display/RelativeTime.vue';

beforeEach(() => {
    resetPage({
        auth: { user: { type: 'customer', timezone: 'Asia/Kolkata' } },
        business: {
            locale: 'en-IN',
            currency: 'INR',
            timezone: 'Asia/Kolkata',
        },
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('RelativeTime', () => {
    it('renders a <time> with the ISO value and the absolute time as title', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));

        const wrapper = mount(RelativeTime, {
            props: { at: '2026-10-20T09:00:00Z' },
        });
        const time = wrapper.get('time');

        expect(time.attributes('datetime')).toBe('2026-10-20T09:00:00Z');
        expect(time.text()).toBe('3 hr ago');
        expect(time.attributes('title')).toBe('20 October 2026 at 2:30 pm');
    });

    it('shows the absolute title in the user zone', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
        resetPage({
            auth: {
                user: { type: 'customer', timezone: 'Pacific/Kiritimati' },
            },
        });

        // 11:00Z is 01:00 the next day at UTC+14.
        const time = mount(RelativeTime, {
            props: { at: '2026-10-20T11:00:00Z' },
        }).get('time');

        expect(time.attributes('title')).toContain('21 October 2026');
    });

    it('refreshes every 60 seconds and stops when unmounted', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));

        const wrapper = mount(RelativeTime, {
            props: { at: '2026-10-20T11:59:30Z' },
        });
        expect(wrapper.text()).toBe('now');

        vi.advanceTimersByTime(60_000);
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toBe('1 min ago');

        vi.advanceTimersByTime(60_000);
        await wrapper.vm.$nextTick();
        expect(wrapper.text()).toBe('2 min ago');

        wrapper.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('updates when the value changes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
        const wrapper = mount(RelativeTime, {
            props: { at: '2026-10-20T11:00:00Z' },
        });

        await wrapper.setProps({ at: '2026-10-20T09:00:00Z' });

        expect(wrapper.text()).toBe('3 hr ago');
    });

    it('shows a dash, without a datetime attribute, for an unreadable value', () => {
        const time = mount(RelativeTime, { props: { at: 'soon' } }).get('time');

        expect(time.text()).toBe('—');
        expect(time.attributes('datetime')).toBeUndefined();
    });
});

describe('DateText', () => {
    it('kind="date" formats a date-only string without any zone shift', () => {
        for (const timezone of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
            resetPage({ auth: { user: { type: 'customer', timezone } } });
            const time = mount(DateText, {
                props: { value: '2026-10-20', kind: 'date' },
            }).get('time');

            expect(time.text(), timezone).toBe('20 Oct 2026');
            expect(time.attributes('datetime')).toBe('2026-10-20');
        }
    });

    it('kind="date" takes the date of an instant in the user zone', () => {
        resetPage({
            auth: {
                user: { type: 'customer', timezone: 'Pacific/Kiritimati' },
            },
        });

        expect(
            mount(DateText, {
                props: { value: '2026-10-20T12:00:00Z', kind: 'date' },
            }).text(),
        ).toBe('21 Oct 2026');
    });

    it('kind="datetime" and kind="time"', () => {
        const datetime = mount(DateText, {
            props: { value: '2026-10-20T04:30:00Z', kind: 'datetime' },
        });
        const time = mount(DateText, {
            props: { value: '2026-10-20T04:30:00Z', kind: 'time' },
        });

        expect(datetime.text()).toBe('20 Oct 2026, 10:00 am');
        expect(time.text()).toBe('10:00 am');
    });

    it('a :style binding reaches the <time> element (the spec names the date style prop "style" too)', () => {
        const wrapper = mount(DateText, {
            props: {
                value: '2026-10-20',
                kind: 'date',
                style: { color: 'red' },
            },
        });
        const time = wrapper.get('time');

        expect(time.attributes('style')).toContain('color: red');
        expect(time.text()).toBe('20 Oct 2026');
    });

    it('dateStyle (the preferred prop) picks the style', () => {
        const wrapper = mount(DateText, {
            props: { value: '2026-10-20', kind: 'date', dateStyle: 'long' },
        });

        expect(wrapper.text()).toBe('20 October 2026');
    });

    it('dateStyle wins over style when both are given', () => {
        const wrapper = mount(DateText, {
            props: {
                value: '2026-10-20',
                kind: 'date',
                dateStyle: 'short',
                style: 'long',
            },
        });
        const time = wrapper.get('time');

        expect(time.text()).toBe('20/10/26');
        expect(time.attributes('style')).toBeUndefined();
    });

    it('dateStyle leaves style free for inline CSS', () => {
        const time = mount(DateText, {
            props: {
                value: '2026-10-20',
                kind: 'date',
                dateStyle: 'long',
                style: { color: 'red' },
            },
        }).get('time');

        expect(time.text()).toBe('20 October 2026');
        expect(time.attributes('style')).toContain('color: red');
    });

    it('class still falls through', () => {
        const wrapper = mount(DateText, {
            props: { value: '2026-10-20', kind: 'date' },
            attrs: { class: 'text-sm' },
        });

        expect(wrapper.get('time').classes()).toContain('text-sm');
    });

    it('kind="time" with style long names the zone', () => {
        expect(
            mount(DateText, {
                props: {
                    value: '2026-10-20T04:30:00Z',
                    kind: 'time',
                    style: 'long',
                },
            }).text(),
        ).toContain('IST');
    });

    it('style picks short, medium or long', () => {
        const text = (style: 'short' | 'medium' | 'long'): string =>
            mount(DateText, {
                props: { value: '2026-10-20', kind: 'date', style },
            }).text();

        expect(text('short')).toBe('20/10/26');
        expect(text('medium')).toBe('20 Oct 2026');
        expect(text('long')).toBe('20 October 2026');
    });

    it('shows a dash for an unreadable value', () => {
        expect(
            mount(DateText, { props: { value: 'x', kind: 'date' } }).text(),
        ).toBe('—');
    });
});
