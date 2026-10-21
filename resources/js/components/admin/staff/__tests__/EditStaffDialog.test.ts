import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const put = vi.hoisted(() => vi.fn());

vi.mock('@inertiajs/vue3', async (importOriginal) => {
    const { page: testPage } = await import('@/test/inertiaPage');

    return {
        ...(await importOriginal<typeof import('@inertiajs/vue3')>()),
        usePage: () => testPage,
        router: { put },
    };
});

import EditStaffDialog from '@/components/admin/staff/EditStaffDialog.vue';
import { page, resetPage } from '@/test/inertiaPage';
import type { StaffRoleOption, StaffRowData } from '@/types';

let mounted: VueWrapper | null = null;

const roles: StaffRoleOption[] = (
    ['owner', 'admin', 'estimator', 'production', 'support'] as const
).map((name) => ({
    name,
    label: name,
    description: `${name} description`,
    assignable: true,
}));

const member: StaffRowData = {
    id: '01JZ0000000000000000000001',
    name: 'Eli Estimator',
    email: 'eli@example.com',
    role: 'estimator',
    twoFactorEnabled: false,
    twoFactorRequired: false,
    isActive: true,
    lastLoginAt: null,
    googleLinked: false,
    can: {
        edit: true,
        deactivate: true,
        activate: false,
        resetTwoFactor: false,
    },
};

function dialog(abilities: string[] = []) {
    resetPage({
        auth: { user: { type: 'staff', abilities } },
        errors: {},
    });
    mounted = mount(EditStaffDialog, {
        props: { open: true, member, roles },
        attachTo: document.body,
    });

    return mounted;
}

const q = <T extends Element>(selector: string): T | null =>
    document.body.querySelector<T>(selector);

beforeEach(() => {
    put.mockReset();
});

afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
});

describe('EditStaffDialog (11 §7)', () => {
    it('starts with the name and the role of the member', async () => {
        dialog();
        await flushPromises();

        expect(q<HTMLInputElement>('#edit-name')?.value).toBe('Eli Estimator');
        expect(
            q('[data-test="role-estimator"]')?.getAttribute('aria-checked'),
        ).toBe('true');
        expect(q('[role="dialog"]')?.textContent).toContain(
            'Edit Eli Estimator',
        );
    });

    it('hides the owner option without staff.manage_owners', async () => {
        dialog();
        await flushPromises();

        expect(q('[data-test="role-owner"]')).toBeNull();
    });

    it('puts the new role and name to the update route', async () => {
        dialog();
        await flushPromises();

        q<HTMLElement>('[data-test="role-production"]')?.click();
        await flushPromises();
        q<HTMLFormElement>('[data-test="edit-form"]')?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await flushPromises();

        expect(put).toHaveBeenCalledWith(
            `/admin/staff/${member.id}`,
            { name: 'Eli Estimator', role: 'production' },
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    async function submit(): Promise<void> {
        q<HTMLFormElement>('[data-test="edit-form"]')?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await flushPromises();
    }

    it('shows the last-owner refusal under the role', async () => {
        put.mockImplementation(
            (
                _url: string,
                _data: unknown,
                options: { onError?: (errors: Record<string, string>) => void },
            ) =>
                options.onError?.({
                    role: 'There must be at least one active owner.',
                    code: 'staff.last_owner',
                }),
        );
        dialog();
        await flushPromises();

        await submit();

        expect(q('#edit-role-error')?.textContent).toContain(
            'There must be at least one active owner.',
        );
    });

    it('starts without the refusal of the last time when it is opened again', async () => {
        put.mockImplementation(
            (
                _url: string,
                _data: unknown,
                options: { onError?: (errors: Record<string, string>) => void },
            ) => options.onError?.({ role: 'There must be an owner.' }),
        );
        const wrapper = dialog();
        await flushPromises();
        await submit();
        expect(q('#edit-role-error')?.textContent).toContain(
            'There must be an owner.',
        );

        await wrapper.setProps({ open: false });
        await flushPromises();
        await wrapper.setProps({ open: true });
        await flushPromises();

        expect(q('#edit-role-error')?.textContent?.trim() ?? '').toBe('');
    });

    it('does not show an error that belongs to something else on the page', async () => {
        const wrapper = dialog();
        await wrapper.setProps({ open: false });
        page.props.errors = {
            name: 'A name from another form.',
            role: 'A role from another form.',
        };
        await wrapper.setProps({ open: true });
        await flushPromises();

        expect(q('#edit-name-error')?.textContent?.trim() ?? '').toBe('');
        expect(q('#edit-role-error')?.textContent?.trim() ?? '').toBe('');
    });
});
