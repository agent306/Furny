import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A <button> inside a <form> submits it unless it says type="button". Every
// <Button> in the shared components must state its type (or render as a link
// with as-child), so none of them can submit a host form by accident.
const DIRECTORIES = [
    'resources/js/components/common',
    'resources/js/components/display',
    'resources/js/components/orders',
];

function vueFiles(): string[] {
    return DIRECTORIES.flatMap((directory) =>
        readdirSync(directory)
            .filter((file) => file.endsWith('.vue'))
            .map((file) => `${directory}/${file}`),
    );
}

function buttonTags(source: string): string[] {
    return [...source.matchAll(/<Button\b[^>]*>/gs)].map((match) => match[0]);
}

describe('Button type audit', () => {
    it('finds the buttons (the audit is not vacuous)', () => {
        const count = vueFiles().flatMap((file) =>
            buttonTags(readFileSync(file, 'utf8')),
        ).length;

        expect(count).toBeGreaterThanOrEqual(8);
    });

    it('every <Button> has a type or is an as-child link wrapper', () => {
        const offenders = vueFiles().flatMap((file) =>
            buttonTags(readFileSync(file, 'utf8'))
                .filter((tag) => !/\stype="(button|submit)"/.test(tag))
                .filter((tag) => !/\bas-child\b/.test(tag))
                .map((tag) => `${file}: ${tag.replaceAll(/\s+/g, ' ')}`),
        );

        expect(offenders).toEqual([]);
    });

    it('the audit catches an untyped button', () => {
        expect(buttonTags('<Button variant="outline">x</Button>')).toHaveLength(
            1,
        );
        expect(
            /\stype="(button|submit)"/.test('<Button variant="outline">'),
        ).toBe(false);
    });
});
