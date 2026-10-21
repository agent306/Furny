<script setup lang="ts">
import { router, useForm } from '@inertiajs/vue3';
import { MailWarning } from '@lucide/vue';
import { computed, ref } from 'vue';
import { toast } from 'vue-sonner';
import PhoneVerifyDialog from '@/components/account/PhoneVerifyDialog.vue';
import FormSection from '@/components/common/FormSection.vue';
import InputError from '@/components/common/InputError.vue';
import RequiredMark from '@/components/common/RequiredMark.vue';
import StickyActionBar from '@/components/common/StickyActionBar.vue';
import UserAvatar from '@/components/display/UserAvatar.vue';
import ImageUploader from '@/components/media/ImageUploader.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useControlSize } from '@/composables/useControlSize';
import { useFocusFirstError } from '@/composables/useFocusFirstError';
import { useFormat } from '@/composables/useFormat';
import { useI18n } from '@/composables/useI18n';
import { accountUrls } from '@/lib/account';
import type { AccountAudience } from '@/lib/account';
import type { UploadedFileRef } from '@/lib/upload';
import { update as updateProfile } from '@/routes/user-profile-information';
import { send as sendVerification } from '@/routes/verification';
import type { AuthUserData, OtpChannel } from '@/types';

// 10 §13.2, 11 §18: the photo, the details (Fortify's `user-profile-information.update`: `name`, `email`, and for
// customers `marketing_opt_in`), the phone number and the email verification. Staff must keep an email and have no
// marketing choice. The photo is 5 MB at most (13 §11.1).
const props = defineProps<{
    audience: AccountAudience;
    user: AuthUserData;
    marketingOptIn: boolean;
    otpChannels: OtpChannel[];
}>();

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const TOAST_HEADER = 'X-Throttle-Toast';
const FORM_ID = 'profile-form';

const { t } = useI18n();
const { formatFileSize } = useFormat();
const size = useControlSize();
const { focusFirstError } = useFocusFirstError();

const isStaff = computed(() => props.audience === 'admin');
const urls = computed(() => accountUrls(props.audience));

const form = useForm({
    name: props.user.name,
    email: props.user.email ?? '',
    marketing_opt_in: props.marketingOptIn,
});

const emailChanged = computed(
    () => form.email.trim().toLowerCase() !== (props.user.email ?? ''),
);

function submit(): void {
    form.put(updateProfile.url(), {
        preserveScroll: true,
        onSuccess: () => form.defaults().reset(),
        onError: () => void focusFirstError(),
    });
}

function discard(): void {
    form.reset();
    form.clearErrors();
}

// The photo: a ready upload is sent at once; the uploader is emptied after the answer.
const photo = ref<UploadedFileRef[]>([]);
const photoBusy = ref(false);
const photoError = ref<string | undefined>();

function savePhoto(uploadId: string | null): void {
    photoError.value = undefined;

    router.put(
        urls.value.avatar,
        { uploadId },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (photoBusy.value = true),
            onFinish: () => {
                photoBusy.value = false;
                photo.value = [];
            },
            onError: (errors) => {
                photoError.value = errors._error ?? errors.uploadId;
            },
        },
    );
}

function onPhotoChange(files: UploadedFileRef[]): void {
    photo.value = files;

    const ready = files[0];

    if (ready !== undefined && !photoBusy.value) {
        savePhoto(ready.uploadId);
    }
}

// The phone number: the dialog adds or changes it.
const dialogOpen = ref(false);
const phoneAvailable = computed(() => props.otpChannels.length > 0);

// The email link.
const sending = ref(false);

function resend(): void {
    router.post(
        sendVerification.url(),
        {},
        {
            headers: { [TOAST_HEADER]: '1' },
            preserveScroll: true,
            preserveState: true,
            onStart: () => (sending.value = true),
            onFinish: () => (sending.value = false),
            onSuccess: (visited) => {
                if (!visited.flash?.error) {
                    toast.success(t('common.verify_banner.email_sent'));
                }
            },
        },
    );
}
</script>

