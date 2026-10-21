import { describe, expect, it } from 'vitest';
import { derivePlanGeometry } from '../../derive';
import type { PlanDocument } from '../../schema';
import { emptyPlan, makeRectPlan } from '../../testing/fixtures';
import {
    addFixture,
    addOpening,
    addRoomMeta,
} from '../../testing/drawingHelpers';
import { testDrawingOptions } from '../../testing/drawingOptions';
import { buildBrochure2Bhk, buildHdb3Room } from '../../testing/referencePlans';
import {
    TEST_PALETTE,
    TEST_STYLES,
    testSvgOptions,
} from '../../testing/svgOptions';
import { assertWellFormedXml } from '../../testing/xmlCheck';
import {
    buildPlanDrawing,
    LAYER_ORDER,
    type DrawGroup,
    type DrawItem,
    type PlanDrawing,
    type RoomColorKey,
    type StyleKey,
} from '..';
import { svgFromDrawing, type SvgStyle } from '../svg';

const TOP = 'w_0000000001';

function drawingOf(
    doc: PlanDocument,
    over: Parameters<typeof testDrawingOptions>[0] = {},
): PlanDrawing {
    return buildPlanDrawing(
        doc,
        derivePlanGeometry(doc),
        testDrawingOptions(over),
    );
}

/** A drawing with one hand-written group on `layer`; everything else empty. */
function drawingWith(
    layer: (typeof LAYER_ORDER)[number],
    ...groups: DrawGroup[]
): PlanDrawing {
    const layers = Object.fromEntries(
        LAYER_ORDER.map((l) => [l, [] as DrawGroup[]]),
    ) as PlanDrawing['layers'];
    layers[layer] = groups;
    return { bbox: null, layers };
}

const group = (
    items: DrawItem[],
    entityId: string | null = 'w_x',
): DrawGroup => ({
    entityId,
    entityKind: 'wall',
    items,
});

const square = (x: number, y: number, s: number) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
];

const textItem0 = (): DrawItem => ({
    t: 'text',
    at: { x: 0, y: 0 },
    text: 'x',
    sizeMm: 100,
    dyEm: 0,
    rotationDeg: 0,
    anchor: 'start',
    baseline: 'middle',
    style: 'room_name',
});

const svg = (d: PlanDrawing, over: Parameters<typeof testSvgOptions>[0] = {}) =>
    svgFromDrawing(d, testSvgOptions(over));

