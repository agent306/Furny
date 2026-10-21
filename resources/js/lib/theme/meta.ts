import type { ResolvedAppearance } from '@/types';

/**
 * Resolved `--background` per theme, precomputed for `<meta name="theme-color">`
 * (15 §11). The PHP twin is `HandleAppearance::THEME_COLOR`; a Pest test keeps
 * the two in sync.
 */
export const THEME_COLOR = {
    light: '#fbfaf7',
    dark: '#1d1a17',
} as const satisfies Record<ResolvedAppearance, string>;

/** Points the page's `theme-color` meta at the resolved theme, creating the tag when absent. */
export function applyThemeColor(resolved: ResolvedAppearance): void {
    if (typeof document === 'undefined') {
        return;
    }

    let meta = document.head.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]',
    );

    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.append(meta);
    }

    meta.content = THEME_COLOR[resolved];
}
