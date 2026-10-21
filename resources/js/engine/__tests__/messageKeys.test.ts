import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { BOM_ISSUE_CODES } from '../bom/nesting';
import { FURNITURE_COMMAND_ERROR_CODES } from '../furniture/commands/pipeline';
import { FURNITURE_COMMANDS } from '../furniture/commands/registry';
import { CHANGE_MESSAGE_KEYS } from '../furniture/diff';
import { PART_NAMES_EN, partNameEn } from '../furniture/partNames';
import { HARDWARE_REASON_KEYS } from '../furniture/rules/hardware';
import { TEMPLATES } from '../furniture/templates/index';
import { FURNITURE_ISSUE_CODES } from '../furniture/validate';
import { PLAN_COMMAND_ERROR_CODES } from '../plan/commands/pipeline';
import { PLAN_COMMANDS } from '../plan/commands/registry';
import { CONFLICT_KINDS } from '../plan/conflicts';
import { OPENING_SNAP_REASONS, SNAP_KINDS } from '../plan/snapping';
import { makeRectPlan } from '../plan/testing/fixtures';
import { PLAN_ISSUE_CODES, validatePlan } from '../plan/validate';
import { DERIVE_ISSUE_CODES } from '../plan/walls';
import { PARSE_LENGTH_ERROR_CODES } from '../units/types';

/**
 * The lang files P2 owns (15 §15.2): `engine` (04), `parts`, `hardware`,
 * `changes` (07), `templates`, `sections`. Furniture and BOM issue texts live
 * in `engine.php` (carry 5), plan issue texts in P4's `plan_editor.php`.
 */
const NAMESPACES = [
    'engine',
    'parts',
    'hardware',
    'changes',
    'templates',
    'sections',
] as const;

const PHP =
    "$d = $argv[1]; $o = []; foreach (array_slice($argv, 2) as $n) { $o[$n] = require $d . '/' . $n . '.php'; } echo json_encode($o, JSON_THROW_ON_ERROR);";

function flatten(
    value: unknown,
    prefix: string,
    out: Map<string, unknown>,
): Map<string, unknown> {
    if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            flatten(v, `${prefix}.${k}`, out);
        }
    } else {
        out.set(prefix, value);
    }
    return out;
}

// Read the PHP lang files with PHP itself (carry 10).
const raw = JSON.parse(
    execFileSync(
        'php',
        [
            '-r',
            PHP,
            '--',
            resolve(__dirname, '../../../lang/en'),
            ...NAMESPACES,
        ],
        {
            encoding: 'utf8',
        },
    ),
) as Record<string, unknown>;
const messages = new Map<string, unknown>();
for (const ns of NAMESPACES) {
    flatten(raw[ns], ns, messages);
}

const snake = (name: string) =>
    name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const rest = (prefix: string) => (code: string) => code.slice(prefix.length);

function expectKeys(keys: readonly string[]) {
    expect(keys.filter((k) => !messages.has(k))).toEqual([]);
}

describe('engine translation keys', () => {
    it('units: engine.units.error.{code}', () => {
        expectKeys(
            PARSE_LENGTH_ERROR_CODES.map((c) => `engine.units.error.${c}`),
        );
    });

    it('plan: command errors, labels, derive, snap, conflicts', () => {
        expect(Object.keys(PLAN_COMMANDS)).toHaveLength(43);
        expectKeys([
            ...PLAN_COMMAND_ERROR_CODES.map((c) => `engine.plan.command.${c}`),
            ...Object.keys(PLAN_COMMANDS).map(
                (t) => `engine.plan.command.label.${snake(t)}`,
            ),
            ...DERIVE_ISSUE_CODES.map((c) => `engine.plan.derive.${c}`),
            ...SNAP_KINDS.map((k) => `engine.plan.snap.kind.${k}`),
            ...OPENING_SNAP_REASONS,
            ...CONFLICT_KINDS.map((k) => `engine.plan.conflict.${k}`),
        ]);
    });

    it('plan issues carry plan_editor.issues.<rule> and no text is written here (carry 3)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const [firstId, first] = Object.entries(doc.walls)[0] as [
            string,
            (typeof doc.walls)[string],
        ];
        const broken = {
            ...doc,
            walls: { ...doc.walls, [firstId]: { ...first, a: 'n_missing000' } },
        };
        const issues = validatePlan(broken);
        expect(issues.length).toBeGreaterThan(0);
        for (const issue of issues) {
            expect(PLAN_ISSUE_CODES).toContain(issue.code);
            expect(issue.messageKey).toBe(
                `plan_editor.issues.${rest('plan.')(issue.code)}`,
            );
        }
        expect(
            [...messages.keys()].filter(
                (k) =>
                    k.startsWith('engine.plan.issue') ||
                    k.startsWith('plan_editor'),
            ),
        ).toEqual([]);
    });

    it('furniture: command errors and labels', () => {
        expect(Object.keys(FURNITURE_COMMANDS)).toHaveLength(28);
        expectKeys([
            ...FURNITURE_COMMAND_ERROR_CODES.map(
                (c) => `engine.furniture.command.${c}`,
            ),
            ...Object.keys(FURNITURE_COMMANDS).map(
                (n) =>
                    `engine.furniture.command.label.${snake(rest('furniture.')(n))}`,
            ),
        ]);
    });

    it('furniture and BOM issues: engine.furniture.issue.* / engine.bom.issue.* (carry 5)', () => {
        expectKeys([
            ...FURNITURE_ISSUE_CODES.map(
                (c) => `engine.furniture.issue.${rest('furniture.')(c)}`,
            ),
            ...BOM_ISSUE_CODES.map(
                (c) => `engine.bom.issue.${rest('bom.')(c)}`,
            ),
        ]);
    });

    it('the Task 38/40 issues name the params the engine emits (carry 6)', () => {
        const text = (code: string) =>
            String(messages.get(`engine.furniture.issue.${code}`));
        expect(text('panel_split')).toContain('{count}');
        expect(text('panel_seam_unsupported')).toContain('{position}');
        expect(text('table_drawers_dont_fit')).toMatch(
            /\{available\}.*\{required\}|\{required\}.*\{available\}/,
        );
        expect(text('apron_inset_clamped')).toMatch(
            /\{requested\}.*\{applied\}|\{applied\}.*\{requested\}/,
        );
    });
});