/** Everything inside the quotes of every `name="..."` attribute. */
const attrValues = (xml: string, name: string): string[] =>
    [...xml.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map(
        (m) => m[1]!,
    );

describe('svgFromDrawing structure (04 §8.3)', () => {
    const doc = makeRectPlan(5000, 4000, 230);
    addRoomMeta(doc, { x: 2500, y: 2000 }, { name: 'Living', type: 'living' });
    const out = svg(drawingOf(doc));

    it('is a well-formed svg with the viewBox and output size', () => {
        assertWellFormedXml(out);
        expect(out).toMatch(
            /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1100" height="900" viewBox="-500 -500 11000 9000">/,
        );
        expect(out.trimEnd().endsWith('</svg>')).toBe(true);
    });

    it('writes the page background rect', () => {
        expect(out).toContain(
            '<rect x="-500" y="-500" width="11000" height="9000" fill="#ffffff"/>',
        );
        expect(svg(drawingOf(doc), { background: null })).not.toContain(
            'fill="#ffffff"/>',
        );
    });

    it('writes one layer group per layer in paint order', () => {
        const ids = attrValues(out, 'id').filter((v) => v.startsWith('layer-'));
        expect(ids).toEqual(LAYER_ORDER.map((l) => `layer-${l}`));
        for (const l of LAYER_ORDER) {
            expect(out.split(`<g id="layer-${l}"`).length - 1).toBe(1);
        }
    });

    it('writes one entity group per drawing group', () => {
        const layer = (name: string): string =>
            out.slice(
                out.indexOf(`<g id="layer-${name}">`),
                out.indexOf(
                    '</g>\n<g id="layer-',
                    out.indexOf(`<g id="layer-${name}">`),
                ),
            );
        for (const wallId of Object.keys(doc.walls)) {
            expect(
                layer('WALLS').split(`<g data-entity="${wallId}">`),
            ).toHaveLength(2);
        }
        // the room group is on ROOMS (fill) and on TEXT (labels)
        const roomId = Object.keys(doc.rooms)[0]!;
        expect(
            layer('ROOMS').split(`<g data-entity="${roomId}">`),
        ).toHaveLength(2);
        expect(layer('TEXT').split(`<g data-entity="${roomId}">`)).toHaveLength(
            2,
        );
    });

    it('resolves the room fill token through the palette', () => {
        expect(out).toContain(`fill="${TEST_PALETTE['room-living']}"`);
        expect(out).not.toContain('room-living');
    });

    it('draws a poly with holes as one evenodd path', () => {
        const d = drawingWith(
            'ROOMS',
            group([
                {
                    t: 'poly',
                    pts: square(0, 0, 1000),
                    holes: [square(200, 200, 300)],
                    closed: true,
                    style: 'room_fill',
                },
            ]),
        );
        const xml = svg(d);
        const paths = xml.match(/<path [^>]*>/g) ?? [];
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain('fill-rule="evenodd"');
        expect(paths[0]!.match(/M/g)).toHaveLength(2);
        expect(paths[0]!.match(/Z/g)).toHaveLength(2);
    });

    it('leaves an open poly unfilled and unclosed', () => {
        const xml = svg(
            drawingWith(
                'WALLS',
                group([
                    {
                        t: 'poly',
                        pts: square(0, 0, 100).slice(0, 3),
                        closed: false,
                        style: 'wall',
                    },
                ]),
            ),
        );
        const path = xml.match(/<path [^>]*>/)![0];
        expect(path).toContain('fill="none"');
        expect(path).not.toContain('Z');
    });

    it('emits arcs as SVG A commands that end on the swing end point', () => {
        const xml = svg(
            drawingWith(
                'OPENINGS',
                group([
                    {
                        t: 'arc',
                        c: { x: 100, y: 200 },
                        r: 900,
                        startDeg: 0,
                        endDeg: 90,
                        style: 'door_swing',
                    },
                ]),
            ),
        );
        // from (1000,200) clockwise on screen (y down) to (100,1100)
        expect(xml).toContain('d="M 1000 200 A 900 900 0 0 1 100 1100"');
    });

    it('marks arcs over 180 degrees large and splits a full circle', () => {
        const big = svg(
            drawingWith(
                'OPENINGS',
                group([
                    {
                        t: 'arc',
                        c: { x: 0, y: 0 },
                        r: 100,
                        startDeg: 0,
                        endDeg: 270,
                        style: 'door_swing',
                    },
                ]),
            ),
        );
        expect(big).toContain('A 100 100 0 1 1 0 -100');
        const full = svg(
            drawingWith(
                'OPENINGS',
                group([
                    {
                        t: 'arc',
                        c: { x: 0, y: 0 },
                        r: 100,
                        startDeg: 0,
                        endDeg: 360,
                        style: 'door_swing',
                    },
                ]),
            ),
        );
        expect(full.match(/ A /g)).toHaveLength(2);
    });

    it('lowers a door plan to arcs and lines', () => {
        const withDoor = makeRectPlan(5000, 4000, 230);
        addOpening(withDoor, TOP);
        const xml = svg(drawingOf(withDoor));
        assertWellFormedXml(xml);
        expect(xml).toMatch(/ A \d/);
    });

    it('draws circles and lines', () => {
        const xml = svg(
            drawingWith(
                'FIXTURES',
                group([
                    {
                        t: 'circle',
                        c: { x: 10, y: 20 },
                        r: 30,
                        style: 'fixture',
                    },
                    {
                        t: 'line',
                        a: { x: 0, y: 0 },
                        b: { x: 5, y: 6 },
                        style: 'dim_line',
                    },
                ]),
            ),
        );
        expect(xml).toContain('<circle cx="10" cy="20" r="30"');
        expect(xml).toContain('<line x1="0" y1="0" x2="5" y2="6"');
    });
});

describe('svgFromDrawing text', () => {
    const textItem = (
        over: Partial<Extract<DrawItem, { t: 'text' }>> = {},
    ): DrawItem => ({
        t: 'text',
        at: { x: 100, y: 200 },
        text: 'Hello',
        sizeMm: 200,
        dyEm: 0.5,
        rotationDeg: 30,
        anchor: 'middle',
        baseline: 'bottom',
        style: 'room_name',
        ...over,
    });

    it('writes transform, anchor, baseline, size, weight and font', () => {
        const xml = svg(drawingWith('TEXT', group([textItem()])));
        const el = xml.match(/<text [^>]*>/)![0];
        expect(el).toContain('transform="translate(100 200) rotate(30)"');
        expect(el).toContain('text-anchor="middle"');
        expect(el).toContain('dominant-baseline="alphabetic"');
        expect(el).toContain('font-size="200"');
        expect(el).toContain('font-weight="600"');
        expect(el).toContain('font-family="Inter, Arial, sans-serif"');
        expect(el).toContain('dy="100"');
        expect(xml).toContain('>Hello</text>');
    });

    it('maps the other baselines', () => {
        const xml = svg(
            drawingWith(
                'TEXT',
                group([
                    textItem({ baseline: 'middle' }),
                    textItem({ baseline: 'top' }),
                ]),
            ),
        );
        expect(xml).toContain('dominant-baseline="middle"');
        expect(xml).toContain('dominant-baseline="hanging"');
    });

    it('draws a halo as a stroke-only underlay before the fill text', () => {
        const xml = svg(
            drawingWith('DIMS', group([textItem({ style: 'dim_text' })])),
        );
        const els = xml.match(/<text [^>]*>[^<]*<\/text>/g)!;
        expect(els).toHaveLength(2);
        const [halo, main] = els as [string, string];
        expect(halo).toContain('fill="none"');
        expect(halo).toContain('stroke="#FBFAF8"');
        expect(halo).toContain('stroke-width="0.8"');
        expect(halo).toContain('stroke-linejoin="round"');
        expect(main).toContain('fill="#374151"');
        expect(main).not.toContain('stroke');
        expect(xml).not.toContain('paint-order');
        // same geometry, same text
        expect(halo.replace(/ fill="none".*?stroke-linejoin="round"/, '')).toBe(
            main.replace(/ fill="#374151"/, ''),
        );
    });

    it('writes alignment-baseline next to dominant-baseline', () => {
        for (const baseline of ['middle', 'top', 'bottom'] as const) {
            const xml = svg(
                drawingWith('TEXT', group([textItem({ baseline })])),
            );
            const dom = xml.match(/dominant-baseline="([^"]+)"/)![1];
            expect(xml).toContain(`alignment-baseline="${dom}"`);
        }
    });

    it('writes a plain text style as a single text element', () => {
        const xml = svg(drawingWith('TEXT', group([textItem()])));
        expect(xml.match(/<text /g)).toHaveLength(1);
    });

    it('drops characters that XML cannot carry', () => {
        const xml = svg(
            drawingWith(
                'TEXT',
                group([textItem({ text: 'a\u0001b\u0000c\uD800d' })]),
            ),
        );
        assertWellFormedXml(xml);
        expect(xml).toContain('>abcd</text>');
    });
});

