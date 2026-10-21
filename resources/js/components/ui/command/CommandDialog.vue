<script setup lang="ts">
import type { DialogRootEmits, DialogRootProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import { useForwardPropsEmits } from "reka-ui"
import { useI18n } from "@/composables/useI18n"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import Command from "./Command.vue"

const props = defineProps<DialogRootProps & {
  title?: string
  description?: string
}>()
const emits = defineEmits<DialogRootEmits>()

const { t } = useI18n()

const forwarded = useForwardPropsEmits(reactiveOmit(props, "title", "description"), emits)
</script>

<template>
  <Dialog v-slot="slotProps" v-bind="forwarded">
    <DialogContent class="overflow-hidden p-0 ">
      <DialogHeader class="sr-only">
        <DialogTitle>{{ title ?? t("a11y.command_palette") }}</DialogTitle>
        <DialogDescription>{{ description ?? t("a11y.command_palette_description") }}</DialogDescription>
      </DialogHeader>
      <Command>
        <slot v-bind="slotProps" />
      </Command>
    </DialogContent>
  </Dialog>
</template>
