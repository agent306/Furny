/**
 * Test-only strict XML well-formedness check for the SVG output (04 §8.3).
 * The engine tests run in Node without a DOM, so this is a small tokenizer:
 * one root, matched tags, quoted unique attributes, valid entity references,
 * no raw `<` in attribute values, only XML 1.0 characters, no comments, CDATA
 * or processing instructions (the exporter never writes them). Throws with the
 * offending offset.
 */

const NAME = /[A-Za-z_][\w.:-]*/y;
const ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/y;
const XML_CHAR = /^[\u0009\u000A\u000D -퟿-�]*$/u;

export function assertWellFormedXml(xml: string): void {
    const fail = (at: number, why: string): never => {
        throw new Error(
            `not well-formed at ${at}: ${why} near ${JSON.stringify(xml.slice(Math.max(0, at - 20), at + 40))}`,
        );
    };
    // `u` flag with lone surrogates fails the character class, as intended.
    if (!XML_CHAR.test(xml)) fail(0, 'character outside the XML 1.0 range');

    const stack: string[] = [];
    let rootClosed = false;
    let sawRoot = false;
    let i = 0;

    /** Length of the reference at `at`; numeric ones must name an XML 1.0 Char. */
    const refLength = (at: number): number => {
        ENTITY.lastIndex = at;
        const m = ENTITY.exec(xml);
        if (!m) return fail(at, 'invalid entity reference');
        const body = m[0].slice(2, -1);
        if (m[0][1] === '#') {
            const code =
                body[0] === 'x'
                    ? parseInt(body.slice(1), 16)
                    : parseInt(body, 10);
            const ok =
                code === 0x9 ||
                code === 0xa ||
                code === 0xd ||
                (code >= 0x20 && code <= 0xd7ff) ||
                (code >= 0xe000 && code <= 0xfffd) ||
                (code >= 0x10000 && code <= 0x10ffff);
            if (!ok)
                fail(
                    at,
                    `character reference to a non-XML character (${m[0]})`,
                );
        }
        return m[0].length;
    };

    const readName = (): string => {
        NAME.lastIndex = i;
        const m = NAME.exec(xml);
        if (!m) return fail(i, 'expected a name');
        i += m[0].length;
        return m[0];
    };
    const skipSpace = (): boolean => {
        const start = i;
        while (i < xml.length && /[ \t\r\n]/.test(xml[i]!)) i += 1;
        return i > start;
    };

    while (i < xml.length) {
        if (xml[i] !== '<') {
            // Character data: only valid entity references, and no `]]>`.
            const start = i;
            while (i < xml.length && xml[i] !== '<') {
                if (xml[i] === '&') {
                    i += refLength(i);
                } else i += 1;
            }
            const data = xml.slice(start, i);
            if (data.includes(']]>')) fail(start, 'literal ]]> in text');
            if (stack.length === 0 && data.trim() !== '') {
                fail(start, 'text outside the root element');
            }
            continue;
        }
        if (rootClosed) fail(i, 'content after the root element');
        if (xml[i + 1] === '/') {
            i += 2;
            const name = readName();
            skipSpace();
            if (xml[i] !== '>') fail(i, 'expected >');
            i += 1;
            if (stack.pop() !== name) fail(i, `unmatched </${name}>`);
            if (stack.length === 0) rootClosed = true;
            continue;
        }
        if (xml[i + 1] === '!' || xml[i + 1] === '?') {
            fail(
                i,
                'comments, CDATA and processing instructions are not allowed',
            );
        }
        i += 1;
        const name = readName();
        const seen = new Set<string>();
        for (;;) {
            const hadSpace = skipSpace();
            if (xml[i] === '>' || (xml[i] === '/' && xml[i + 1] === '>')) break;
            if (!hadSpace) fail(i, 'expected whitespace before an attribute');
            const attr = readName();
            if (seen.has(attr)) fail(i, `duplicate attribute ${attr}`);
            seen.add(attr);
            skipSpace();
            if (xml[i] !== '=') fail(i, 'expected =');
            i += 1;
            skipSpace();
            if (xml[i] !== '"')
                fail(i, 'attribute value must be double-quoted');
            i += 1;
            while (xml[i] !== '"') {
                if (i >= xml.length) fail(i, 'unterminated attribute value');
                if (xml[i] === '<') fail(i, 'raw < in an attribute value');
                if (xml[i] === '&') {
                    i += refLength(i);
                } else i += 1;
            }
            i += 1;
        }
        sawRoot = true;
        if (xml[i] === '/') {
            i += 2;
            if (stack.length === 0) rootClosed = true;
        } else {
            i += 1;
            stack.push(name);
        }
    }
    if (!sawRoot) fail(0, 'no root element');
    if (stack.length > 0) fail(xml.length, `unclosed <${stack.at(-1)}>`);
}