describe('svgFromDrawing escaping (04 §8.3)', () => {
    const NAME = '<script>alert(1)</script> & "x"';

    it('escapes a malicious room name in text content', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        addRoomMeta(doc, { x: 2500, y: 2000 }, { name: NAME });
        const xml = svg(drawingOf(doc));
        assertWellFormedXml(xml);
        expect(xml).toContain(
            '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;',
        );
        expect(xml).not.toContain('<script');
    });

    it('escapes apostrophes and all five characters in labels', () => {
        const doc = emptyPlan();
        doc.annotations.labels['t_0000000001'] = {
            id: 't_0000000001',
            position: { x: 0, y: 0 },
            text: `<&>"'`,
            fontSize: 200,
            rotation: 0,
        };
        const xml = svg(drawingOf(doc));
        expect(xml).toContain('&lt;&amp;&gt;&quot;&#39;</text>');
        assertWellFormedXml(xml);
    });

    it('escapes a malicious entity id in data-entity', () => {
        const id = `w_"><script>alert('x')</script>&`;
        const xml = svg(
            drawingWith(
                'WALLS',
                group(
                    [
                        {
                            t: 'line',
                            a: { x: 0, y: 0 },
                            b: { x: 1, y: 1 },
                            style: 'wall_outline',
                        },
                    ],
                    id,
                ),
            ),
        );
        assertWellFormedXml(xml);
        expect(xml).toContain(
            'data-entity="w_&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;"',
        );
        expect(xml).not.toContain('<script');
    });

    it('rejects a fillKey that is not in the palette, whatever it contains', () => {
        const bad = '"/><script>alert(1)</script>' as RoomColorKey;
        const d = drawingWith(
            'ROOMS',
            group([
                {
                    t: 'poly',
                    pts: square(0, 0, 10),
                    closed: true,
                    style: 'room_fill',
                    fillKey: bad,
                },
            ]),
        );
        expect(() => svg(d)).toThrow(/palette/);
    });

    it('names the missing palette key in the error', () => {
        const d = drawingWith(
            'ROOMS',
            group([
                {
                    t: 'poly',
                    pts: square(0, 0, 10),
                    closed: true,
                    style: 'room_fill',
                    fillKey: 'room-living',
                },
            ]),
        );
        const without = Object.fromEntries(
            Object.entries(TEST_PALETTE).filter(([k]) => k !== 'room-living'),
        );
        expect(() => svg(d, { palette: without })).toThrow(/room-living/);
        expect(() => svg(d, { palette: without })).toThrow(/fill key/);
        // inherited object properties are not palette entries
        expect(() =>
            svg(d, {
                palette: Object.create(TEST_PALETTE) as Record<string, string>,
            }),
        ).toThrow(/palette entry/);
    });

    it('escapes palette values, literal fills and the font family in attributes', () => {
        const d = drawingWith(
            'ROOMS',
            group([
                {
                    t: 'poly',
                    pts: square(0, 0, 10),
                    closed: true,
                    style: 'room_fill',
                    fillKey: 'room-living',
                },
                {
                    t: 'poly',
                    pts: square(0, 0, 10),
                    closed: true,
                    style: 'fixture',
                    fill: '"><b>',
                },
                {
                    t: 'text',
                    at: { x: 0, y: 0 },
                    text: 't',
                    sizeMm: 10,
                    dyEm: 0,
                    rotationDeg: 0,
                    anchor: 'start',
                    baseline: 'middle',
                    style: 'label',
                },
            ]),
        );
        const xml = svg(d, {
            palette: { ...TEST_PALETTE, 'room-living': `red" onload="x` },
            fontFamily: `Inter, "Evil" 'Font' <&>`,
        });
        assertWellFormedXml(xml);
        expect(xml).toContain('fill="red&quot; onload=&quot;x"');
        expect(xml).toContain('fill="&quot;&gt;&lt;b&gt;"');
        expect(xml).toContain(
            'font-family="Inter, &quot;Evil&quot; &#39;Font&#39; &lt;&amp;&gt;"',
        );
        expect(xml).not.toMatch(/" onload=/);
    });

    it('resolves a style colour through the palette and escapes the value', () => {
        const styles = {
            ...TEST_STYLES,
            wall: { ...TEST_STYLES.wall, fill: 'evil' },
        };
        const d = drawingWith(
            'WALLS',
            group([
                {
                    t: 'poly',
                    pts: square(0, 0, 10),
                    closed: true,
                    style: 'wall',
                },
            ]),
        );
        const xml = svg(d, {
            styles,
            palette: { ...TEST_PALETTE, evil: '#000" x="y' },
        });
        assertWellFormedXml(xml);
        expect(xml).toContain('fill="#000&quot; x=&quot;y"');
    });

    it('throws on a style colour that is not a palette key', () => {
        const d = drawingWith(
            'WALLS',
            group([
                {
                    t: 'poly',
                    pts: square(0, 0, 10),
                    closed: true,
                    style: 'wall',
                },
            ]),
        );
        const withColour = (patch: Partial<SvgStyle>) => ({
            styles: { ...TEST_STYLES, wall: { ...TEST_STYLES.wall, ...patch } },
        });
        // a literal CSS colour is not a token
        expect(() => svg(d, withColour({ fill: '#3B3B3B' }))).toThrow(
            /palette entry for colour "#3B3B3B"/,
        );
        expect(() =>
            svg(d, withColour({ stroke: 'nope', strokeWidthMm: 1 })),
        ).toThrow(/"nope"/);
        // inherited properties are not tokens either
        expect(() => svg(d, withColour({ fill: 'constructor' }))).toThrow(
            /"constructor"/,
        );
        expect(() => svg(d, withColour({ fill: 'toString' }))).toThrow(
            /"toString"/,
        );
        // known token: fine
        expect(svg(d, withColour({ fill: 'cFFFFFF' }))).toContain(
            'fill="#FFFFFF"',
        );
    });

    it('throws on an unknown hatch colour token', () => {
        const styles = {
            ...TEST_STYLES,
            wall_exterior: {
                ...TEST_STYLES.wall_exterior,
                hatch: { angleDeg: 45, spacingMm: 60, color: '#5A5A5A' },
            },
        };
        expect(() => svg(drawingWith('WALLS'), { styles })).toThrow(
            /"#5A5A5A"/,
        );
    });

    it('throws cleanly on a style key that is not an own property', () => {
        const d = drawingWith(
            'WALLS',
            group([
                {
                    t: 'line',
                    a: { x: 0, y: 0 },
                    b: { x: 1, y: 1 },
                    style: 'constructor' as StyleKey,
                },
            ]),
        );
        expect(() => svg(d)).toThrow(/no style for constructor/);
    });

    it('rejects a font weight that is not a number', () => {
        const styles = {
            ...TEST_STYLES,
            room_name: {
                ...TEST_STYLES.room_name,
                fontWeight: '600" onload="alert(1)' as unknown as 600,
            },
        };
        const d = drawingWith('TEXT', group([textItem0()]));
        expect(() => svg(d, { styles })).toThrow(/not finite/);
    });

    it('writes a numeric font weight verbatim', () => {
        const xml = svg(drawingWith('TEXT', group([textItem0()])));
        expect(xml).toContain('font-weight="600"');
    });

    it('writes attribute tab, CR and LF as character references', () => {
        const xml = svg(
            drawingWith(
                'WALLS',
                group(
                    [
                        {
                            t: 'line',
                            a: { x: 0, y: 0 },
                            b: { x: 1, y: 1 },
                            style: 'wall_outline',
                        },
                    ],
                    'a\nb\rc\td',
                ),
            ),
        );
        assertWellFormedXml(xml);
        expect(xml).toContain('data-entity="a&#10;b&#13;c&#9;d"');
        expect(xml).not.toMatch(/data-entity="[^"]*[\t\r\n]/);
    });

    it('does not interpolate any option string raw into an attribute', () => {
        const nasty = '" onload="alert(1)';
        const xml = svg(
            drawingWith(
                'WALLS',
                group([
                    {
                        t: 'poly',
                        pts: square(0, 0, 10),
                        closed: true,
                        style: 'wall_exterior',
                    },
                ]),
            ),
            { fontFamily: nasty, background: nasty },
        );
        assertWellFormedXml(xml);
        expect(xml).not.toMatch(/" onload=/);
    });
});