describe('furniture translation keys', () => {
    it('parts.{name} for every PART_NAMES_EN key', () => {
        expectKeys(Object.keys(PART_NAMES_EN));
    });

    it('parts render like their English mirror (optional params, piece wording)', () => {
        // P1's t() renders an absent argument as an empty string.
        const render = (
            key: string,
            params: Record<string, string | number>,
        ) => {
            const text = String(messages.get(key));
            const args: Record<string, string | number> = {};
            for (const m of text.matchAll(/\{(\w+)/g)) {
                args[m[1] as string] = params[m[1] as string] ?? '';
            }
            return String(new IntlMessageFormat(text, 'en').format(args))
                .replace(/\s+/g, ' ')
                .trim();
        };
        const samples: Array<Record<string, string | number>> = [
            {},
            { n: 2 },
            { piece: 3 },
            { n: 2, piece: 3 },
            { leaf: 1 },
            { name: 'Kick board' },
        ];
        for (const key of Object.keys(PART_NAMES_EN)) {
            for (const params of samples) {
                expect(
                    render(key, params),
                    `${key} ${JSON.stringify(params)}`,
                ).toBe(partNameEn(key, params));
            }
        }
        expect(render('parts.fixed_shelf', { n: 2, piece: 3 })).toBe(
            'Fixed shelf 2 – piece 3',
        );
        expect(render('parts.fixed_shelf', { n: 2 })).toBe('Fixed shelf 2');
        expect(render('parts.top', { piece: 2 })).toBe('Top 2');
        expect(render('parts.back', {})).toBe('Back panel');
    });

    it('hardware.reason.{key} (07 §6.12); hinges_for_door takes {leaves}', () => {
        expect(HARDWARE_REASON_KEYS).toHaveLength(23);
        expectKeys(HARDWARE_REASON_KEYS);
        expect(
            String(messages.get('hardware.reason.hinges_for_door')),
        ).toContain('{leaves');
    });

    it('changes.{key} (07 §10.2)', () => {
        expectKeys(CHANGE_MESSAGE_KEYS);
    });

    it('templates: name, description, field labels, help, options, range', () => {
        expect(Object.keys(TEMPLATES)).toHaveLength(19);
        const keys = new Set<string>(['templates.range']);
        for (const [key, def] of Object.entries(TEMPLATES)) {
            keys.add(`templates.${key}.name`);
            keys.add(`templates.${key}.description`);
            for (const field of def.fields) {
                keys.add(field.labelKey);
                if (field.helpKey) keys.add(field.helpKey);
                if (field.kind === 'select') {
                    for (const option of field.options) {
                        expect(option.labelKey).toBe(
                            `templates.options.${option.value}`,
                        );
                        keys.add(option.labelKey);
                    }
                }
            }
        }
        expectKeys([...keys]);
    });

    it('sections.interior|column|row (07 §3.7)', () => {
        expectKeys(['interior', 'column', 'row'].map((k) => `sections.${k}`));
    });
});

describe('every message', () => {
    it('is a non-empty string and parses as ICU', () => {
        const bad: string[] = [];
        for (const [key, value] of messages) {
            try {
                if (typeof value !== 'string' || value.trim() === '') {
                    throw new Error('empty');
                }
                new IntlMessageFormat(value, 'en');
            } catch {
                bad.push(key);
            }
        }
        expect(bad).toEqual([]);
        expect(messages.size).toBeGreaterThan(300);
    });

    it('exists for every key literal in the engine sources', () => {
        const root = resolve(__dirname, '..');
        const files = (readdirSync(root, { recursive: true }) as string[])
            .map((f) => f.split('\\').join('/'))
            .filter(
                (f) =>
                    f.endsWith('.ts') &&
                    !/(^|\/)(__tests__|__perf__|testing)\//.test(f) &&
                    !f.endsWith('.bench.ts') &&
                    f !== 'index.ts',
            );
        const keyed =
            /(['"`])((?:engine|hardware|changes|templates|sections|parts)\.[a-z0-9_.]+)\1/g;
        const all = [...messages.keys()];
        const missing: string[] = [];
        for (const file of files) {
            const source = readFileSync(resolve(root, file), 'utf8');
            for (const m of source.matchAll(keyed)) {
                const key = m[2] as string;
                // A bare prefix such as `engine.plan.command` is built upon, not a key.
                const isPrefix = all.some((k) => k.startsWith(`${key}.`));
                if (
                    !messages.has(key) &&
                    !isPrefix &&
                    !key.endsWith('.') &&
                    !key.endsWith('.ts') // an import path such as './hardware.ts'
                ) {
                    missing.push(`${file}: ${key}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
