import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    post: vi.fn(),
    delete: vi.fn(),
    visit: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');
    const { defineComponent: define } = await import('vue');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router,
        Head: define({
            name: 'Head',
            props: { title: String },
            render: () => null,
        }),
    };
});

vi.mock('@/composables/useConfirm', () => ({
    useConfirm: () => ({ confirm }),
}));

import { toast } from 'vue-sonner';
import TwoFactor from '@/pages/Admin/Account/TwoFactor.vue';
import { page, resetPage } from '@/test/inertiaPage';

let mounted: VueWrapper | null = null;

const PASSWORD_PAGE = '/admin/account/two-factor?confirm-password=1';

const CODES = Array.from(
    { length: 8 },
    (_, i) => `code${i}aaaaa-code${i}bbbbb`,
);
const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';

type Answers = Record<string, { status?: number; body?: unknown }>;

/** The three JSON routes of Fortify the page reads. */
function answer(overrides: Answers = {}) {
    const answers: Answers = {
        '/user/two-factor-qr-code': {
            body: { svg: SVG, url: 'otpauth://totp/Furny:ada' },
        },
        '/user/two-factor-secret-key': {
            body: { secretKey: 'JBSWY3DPEHPK3PXP' },
        },
        '/user/two-factor-recovery-codes': { body: CODES },
        '/user/confirmed-password-status': { body: { confirmed: true } },
        ...overrides,
    };
    const fetchMock = vi.fn((url: string) => {
        const found = answers[url] ?? { status: 404, body: {} };
        const status = found.status ?? 200;

        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(found.body),
        });
    });

    vi.stubGlobal('fetch', fetchMock);

    return fetchMock;
}

function twoFactor(props: Record<string, unknown> = {}) {
    mounted = mount(TwoFactor, {
        props: {
            enabled: false,
            confirmed: false,
            required: true,
            enforced: true,
            ...props,
        },
        attachTo: document.body,
    });

    return mounted;
}

const q = <T extends Element>(selector: string): T | null =>
    document.body.querySelector<T>(selector);