describe('svgFromDrawing numbers', () => {
    it('writes at most two decimals and never -0, NaN or Infinity', () => {
        const xml = svg(
            drawingWith(
                'WALLS',
                group([
                    {
                        t: 'line',
                        a: { x: 1.005, y: -0 },
                        b: { x: 3.14159, y: 2.5 },
                        style: 'wall_outline',
                    },
                    {
                        t: 'line',
                        a: { x: -0.001, y: 1 / 3 },
                        b: { x: 100.1, y: 7.1 },
                        style: 'wall_outline',
                    },
                ]),
            ),
            {
                viewBox: {
                    min: { x: -0.004, y: 0.333 },
                    max: { x: 10.126, y: 20.5 },
                },
            },
        );
        expect(xml).not.toMatch(/\d\.\d{3}/);
        expect(xml).not.toMatch(/-0(?![.\d])/);
        expect(xml).toContain('x2="3.14"');
        expect(xml).toContain('y2="2.5"');
        expect(xml).toContain('x2="100.1"');
        expect(xml).toContain('y2="7.1"');
    });

    it('fails loudly on a non-finite number', () => {
        const d = drawingWith(
            'WALLS',
            group([
                {
                    t: 'line',
                    a: { x: NaN, y: 0 },
                    b: { x: 1, y: 1 },
                    style: 'wall_outline',
                },
            ]),
        );
        expect(() => svg(d)).toThrow(/finite/);
        expect(() => svg(drawingWith('WALLS'), { widthPx: Infinity })).toThrow(
            /finite/,
        );
    });
});

