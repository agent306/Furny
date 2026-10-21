import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { badgeVariants } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';

// 15 §4: the shadcn-vue set, plus the tone variants added after install.
const UI_ROOT = 'resources/js/components/ui';

const COMPONENTS = [
    'accordion',
    'alert',
    'alert-dialog',
    'aspect-ratio',
    'avatar',
    'badge',
    'breadcrumb',
    'button',
    'calendar',
    'card',
    'checkbox',
    'collapsible',
    'combobox',
    'command',
    'context-menu',
    'dialog',
    'drawer',
    'dropdown-menu',
    'hover-card',
    'input',
    'label',
    'navigation-menu',
    'number-field',
    'pagination',
    'pin-input',
    'popover',
    'progress',
    'radio-group',
    'range-calendar',
    'resizable',
    'scroll-area',
    'select',
    'separator',
    'sheet',
    'sidebar',
    'skeleton',
    'slider',
    'sonner',
    'switch',
    'table',
    'tabs',
    'tags-input',
    'textarea',
    'toggle',
    'toggle-group',
    'tooltip',
] as const;

// Not in 15 §4 but required by it: `calendar` renders `native-select`
// (registry dependency), `input-otp`/`spinner` are used by the auth pages.
const SUPPORTING = ['native-select', 'input-otp', 'spinner'] as const;

// shadcn-vue keeps the upper-case acronym in `InputOTP`, and `resizable`
// has no single root: its entry component is the panel group.
function root(name: string): string {
    if (name === 'input-otp') {
        return 'InputOTP';
    }

    if (name === 'resizable') {
        return 'ResizablePanelGroup';
    }

    return name
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

describe('buttonVariants', () => {
    it('adds the success and warning tone variants', () => {
        const success = buttonVariants({ variant: 'success' });
        const warning = buttonVariants({ variant: 'warning' });

        expect(success).toContain('bg-success');
        expect(success).toContain('text-success-foreground');
        expect(success).toContain('hover:bg-success/90');
        expect(warning).toContain('bg-warning');
        expect(warning).toContain('text-warning-foreground');
    });

    it('keeps the six base variants', () => {
        for (const variant of [
            'default',
            'secondary',
            'outline',
            'ghost',
            'link',
            'destructive',
        ] as const) {
            expect(buttonVariants({ variant })).toContain('inline-flex');
        }
    });

    it('has the control-height sizes of 15 §3.3', () => {
        expect(buttonVariants({ size: 'sm' })).toContain('h-8');
        expect(buttonVariants({ size: 'default' })).toContain('h-9');
        expect(buttonVariants({ size: 'lg' })).toContain('h-11');
        expect(buttonVariants({ size: 'icon' })).toContain('size-9');
        expect(buttonVariants({ size: 'icon-lg' })).toContain('size-11');
    });

    it('does not use hard-coded white on the destructive variant', () => {
        expect(buttonVariants({ variant: 'destructive' })).toContain(
            'text-destructive-foreground',
        );
        expect(buttonVariants({ variant: 'destructive' })).not.toMatch(
            /text-white/,
        );
    });
});

describe('badgeVariants', () => {
    it.each(['info', 'success', 'warning', 'danger'] as const)(
        '%s uses the -subtle token pair on a transparent border',
        (variant) => {
            const classes = badgeVariants({ variant });

            expect(classes).toContain(`bg-${variant}-subtle`);
            expect(classes).toContain(`text-${variant}-subtle-foreground`);
            expect(classes).toContain('border-transparent');
        },
    );

    it('neutral and primary use tokens too (15 §3.1 has no subtle pair for them)', () => {
        const neutral = badgeVariants({ variant: 'neutral' });
        const primary = badgeVariants({ variant: 'primary' });

        expect(neutral).toContain('bg-muted');
        expect(neutral).toContain('text-muted-foreground');
        expect(neutral).toContain('border-transparent');
        expect(primary).toContain('bg-primary/10');
        expect(primary).toContain('text-primary');
        expect(primary).toContain('border-transparent');
    });

    it('keeps the base variants', () => {
        for (const variant of [
            'default',
            'secondary',
            'outline',
            'destructive',
        ] as const) {
            expect(badgeVariants({ variant })).toContain('inline-flex');
        }

        expect(badgeVariants({ variant: 'destructive' })).not.toMatch(
            /text-white/,
        );
    });
});

describe('component set (15 §4)', () => {
    it('lists the 46 components of the spec', () => {
        expect(COMPONENTS).toHaveLength(46);
        expect(new Set(COMPONENTS).size).toBe(46);
    });

    it.each([...COMPONENTS, ...SUPPORTING])(
        '%s exists with an index.ts and its root component',
        (name) => {
            expect(existsSync(`${UI_ROOT}/${name}/index.ts`)).toBe(true);
            expect(existsSync(`${UI_ROOT}/${name}/${root(name)}.vue`)).toBe(
                true,
            );
        },
    );

    it('contains no directory outside the set (no duplicates, no strays)', () => {
        const dirs = readdirSync(UI_ROOT, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => name !== '__tests__')
            .sort();

        expect(dirs).toEqual([...COMPONENTS, ...SUPPORTING].sort());
    });
});

describe('components.json (15 §4)', () => {
    const config = JSON.parse(readFileSync('components.json', 'utf8')) as {
        style: string;
        tailwind: { baseColor: string; cssVariables: boolean; css: string };
        aliases: Record<string, string>;
        iconLibrary: string;
    };

    it('uses the stone base colour with CSS variables', () => {
        expect(config.tailwind.baseColor).toBe('stone');
        expect(config.tailwind.cssVariables).toBe(true);
        expect(config.tailwind.css).toBe('resources/css/app.css');
    });

    it('uses new-york-v4, the Tailwind 4 build of new-york (preflight E10)', () => {
        expect(config.style).toBe('new-york-v4');
    });

    it('has the @/components and @/lib/utils aliases', () => {
        expect(config.aliases.components).toBe('@/components');
        expect(config.aliases.utils).toBe('@/lib/utils');
        expect(config.aliases.ui).toBe('@/components/ui');
        expect(config.iconLibrary).toBe('lucide');
    });
});

describe('semantic tokens only (15 §4)', () => {
    // Stricter than the app-wide guard: components/ui is exempt there, but the
    // brief wants generated files cleaned too (incl. hard-coded white/black).
    const RAW =
        /\b(?:[a-z-]+:)*(?:bg|text|border|fill|stroke|ring|outline|from|to|via|shadow|divide|decoration|accent|caret)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)\b(?:\/\d+)?/;

    function sources(): string[] {
        return (readdirSync(UI_ROOT, { recursive: true }) as string[])
            .map((file) => `${UI_ROOT}/${file.split('\\').join('/')}`)
            .filter((file) => /\.(vue|ts)$/.test(file))
            .filter((file) => !file.includes('/__tests__/'));
    }

    it('finds the generated sources', () => {
        expect(sources().length).toBeGreaterThan(250);
    });

    it('has no raw palette, white or black colour class', () => {
        const offences = sources().flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .map((line, index) => ({ line, number: index + 1 }))
                .filter(({ line }) => RAW.test(line))
                .map(({ line, number }) => `${file}:${number}: ${line.trim()}`),
        );

        expect(offences).toEqual([]);
    });

    it('the pattern is not vacuous', () => {
        expect(RAW.test('fixed inset-0 bg-black/80')).toBe(true);
        expect(RAW.test('dark:text-white')).toBe(true);
        expect(RAW.test('text-red-600')).toBe(true);
        expect(RAW.test('bg-destructive text-destructive-foreground')).toBe(
            false,
        );
    });
});
