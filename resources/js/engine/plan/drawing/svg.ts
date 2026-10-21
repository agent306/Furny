/**
 * `svgFromDrawing` (04 §8.3): serialises a `PlanDrawing` to an SVG string.
 *
 * The output is deterministic (layers in paint order, groups and items in
 * drawing order, numbers via `num`) and safe to embed: every text and
 * attribute value is XML-escaped, no script or foreign content is ever
 * written, and the only external reference is the background image `href`,
 * which must be a `data:image` URI or an http(s) URL (anything else drops the
 * image). The engine stays theme-free: room fill tokens and style colours are
 * resolved through `SvgExportOptions.palette`, which the caller fills from the
 * light export palette.
 */
import type { Vec2 } from '../../geometry/vec2';
import {
    LAYER_ORDER,
    STYLE_KEYS,
    type DrawGroup,
    type DrawItem,
    type PlanDrawing,
    type StyleKey,
} from './types';

export interface SvgStyle {
    /** Stroke colour; `null` = no stroke. */
    stroke: string | null;
    strokeWidthMm: number;
    /** Fill colour; `null` = no fill. */
    fill: string | null;
    /** Dash array in mm; `null` or empty = solid unless the item is `dashed`. */
    dash: number[] | null;
    fontWeight?: 400 | 600;
    /** Hatch overlay painted instead of the plain fill (one pattern per style). */
    hatch?: { angleDeg: number; spacingMm: number; color: string };
}

export interface SvgExportOptions {
    /** Visible model rectangle in mm. */
    viewBox: { min: Vec2; max: Vec2 };
    widthPx: number;
    heightPx: number;
    styles: Record<StyleKey, SvgStyle>;
    /** Page background as a literal CSS colour (`'#ffffff'`); `null` = transparent. */
    background: string | null;
    fontFamily: string;
    /**
     * Colour tokens to CSS colours, e.g. the light export palette. Every
     * style colour (stroke, fill, hatch colour) and every `fillKey` is a
     * token of this palette; an unknown token throws. Only the page
     * `background` and a poly's literal `fill` override are CSS colours.
     */
    palette: Readonly<Record<string, string>>;
    /**
     * Accept http(s) hrefs for the background image. Off by default, so an
     * export never leaks a signed URL; only `data:image` URIs are written.
     */
    allowRemoteHref?: boolean;
    /**
     * Prefix of the generated ids (`layer-*`, `hatch-*`), so several SVGs can
     * be inlined into one page without id clashes. Default `''`; letters,
     * digits, `_`, `-` and `.`, starting with a letter or `_`.
     */
    idPrefix?: string;
}

/** Default dash (multiples of the stroke width) for a dashed item whose style has no dash array. */
const DEFAULT_DASH_FACTORS = [6, 4] as const;
/** Hatch line width as a share of the hatch spacing. */
const HATCH_LINE_SHARE = 0.1;
/** Background image sources the exporter accepts (04 §8.3). */
const DATA_IMAGE_HREF =
    /^data:image\/(?:png|jpe?g|gif|webp)(?:;[A-Za-z0-9=.+-]+)*,[A-Za-z0-9+/=%._~-]*$/;
const HTTP_HREF = /^https?:\/\/\S+$/i;

/** Largest magnitude written; beyond it `toFixed` would risk exponent notation. */
const MAX_ABS = 1e15;

/** Formats a number with at most two decimals, trailing zeros stripped, never `-0` or an exponent. */
function num(n: number): string {
    if (!Number.isFinite(n)) {
        throw new RangeError(`svgFromDrawing: number is not finite (${n})`);
    }
    if (Math.abs(n) >= MAX_ABS) {
        throw new RangeError(`svgFromDrawing: number is too large (${n})`);
    }
    const s = n.toFixed(2);
    const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
    return t === '-0' ? '0' : t;
}