describe('svgFromDrawing strokes, dashes and hatches', () => {
    const lineItem = (style: StyleKey, dashed?: boolean): DrawItem => ({
        t: 'line',
        a: { x: 0, y: 0 },
        b: { x: 1000, y: 0 },
        style,
        ...(dashed ? { dashed: true } : {}),
    });
    const tag = (xml: string) => xml.match(/<line [^>]*x2="1000"[^>]*>/)![0];

    it('writes stroke colour and width from the style', () => {
        const el = tag(
            svg(drawingWith('WALLS', group([lineItem('wall_outline')]))),
        );
        expect(el).toContain('stroke="#1A1A1A"');
        expect(el).toContain('stroke-width="0.33"');
        expect(el).not.toContain('stroke-dasharray');
    });

    it('honours item-level dashed with the style dash array', () => {
        const styles = {
            ...TEST_STYLES,
            dim_line: { ...TEST_STYLES.dim_line, dash: [5, 3] },
        };
        const el = tag(
            svg(drawingWith('DIMS', group([lineItem('dim_line', true)])), {
                styles,
            }),
        );
        expect(el).toContain('stroke-dasharray="5 3"');
    });

    it('falls back to a default dash scaled by the stroke width', () => {
        const el = tag(
            svg(drawingWith('DIMS', group([lineItem('dim_line', true)]))),
        );
        // dim_line: width 0.2 mm, no dash array: 6 x and 4 x the width
        expect(el).toContain('stroke-dasharray="1.2 0.8"');
    });

    it('uses a default dash for a style without a stroke width', () => {
        const styles = {
            ...TEST_STYLES,
            wall_outline: { ...TEST_STYLES.wall_outline, strokeWidthMm: 0 },
        };
        const el = tag(
            svg(drawingWith('WALLS', group([lineItem('wall_outline', true)])), {
                styles,
            }),
        );
        expect(el).toContain('stroke-dasharray="6 4"');
    });

    it('draws a style dash array without the item flag (furniture_missing)', () => {
        const xml = svg(
            drawingWith(
                'FURNITURE',
                group([
                    {
                        t: 'poly',
                        pts: square(0, 0, 600),
                        closed: true,
                        style: 'furniture_missing',
                        dashed: true,
                    },
                ]),
            ),
        );
        expect(xml).toContain('stroke-dasharray="6 4"');
        const plain = svg(
            drawingWith(
                'FURNITURE',
                group([
                    {
                        t: 'poly',
                        pts: square(0, 0, 600),
                        closed: true,
                        style: 'furniture_missing',
                    },
                ]),
            ),
        );
        expect(plain).toContain('stroke-dasharray="6 4"');
    });

    it('dashes polys and ignores empty dash arrays', () => {
        const xml = svg(
            drawingWith(
                'FIXTURES',
                group([
                    {
                        t: 'poly',
                        pts: square(0, 0, 100),
                        closed: true,
                        style: 'fixture',
                        dashed: true,
                    },
                ]),
            ),
            {
                styles: {
                    ...TEST_STYLES,
                    fixture: { ...TEST_STYLES.fixture, dash: [] },
                },
            },
        );
        expect(xml).toContain('stroke-dasharray="1.56 1.04"');
    });

    it('emits one userSpaceOnUse pattern per hatch style and fills with it', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const xml = svg(drawingOf(doc));
        assertWellFormedXml(xml);
        expect(xml.match(/<pattern /g)).toHaveLength(1);
        expect(xml).toContain(
            '<pattern id="hatch-wall_exterior" patternUnits="userSpaceOnUse" width="60" height="60" patternTransform="rotate(45)">',
        );
        // all four exterior walls paint with it
        expect(xml.match(/fill="url\(#hatch-wall_exterior\)"/g)).toHaveLength(
            4,
        );
        expect(xml).toContain('stroke="#5A5A5A"');
    });

    it('writes one pattern for each hatch style, in style order', () => {
        const hatch = { angleDeg: 0, spacingMm: 40, color: 'cFFFFFF' };
        const styles = {
            ...TEST_STYLES,
            wall_half: { ...TEST_STYLES.wall_half, hatch },
        };
        const xml = svg(drawingWith('WALLS'), { styles });
        expect(
            attrValues(xml, 'id').filter((v) => v.startsWith('hatch-')),
        ).toEqual(['hatch-wall_exterior', 'hatch-wall_half']);
    });

    it('writes the hatch tile: base rect, one centred line, 10 % of the spacing wide', () => {
        const hatch = { angleDeg: 0, spacingMm: 40, color: 'c5A5A5A' };
        const styles = {
            ...TEST_STYLES,
            wall_exterior: {
                ...TEST_STYLES.wall_exterior,
                hatch: undefined,
            } as SvgStyle,
            wall_half: { ...TEST_STYLES.wall_half, hatch },
        };
        const xml = svg(drawingWith('WALLS'), { styles });
        expect(xml).toContain(
            [
                '<defs>',
                '<pattern id="hatch-wall_half" patternUnits="userSpaceOnUse" width="40" height="40">',
                '<rect width="40" height="40" fill="#8C8C8C"/>',
                '<line x1="0" y1="20" x2="40" y2="20" stroke="#5A5A5A" stroke-width="4"/>',
                '</pattern>',
                '</defs>',
            ].join('\n'),
        );
    });

    it('omits the tile base for an unfilled hatch style', () => {
        const styles = {
            ...TEST_STYLES,
            wall_exterior: {
                ...TEST_STYLES.wall_exterior,
                fill: null,
            },
        };
        const xml = svg(drawingWith('WALLS'), { styles });
        expect(xml).toContain(
            '<pattern id="hatch-wall_exterior" patternUnits="userSpaceOnUse" width="60" height="60" patternTransform="rotate(45)">\n<line',
        );
    });

    it('writes no defs when no style has a hatch', () => {
        const styles = {
            ...TEST_STYLES,
            wall_exterior: {
                ...TEST_STYLES.wall_exterior,
                hatch: undefined,
            } as SvgStyle,
        };
        expect(svg(drawingWith('WALLS'), { styles })).not.toContain('<defs');
    });
});

