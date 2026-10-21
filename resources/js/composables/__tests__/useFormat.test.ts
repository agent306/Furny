import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, resetPage } from '@/test/inertiaPage';

vi.mock('@inertiajs/vue3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
    usePage: () => page,
}));

import { useFormat } from '@/composables/useFormat';

beforeEach(() => resetPage());

describe('useFormat (15 §15.6)', () => {
    it('binds the business locale and currency from the shared props', () => {
        resetPage({
            business: {
                locale: 'en-IN',
                currency: 'INR',
                timezone: 'Asia/Kolkata',
            },
        });
        const { formatMoney } = useFormat();

        expect(formatMoney(1234567890)).toBe('₹1,23,45,678.90');
    });

    it('follows later prop changes without re-creating the composable', () => {
        resetPage({ business: { locale: 'en-US', currency: 'USD' } });
        const { formatMoney } = useFormat();

        expect(formatMoney(1234567)).toBe('$12,345.67');

        page.props = { business: { locale: 'en-IN', currency: 'INR' } };

        expect(formatMoney(1234567)).toBe('₹12,345.67');
    });

    it('formats dates in the user zone, falling back to the business zone', () => {
        resetPage({
            auth: {
                user: { type: 'customer', timezone: 'Pacific/Kiritimati' },
            },
            business: { timezone: 'Asia/Kolkata' },
        });
        const { formatDate } = useFormat();

        expect(formatDate('2026-10-20T12:00:00Z')).toBe('21 Oct 2026');

        page.props = {
            auth: { user: null },
            business: { timezone: 'America/Los_Angeles' },
        };

        expect(formatDate('2026-10-20T03:00:00Z')).toBe('19 Oct 2026');
    });

    it('decides "today" in the business zone, not the user zone', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-20T20:00:00Z'));
        resetPage({
            auth: { user: { type: 'staff', timezone: 'America/Los_Angeles' } },
            business: { timezone: 'Asia/Kolkata' },
        });

        try {
            expect(useFormat().todayInBusinessTz()).toBe('2026-10-21');
        } finally {
            vi.useRealTimers();
        }
    });

    it('works before the server shares any props (India defaults)', () => {
        expect(useFormat().formatMoney(1234567)).toBe('₹12,345.67');
    });
});