function type(selector: string, value: string): void {
    const input = q<HTMLInputElement>(selector);

    if (input === null) {
        throw new Error(`No ${selector}.`);
    }

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Calls the `onSuccess` of the visit, like a server that said yes. */
function succeeds(mock: ReturnType<typeof vi.fn>): void {
    mock.mockImplementation(
        (
            _url: string,
            _dataOrOptions: unknown,
            options?: { onSuccess?: () => void },
        ) => {
            const given = (options ?? _dataOrOptions) as {
                onSuccess?: () => void;
            };

            given.onSuccess?.();
        },
    );
}

beforeEach(() => {
    router.post.mockReset();
    router.delete.mockReset();
    router.visit.mockReset();
    confirm.mockReset();
    resetPage({
        app: { name: 'Furny Joinery', logoUrl: null },
        auth: {
            user: { type: 'staff', roles: ['admin'], permissions: [] },
        },
        errors: {},
    });
    page.component = 'Admin/Account/TwoFactor';
    vi.spyOn(toast, 'success').mockImplementation(() => 1);
});

afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Admin/Account/TwoFactor (11 §18, 13 §5.10)', () => {
    it('is framed by the account nav, with Two-factor the current section', () => {
        answer();
        page.url = '/admin/account/two-factor';
        const wrapper = twoFactor();

        const nav = wrapper.get('[data-test="account-nav"]');
        const current = nav.findAll('a[aria-current="page"]');

        expect(nav.findAll('a').map((link) => link.text())).toEqual([
            'Profile',
            'Security',
            'Two-factor',
            'Preferences',
        ]);
        expect(current).toHaveLength(1);
        expect(current[0]?.text()).toBe('Two-factor');
        expect(wrapper.findAll('h1')).toHaveLength(1);
    });

    describe('before the setup', () => {
        it('has one h1 and the enrolment banner while 2fa.enrolled keeps the admin area shut', () => {
            answer();
            const wrapper = twoFactor();

            expect(wrapper.findAll('h1')).toHaveLength(1);
            expect(wrapper.get('h1').text()).toBe('Two-factor authentication');
            expect(
                wrapper.get('[data-test="enforced-banner"]').text(),
            ).toContain(
                'Set up two-factor authentication to use the admin area.',
            );
        });

        it('has no banner for someone who is not made to', () => {
            answer();
            const wrapper = twoFactor({ required: false, enforced: false });

            expect(wrapper.find('[data-test="enforced-banner"]').exists()).toBe(
                false,
            );
        });

        it('starts the setup with the enable route', async () => {
            answer();
            const wrapper = twoFactor();

            await wrapper.get('[data-test="enable-button"]').trigger('click');
            await flushPromises();

            expect(router.post).toHaveBeenCalledWith(
                '/user/two-factor-authentication',
                {},
                expect.objectContaining({ preserveScroll: true }),
            );
        });
    });

    describe('the setup under way', () => {
        beforeEach(() => {
            answer();
        });

        it('shows the QR code as an image, not as markup, and the setup key', async () => {
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            const image = wrapper.get('[data-test="qr-code"]');

            expect(image.element.tagName).toBe('IMG');
            expect(image.attributes('src')).toMatch(/^data:image\/svg\+xml/);
            expect(image.attributes('alt')).toBe(
                'QR code for your authenticator app',
            );
            // Not the markup of the server's SVG in the page.
            expect(wrapper.find('rect[height="4"]').exists()).toBe(false);
            expect(wrapper.get('[data-test="setup-key"]').text()).toContain(
                'JBSWY3DPEHPK3PXP',
            );
        });

        it('cannot be confirmed before the six digits are in', async () => {
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            expect(
                wrapper.get<HTMLButtonElement>('[data-test="confirm-button"]')
                    .element.disabled,
            ).toBe(true);

            type('#code', '123');
            await flushPromises();
            expect(
                wrapper.get<HTMLButtonElement>('[data-test="confirm-button"]')
                    .element.disabled,
            ).toBe(true);

            type('#code', '123456');
            await flushPromises();
            expect(
                wrapper.get<HTMLButtonElement>('[data-test="confirm-button"]')
                    .element.disabled,
            ).toBe(false);
        });

        it('puts the code to the confirm route, in the error bag Fortify answers in', async () => {
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            type('#code', '123456');
            await flushPromises();
            await wrapper.get('[data-test="confirm-form"]').trigger('submit');
            await flushPromises();

            expect(router.post).toHaveBeenCalledWith(
                '/user/confirmed-two-factor-authentication',
                { code: '123456' },
                expect.objectContaining({
                    errorBag: 'confirmTwoFactorAuthentication',
                    preserveScroll: true,
                }),
            );
        });

        it('shows a wrong code under the field and marks it invalid', async () => {
            router.post.mockImplementation(
                (
                    _url: string,
                    _data: unknown,
                    options: {
                        onError?: (errors: Record<string, string>) => void;
                    },
                ) =>
                    options.onError?.({
                        code: 'The provided two factor authentication code was invalid.',
                    }),
            );
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            type('#code', '123456');
            await flushPromises();
            await wrapper.get('[data-test="confirm-form"]').trigger('submit');
            await flushPromises();

            expect(wrapper.get('#code-error').text()).toContain(
                'The provided two factor authentication code was invalid.',
            );
            expect(wrapper.get('#code').attributes('aria-invalid')).toBe(
                'true',
            );
        });

        it('asks for the password when Fortify says the confirmation ran out (423)', async () => {
            answer({ '/user/two-factor-qr-code': { status: 423, body: {} } });
            twoFactor({ enabled: true });
            await flushPromises();

            expect(router.visit).toHaveBeenCalledWith(PASSWORD_PAGE);
        });

        it('says so, with a retry, when the QR code cannot be loaded', async () => {
            answer({ '/user/two-factor-qr-code': { status: 500, body: {} } });
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            expect(wrapper.get('[data-test="qr-error"]').text()).toContain(
                "We couldn't load the QR code",
            );
            expect(wrapper.find('[data-test="qr-code"]').exists()).toBe(false);
        });
    });

    describe('the recovery codes after the confirmation', () => {
        async function confirmed() {
            const fetchMock = answer();
            succeeds(router.post);
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            type('#code', '123456');
            await flushPromises();
            await wrapper.get('[data-test="confirm-form"]').trigger('submit');
            await flushPromises();

            return { wrapper, fetchMock };
        }

        it('reads the eight codes and shows them', async () => {
            const { wrapper, fetchMock } = await confirmed();

            expect(fetchMock).toHaveBeenCalledWith(
                '/user/two-factor-recovery-codes',
                expect.anything(),
            );
            expect(
                wrapper
                    .findAll('[data-test="recovery-code"]')
                    .map((c) => c.text()),
            ).toEqual(CODES);
        });

        it('keeps the button disabled until "I saved these codes" is ticked', async () => {
            const { wrapper } = await confirmed();
            const done = () =>
                wrapper.get<HTMLButtonElement>('[data-test="codes-done"]')
                    .element;

            expect(done().disabled).toBe(true);

            await wrapper.get('[data-test="codes-saved"]').trigger('click');
            await flushPromises();
            expect(done().disabled).toBe(false);

            await wrapper.get('[data-test="codes-saved"]').trigger('click');
            await flushPromises();
            expect(done().disabled).toBe(true);
        });

        it('labels the checkbox and requires it', async () => {
            const { wrapper } = await confirmed();

            expect(wrapper.get('label[for="codes-saved"]').text()).toContain(
                'I saved these codes',
            );
            expect(
                wrapper
                    .get('[data-test="codes-saved"]')
                    .attributes('aria-required'),
            ).toBe('true');
        });

        it('copies all the codes, one a line', async () => {
            const writeText = vi.fn(() => Promise.resolve());
            vi.stubGlobal('navigator', { clipboard: { writeText } });
            const { wrapper } = await confirmed();

            await wrapper.get('[data-test="codes-copy"]').trigger('click');
            await flushPromises();

            expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
        });

        it('downloads them as a file named after the app', async () => {
            const blobs: Blob[] = [];
            const createObjectURL = vi.fn((blob: Blob) => {
                blobs.push(blob);

                return 'blob:codes';
            });
            const revokeObjectURL = vi.fn();
            // Still a URL class: the account nav of the page builds links with it.
            vi.stubGlobal(
                'URL',
                class extends URL {
                    static createObjectURL = createObjectURL;
                    static revokeObjectURL = revokeObjectURL;
                },
            );
            const clicked: HTMLAnchorElement[] = [];
            const click = vi
                .spyOn(HTMLAnchorElement.prototype, 'click')
                .mockImplementation(function (this: HTMLAnchorElement) {
                    clicked.push(this);
                });
            const { wrapper } = await confirmed();

            await wrapper.get('[data-test="codes-download"]').trigger('click');

            expect(clicked).toHaveLength(1);
            expect(clicked[0]?.download).toBe(
                'furny-joinery-recovery-codes.txt',
            );
            expect(clicked[0]?.href).toBe('blob:codes');
            expect(blobs[0]?.type).toBe('text/plain');
            expect(await blobs[0]?.text()).toBe(`${CODES.join('\n')}\n`);
            // Not before the browser has taken the file: later, in a task of its own.
            expect(revokeObjectURL).not.toHaveBeenCalled();
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes');

            click.mockRestore();
        });

        it('leads on to the admin area when the page was shown because it was shut', async () => {
            const { wrapper } = await confirmed();

            await wrapper.get('[data-test="codes-saved"]').trigger('click');
            await flushPromises();
            await wrapper.get('[data-test="codes-done"]').trigger('click');

            expect(router.visit).toHaveBeenCalledWith('/admin');
        });

        it('stays on the page when nothing made the person come here', async () => {
            answer();
            succeeds(router.post);
            const wrapper = twoFactor({
                enabled: true,
                required: false,
                enforced: false,
            });
            await flushPromises();
            type('#code', '123456');
            await flushPromises();
            await wrapper.get('[data-test="confirm-form"]').trigger('submit');
            await flushPromises();
            await wrapper.get('[data-test="codes-saved"]').trigger('click');
            await flushPromises();
            await wrapper.get('[data-test="codes-done"]').trigger('click');
            await flushPromises();

            expect(router.visit).not.toHaveBeenCalled();
            expect(wrapper.find('[data-test="recovery-code"]').exists()).toBe(
                false,
            );
        });
    });

    describe('with the second factor on', () => {
        it('has no Disable for an owner or an admin, and says why', () => {
            answer();
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: true,
                enforced: false,
            });

            expect(wrapper.find('[data-test="disable-button"]').exists()).toBe(
                false,
            );
            expect(wrapper.get('[data-test="required-note"]').text()).toBe(
                'Two-factor authentication is required for your role.',
            );
            // Regenerating the codes is still theirs.
            expect(
                wrapper.find('[data-test="regenerate-button"]').exists(),
            ).toBe(true);
        });

        it('has Disable for a role that does not need it, after a confirmation', async () => {
            answer();
            confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: false,
                enforced: false,
            });
            const disable = wrapper.get('[data-test="disable-button"]');

            expect(wrapper.find('[data-test="required-note"]').exists()).toBe(
                false,
            );

            await disable.trigger('click');
            await flushPromises();
            expect(router.delete).not.toHaveBeenCalled();

            await disable.trigger('click');
            await flushPromises();
            expect(router.delete).toHaveBeenCalledWith(
                '/user/two-factor-authentication',
                expect.objectContaining({ preserveScroll: true }),
            );
            expect(confirm).toHaveBeenLastCalledWith(
                expect.objectContaining({ tone: 'destructive' }),
            );
        });

        it('regenerates the codes after a confirmation and shows the new ones', async () => {
            answer();
            confirm.mockResolvedValue(true);
            succeeds(router.post);
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: true,
                enforced: false,
            });

            await wrapper
                .get('[data-test="regenerate-button"]')
                .trigger('click');
            await flushPromises();

            expect(router.post).toHaveBeenCalledWith(
                '/user/two-factor-recovery-codes',
                {},
                expect.objectContaining({ preserveScroll: true }),
            );
            expect(wrapper.findAll('[data-test="recovery-code"]')).toHaveLength(
                8,
            );
        });

        it('does not regenerate when the confirmation is refused', async () => {
            answer();
            confirm.mockResolvedValue(false);
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: true,
                enforced: false,
            });

            await wrapper
                .get('[data-test="regenerate-button"]')
                .trigger('click');
            await flushPromises();

            expect(router.post).not.toHaveBeenCalled();
        });
    });

    describe('when the password has to be confirmed again', () => {
        /** A visit that lands on the password form: Inertia follows Fortify's redirect and calls `onSuccess`. */
        function landsOnPasswordForm(mock: ReturnType<typeof vi.fn>): void {
            mock.mockImplementation(
                (
                    _url: string,
                    dataOrOptions: unknown,
                    options?: { onSuccess?: () => void },
                ) => {
                    page.component = 'Auth/ConfirmPassword';
                    (
                        (options ?? dataOrOptions) as { onSuccess?: () => void }
                    ).onSuccess?.();
                },
            );
        }

        const stale = {
            '/user/confirmed-password-status': { body: { confirmed: false } },
        };

        it('does not say the setup is confirmed, nor show codes, when the confirm visit lands on the form', async () => {
            const fetchMock = answer();
            landsOnPasswordForm(router.post);
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            type('#code', '123456');
            await flushPromises();
            await wrapper.get('[data-test="confirm-form"]').trigger('submit');
            await flushPromises();

            expect(toast.success).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalledWith(
                '/user/two-factor-recovery-codes',
                expect.anything(),
            );
            expect(wrapper.find('[data-test="recovery-code"]').exists()).toBe(
                false,
            );
        });

        it('does not say the codes are new, nor show codes, when the regenerate visit lands on the form', async () => {
            const fetchMock = answer();
            confirm.mockResolvedValue(true);
            landsOnPasswordForm(router.post);
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: true,
                enforced: false,
            });

            await wrapper
                .get('[data-test="regenerate-button"]')
                .trigger('click');
            await flushPromises();

            expect(toast.success).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalledWith(
                '/user/two-factor-recovery-codes',
                expect.anything(),
            );
        });

        it('does not say it is off when the disable visit lands on the form', async () => {
            answer();
            confirm.mockResolvedValue(true);
            landsOnPasswordForm(router.delete);
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: false,
                enforced: false,
            });

            await wrapper.get('[data-test="disable-button"]').trigger('click');
            await flushPromises();

            expect(router.delete).toHaveBeenCalled();
            expect(toast.success).not.toHaveBeenCalled();
        });

        it('does not say it is off when the cancel-setup visit lands on the form', async () => {
            answer();
            confirm.mockResolvedValue(true);
            landsOnPasswordForm(router.delete);
            const wrapper = twoFactor({
                enabled: true,
                required: false,
                enforced: false,
            });
            await flushPromises();

            await wrapper
                .get('[data-test="cancel-setup-button"]')
                .trigger('click');
            await flushPromises();

            expect(toast.success).not.toHaveBeenCalled();
        });

        it('still says so when the visit stays on the page', async () => {
            answer();
            confirm.mockResolvedValue(true);
            succeeds(router.delete);
            const wrapper = twoFactor({
                enabled: true,
                confirmed: true,
                required: false,
                enforced: false,
            });

            await wrapper.get('[data-test="disable-button"]').trigger('click');
            await flushPromises();

            expect(toast.success).toHaveBeenCalledWith(
                'Two-factor authentication is off.',
            );
        });

        it.each([
            [
                'enable',
                { enabled: false },
                '[data-test="enable-button"]',
                'post',
            ],
            [
                'regenerate',
                { enabled: true, confirmed: true },
                '[data-test="regenerate-button"]',
                'post',
            ],
            [
                'disable',
                {
                    enabled: true,
                    confirmed: true,
                    required: false,
                    enforced: false,
                },
                '[data-test="disable-button"]',
                'delete',
            ],
        ] as const)(
            'sends the person to confirm it before %s, and does not post',
            async (_name, props, button, method) => {
                answer(stale);
                confirm.mockResolvedValue(true);
                const wrapper = twoFactor(props);
                await flushPromises();

                await wrapper.get(button).trigger('click');
                await flushPromises();

                expect(router[method]).not.toHaveBeenCalled();
                expect(router.visit).toHaveBeenCalledWith(PASSWORD_PAGE);
            },
        );

        it('sends the person to confirm it before sending the code, and keeps the code', async () => {
            answer(stale);
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();
            // The QR code reads are behind the same confirmation; only the status says it ran out.
            router.visit.mockClear();

            type('#code', '123456');
            await flushPromises();
            await wrapper.get('[data-test="confirm-form"]').trigger('submit');
            await flushPromises();

            expect(router.post).not.toHaveBeenCalled();
            expect(router.visit).toHaveBeenCalledWith(PASSWORD_PAGE);
        });
    });

    describe('cancelling a setup that was never confirmed', () => {
        it('is offered to a role that does not need the second factor, after a confirmation', async () => {
            answer();
            confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            const wrapper = twoFactor({
                enabled: true,
                required: false,
                enforced: false,
            });
            await flushPromises();
            const cancel = wrapper.get('[data-test="cancel-setup-button"]');

            await cancel.trigger('click');
            await flushPromises();
            expect(router.delete).not.toHaveBeenCalled();

            await cancel.trigger('click');
            await flushPromises();
            expect(router.delete).toHaveBeenCalledWith(
                '/user/two-factor-authentication',
                expect.objectContaining({ preserveScroll: true }),
            );
        });

        it('is not offered to an owner or an admin, who have to finish the setup', async () => {
            answer();
            const wrapper = twoFactor({ enabled: true });
            await flushPromises();

            expect(
                wrapper.find('[data-test="cancel-setup-button"]').exists(),
            ).toBe(false);
        });
    });
});