describe('svgFromDrawing background image', () => {
    const image = (
        href: string,
        over: Partial<Extract<DrawItem, { t: 'image' }>> = {},
    ): DrawItem => ({
        t: 'image',
        href,
        at: { x: -100, y: -200 },
        width: 1000,
        height: 400,
        rotationDeg: 0,
        opacity: 1,
        ...over,
    });
    const drawImage = (
        href: string,
        over = {},
        options: Parameters<typeof testSvgOptions>[0] = {},
    ) =>
        svg(
            drawingWith('BACKGROUND', {
                entityId: null,
                entityKind: 'background',
                items: [image(href, over)],
            }),
            options,
        );
    const DATA = 'data:image/png;base64,iVBORw0KGgo=';

    it('is the only href, and absent without an image', () => {
        const xml = drawImage(DATA);
        assertWellFormedXml(xml);
        expect(xml.match(/href=/g)).toHaveLength(1);
        expect(xml).toContain(`href="${DATA}"`);
        expect(xml).not.toContain('xlink');
        expect(svg(drawingWith('WALLS'))).not.toContain('href');
    });

    it('draws the unrotated top-left at `at` and rotates about the centre', () => {
        const xml = drawImage(DATA, { rotationDeg: 30, opacity: 0.5 });
        const el = xml.match(/<image [^>]*>/)![0];
        expect(el).toContain('x="-100"');
        expect(el).toContain('y="-200"');
        expect(el).toContain('width="1000"');
        expect(el).toContain('height="400"');
        expect(el).toContain('preserveAspectRatio="none"');
        expect(el).toContain('opacity="0.5"');
        // centre = at + (w, h) / 2 = (400, 0)
        expect(el).toContain('transform="rotate(30 400 0)"');
    });

    it('omits transform and opacity when they are the identity', () => {
        const el = drawImage(DATA).match(/<image [^>]*>/)![0];
        expect(el).not.toContain('transform');
        expect(el).not.toContain('opacity');
    });

    it('drops http and https URLs by default, so exports never leak signed URLs', () => {
        for (const url of [
            'https://cdn.example.com/p.png?sig=abc',
            'http://example.com/a.png',
        ]) {
            const xml = drawImage(url);
            assertWellFormedXml(xml);
            expect(xml).not.toContain('<image');
            expect(xml).not.toContain('href');
        }
    });

    it('accepts http and https URLs with allowRemoteHref, escaped like any attribute', () => {
        const url = 'https://cdn.example.com/p.png?a=1&b="2"';
        const xml = drawImage(url, {}, { allowRemoteHref: true });
        assertWellFormedXml(xml);
        expect(xml).toContain(
            'href="https://cdn.example.com/p.png?a=1&amp;b=&quot;2&quot;"',
        );
        expect(
            drawImage(
                'http://example.com/a.png',
                {},
                { allowRemoteHref: true },
            ),
        ).toContain('href="http://example.com/a.png"');
        // the opt-in does not widen the other schemes
        expect(
            drawImage('javascript:alert(1)', {}, { allowRemoteHref: true }),
        ).not.toContain('href');
        // data URIs keep working without it
        expect(drawImage(DATA)).toContain('href=');
    });

    it('clamps the opacity to 0..1', () => {
        const op = (v: number): string[] =>
            drawImage(DATA, { opacity: v })
                .match(/<image [^>]*>/)![0]
                .match(/opacity="[^"]*"/g) ?? [];
        expect(op(1.5)).toEqual([]);
        expect(op(-0.5)).toEqual(['opacity="0"']);
        expect(op(0.25)).toEqual(['opacity="0.25"']);
    });

    it.each([
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        ' javascript:alert(1)',
        'java\tscript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'vbscript:x',
        'file:///etc/passwd',
        '//evil.example.com/x.png',
        '/relative.png',
        'https://exa mple.com/x.png',
        '',
    ])('drops the image for %j', (href) => {
        const xml = drawImage(href, {}, { allowRemoteHref: true });
        assertWellFormedXml(xml);
        expect(xml).not.toContain('<image');
        expect(xml).not.toContain('href');
        expect(xml).not.toContain('javascript');
    });
});

