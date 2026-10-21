<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import { toast } from 'vue-sonner';
import EditStaffDialog from '@/components/admin/staff/EditStaffDialog.vue';
import InviteStaffDialog from '@/components/admin/staff/InviteStaffDialog.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useConfirm } from '@/composables/useConfirm';
import { useControlSize } from '@/composables/useControlSize';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { usePermissions } from '@/composables/usePermissions';
import { ICONS } from '@/lib/icons';
import { activate, deactivate } from '@/routes/admin/staff';
import { resend, revoke } from '@/routes/admin/staff/invitations';
import { reset as resetTwoFactor } from '@/routes/admin/staff/two-factor';
import type {
    StaffInvitationRowData,
    StaffRoleOption,
    StaffRowData,
} from '@/types';

// 11 §7. The Members table and the Invitations table of the staff, with the actions of 14 §10. Everything the menus
// offer is a hint from `can`; the server decides.
const props = defineProps<{
    staff: StaffRowData[];
    invitations: StaffInvitationRowData[];
    roles: StaffRoleOption[];
    currentUserId: string;
}>();

const { t } = useI18n();
const { confirm } = useConfirm();
const { formatDateTime } = useFormat();
const size = useControlSize();
const { can } = usePermissions();

const inviting = ref(false);
const editing = ref<StaffRowData | null>(null);
const editOpen = computed({
    get: () => editing.value !== null,
    set: (value: boolean) => {
        if (!value) {
            editing.value = null;
        }
    },
});

const roleLabels = computed(
    () => new Map(props.roles.map((role) => [role.name, role.label])),
);

function roleLabel(name: string): string {
    return roleLabels.value.get(name as StaffRoleOption['name']) ?? name;
}

/** A refusal with no field of its own (`_error`, 14 §1.9) is shown as a toast. */
function toastRefusal(errors: Record<string, string>): void {
    const message = errors._error ?? Object.values(errors)[0];

    if (message) {
        toast.error(message);
    }
}

const visit = { preserveScroll: true, onError: toastRefusal } as const;

async function deactivateMember(member: StaffRowData): Promise<void> {
    const confirmed = await confirm({
        title: t('staff.confirm.deactivate.title', { name: member.name }),
        description: t('staff.confirm.deactivate.description'),
        confirmLabel: t('staff.confirm.deactivate.action'),
        tone: 'destructive',
    });

    if (confirmed) {
        router.post(deactivate.url(member.id), {}, visit);
    }
}

function activateMember(member: StaffRowData): void {
    router.post(activate.url(member.id), {}, visit);
}

async function resetMemberTwoFactor(member: StaffRowData): Promise<void> {
    const confirmed = await confirm({
        title: t('staff.confirm.reset_two_factor.title', {
            name: member.name,
        }),
        description: t('staff.confirm.reset_two_factor.description'),
        confirmLabel: t('staff.confirm.reset_two_factor.action'),
        tone: 'warning',
    });

    if (confirmed) {
        router.delete(resetTwoFactor.url(member.id), visit);
    }
}

function resendInvitation(invitation: StaffInvitationRowData): void {
    router.post(resend.url(invitation.id), {}, visit);
}

async function revokeInvitation(
    invitation: StaffInvitationRowData,
): Promise<void> {
    const confirmed = await confirm({
        title: t('staff.confirm.revoke.title', { email: invitation.email }),
        description: t('staff.confirm.revoke.description'),
        confirmLabel: t('staff.confirm.revoke.action'),
        tone: 'destructive',
    });

    if (confirmed) {
        router.delete(revoke.url(invitation.id), visit);
    }
}

/**
 * An invitation to the owner role is for owners to resend or revoke (13 §7.3, `staff.manage_owners`); for anybody else
 * the buttons would only lead to the 403 page.
 */
function canManageInvitation(invitation: StaffInvitationRowData): boolean {
    return invitation.role !== 'owner' || can('staff.manage_owners');
}

function hasActions(member: StaffRowData): boolean {
    return Object.values(member.can).some(Boolean);
}
</script>

