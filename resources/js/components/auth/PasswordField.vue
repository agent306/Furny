<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue';
import { ref } from 'vue';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/composables/useI18n';

// A password input with a show/hide toggle (10 §4.2). Every other attribute (`id`, `name`, `autocomplete`,
// `aria-*`, `passwordrules`) goes to the input.
defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const visible = ref(false);
</script>

<template>
    <div class="relative">
        <Input
            v-bind="$attrs"
            :type="visible ? 'text' : 'password'"
            class="pr-11"
        />
        <button
            type="button"
            class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            :aria-label="
                visible
                    ? t('auth_ui.password.hide')
                    : t('auth_ui.password.show')
            "
            :aria-pressed="visible"
            @click="visible = !visible"
        >
            <EyeOff v-if="visible" class="size-4" aria-hidden="true" />
            <Eye v-else class="size-4" aria-hidden="true" />
        </button>
    </div>
</template>
