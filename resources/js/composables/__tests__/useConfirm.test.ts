import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    registerConfirmHost,
    resetConfirmForTests,
    useConfirm,
    useConfirmState,
} from '@/composables/useConfirm';

const options = (title: string) => ({ title });

afterEach(() => {
    resetConfirmForTests();
    vi.restoreAllMocks();
});

describe('useConfirm', () => {
    it('resolves true when the active dialog is confirmed', async () => {
        const unregister = registerConfirmHost();
        const { confirm } = useConfirm();
        const state = useConfirmState();

        const answer = confirm({ title: 'Delete?', tone: 'destructive' });

        expect(state.open.value).toBe(true);
        expect(state.options.value?.title).toBe('Delete?');
        expect(state.options.value?.tone).toBe('destructive');

        state.settle(state.id.value, true);

        await expect(answer).resolves.toBe(true);
        expect(state.open.value).toBe(false);

        unregister();
    });

    it('resolves false when it is cancelled', async () => {
        const unregister = registerConfirmHost();
        const state = useConfirmState();
        const answer = useConfirm().confirm(options('Leave?'));

        state.settle(state.id.value, false);

        await expect(answer).resolves.toBe(false);

        unregister();
    });

    it('keeps the last options after closing so the dialog does not go blank mid-animation', async () => {
        const unregister = registerConfirmHost();
        const state = useConfirmState();
        const answer = useConfirm().confirm(options('Keep me'));

        state.settle(state.id.value, true);
        await answer;

        expect(state.open.value).toBe(false);
        expect(state.options.value?.title).toBe('Keep me');

        unregister();
    });

    it('queues concurrent calls first-in first-out, one dialog at a time', async () => {
        const unregister = registerConfirmHost();
        const { confirm } = useConfirm();
        const state = useConfirmState();
        const settled: string[] = [];

        const first = confirm(options('first')).then((value) =>
            settled.push(`first:${String(value)}`),
        );
        const second = confirm(options('second')).then((value) =>
            settled.push(`second:${String(value)}`),
        );
        const third = confirm(options('third')).then((value) =>
            settled.push(`third:${String(value)}`),
        );

        // Only the first one is on screen; the others have not been touched.
        expect(state.options.value?.title).toBe('first');
        await Promise.resolve();
        expect(settled).toEqual([]);

        state.settle(state.id.value, true);
        await first;

        expect(state.open.value).toBe(true);
        expect(state.options.value?.title).toBe('second');

        state.settle(state.id.value, false);
        await second;

        expect(state.options.value?.title).toBe('third');

        state.settle(state.id.value, true);
        await third;

        expect(settled).toEqual(['first:true', 'second:false', 'third:true']);
        expect(state.open.value).toBe(false);

        unregister();
    });

    it('ignores a late answer for a dialog that is no longer the active one', async () => {
        const unregister = registerConfirmHost();
        const state = useConfirmState();
        const first = useConfirm().confirm(options('first'));
        const second = useConfirm().confirm(options('second'));
        const firstId = state.id.value;

        state.settle(firstId, true);
        await first;
        // e.g. the closing dialog's update:open(false) arriving after hand-off
        state.settle(firstId, false);

        expect(state.options.value?.title).toBe('second');
        expect(state.open.value).toBe(true);

        state.settle(state.id.value, true);
        await expect(second).resolves.toBe(true);

        unregister();
    });

    it('answers false at once, and warns, when no host is mounted', async () => {
        const warn = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);

        await expect(
            useConfirm().confirm(options('Nobody home')),
        ).resolves.toBe(false);
        expect(warn).toHaveBeenCalledOnce();
        expect(useConfirmState().open.value).toBe(false);
    });

    it('answers every pending call false when the last host goes away', async () => {
        const unregister = registerConfirmHost();
        const { confirm } = useConfirm();
        const active = confirm(options('active'));
        const queued = confirm(options('queued'));

        unregister();

        await expect(active).resolves.toBe(false);
        await expect(queued).resolves.toBe(false);
        expect(useConfirmState().open.value).toBe(false);
    });

    it('survives a second host: calls stay pending until the last one is gone', async () => {
        const first = registerConfirmHost();
        const second = registerConfirmHost();
        const answer = useConfirm().confirm(options('still here'));
        let settled = false;
        void answer.then(() => {
            settled = true;
        });

        first();
        await Promise.resolve();
        expect(settled).toBe(false);

        second();
        await expect(answer).resolves.toBe(false);
    });

    it('does not unregister twice', () => {
        const first = registerConfirmHost();
        const second = registerConfirmHost();

        first();
        first();
        const answer = useConfirm().confirm(options('still hosted'));

        expect(useConfirmState().open.value).toBe(true);

        second();
        return expect(answer).resolves.toBe(false);
    });
});
