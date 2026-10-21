<script setup lang="ts">
import type { PaginationPrevProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "@/components/ui/button"
import { ChevronLeftIcon } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { useI18n } from "@/composables/useI18n"
import { cn } from "@/lib/utils"
import { PaginationPrev, useForwardProps } from "reka-ui"
import { buttonVariants } from "@/components/ui/button"

const props = withDefaults(defineProps<PaginationPrevProps & {
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
}>(), {
  size: "default",
})

const delegatedProps = reactiveOmit(props, "class", "size")
const forwarded = useForwardProps(delegatedProps)

const { t } = useI18n()
</script>

<template>
  <PaginationPrev
    data-slot="pagination-previous"
    :class="cn(buttonVariants({ variant: 'ghost', size }), 'gap-1 px-2.5 sm:pr-2.5', props.class)"
    :aria-label="t('common.pagination.previous')"
    v-bind="forwarded"
  >
    <slot>
      <ChevronLeftIcon />
      <span class="hidden sm:block">{{ t("common.pagination.previous") }}</span>
    </slot>
  </PaginationPrev>
</template>