// Characters XML 1.0 cannot carry at all (control codes, lone surrogates, U+FFFE/F).
const INVALID_XML =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** Escapes `& < > " '` after removing characters XML cannot represent. */
function escText(s: string): string {
    return s.replace(INVALID_XML, '').replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Attribute values also keep tabs and line breaks as references. */
function esc(s: string): string {
    return escText(s)
        .replace(/\t/g, '&#9;')
        .replace(/\n/g, '&#10;')
        .replace(/\r/g, '&#13;');
}

/** `name="value"` with the value escaped. */
const attr = (name: string, value: string): string => `${name}="${esc(value)}"`;
const nattr = (name: string, value: number): string =>
    `${name}="${num(value)}"`;

const ID_PREFIX = /^(?:[A-Za-z_][\w.-]*)?$/;

class Writer {
    readonly prefix: string;

    constructor(private readonly o: SvgExportOptions) {
        this.prefix = o.idPrefix ?? '';
        if (!ID_PREFIX.test(this.prefix)) {
            throw new Error(
                `svgFromDrawing: invalid idPrefix ${JSON.stringify(this.prefix)}`,
            );
        }
    }

    /** The CSS colour of a palette token; an unknown token throws. */
    colour(token: string, what = 'colour'): string {
        if (!Object.hasOwn(this.o.palette, token)) {
            throw new Error(
                `svgFromDrawing: no palette entry for ${what} ${JSON.stringify(token)}`,
            );
        }
        return this.o.palette[token]!;
    }

    fillKey(key: string): string {
        return this.colour(key, 'fill key');
    }

    style(key: StyleKey): SvgStyle {
        if (!Object.hasOwn(this.o.styles, key)) {
            throw new Error(`svgFromDrawing: no style for ${key}`);
        }
        return this.o.styles[key];
    }

    /** Stroke attributes of `style`, with the dash array when it applies. */
    stroke(style: SvgStyle, dashed: boolean | undefined): string[] {
        if (style.stroke === null) return [];
        const out = [
            attr('stroke', this.colour(style.stroke)),
            nattr('stroke-width', style.strokeWidthMm),
        ];
        const own = style.dash !== null && style.dash.length > 0;
        if (own || dashed) {
            const w = style.strokeWidthMm > 0 ? style.strokeWidthMm : 1;
            const dash = own
                ? style.dash!
                : DEFAULT_DASH_FACTORS.map((f) => f * w);
            out.push(attr('stroke-dasharray', dash.map(num).join(' ')));
        }
        return out;
    }

    private fillOf(
        style: StyleKey,
        item: Extract<DrawItem, { t: 'poly' }>,
    ): string {
        if (item.fillKey !== undefined) return this.fillKey(item.fillKey);
        if (item.fill !== undefined) return item.fill;
        const s = this.style(style);
        if (s.hatch) return `url(#${this.prefix}hatch-${style})`;
        return s.fill === null ? 'none' : this.colour(s.fill);
    }

    item(item: DrawItem): string {
        switch (item.t) {
            case 'poly': {
                const s = this.style(item.style);
                const rings = [item.pts, ...(item.holes ?? [])];
                const close = item.closed || (item.holes?.length ?? 0) > 0;
                const d = rings.map((r) => ring(r, close)).join(' ');
                const fill = item.closed
                    ? this.fillOf(item.style, item)
                    : 'none';
                return `<path ${[
                    attr('d', d),
                    ...(close ? ['fill-rule="evenodd"'] : []),
                    attr('fill', fill),
                    ...this.stroke(s, item.dashed),
                ].join(' ')}/>`;
            }
            case 'line': {
                const s = this.style(item.style);
                return `<line ${[
                    nattr('x1', item.a.x),
                    nattr('y1', item.a.y),
                    nattr('x2', item.b.x),
                    nattr('y2', item.b.y),
                    ...this.stroke(s, item.dashed),
                ].join(' ')}/>`;
            }
            case 'arc': {
                const s = this.style(item.style);
                return `<path ${[
                    attr('d', arcPath(item)),
                    'fill="none"',
                    ...this.stroke(s, false),
                ].join(' ')}/>`;
            }
            case 'circle': {
                const s = this.style(item.style);
                return `<circle ${[
                    nattr('cx', item.c.x),
                    nattr('cy', item.c.y),
                    nattr('r', item.r),
                    attr(
                        'fill',
                        s.fill === null ? 'none' : this.colour(s.fill),
                    ),
                    ...this.stroke(s, false),
                ].join(' ')}/>`;
            }
            case 'text':
                return this.text(item);
            case 'image':
                return this.image(item);
        }
    }

    private text(item: Extract<DrawItem, { t: 'text' }>): string {
        const s = this.style(item.style);
        const transform =
            item.rotationDeg === 0
                ? `translate(${num(item.at.x)} ${num(item.at.y)})`
                : `translate(${num(item.at.x)} ${num(item.at.y)}) rotate(${num(item.rotationDeg)})`;
        const shared = [
            attr('transform', transform),
            ...(item.dyEm === 0 ? [] : [nattr('dy', item.dyEm * item.sizeMm)]),
            attr('text-anchor', item.anchor),
            // svg2pdf.js reads alignment-baseline, browsers dominant-baseline.
            attr('dominant-baseline', BASELINE[item.baseline]),
            attr('alignment-baseline', BASELINE[item.baseline]),
            nattr('font-size', item.sizeMm),
            attr('font-family', this.o.fontFamily),
            ...(s.fontWeight === undefined
                ? []
                : [nattr('font-weight', s.fontWeight)]),
        ];
        const content = escText(item.text);
        const main = `<text ${[
            ...shared,
            attr('fill', s.fill === null ? 'none' : this.colour(s.fill)),
        ].join(' ')}>${content}</text>`;
        if (s.stroke === null) return main;
        // A stroked text style is a halo: a stroke-only copy under the fill
        // (no paint-order, which PDF export does not support).
        const halo = `<text ${[
            ...shared,
            'fill="none"',
            ...this.stroke(s, false),
            'stroke-linejoin="round"',
        ].join(' ')}>${content}</text>`;
        return `${halo}\n${main}`;
    }

    group(g: DrawGroup): string {
        const items = g.items.map((i) => this.item(i)).filter((s) => s !== '');
        const open =
            g.entityId === null
                ? '<g>'
                : `<g ${attr('data-entity', g.entityId)}>`;
        return [open, ...items, '</g>'].join('\n');
    }

    pattern(key: StyleKey): string | null {
        const s = this.style(key);
        if (!s.hatch) return null;
        const { spacingMm: sp, angleDeg, color } = s.hatch;
        const rotate =
            angleDeg === 0
                ? []
                : [attr('patternTransform', `rotate(${num(angleDeg)})`)];
        const base =
            s.fill === null
                ? []
                : [
                      `<rect ${[nattr('width', sp), nattr('height', sp), attr('fill', this.colour(s.fill))].join(' ')}/>`,
                  ];
        const stroke = `<line ${[
            'x1="0"',
            nattr('y1', sp / 2),
            nattr('x2', sp),
            nattr('y2', sp / 2),
            attr('stroke', this.colour(color)),
            nattr('stroke-width', sp * HATCH_LINE_SHARE),
        ].join(' ')}/>`;
        return [
            `<pattern ${[
                attr('id', `${this.prefix}hatch-${key}`),
                'patternUnits="userSpaceOnUse"',
                nattr('width', sp),
                nattr('height', sp),
                ...rotate,
            ].join(' ')}>`,
            ...base,
            stroke,
            '</pattern>',
        ].join('\n');
    }

    /** The background image, or `''` when its source is not an allowed `href`. */
    image(item: Extract<DrawItem, { t: 'image' }>): string {
        const remote =
            this.o.allowRemoteHref === true && HTTP_HREF.test(item.href);
        if (!DATA_IMAGE_HREF.test(item.href) && !remote) {
            return '';
        }
        const cx = item.at.x + item.width / 2;
        const cy = item.at.y + item.height / 2;
        const opacity = Math.min(1, Math.max(0, item.opacity));
        return `<image ${[
            attr('href', item.href),
            nattr('x', item.at.x),
            nattr('y', item.at.y),
            nattr('width', item.width),
            nattr('height', item.height),
            'preserveAspectRatio="none"',
            ...(opacity === 1 ? [] : [nattr('opacity', opacity)]),
            ...(item.rotationDeg === 0
                ? []
                : [
                      attr(
                          'transform',
                          `rotate(${num(item.rotationDeg)} ${num(cx)} ${num(cy)})`,
                      ),
                  ]),
        ].join(' ')}/>`;
    }
}

const BASELINE = {
    middle: 'middle',
    top: 'hanging',
    bottom: 'alphabetic',
} as const;

function ring(pts: Vec2[], close: boolean): string {
    const cmds = pts.map(
        (p, i) => `${i === 0 ? 'M' : 'L'} ${num(p.x)} ${num(p.y)}`,
    );
    return (close ? [...cmds, 'Z'] : cmds).join(' ');
}

/**
 * Plan angles run clockwise on screen from +x, which is SVG's positive
 * (sweep-flag 1) direction too, so they convert directly. A full turn is two
 * half arcs, as one arc cannot start and end on the same point.
 */
function arcPath(a: Extract<DrawItem, { t: 'arc' }>): string {
    const at = (deg: number): string => {
        const rad = (deg * Math.PI) / 180;
        return `${num(a.c.x + a.r * Math.cos(rad))} ${num(a.c.y + a.r * Math.sin(rad))}`;
    };
    const r = num(a.r);
    const sweep = a.endDeg - a.startDeg;
    if (sweep >= 360 - 1e-9) {
        const mid = a.startDeg + 180;
        return `M ${at(a.startDeg)} A ${r} ${r} 0 0 1 ${at(mid)} A ${r} ${r} 0 0 1 ${at(a.startDeg)}`;
    }
    const large = sweep > 180 ? 1 : 0;
    return `M ${at(a.startDeg)} A ${r} ${r} 0 ${large} 1 ${at(a.endDeg)}`;
}

/** Serialises `d` to an SVG document (04 §8.3). Throws on a missing palette key or a non-finite number. */
export function svgFromDrawing(d: PlanDrawing, o: SvgExportOptions): string {
    const w = new Writer(o);
    const { min, max } = o.viewBox;
    const out: string[] = [
        `<svg ${[
            'xmlns="http://www.w3.org/2000/svg"',
            nattr('width', o.widthPx),
            nattr('height', o.heightPx),
            attr(
                'viewBox',
                `${num(min.x)} ${num(min.y)} ${num(max.x - min.x)} ${num(max.y - min.y)}`,
            ),
        ].join(' ')}>`,
    ];

    const patterns = STYLE_KEYS.map((k) => w.pattern(k)).filter(
        (p): p is string => p !== null,
    );
    if (patterns.length > 0) out.push('<defs>', ...patterns, '</defs>');

    if (o.background !== null) {
        out.push(
            `<rect ${[
                nattr('x', min.x),
                nattr('y', min.y),
                nattr('width', max.x - min.x),
                nattr('height', max.y - min.y),
                attr('fill', o.background),
            ].join(' ')}/>`,
        );
    }

    for (const layer of LAYER_ORDER) {
        const groups = d.layers[layer].map((g) => w.group(g));
        out.push(
            `<g ${attr('id', `${w.prefix}layer-${layer}`)}>`,
            ...groups,
            '</g>',
        );
    }
    out.push('</svg>');
    return out.join('\n');
}