describe('svgFromDrawing determinism and reference plans', () => {
    const shuffled = (doc: PlanDocument): PlanDocument => {
        const rev = <T>(rec: Record<string, T>): Record<string, T> =>
            Object.fromEntries(Object.entries(rec).reverse());
        return {
            ...doc,
            nodes: rev(doc.nodes),
            walls: rev(doc.walls),
            openings: rev(doc.openings),
            rooms: rev(doc.rooms),
            placements: rev(doc.placements),
            fixtures: rev(doc.fixtures),
            annotations: {
                dimensions: rev(doc.annotations.dimensions),
                labels: rev(doc.annotations.labels),
            },
        };
    };

    it('builds byte-identical output twice and from a shuffled document', () => {
        const doc = buildHdb3Room();
        addFixture(doc, { libraryKey: 'shower', x: 500, y: 500 });
        const a = svg(drawingOf(doc));
        expect(svg(drawingOf(doc))).toBe(a);
        expect(svg(drawingOf(shuffled(doc)))).toBe(a);
    });

    it.each([
        ['hdb-3room', buildHdb3Room],
        ['brochure-2bhk', buildBrochure2Bhk],
    ])('exports %s as clean, well-formed SVG', (_name, make) => {
        const doc = make();
        doc.annotations.labels['t_0000000001'] = {
            id: 't_0000000001',
            position: { x: 500, y: 500 },
            text: 'Note <&> "q"',
            fontSize: 250,
            rotation: 12.5,
        };
        doc.annotations.dimensions['d_0000000001'] = {
            id: 'd_0000000001',
            a: { x: 0, y: 0 },
            b: { x: 3000, y: 1700 },
            offset: -400,
            attachedTo: null,
        };
        doc.background = {
            importId: null,
            mediaUuid: 'abc',
            pixelWidth: 2000,
            pixelHeight: 1000,
            mmPerPixel: 5.5,
            position: { x: -100, y: -200 },
            rotation: 3,
            opacity: 0.5,
            visible: true,
            locked: false,
        };
        const base = testDrawingOptions();
        const drawing = drawingOf(doc, {
            include: {
                ...base.include,
                background: { href: 'data:image/png;base64,AAAA' },
            },
        });
        const xml = svg(drawing);
        assertWellFormedXml(xml);
        expect(xml).not.toMatch(/NaN|Infinity/);
        expect(xml).not.toMatch(/\d\.\d{3}/);
        expect(xml).not.toContain('<script');
        expect(xml).not.toContain('room-');
        expect(xml.match(/href=/g)).toHaveLength(1);
        for (const l of LAYER_ORDER)
            expect(xml).toContain(`<g id="layer-${l}"`);
        expect(xml).toContain('<path ');
        expect(xml).toContain('<text ');
    });
});

