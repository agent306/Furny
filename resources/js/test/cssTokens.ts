// Test helper: reads the design tokens out of resources/css/app.css (15 §3.1).
import { readFileSync } from 'node:fs';

export type CssRule = {
    /** Enclosing at-rule prelude, e.g. `@media print`; `null` at top level. */
    context: string | null;
    selector: string;
    body: string;
};

export type Declarations = Record<string, string>;

const APP_CSS = 'resources/css/app.css';

export function readAppCss(): string {
    return readFileSync(APP_CSS, 'utf8');
}

function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function collectRules(css: string, context: string | null): CssRule[] {
    const rules: CssRule[] = [];
    let depth = 0;
    let prelude = '';
    let bodyStart = 0;

    for (let index = 0; index < css.length; index++) {
        const char = css.charAt(index);

        if (char === '{') {
            if (depth === 0) {
                bodyStart = index + 1;
            }

            depth++;
        } else if (char === '}') {
            depth--;

            if (depth === 0) {
                const body = css.slice(bodyStart, index);
                const selector = prelude.trim();

                if (selector.startsWith('@')) {
                    rules.push(...collectRules(body, selector));
                } else {
                    rules.push({ context, selector, body });
                }

                prelude = '';
            }
        } else if (depth === 0) {
            if (char === ';') {
                prelude = '';
            } else {
                prelude += char;
            }
        }
    }

    return rules;
}

export function parseRules(css: string = readAppCss()): CssRule[] {
    return collectRules(stripComments(css), null);
}

/** Custom property declarations (`--name: value;`) of one rule body. */
export function parseDeclarations(body: string): Declarations {
    const declarations: Declarations = {};

    for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        declarations[match[1] ?? ''] = (match[2] ?? '').trim();
    }

    return declarations;
}

export function findRule(
    selector: string,
    context: string | null = null,
    rules: CssRule[] = parseRules(),
): CssRule {
    const rule = rules.find(
        (candidate) =>
            candidate.selector === selector && candidate.context === context,
    );

    if (!rule) {
        throw new Error(
            `No rule "${selector}" in ${context ?? 'top level'} of ${APP_CSS}`,
        );
    }

    return rule;
}

/** Substitutes `var(--x)` references, using the cascade of `layers` (later wins). */
export function resolveVars(...layers: Declarations[]): Declarations {
    const merged: Declarations = Object.assign({}, ...layers);
    const resolved: Declarations = {};

    const resolve = (name: string, trail: string[]): string => {
        const value = merged[name];

        if (value === undefined || trail.includes(name)) {
            throw new Error(`Cannot resolve ${name} (${trail.join(' > ')})`);
        }

        return value.replace(/var\((--[\w-]+)\)/g, (_, ref: string) =>
            resolve(ref, [...trail, name]),
        );
    };

    for (const name of Object.keys(merged)) {
        resolved[name] = resolve(name, []);
    }

    return resolved;
}

/** Light theme tokens, `var()` references resolved. */
export function lightTokens(): Declarations {
    return resolveVars(parseDeclarations(findRule(':root').body));
}

/** Dark theme tokens as the browser computes them on `<html class="dark">`. */
export function darkTokens(): Declarations {
    return resolveVars(
        parseDeclarations(findRule(':root').body),
        parseDeclarations(findRule('.dark').body),
    );
}
