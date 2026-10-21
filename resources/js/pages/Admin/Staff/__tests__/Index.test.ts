import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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

import StaffIndex from '@/pages/Admin/Staff/Index.vue';
import { resetPage } from '@/test/inertiaPage';
import type {
    StaffInvitationRowData,
    StaffRoleOption,
    StaffRowData,
} from '@/types';

let mounted: VueWrapper | null = null;

const roles: StaffRoleOption[] = (
    ['owner', 'admin', 'estimator', 'production', 'support'] as const
).map((name) => ({
    name,
    label: name.toUpperCase(),
    description: `${name} description`,
    assignable: name !== 'owner',
}));

const row = (over: Partial<StaffRowData> & { id: string }): StaffRowData => ({
    name: 'Someone',
    email: 'someone@example.com',
    role: 'support',
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
    ...over,
});

const none = {
    edit: false,
    deactivate: false,
    activate: false,
    resetTwoFactor: false,
};

const staff: StaffRowData[] = [
    row({
        id: 'ME',
        name: 'Ada Admin',
        role: 'admin',
        twoFactorEnabled: true,
        twoFactorRequired: true,
        can: none,
    }),
    row({
        id: 'OWNER',
        name: 'Olga Owner',
        role: 'owner',
        twoFactorRequired: true,
        can: none,
    }),
    row({
        id: 'ELI',
        name: 'Eli Estimator',
        role: 'estimator',
        lastLoginAt: '2026-10-20T10:00:00+00:00',
        can: {
            edit: true,
            deactivate: true,
            activate: false,
            resetTwoFactor: true,
        },
    }),
    row({
        id: 'GUS',
        name: 'Gus Gone',
        isActive: false,
        can: {
            edit: true,
            deactivate: false,
            activate: true,
            resetTwoFactor: false,
        },
    }),
];

const invitations: StaffInvitationRowData[] = [
    {
        id: 'INV1',
        email: 'pat@example.com',
        name: 'Pat Pending',
        role: 'estimator',
        invitedBy: {
            id: 'ME',
            name: 'Ada Admin',
            avatarUrl: null,
            isStaff: true,
        },
        expiresAt: '2026-10-23T10:00:00+00:00',
        expired: false,
        createdAt: '2026-10-20T10:00:00+00:00',
    },
    {
        id: 'INV2',
        email: 'old@example.com',
        name: 'Olly Old',
        role: 'support',
        invitedBy: null,
        expiresAt: '2026-10-01T10:00:00+00:00',
        expired: true,
        createdAt: '2026-09-28T10:00:00+00:00',
    },
];

function index(props: Record<string, unknown> = {}) {
    mounted = mount(StaffIndex, {
        props: { staff, invitations, roles, currentUserId: 'ME', ...props },
        attachTo: document.body,
    });

    return mounted;
}

const q = <T extends Element>(selector: string): T | null =>
    document.body.querySelector<T>(selector);

beforeEach(() => {
    router.post.mockReset();
    router.put.mockReset();
    router.delete.mockReset();
    confirm.mockReset();
    resetPage({
        auth: {
            user: {
                type: 'staff',
                permissions: ['staff.manage'],
                timezone: 'Asia/Kolkata',
            },
        },
        business: { timezone: 'Asia/Kolkata', locale: 'en-IN' },
        errors: {},
    });
});

afterEach(() => {
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = '';
});

describe('Admin/Staff/Index (11 §7)', () => {
    it('has one h1 and the invite button', () => {
        const wrapper = index();

        expect(wrapper.findAll('h1')).toHaveLength(1);
        expect(wrapper.get('h1').text()).toBe('Staff');
        expect(wrapper.get('[data-test="invite-button"]').text()).toBe(
            'Invite staff member',
        );
    });

    it('lists the members with role, two-factor state and status', () => {
        const wrapper = index();
        const ada = wrapper.get('[data-test="member-ME"]');
        const olga = wrapper.get('[data-test="member-OWNER"]');
        const gus = wrapper.get('[data-test="member-GUS"]');

        expect(ada.text()).toContain('You');
        expect(ada.text()).toContain('ADMIN');
        expect(ada.text()).toContain('On');
        expect(olga.text()).toContain('Off — required');
        expect(gus.text()).toContain('Deactivated');
        expect(wrapper.get('[data-test="member-ELI"]').text()).toContain('Off');
        expect(wrapper.get('[data-test="member-ELI"]').text()).toContain(
            'Active',
        );
    });

    it('offers a menu only on rows with something to do', () => {
        const wrapper = index();

        expect(wrapper.find('[data-test="menu-ME"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="menu-OWNER"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="menu-ELI"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="menu-GUS"]').exists()).toBe(true);
    });

    it('lists the invitations with who invited, and Expired for the old', () => {
        const wrapper = index();
        const pending = wrapper.get('[data-test="invitation-INV1"]');
        const expired = wrapper.get('[data-test="invitation-INV2"]');

        expect(pending.text()).toContain('pat@example.com');
        expect(pending.text()).toContain('Ada Admin');
        expect(pending.text()).not.toContain('Expired');
        expect(expired.text()).toContain('Expired');
    });

    it('says so when no invitation is waiting', () => {
        const wrapper = index({ invitations: [] });

        expect(wrapper.find('[data-test="invitations-table"]').exists()).toBe(
            false,
        );
        expect(wrapper.get('[data-test="invitations-empty"]').text()).toContain(
            'No invitations are waiting.',
        );
    });

    it('resends an invitation at once', async () => {
        const wrapper = index();

        await wrapper
            .get('[data-test="invitation-INV1"] [data-test="resend-button"]')
            .trigger('click');

        expect(router.post).toHaveBeenCalledWith(
            '/admin/staff/invitations/INV1/resend',
            {},
            expect.objectContaining({ preserveScroll: true }),
        );
    });

    it('revokes only after the confirmation', async () => {
        confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const wrapper = index();
        const revoke = wrapper.get(
            '[data-test="invitation-INV1"] [data-test="revoke-button"]',
        );

        await revoke.trigger('click');
        await flushPromises();
        expect(router.delete).not.toHaveBeenCalled();

        await revoke.trigger('click');
        await flushPromises();
        expect(router.delete).toHaveBeenCalledWith(
            '/admin/staff/invitations/INV1',
            expect.objectContaining({ preserveScroll: true }),
        );
        expect(confirm).toHaveBeenLastCalledWith(
            expect.objectContaining({
                title: 'Revoke the invitation to pat@example.com?',
                tone: 'destructive',
            }),
        );
    });

    it('opens the invite dialog', async () => {
        const wrapper = index();

        await wrapper.get('[data-test="invite-button"]').trigger('click');
        await flushPromises();

        expect(q('[data-test="invite-form"]')).not.toBeNull();
    });

    it('opens the menu of a member with the actions it can do', async () => {
        const wrapper = index();

        await wrapper
            .get('[data-test="menu-ELI"]')
            .trigger('keydown', { key: 'Enter' });
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(q('[data-test="action-edit"]')).not.toBeNull();
        expect(q('[data-test="action-deactivate"]')).not.toBeNull();
        expect(q('[data-test="action-reset-two-factor"]')).not.toBeNull();
        expect(q('[data-test="action-activate"]')).toBeNull();
    });
});
