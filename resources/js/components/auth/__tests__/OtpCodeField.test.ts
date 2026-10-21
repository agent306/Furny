import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OtpCodeField from '@/components/auth/OtpCodeField.vue';

function field(props: Record<string, unknown> = {}) {
    return mount(OtpCodeField, {
        props: { id: 'code', modelValue: '', ...props },
        attachTo: document.body,
    });
}

afterEach(() => {
    Reflect.deleteProperty(window, 'OTPCredential');
    Reflect.deleteProperty(navigator, 'credentials');
    vi.restoreAllMocks();
});

/** A browser with WebOTP: `get` answers with `result` (or is left pending). */
function webOtp(result?: { code: string } | Error | 'pending') {
    const get = vi.fn<(options: { signal: AbortSignal }) => Promise<unknown>>(
        () => {
            if (result === 'pending' || result === undefined) {
                return new Promise<never>(() => undefined);
            }

            return result instanceof Error
                ? Promise.reject(result)
                : Promise.resolve(result);
        },
    );

    Object.defineProperty(window, 'OTPCredential', {
        value: class OTPCredential {},
        configurable: true,
    });
    Object.defineProperty(navigator, 'credentials', {
        value: { get },
        configurable: true,
    });

    return get;
}

describe('OtpCodeField (13 §4.4)', () => {
    it('is one field the phone can fill in', () => {
        const input = field().get('input');

        expect(input.attributes('inputmode')).toBe('numeric');
        expect(input.attributes('autocomplete')).toBe('one-time-code');
        expect(input.attributes('pattern')).toBe('[0-9]*');
        expect(input.attributes('maxlength')).toBe('6');
        expect(input.attributes('aria-required')).toBe('true');
    });

    it('keeps the digits only', async () => {
        const wrapper = field();

        await wrapper.get('input').setValue('12 a3-4');

        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['1234']);
        expect(wrapper.emitted('complete')).toBeUndefined();
    });

    it('says when the sixth digit is there', async () => {
        const wrapper = field();

        await wrapper.get('input').setValue('123456');

        expect(wrapper.emitted('complete')).toEqual([['123456']]);
    });

    it('marks itself invalid and described for the error', () => {
        const input = field({ invalid: true, describedby: 'code-error' }).get(
            'input',
        );

        expect(input.attributes('aria-invalid')).toBe('true');
        expect(input.attributes('aria-describedby')).toBe('code-error');
    });

    describe('WebOTP', () => {
        it('asks for the SMS code on mount, with a signal, where the browser has it', () => {
            const get = webOtp('pending');
            field();

            expect(get).toHaveBeenCalledTimes(1);
            expect(get.mock.calls[0]?.[0]).toMatchObject({
                otp: { transport: ['sms'] },
            });
            expect(get.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
        });

        it('fills the field with the code it reads and says it is complete', async () => {
            webOtp({ code: '654321' });
            const wrapper = field();
            await flushPromises();

            expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
                '654321',
            ]);
            expect(wrapper.emitted('complete')).toEqual([['654321']]);
        });

        it('aborts the request when the field goes away', () => {
            const get = webOtp('pending');
            const wrapper = field();
            const signal = get.mock.calls[0]?.[0].signal as AbortSignal;

            expect(signal.aborted).toBe(false);

            wrapper.unmount();

            expect(signal.aborted).toBe(true);
        });

        it('is not asked of a browser without OTPCredential', () => {
            const get = vi.fn();
            Object.defineProperty(navigator, 'credentials', {
                value: { get },
                configurable: true,
            });

            field();

            expect(get).not.toHaveBeenCalled();
        });

        it('leaves the field alone when the person refuses or the request is aborted', async () => {
            webOtp(new DOMException('aborted', 'AbortError'));
            const wrapper = field();
            await flushPromises();

            expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        });

        it('ignores an answer without a code', async () => {
            webOtp({ code: '' });
            const wrapper = field();
            await flushPromises();

            expect(wrapper.emitted('complete')).toBeUndefined();
        });
    });
});
