<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import CopyButton from '@/components/common/CopyButton.vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useControlSize } from '@/composables/useControlSize';
import { useI18n } from '@/composables/useI18n';
import { ICONS } from '@/lib/icons';

// 13 §5.10, 11 §18: the eight recovery codes of a second factor, shown once for the person to keep. Copy and Download
// are client-side (a Blob; nothing is sent anywhere), and the button that closes the panel stays disabled until the
// person ticks "I saved these codes".
const props = defineProps<{
    codes: readonly string[];
    /** The label of the button that closes the panel. */
    doneLabel: string;
}>();

const emit = defineEmits<{ done: [] }>();

const { t } = useI18n();
const page = usePage();
const size = useControlSize();
const saved = ref(false);

const text = computed(() => props.codes.join('\n'));
const fileName = computed(() => {
    // The app's name in a form a file can carry: "Furny Joinery" → furny-joinery.
    const name = (page.props.app?.name ?? 'app')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return `${name === '' ? 'app' : name}-recovery-codes.txt`;
});

function download(): void {
    const url = URL.createObjectURL(
        new Blob([`${text.value}\n`], { type: 'text/plain' }),
    );
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName.value;
    link.click();
    URL.revokeObjectURL(url);
}
</script>

<template>
    <section
        class="space-y-4"
        aria-labelledby="codes-heading"
        data-test="recovery-codes"
    >
        <div class="space-y-1">
            <h2 id="codes-heading" class="text-lg font-semibold">
                {{ t('account.two_factor.codes.title') }}
            </h2>
            <p class="text-sm text-muted-foreground">
                {{ t('account.two_factor.codes.description') }}
            </p>
        </div>

        <ul
            class="grid gap-2 rounded-lg border bg-muted/40 p-4 font-mono text-sm sm:grid-cols-2"
            :aria-label="t('account.two_factor.codes.list')"
        >
            <li
                v-for="code in codes"
                :key="code"
                data-test="recovery-code"
                class="select-all"
            >
                {{ code }}
            </li>
        </ul>

        <div class="flex flex-wrap items-center gap-2">
            <CopyButton
                :value="text"
                :label="t('account.two_factor.codes.copy')"
                data-test="codes-copy"
            />
            <Button
                type="button"
                variant="outline"
                :size="size"
                data-test="codes-download"
                @click="download"
            >
                <component
                    :is="ICONS['download']"
                    aria-hidden="true"
                    class="size-4"
                />
                {{ t('account.two_factor.codes.download') }}
            </Button>
        </div>

        <div class="flex min-h-11 items-center gap-3">
            <Checkbox
                id="codes-saved"
                v-model="saved"
                required
                data-test="codes-saved"
            />
            <Label for="codes-saved" class="font-normal"
                >{{ t('account.two_factor.codes.saved') }} <RequiredMark
            /></Label>
        </div>

        <Button
            type="button"
            :size="size"
            :disabled="!saved"
            data-test="codes-done"
            @click="emit('done')"
        >
            {{ doneLabel }}
        </Button>
    </section>
</template>
