<script setup lang="ts">
// 15 §13: 5-7 gently curved, concentric "wood grain" strokes behind the
// EmptyState icon circle. Decorative only.
const STROKES = [
    { rx: 112, ry: 52 },
    { rx: 96, ry: 44 },
    { rx: 80, ry: 36 },
    { rx: 64, ry: 28 },
    { rx: 48, ry: 20 },
    { rx: 32, ry: 12 },
] as const;
</script>

<template>
    <svg
        viewBox="0 0 240 120"
        width="240"
        height="120"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <g transform="rotate(-4 120 60)">
            <ellipse
                v-for="stroke in STROKES"
                :key="stroke.rx"
                data-stroke
                cx="120"
                cy="60"
                :rx="stroke.rx"
                :ry="stroke.ry"
                stroke="var(--brand-wood)"
                stroke-opacity="0.18"
                stroke-width="1"
            />
        </g>
    </svg>
</template>
