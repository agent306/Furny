import { IntlMessageFormat } from 'intl-messageformat';
import type { Formatters, PrimitiveType } from 'intl-messageformat';
import { ref } from 'vue';
import type { App, InjectionKey, Ref } from 'vue';

export type MessageParams = Record<string, unknown>;

/** A run of text between the tags of a message, or the text inside one tag (`<terms>Terms</terms>`). */
export type MessagePart = string | { tag: string; text: string };

export interface I18n {
    /** Renders the ICU message `key`; never throws (missing key → the key). */
    t(key: string, params?: MessageParams): string;
    /**
     * Renders a message with rich-text tags (`By going on you accept the <terms>Terms</terms>.`) as its parts, in
     * order: text, and one `{tag, text}` for each tagged run (nested tags keep only their text). The page decides what a
     * tag is (a link, bold) in the `RichText` component's slots. Never throws (missing key → the key).
     */
    parts(key: string, params?: MessageParams): MessagePart[];
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
    /** The names of the tags in the message. */
    tags: string[];
    /** Plain `{name}` arguments outside any select/plural branch; always rendered. */
    required: string[];
    /** Plain arguments inside a branch; only rendered when the branch is chosen. */
    optional: string[];
}

function simpleArguments(
    elements: AstElement[],
    found: { required: Set<string>; optional: Set<string>; tags: Set<string> },
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
            if (element.value !== undefined) {
                found.tags.add(element.value);
            }

            simpleArguments(element.children ?? [], found, nested);
        }
    }
}

/**
 * Intl formatters bound to the user's time zone. Going through `formatters`
 * (rather than per-style `formats`) also covers bare `{at, date}` and ICU
 * skeletons such as `{at, date, ::yyyyMMMd}`.
 */
function zonedFormatters(timeZone: string): Formatters {
    const cache = new Map<string, Intl.DateTimeFormat>();

    return {
        getDateTimeFormat(...args) {
            const [locales, options] = args;
            const cacheKey = JSON.stringify([locales, options]);
            let format = cache.get(cacheKey);

            if (!format) {
                format = new Intl.DateTimeFormat(locales, {
                    timeZone,
                    ...options,
                });
                cache.set(cacheKey, format);
            }

            return format;
        },
        getNumberFormat: (locales, options) =>
            new Intl.NumberFormat(locales, options),
        getPluralRules: (...args) => new Intl.PluralRules(...args),
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
    const formatters = options.timeZone
        ? zonedFormatters(options.timeZone)
        : undefined;
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
                undefined,
                { formatters },
            );

            const found = {
                required: new Set<string>(),
                optional: new Set<string>(),
                tags: new Set<string>(),
            };
            simpleArguments(
                formatter.getAst() as unknown as AstElement[],
                found,
            );

            entry = {
                formatter,
                tags: [...found.tags],
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

    /** The message `key` formatted with `params` and the tag handlers, or null (and a warning) when it cannot be. */
    function render<T>(
        key: string,
        params: MessageParams,
        handlers: (tags: string[]) => Record<string, unknown>,
    ): T | string | Array<T | string> | null {
        const message = messages[key];

        if (message === undefined || !has(key)) {
            warn(`Missing translation key "${key}".`);

            return null;
        }

        const entry = compile(key, message);

        if (entry === null) {
            return null;
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

        Object.assign(values, handlers(entry.tags));

        try {
            return entry.formatter.format<T>(
                values as Record<string, PrimitiveType>,
            );
        } catch (error) {
            warn(`Message "${key}" could not be rendered: ${String(error)}`);

            return null;
        }
    }

    function t(key: string, params: MessageParams = {}): string {
        // A tag without a handler is plain text: the tags are dropped, their text stays.
        const result = render<string>(key, params, (tags) =>
            Object.fromEntries(
                tags.map((tag) => [
                    tag,
                    (chunks: unknown[]) => chunks.join(''),
                ]),
            ),
        );

        if (result === null) {
            return key;
        }

        return Array.isArray(result) ? result.join('') : String(result);
    }

    function parts(key: string, params: MessageParams = {}): MessagePart[] {
        const result = render<MessagePart>(key, params, (tags) =>
            Object.fromEntries(
                tags.map((tag) => [
                    tag,
                    (chunks: Array<string | MessagePart>) => ({
                        tag,
                        text: chunks
                            .map((chunk) =>
                                typeof chunk === 'string' ? chunk : chunk.text,
                            )
                            .join(''),
                    }),
                ]),
            ),
        );

        if (result === null) {
            return [key];
        }

        return Array.isArray(result) ? result : [result];
    }

    return {
        t,
        parts,
        has,
        locale,
        install(app: App): void {
            app.provide(I18N_KEY, { t, parts, has, locale });
            app.config.globalProperties.$t = t;
        },
    };
}
