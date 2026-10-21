import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = 'resources/js';
const EXCLUDED = [
    /(^|\/)lang\/generated\//,
    /(^|\/)__tests__\//,
    /\.test\.ts$/,
];

/**
 * Dynamic key patterns of 15 §15.2 → name of the generated TS union type
 * (`types/generated.d.ts`) whose members fill `{…}`. A task adds an entry when
 * it first renders the enum, e.g. `'orders.states.{state}': 'OrderStateKey'`.
 */
const ENUM_KEY_PATTERNS: Record<string, string> = {
    'orders.states.{state}': 'OrderStateKey',
    'orders.states_customer.{state}': 'OrderStateKey',
    'orders.states_customer_short.{state}': 'OrderStateKey',
};

const KEY_CALLS = [
    /(?<![\w$])\$?t\(\s*(['"])([\w.]+)\1/g,
    /\b(?:labelKey|titleKey)\s*:\s*(['"])([\w.]+)\1/g,
];

function sourceFiles(): string[] {
    return (readdirSync(SOURCE_ROOT, { recursive: true }) as string[])
        .map((file) => `${SOURCE_ROOT}/${file.split('\\').join('/')}`)
        .filter((file) => /\.(vue|ts)$/.test(file))
        .filter((file) => !EXCLUDED.some((pattern) => pattern.test(file)));
}

function literalKeys(source: string): string[] {
    return KEY_CALLS.flatMap((call) =>
        [...source.matchAll(call)].map((match) => match[2] ?? ''),
    );
}

function unionMembers(declarations: string, typeName: string): string[] | null {
    const declaration = new RegExp(
        `type ${typeName}\\s*=\\s*((?:\\s*\\|?\\s*'[^']*')+)`,
    ).exec(declarations);

    if (!declaration?.[1]) {
        return null;
    }

    return [...declaration[1].matchAll(/'([^']*)'/g)].map(
        (member) => member[1] ?? '',
    );
}

const messages = JSON.parse(
    readFileSync(`${SOURCE_ROOT}/lang/generated/en.json`, 'utf8'),
) as Record<string, string>;

describe('literal translation keys', () => {
    it('exist in en.json', () => {
        const missing = sourceFiles().flatMap((file) =>
            literalKeys(readFileSync(file, 'utf8'))
                .filter((key) => !Object.hasOwn(messages, key))
                .map((key) => `${file}: ${key}`),
        );

        expect(missing).toEqual([]);
    });

    it('are found in t(), $t(), labelKey and titleKey calls', () => {
        const source = `
            t('a.one'); $t("a.two"); i18n.t('a.three');
            { labelKey: 'a.four', titleKey: "a.five" }
            format('not.a.key'); t(\`dynamic.\${x}\`); t(variable);
        `;

        expect(literalKeys(source).sort()).toEqual([
            'a.five',
            'a.four',
            'a.one',
            'a.three',
            'a.two',
        ]);
    });
});

describe('enum label keys', () => {
    it('reads the members of a string-literal union', () => {
        const declarations = `
            export type OrderState = 'draft' | 'quoted'
              | 'accepted';
            export type Other = 'x';
        `;

        expect(unionMembers(declarations, 'OrderState')).toEqual([
            'draft',
            'quoted',
            'accepted',
        ]);
        expect(unionMembers(declarations, 'Missing')).toBeNull();
    });

    it('exist in en.json for every enum exported in types/generated.d.ts', () => {
        const declarations = readFileSync(
            `${SOURCE_ROOT}/types/generated.d.ts`,
            'utf8',
        );
        const missing: string[] = [];
        const missingUnions: string[] = [];

        for (const [pattern, typeName] of Object.entries(ENUM_KEY_PATTERNS)) {
            const members = unionMembers(declarations, typeName);

            if (members === null) {
                // A pattern whose enum vanished (renamed, or regenerated
                // without it) would otherwise pass without checking anything.
                missingUnions.push(`${pattern} -> ${typeName}`);

                continue;
            }

            for (const member of members) {
                const key = pattern.replace(/\{[^}]+\}/, member);

                if (!Object.hasOwn(messages, key)) {
                    missing.push(key);
                }
            }
        }

        expect(missingUnions).toEqual([]);
        expect(missing).toEqual([]);
    });
});
