import { IntlMessageFormat } from 'intl-messageformat';
import type { Formats, PrimitiveType } from 'intl-messageformat';
import { ref } from 'vue';
import type { App, InjectionKey, Ref } from 'vue';

export type MessageParams = Record<string, unknown>;

export interface I18n {
    /** Renders the ICU message `key`; never throws (missing key → the key). */
    t(key: string, params?: MessageParams): string;
    has(key: string): boolean;
    locale: Ref<string>;
}

export interface I18nPlugin extends I18n {
    install(app: App): void;
}

export interface I18nOptions {
    /** UI language, e.g. `en`. */
    locale: string;
    /** Flat dot-key → ICU message, as exported by `php artisan i18n:export`. */
    messages: Record<string, string>;
    /** User time zone for `{at, date}` / `{at, time}` arguments. */
    timeZone?: string;
    /** Business locale for number/date formatting (e.g. `en-IN`); defaults to `locale`. */
    numberLocale?: string;
}

export const I18N_KEY: InjectionKey<I18n> = Symbol('i18n');

// Element kinds of the ICU AST (`TYPE` in @formatjs/icu-messageformat-parser).
const ARGUMENT = 1;
const SELECT = 5;
const PLURAL = 6;
const TAG = 8;

interface AstElement {
    type: number;
    value?: string;
    options?: Record<string, { value: AstElement[] }>;
    children?: AstElement[];
}

interface Compiled {
    formatter: IntlMessageFormat;
    /** Plain `{name}` arguments outside any select/plural branch; always rendered. */
    required: string[];
    /** Plain arguments inside a branch; only rendered when the branch is chosen. */
    optional: string[];
}

function simpleArguments(
    elements: AstElement[],
    found: { required: Set<string>; optional: Set<string> },
    nested = false,
): void {
    for (const element of elements) {
        if (element.type === ARGUMENT && element.value !== undefined) {
            (nested ? found.optional : found.required).add(element.value);
        } else if (element.type === SELECT || element.type === PLURAL) {
            for (const option of Object.values(element.options ?? {})) {
                simpleArguments(option.value, found, true);
            }
        } else if (element.type === TAG) {
            simpleArguments(element.children ?? [], found, nested);
        }
    }
}

function zonedFormats(timeZone: string | undefined): Partial<Formats> {
    if (!timeZone) {
        return {};
    }

    const zoned = (styles: Record<string, unknown>) =>
        Object.fromEntries(
            Object.keys(styles).map((style) => [style, { timeZone }]),
        );

    return {
        date: zoned(IntlMessageFormat.formats.date),
        time: zoned(IntlMessageFormat.formats.time),
    };
}

function warn(message: string): void {
    if (import.meta.env.DEV) {
        console.warn(`[i18n] ${message}`);
    }
}

export function createI18n(options: I18nOptions): I18nPlugin {
    const { messages } = options;
    const locale = ref(options.locale);
    const formatLocale = options.numberLocale ?? options.locale;
    const formats = zonedFormats(options.timeZone);
    // `null` remembers a message that failed to compile so it is not parsed again.
    const compiled = new Map<string, Compiled | null>();

    function compile(key: string, message: string): Compiled | null {
        if (compiled.has(key)) {
            return compiled.get(key) ?? null;
        }

        let entry: Compiled | null = null;

        try {
            const formatter = new IntlMessageFormat(
                message,
                formatLocale,
                formats,
            );

            const found = {
                required: new Set<string>(),
                optional: new Set<string>(),
            };
            simpleArguments(
                formatter.getAst() as unknown as AstElement[],
                found,
            );

            entry = {
                formatter,
                required: [...found.required],
                optional: [...found.optional],
            };
        } catch (error) {
            warn(`Message "${key}" is not valid ICU: ${String(error)}`);
        }

        compiled.set(key, entry);

        return entry;
    }

    function has(key: string): boolean {
        return Object.hasOwn(messages, key);
    }

    function t(key: string, params: MessageParams = {}): string {
        const message = messages[key];

        if (message === undefined || !has(key)) {
            warn(`Missing translation key "${key}".`);

            return key;
        }

        const entry = compile(key, message);

        if (entry === null) {
            return key;
        }

        const values: Record<string, unknown> = { ...params };

        for (const name of entry.required) {
            if (values[name] === undefined) {
                warn(
                    `Message "${key}" was rendered without its "${name}" argument.`,
                );
            }
        }

        for (const name of [...entry.required, ...entry.optional]) {
            values[name] ??= '';
        }

        try {
            const result = entry.formatter.format<string>(
                values as Record<string, PrimitiveType>,
            );

            return Array.isArray(result) ? result.join('') : String(result);
        } catch (error) {
            warn(`Message "${key}" could not be rendered: ${String(error)}`);

            return key;
        }
    }

    return {
        t,
        has,
        locale,
        install(app: App): void {
            app.provide(I18N_KEY, { t, has, locale });
            app.config.globalProperties.$t = t;
        },
    };
}