<template>
    <Head :title="t('staff.title')" />

    <div class="space-y-8">
        <PageHeader
            :title="t('staff.title')"
            :description="t('staff.description')"
        >
            <template #actions>
                <Button
                    :size="size"
                    data-test="invite-button"
                    @click="inviting = true"
                >
                    <component
                        :is="ICONS['user-plus']"
                        aria-hidden="true"
                        class="size-4"
                    />
                    {{ t('staff.invite') }}
                </Button>
            </template>
        </PageHeader>

        <section aria-labelledby="members-heading" class="space-y-3">
            <h2 id="members-heading" class="text-lg font-semibold">
                {{ t('staff.members.title') }}
            </h2>

            <Table data-test="members-table">
                <TableHeader>
                    <TableRow>
                        <TableHead>{{
                            t('staff.members.columns.member')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.members.columns.role')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.members.columns.two_factor')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.members.columns.status')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.members.columns.last_login')
                        }}</TableHead>
                        <TableHead class="w-12">
                            <span class="sr-only">{{
                                t('staff.members.columns.actions')
                            }}</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow
                        v-for="member in staff"
                        :key="member.id"
                        :data-test="`member-${member.id}`"
                    >
                        <TableCell>
                            <div class="font-medium">
                                {{ member.name }}
                                <Badge
                                    v-if="member.id === currentUserId"
                                    variant="neutral"
                                    class="ml-1"
                                >
                                    {{ t('staff.members.you') }}
                                </Badge>
                            </div>
                            <div class="text-muted-foreground">
                                {{ member.email }}
                            </div>
                        </TableCell>
                        <TableCell>
                            <Badge variant="primary">{{
                                roleLabel(member.role)
                            }}</Badge>
                        </TableCell>
                        <TableCell>
                            <Badge
                                v-if="member.twoFactorEnabled"
                                variant="success"
                            >
                                <component
                                    :is="ICONS['shield-check']"
                                    aria-hidden="true"
                                />
                                {{ t('staff.members.two_factor.on') }}
                            </Badge>
                            <Badge
                                v-else-if="member.twoFactorRequired"
                                variant="danger"
                            >
                                <component
                                    :is="ICONS['shield-alert']"
                                    aria-hidden="true"
                                />
                                {{ t('staff.members.two_factor.off_required') }}
                            </Badge>
                            <Badge v-else variant="neutral">{{
                                t('staff.members.two_factor.off')
                            }}</Badge>
                        </TableCell>
                        <TableCell>
                            <Badge
                                :variant="
                                    member.isActive ? 'success' : 'neutral'
                                "
                            >
                                {{
                                    member.isActive
                                        ? t('staff.members.status.active')
                                        : t('staff.members.status.inactive')
                                }}
                            </Badge>
                        </TableCell>
                        <TableCell>
                            {{
                                member.lastLoginAt === null
                                    ? t('staff.members.never')
                                    : formatDateTime(member.lastLoginAt)
                            }}
                        </TableCell>
                        <TableCell class="text-right">
                            <DropdownMenu v-if="hasActions(member)">
                                <DropdownMenuTrigger as-child>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        :aria-label="
                                            t('staff.members.menu', {
                                                name: member.name,
                                            })
                                        "
                                        :data-test="`menu-${member.id}`"
                                    >
                                        <component
                                            :is="ICONS['ellipsis-vertical']"
                                            aria-hidden="true"
                                        />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        v-if="member.can.edit"
                                        data-test="action-edit"
                                        @select="editing = member"
                                    >
                                        {{ t('staff.members.actions.edit') }}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        v-if="member.can.activate"
                                        data-test="action-activate"
                                        @select="activateMember(member)"
                                    >
                                        {{
                                            t('staff.members.actions.activate')
                                        }}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        v-if="member.can.resetTwoFactor"
                                        data-test="action-reset-two-factor"
                                        @select="resetMemberTwoFactor(member)"
                                    >
                                        {{
                                            t(
                                                'staff.members.actions.reset_two_factor',
                                            )
                                        }}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator
                                        v-if="member.can.deactivate"
                                    />
                                    <DropdownMenuItem
                                        v-if="member.can.deactivate"
                                        variant="destructive"
                                        data-test="action-deactivate"
                                        @select="deactivateMember(member)"
                                    >
                                        {{
                                            t(
                                                'staff.members.actions.deactivate',
                                            )
                                        }}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </section>

        <section aria-labelledby="invitations-heading" class="space-y-3">
            <h2 id="invitations-heading" class="text-lg font-semibold">
                {{ t('staff.invitations.title') }}
            </h2>

            <EmptyState
                v-if="invitations.length === 0"
                icon="send"
                size="sm"
                :title="t('staff.invitations.empty')"
                data-test="invitations-empty"
            />

            <Table v-else data-test="invitations-table">
                <TableHeader>
                    <TableRow>
                        <TableHead>{{
                            t('staff.invitations.columns.email')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.invitations.columns.role')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.invitations.columns.invited_by')
                        }}</TableHead>
                        <TableHead>{{
                            t('staff.invitations.columns.expires')
                        }}</TableHead>
                        <TableHead class="w-48">
                            <span class="sr-only">{{
                                t('staff.invitations.columns.actions')
                            }}</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow
                        v-for="invitation in invitations"
                        :key="invitation.id"
                        :data-test="`invitation-${invitation.id}`"
                    >
                        <TableCell>
                            <div class="font-medium">{{ invitation.name }}</div>
                            <div class="text-muted-foreground">
                                {{ invitation.email }}
                            </div>
                        </TableCell>
                        <TableCell>
                            <Badge variant="primary">{{
                                roleLabel(invitation.role)
                            }}</Badge>
                        </TableCell>
                        <TableCell>
                            {{
                                invitation.invitedBy?.name ??
                                t('staff.invitations.unknown_inviter')
                            }}
                        </TableCell>
                        <TableCell>
                            <Badge v-if="invitation.expired" variant="warning">
                                {{ t('staff.invitations.expired') }}
                            </Badge>
                            <template v-else>
                                {{ formatDateTime(invitation.expiresAt) }}
                            </template>
                        </TableCell>
                        <TableCell class="text-right">
                            <div
                                v-if="canManageInvitation(invitation)"
                                class="flex justify-end gap-1"
                            >
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="
                                        t('staff.invitations.resend_aria', {
                                            email: invitation.email,
                                        })
                                    "
                                    data-test="resend-button"
                                    @click="resendInvitation(invitation)"
                                >
                                    {{ t('staff.invitations.resend') }}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    :aria-label="
                                        t('staff.invitations.revoke_aria', {
                                            email: invitation.email,
                                        })
                                    "
                                    data-test="revoke-button"
                                    @click="revokeInvitation(invitation)"
                                >
                                    {{ t('staff.invitations.revoke') }}
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </section>
    </div>

    <InviteStaffDialog v-model:open="inviting" :roles="roles" />
    <EditStaffDialog v-model:open="editOpen" :member="editing" :roles="roles" />
</template>
