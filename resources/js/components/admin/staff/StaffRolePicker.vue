<script setup lang="ts">
import { computed } from 'vue';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { usePermissions } from '@/composables/usePermissions';
import type { StaffRole, StaffRoleOption } from '@/types';

// 11 §7: one role per member, chosen from radios with their descriptions. The owner role is offered only to someone
// who passes the `staff.manage_owners` gate (13 §7.3); the server enforces it regardless.
const props = defineProps<{
    id: string;
    roles: readonly StaffRoleOption[];
    disabled?: boolean;
    invalid?: boolean;
    describedby?: string;
}>();

const model = defineModel<StaffRole | ''>({ required: true });

const { can } = usePermissions();

const offered = computed(() =>
    props.roles.filter(
        (role) =>
            role.assignable &&
            (role.name !== 'owner' || can('staff.manage_owners')),
    ),
);
</script>

<template>
    <RadioGroup
        :id="id"
        v-model="model"
        name="role"
        :disabled="disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-describedby="describedby"
        class="gap-2"
        data-test="role-picker"
    >
        <div
            v-for="role in offered"
            :key="role.name"
            class="flex items-start gap-3 rounded-lg border p-3"
        >
            <RadioGroupItem
                :id="`${id}-${role.name}`"
                :value="role.name"
                class="mt-0.5"
                :data-test="`role-${role.name}`"
            />
            <Label :for="`${id}-${role.name}`" class="grid gap-0.5 font-normal">
                <span class="font-medium">{{ role.label }}</span>
                <span class="text-sm text-muted-foreground">{{
                    role.description
                }}</span>
            </Label>
        </div>
    </RadioGroup>
</template>