describe('svgFromDrawing id prefix', () => {
    const doc = makeRectPlan(5000, 4000, 230);
    const drawing = drawingOf(doc);

    it('defaults to no prefix', () => {
        const xml = svg(drawing);
        expect(xml).toContain('<g id="layer-WALLS">');
        expect(xml).toContain('<pattern id="hatch-wall_exterior"');
        expect(xml).toContain('fill="url(#hatch-wall_exterior)"');
    });

    it('prefixes layer and hatch ids and the hatch references', () => {
        const xml = svg(drawing, { idPrefix: 'p1-' });
        assertWellFormedXml(xml);
        for (const l of LAYER_ORDER) {
            expect(xml).toContain(`<g id="p1-layer-${l}">`);
        }
        expect(xml).toContain('<pattern id="p1-hatch-wall_exterior"');
        expect(xml).toContain('fill="url(#p1-hatch-wall_exterior)"');
        // nothing is left unprefixed
        expect(xml).not.toMatch(/id="(?!p1-)/);
        expect(xml).not.toMatch(/url\(#(?!p1-)/);
    });

    it('keeps two prefixed exports free of id clashes', () => {
        const ids = (x: string): string[] => attrValues(x, 'id');
        const a = ids(svg(drawing, { idPrefix: 'a-' }));
        const b = ids(svg(drawing, { idPrefix: 'b-' }));
        expect(a.filter((id) => b.includes(id))).toEqual([]);
    });

    it.each(['1x', 'a b', 'a"b', '-x', 'a<b', 'a)'])(
        'rejects the prefix %j',
        (idPrefix) => {
            expect(() => svg(drawing, { idPrefix })).toThrow(/idPrefix/);
        },
    );
});

describe('svgFromDrawing number format', () => {
    const lineAt = (x: number): PlanDrawing =>
        drawingWith(
            'WALLS',
            group([
                {
                    t: 'line',
                    a: { x: 0, y: 0 },
                    b: { x, y: 1 },
                    style: 'wall_outline',
                },
            ]),
        );

    it('never writes exponent notation', () => {
        for (const x of [1e14, -1e14, 123456789012345, 1e-9, -1e-9]) {
            const xml = svg(lineAt(x));
            expect(xml).not.toMatch(/\de[+-]?\d/i);
        }
        expect(svg(lineAt(1e14))).toContain('x2="100000000000000"');
        expect(svg(lineAt(1e-9))).toContain('x2="0"');
    });

    it.each([1e15, -1e15, 1e21, 5e300])('throws on %s', (x) => {
        expect(() => svg(lineAt(x))).toThrow(/too large/);
    });
});

describe('assertWellFormedXml (the strict check the smoke test relies on)', () => {
    it.each([
        ['<svg><g></svg>', 'unmatched'],
        ['<svg><text>a < b</text></svg>', 'expected a name'],
        ['<svg><text>a & b</text></svg>', 'entity'],
        ['<svg a=1/>', 'double-quoted'],
        ['<svg a="1" a="2"/>', 'duplicate'],
        ['<svg a="<"/>', 'raw <'],
        ['<svg/><svg/>', 'after the root'],
        ['<svg><!-- c --></svg>', 'comments'],
        ['<svg>\u0001</svg>', 'character'],
        ['<svg>', 'unclosed'],
        ['<svg>&#0;</svg>', 'non-XML character'],
        ['<svg>&#1;</svg>', 'non-XML character'],
        ['<svg>&#x8;</svg>', 'non-XML character'],
        ['<svg>&#xD800;</svg>', 'non-XML character'],
        ['<svg>&#xDFFF;</svg>', 'non-XML character'],
        ['<svg>&#xFFFE;</svg>', 'non-XML character'],
        ['<svg>&#x110000;</svg>', 'non-XML character'],
        ['<svg a="&#0;"/>', 'non-XML character'],
    ])('rejects %j', (xml, why) => {
        expect(() => assertWellFormedXml(xml)).toThrow(why);
    });

    it('accepts references to tab, LF, CR and astral characters', () => {
        expect(() =>
            assertWellFormedXml(
                '<svg a="&#9;&#10;&#13;&#x20;&#x1F600;&#xFFFD;"/>',
            ),
        ).not.toThrow();
    });

    it('accepts entities and self-closing elements', () => {
        expect(() =>
            assertWellFormedXml('<svg a="x&amp;&#39;&#x27;"><g/>t&lt;</svg>'),
        ).not.toThrow();
    });
});
