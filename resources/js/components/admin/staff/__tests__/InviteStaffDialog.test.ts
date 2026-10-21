import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { post },
    };
});

import InviteStaffDialog from '@/components/admin/staff/InviteStaffDialog.vue';
import { page, resetPage } from '@/test/inertiaPage';
import type { StaffRoleOption } from '@/types';

let mounted: VueWrapper | null = null;

const roles: StaffRoleOption[] = [
    {
        name: 'owner',
        label: 'Owner',
        description: 'Full access.',
        assignable: true,
    },
    {
        name: 'admin',
        label: 'Admin',
        description: 'Runs the business.',
        assignable: true,
    },
    {
        name: 'estimator',
        label: 'Estimator',
        description: 'Prepares quotes.',
        assignable: true,
    },
    {
        name: 'production',
        label: 'Production',
        description: 'Runs production.',
        assignable: true,
    },
    {
        name: 'support',
        label: 'Support',
        description: 'Answers customers.',
        assignable: true,
    },
];

function dialog(abilities: string[] = [], props: Record<string, unknown> = {}) {
    resetPage({
        auth: {
            user: {
                type: 'staff',
                permissions: ['staff.manage'],
                abilities,
            },
        },
        errors: {},
    });
    mounted = mount(InviteStaffDialog, {
        props: { open: true, roles, ...props },
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

beforeEach(() => {
    post.mockReset();
});

afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
});

describe('InviteStaffDialog (11 §7)', () => {
    it('hides the owner option when the user lacks staff.manage_owners', async () => {
        dialog([]);
        await flushPromises();

        expect(q('[data-test="role-owner"]')).toBeNull();
        expect(
            ['admin', 'estimator', 'production', 'support'].map(
                (name) => q(`[data-test="role-${name}"]`) !== null,
            ),
        ).toEqual([true, true, true, true]);
    });

    it('offers the owner option to a user who passes the gate', async () => {
        dialog(['staff.manage_owners']);
        await flushPromises();

        expect(q('[data-test="role-owner"]')).not.toBeNull();
    });

    it('does not offer a role the server says is not assignable', async () => {
        dialog(['staff.manage_owners'], {
            roles: roles.map((role) =>
                role.name === 'support' ? { ...role, assignable: false } : role,
            ),
        });
        await flushPromises();

        expect(q('[data-test="role-support"]')).toBeNull();
    });

    it('shows each role with its description', async () => {
        dialog();
        await flushPromises();

        const picker = q('[data-test="role-picker"]');

        expect(picker?.textContent).toContain('Prepares quotes.');
        expect(picker?.textContent).toContain('Answers customers.');
    });

    it('cannot be sent before a role is chosen', async () => {
        dialog();
        await flushPromises();

        expect(
            q<HTMLButtonElement>('[data-test="invite-submit"]')?.disabled,
        ).toBe(true);
    });

    it('posts name, email and role to the invitations route', async () => {
        dialog();
        await flushPromises();

        type('#invite-name', 'Nina Hire');
        type('#invite-email', 'nina@example.com');
        q<HTMLElement>('[data-test="role-estimator"]')?.click();
        await flushPromises();

        expect(
            q<HTMLButtonElement>('[data-test="invite-submit"]')?.disabled,
        ).toBe(false);

        q<HTMLFormElement>('[data-test="invite-form"]')?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await flushPromises();

        expect(post).toHaveBeenCalledWith(
            '/admin/staff/invitations',
            { name: 'Nina Hire', email: 'nina@example.com', role: 'estimator' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    it('shows the refusal of the server under the email', async () => {
        dialog();
        page.props.errors = {
            email: 'This email already belongs to an account.',
            code: 'staff.email_in_use',
        };
        await flushPromises();

        expect(q('#invite-email-error')?.textContent).toContain(
            'This email already belongs to an account.',
        );
        expect(q('#invite-email')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('closes after a successful send', async () => {
        post.mockImplementation(
            (
                _url: string,
                _data: unknown,
                options: { onSuccess?: () => void },
            ) => options.onSuccess?.(),
        );
        const wrapper = dialog();
        await flushPromises();

        type('#invite-name', 'Nina Hire');
        type('#invite-email', 'nina@example.com');
        q<HTMLElement>('[data-test="role-support"]')?.click();
        await flushPromises();
        q<HTMLFormElement>('[data-test="invite-form"]')?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await flushPromises();

        expect(wrapper.emitted('update:open')).toEqual([[false]]);
    });
});