<template>
    <FormSection
        :title="t('account.profile.photo.title')"
        :description="t('account.profile.photo.description')"
    >
        <div class="flex flex-wrap items-center gap-4">
            <UserAvatar :user="user" size="lg" />
            <Button
                v-if="user.avatarUrl"
                type="button"
                variant="outline"
                :size="size"
                :disabled="photoBusy"
                data-test="remove-photo"
                @click="savePhoto(null)"
            >
                {{ t('account.profile.photo.remove') }}
            </Button>
        </div>
        <ImageUploader
            :model-value="photo"
            purpose="avatar"
            :max-size-bytes="AVATAR_MAX_BYTES"
            :max-files="1"
            :show-camera="false"
            :disabled="photoBusy"
            :label="t('account.profile.photo.upload_label')"
            :hint="
                t('account.profile.photo.upload_hint', {
                    max: formatFileSize(AVATAR_MAX_BYTES),
                })
            "
            layout="list"
            @update:model-value="onPhotoChange"
        />
        <InputError id="photo-error" :message="photoError" />
    </FormSection>

    <form
        :id="FORM_ID"
        class="divide-y"
        novalidate
        data-test="profile-form"
        @submit.prevent="submit"
    >
        <FormSection
            :title="t('account.profile.details.title')"
            :description="t('account.profile.details.description')"
        >
            <div class="grid gap-2">
                <Label for="name"
                    >{{ t('account.profile.details.name') }} <RequiredMark
                /></Label>
                <Input
                    id="name"
                    v-model="form.name"
                    name="name"
                    type="text"
                    :size="size"
                    required
                    aria-required="true"
                    minlength="2"
                    maxlength="120"
                    autocomplete="name"
                    :aria-invalid="form.errors.name ? 'true' : undefined"
                    :aria-describedby="
                        form.errors.name ? 'name-error' : undefined
                    "
                />
                <InputError id="name-error" :message="form.errors.name" />
            </div>

            <div class="grid gap-2">
                <Label for="email">
                    {{ t('account.profile.details.email') }}
                    <RequiredMark v-if="isStaff" />
                </Label>
                <Input
                    id="email"
                    v-model="form.email"
                    name="email"
                    type="email"
                    :size="size"
                    :required="isStaff"
                    :aria-required="isStaff ? 'true' : undefined"
                    autocomplete="email"
                    :aria-invalid="form.errors.email ? 'true' : undefined"
                    :aria-describedby="
                        form.errors.email ? 'email-error' : 'email-hint'
                    "
                />
                <p
                    v-if="emailChanged"
                    id="email-hint"
                    class="text-sm text-muted-foreground"
                    data-test="email-hint"
                >
                    {{ t('account.profile.details.email_hint') }}
                </p>
                <InputError id="email-error" :message="form.errors.email" />
            </div>

            <div v-if="!isStaff" class="flex items-start gap-3">
                <Checkbox
                    id="marketing_opt_in"
                    v-model="form.marketing_opt_in"
                    name="marketing_opt_in"
                    class="mt-0.5"
                />
                <Label
                    for="marketing_opt_in"
                    class="block text-sm leading-relaxed font-normal"
                >
                    {{ t('account.profile.details.marketing_opt_in') }}
                </Label>
            </div>
        </FormSection>

        <!-- Above the phone tab bar of the customer app (h-16 and the safe-area inset). -->
        <StickyActionBar
            :class="
                audience === 'customer' &&
                'max-md:bottom-[calc(4rem+env(safe-area-inset-bottom))]'
            "
            :dirty="form.isDirty"
            :processing="form.processing"
            :form="FORM_ID"
            @discard="discard"
        />
    </form>

    <FormSection
        v-if="user.email && !user.emailVerified"
        :title="t('account.profile.email_verification.title')"
        :description="t('account.profile.email_verification.description')"
    >
        <Alert role="status" data-test="email-unverified">
            <MailWarning aria-hidden="true" />
            <AlertDescription class="space-y-2">
                <p>{{ user.email }}</p>
                <Button
                    type="button"
                    variant="outline"
                    :size="size"
                    :disabled="sending"
                    data-test="resend-link"
                    @click="resend"
                >
                    <Spinner v-if="sending" />
                    {{ t('account.profile.email_verification.resend') }}
                </Button>
            </AlertDescription>
        </Alert>
    </FormSection>

    <FormSection
        id="phone"
        :title="t('account.profile.phone.title')"
        :description="
            t(
                isStaff
                    ? 'account.profile.phone.staff_description'
                    : 'account.profile.phone.description',
            )
        "
    >
        <div class="flex flex-wrap items-center gap-3">
            <template v-if="user.phoneE164">
                <span class="font-medium" data-test="phone-number">{{
                    user.phoneE164
                }}</span>
                <Badge
                    :variant="user.phoneVerified ? 'success' : 'warning'"
                    data-test="phone-status"
                >
                    {{
                        user.phoneVerified
                            ? t('account.profile.phone.verified')
                            : t('account.profile.phone.not_verified')
                    }}
                </Badge>
            </template>
            <span v-else class="text-sm text-muted-foreground">{{
                t('account.profile.phone.none')
            }}</span>
        </div>
        <p
            v-if="!phoneAvailable"
            class="text-sm text-muted-foreground"
            data-test="phone-unavailable"
        >
            {{ t('account.profile.phone.unavailable') }}
        </p>
        <Button
            v-else
            type="button"
            variant="outline"
            :size="size"
            data-test="phone-button"
            @click="dialogOpen = true"
        >
            {{
                !user.phoneE164
                    ? t('account.profile.phone.add')
                    : user.phoneVerified
                      ? t('account.phone_dialog.change_number')
                      : t('account.profile.phone.verify')
            }}
        </Button>
        <PhoneVerifyDialog
            v-model:open="dialogOpen"
            :initial-phone="user.phoneE164"
        />
    </FormSection>
</template>
