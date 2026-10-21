import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Tone variants (15 §4): the -subtle / -subtle-foreground token pairs.
        // 15 §3.1 defines no subtle pair for neutral and primary, so those two
        // use the muted pair and a 10% primary tint instead.
        neutral:
          "border-transparent bg-muted text-muted-foreground",
        info: "border-transparent bg-info-subtle text-info-subtle-foreground",
        success:
          "border-transparent bg-success-subtle text-success-subtle-foreground",
        warning:
          "border-transparent bg-warning-subtle text-warning-subtle-foreground",
        danger:
          "border-transparent bg-danger-subtle text-danger-subtle-foreground",
        primary:
          "border-transparent bg-primary/10 text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
