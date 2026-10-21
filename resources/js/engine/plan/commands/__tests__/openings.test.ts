import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import type { Opening, PlanDocument } from '../../schema';
import {
    FOOTPRINT,
    Graph,
    busOf,
    ok,
    oneWall,
    refused,
} from '../../testing/graph';
import type { PlanDefaults } from '../pipeline';
import { PLAN_COMMANDS, createPlanBus } from '../registry';

// ---- fixtures ----------------------------------------------------------------

type Bus = ReturnType<typeof busOf>;

/** A second horizontal wall at `y`, `length` long, in the graph of `oneWall`. */
function extraWall(
    g: Graph,
    y: number,
    length: number,
    props: Parameters<Graph['wall']>[2] = {},
): string {
    return g.wall(g.node(0, y), g.node(length, y), props);
}

function expectUndoRestores(bus: Bus, start: PlanDocument): void {
    expect(bus.undo()).toBe(true);
    expect(bus.getDoc()).toEqual(start);
}

/** A refused command leaves the very same document and no history entry. */
function expectRefusedUntouched(
    bus: Bus,
    run: () => ExecuteResult<unknown>,
    code: string,
) {
    const before = bus.getDoc();
    const entries = bus.history().undo.length;
    expect(refused(run()).code).toBe(code);
    expect(bus.getDoc()).toBe(before);
    expect(bus.history().undo.length).toBe(entries);
}

const openingOf = (bus: Bus, id: string): Opening => bus.getDoc().openings[id]!;

/** `u0..u1` of an opening along its wall. */
const spanOf = (o: Opening): [number, number] => [
    o.offset - o.width / 2,
    o.offset + o.width / 2,
];

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers the six opening commands with labels, schemas and geometry', () => {
        for (const [name, label] of [
            ['addOpening', 'add_opening'],
            ['moveOpening', 'move_opening'],
            ['resizeOpening', 'resize_opening'],
            ['setOpeningProps', 'set_opening_props'],
            ['flipOpening', 'flip_opening'],
            ['deleteOpenings', 'delete_openings'],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(true);
        }
    });

    it('moveOpening and resizeOpening merge with replace mode per opening', () => {
        const move = PLAN_COMMANDS.moveOpening;
        expect(move.mergeMode ?? 'replace').toBe('replace');
        expect(move.mergeKey?.({ openingId: 'o_a', offset: 1 })).toBe(
            'moveOpening:o_a',
        );
        const resize = PLAN_COMMANDS.resizeOpening;
        expect(resize.mergeMode ?? 'replace').toBe('replace');
        expect(resize.mergeKey?.({ openingId: 'o_a', keep: 'center' })).toBe(
            'resizeOpening:o_a',
        );
        for (const name of [
            'addOpening',
            'setOpeningProps',
            'flipOpening',
            'deleteOpenings',
        ] as const) {
            expect(PLAN_COMMANDS[name].mergeKey).toBeUndefined();
        }
    });

    it('rejects params of the wrong type', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const r = bus.execute('addOpening', {
            wallId: w,
            kind: 'gate',
            offset: 1000,
        } as never);
        expect(refused(r).code).toBe('invalid_params');
    });
});

// ---- addOpening --------------------------------------------------------------

describe('addOpening', () => {
    it('adds a door with the defaults and labels D1, then D2', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const start = bus.getDoc();
        const first = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 1000,
            }),
        );
        expect(openingOf(bus, first.result.openingId)).toEqual({
            id: first.result.openingId,
            wallId: w,
            kind: 'door',
            type: 'single_swing',
            offset: 1000,
            width: 900,
            height: 2100,
            sillHeight: 0,
            hinge: 'start',
            swing: 'left',
            label: 'D1',
        });
        expect(first.changedIds.has(first.result.openingId)).toBe(true);
        const second = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 3000,
            }),
        );
        expect(openingOf(bus, second.result.openingId).label).toBe('D2');
        expect(bus.undo()).toBe(true);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('adds a window with the window defaults and the label W1', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'window',
                offset: 2000,
            }),
        );
        expect(openingOf(bus, r.result.openingId)).toMatchObject({
            kind: 'window',
            type: 'casement',
            width: 1200,
            height: 1200,
            sillHeight: 900,
            hinge: 'start',
            swing: 'left',
            label: 'W1',
        });
    });

    it('adds a plain opening of type opening without a label', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'opening',
                offset: 2000,
            }),
        );
        expect(openingOf(bus, r.result.openingId)).toMatchObject({
            kind: 'opening',
            type: 'opening',
            width: 900,
            height: 2100,
            sillHeight: 0,
            label: null,
        });
    });

    it('takes the sizes from ctx.defaults', () => {
        const { g, w } = oneWall();
        const bus = busOfDefaults(g, {
            doorWidth: 800,
            doorHeight: 2000,
            windowWidth: 1000,
            windowHeight: 1100,
            windowSill: 950,
            openingWidth: 1500,
            openingHeight: 2200,
        });
        const door = ok(
            bus.execute('addOpening', { wallId: w, kind: 'door', offset: 800 }),
        );
        const window = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'window',
                offset: 2000,
            }),
        );
        const hole = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'opening',
                offset: 4000,
            }),
        );
        expect(openingOf(bus, door.result.openingId)).toMatchObject({
            width: 800,
            height: 2000,
        });
        expect(openingOf(bus, window.result.openingId)).toMatchObject({
            width: 1000,
            height: 1100,
            sillHeight: 950,
        });
        expect(openingOf(bus, hole.result.openingId)).toMatchObject({
            width: 1500,
            height: 2200,
        });
    });

    it('numbers labels per kind from the highest existing number and does not fill gaps', () => {
        const { g, w } = oneWall();
        g.opening(w, 800, 900, { label: 'D3' });
        g.opening(w, 4400, 900, { label: 'D1' });
        g.opening(w, 2800, 900, {
            kind: 'window',
            type: 'casement',
            label: 'W7',
        });
        const bus = busOf(g);
        const door = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 1700,
            }),
        );
        const window = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'window',
                offset: 3600,
                width: 700,
            }),
        );
        expect(openingOf(bus, door.result.openingId).label).toBe('D4');
        expect(openingOf(bus, window.result.openingId).label).toBe('W8');
    });

    it('uses the given hinge, swing, type and size, and rounds the offset and sizes', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                type: 'sliding',
                offset: 1000.4,
                width: 1000.6,
                height: 2050,
                sillHeight: 20,
                hinge: 'end',
                swing: 'right',
                label: 'Front',
            }),
        );
        expect(openingOf(bus, r.result.openingId)).toMatchObject({
            type: 'sliding',
            offset: 1000,
            width: 1001,
            height: 2050,
            sillHeight: 20,
            hinge: 'end',
            swing: 'right',
            label: 'Front',
        });
    });

    it('keeps an explicit null label on a door', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 1000,
                label: null,
            }),
        );
        expect(openingOf(bus, r.result.openingId).label).toBeNull();
    });

    it('refuses a type that does not belong to the kind', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        for (const [kind, type] of [
            ['door', 'casement'],
            ['window', 'single_swing'],
            ['opening', 'sliding'],
            ['door', 'opening'],
        ] as const) {
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addOpening', {
                        wallId: w,
                        kind,
                        type,
                        offset: 2000,
                    } as never),
                'type_mismatch',
            );
        }
    });

    it('reduces a window that reaches over the wall top to wall height minus sill', () => {
        const { g, w } = oneWall({ height: 1800 });
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'window',
                offset: 2000,
            }),
        );
        expect(openingOf(bus, r.result.openingId)).toMatchObject({
            sillHeight: 900,
            height: 900,
        });
        expectUndoRestores(bus, start);
    });

    it('reduces an explicit window height that reaches over the wall top', () => {
        const { g, w } = oneWall({ height: 2000 });
        const bus = busOf(g);
        const window = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'window',
                offset: 3000,
                height: 1500,
                sillHeight: 800,
            }),
        );
        expect(openingOf(bus, window.result.openingId).height).toBe(1200);
    });

    it('does not shorten a door or opening: the default is too_tall, an explicit height out_of_range', () => {
        const { g, w } = oneWall({ height: 2000 });
        const bus = busOf(g);
        for (const kind of ['door', 'opening'] as const) {
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addOpening', {
                        wallId: w,
                        kind,
                        offset: 1000,
                    }),
                'opening_too_tall',
            );
            // an explicit sill under the default height
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addOpening', {
                        wallId: w,
                        kind,
                        offset: 1000,
                        sillHeight: 200,
                    }),
                'opening_too_tall',
            );
            const e = refused(
                bus.execute('addOpening', {
                    wallId: w,
                    kind,
                    offset: 1000,
                    height: 2100,
                }),
            );
            expect(e.code).toBe('out_of_range');
            expect(e.params).toEqual({ field: 'height', min: 300, max: 2000 });
        }
        expect(bus.history().undo).toHaveLength(0);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 1000,
                height: 2000,
            }),
        );
        expect(openingOf(bus, r.result.openingId).height).toBe(2000);
    });

    it('keeps a window that ends exactly at the wall top, and reduces down to 300', () => {
        const exact = oneWall({ height: 2100 });
        const bus = busOf(exact.g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: exact.w,
                kind: 'window',
                offset: 2000,
            }),
        );
        expect(openingOf(bus, r.result.openingId).height).toBe(1200);

        const tight = oneWall({ height: 1200 });
        const bus2 = busOf(tight.g);
        const r2 = ok(
            bus2.execute('addOpening', {
                wallId: tight.w,
                kind: 'window',
                offset: 2000,
            }),
        );
        expect(openingOf(bus2, r2.result.openingId).height).toBe(300);
    });

    it('refuses opening_too_tall when the room above the sill is under the minimum height', () => {
        const { g, w } = oneWall({ height: 1150 });
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addOpening', {
                    wallId: w,
                    kind: 'window',
                    offset: 2000,
                }),
            'opening_too_tall',
        );
    });

    it('refuses an opening that does not fit the wall', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        for (const offset of [300, 449, 4551, 6000, -100]) {
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addOpening', {
                        wallId: w,
                        kind: 'door',
                        offset,
                        width: 900,
                    }),
                'opening_no_fit',
            );
        }
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addOpening', {
                    wallId: w,
                    kind: 'opening',
                    offset: 2500,
                    width: 6000,
                }),
            'opening_no_fit',
        );
    });

    it('accepts an opening flush against either end', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        ok(bus.execute('addOpening', { wallId: w, kind: 'door', offset: 450 }));
        ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 4550,
            }),
        );
        expect(bus.history().undo).toHaveLength(2);
    });

    it('refuses overlap but allows openings that touch', () => {
        const { g, w } = oneWall();
        g.opening(w, 2000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addOpening', {
                    wallId: w,
                    kind: 'door',
                    offset: 2500,
                }),
            'opening_overlap',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addOpening', {
                    wallId: w,
                    kind: 'window',
                    offset: 2000,
                }),
            'opening_overlap',
        );
        ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 2900,
            }),
        );
    });

    it('ignores openings on other walls when checking overlap', () => {
        const { g, w } = oneWall();
        const other = extraWall(g, 3000, 5000);
        g.opening(other, 2000, 900);
        const bus = busOf(g);
        ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 2000,
            }),
        );
    });

    it('refuses an unknown wall, out-of-range sizes and labels', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const add = (over: Record<string, unknown>) => () =>
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 2000,
                ...over,
            } as never);
        expectRefusedUntouched(bus, add({ wallId: 'w_nope' }), 'not_found');
        for (const over of [
            { width: 299 },
            { width: 6001 },
            { height: 299 },
            { sillHeight: -1 },
            { sillHeight: 3001 },
            { label: 'x'.repeat(17) },
            { label: '' },
        ]) {
            expectRefusedUntouched(bus, add(over), 'out_of_range');
        }
        const e = refused(add({ label: 'x'.repeat(17) })());
        expect(e.params).toMatchObject({ field: 'label', min: 1, max: 16 });
        const w6 = refused(add({ width: 6001 })());
        expect(w6.params).toMatchObject({
            field: 'width',
            min: 300,
            max: 6000,
        });
        ok(add({ label: 'x'.repeat(16) })());
        // length counts characters, not UTF-16 units: an emoji is one
        ok(add({ label: '\u{1F6AA}'.repeat(16), offset: 4000 })());
        expectRefusedUntouched(
            bus,
            add({ label: '\u{1F6AA}'.repeat(17), offset: 1000 }),
            'out_of_range',
        );
    });

    it('refuses when the plan already holds the most openings', () => {
        const { g, w } = oneWall();
        for (let i = 0; i < 1000; i += 1) g.opening(w, 2000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addOpening', {
                    wallId: w,
                    kind: 'door',
                    offset: 2000,
                }),
            'too_large',
        );
    });
});

// ---- moveOpening -------------------------------------------------------------

describe('moveOpening', () => {
    it('moves an opening along its wall and keeps swing and hinge', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900, { hinge: 'end', swing: 'right' });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('moveOpening', { openingId: o, offset: 3000.4 }));
        expect(openingOf(bus, o)).toMatchObject({
            wallId: w,
            offset: 3000,
            hinge: 'end',
            swing: 'right',
        });
        expectUndoRestores(bus, start);
    });

    it('moves to another wall, keeping swing and hinge, and checks bounds there', () => {
        const { g, w } = oneWall();
        const target = extraWall(g, 3000, 2000);
        const o = g.opening(w, 1000, 900, { hinge: 'end', swing: 'right' });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('moveOpening', {
                openingId: o,
                wallId: target,
                offset: 1000,
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            wallId: target,
            offset: 1000,
            hinge: 'end',
            swing: 'right',
            width: 900,
        });
        expectUndoRestores(bus, start);

        // 1800 is within the old wall (5000) but not the new one (2000)
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveOpening', {
                    openingId: o,
                    wallId: target,
                    offset: 1800,
                }),
            'opening_no_fit',
        );
    });

    it('refuses the same-wall move out of bounds', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        for (const offset of [449, 4551, -20]) {
            expectRefusedUntouched(
                bus,
                () => bus.execute('moveOpening', { openingId: o, offset }),
                'opening_no_fit',
            );
        }
        ok(bus.execute('moveOpening', { openingId: o, offset: 450 }));
    });

    it('refuses an overlap on the target wall, but not with itself', () => {
        const { g, w } = oneWall();
        const target = extraWall(g, 3000, 5000);
        const o = g.opening(w, 1000, 900);
        g.opening(target, 2000, 900);
        const sibling = g.opening(w, 3000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveOpening', {
                    openingId: o,
                    wallId: target,
                    offset: 2500,
                }),
            'opening_overlap',
        );
        expectRefusedUntouched(
            bus,
            () => bus.execute('moveOpening', { openingId: o, offset: 3500 }),
            'opening_overlap',
        );
        // a small shift of the opening over its own old span is fine
        ok(bus.execute('moveOpening', { openingId: o, offset: 1100 }));
        expect(spanOf(openingOf(bus, sibling))).toEqual([2550, 3450]);
    });

    it('refuses a move to a wall that is too low for the opening', () => {
        const { g, w } = oneWall();
        const low = extraWall(g, 3000, 5000, { height: 2000 });
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveOpening', {
                    openingId: o,
                    wallId: low,
                    offset: 2000,
                }),
            'opening_too_tall',
        );
    });

    it('refuses an unknown opening and an unknown target wall', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveOpening', { openingId: 'o_nope', offset: 1 }),
            'not_found',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('moveOpening', {
                    openingId: o,
                    wallId: 'w_nope',
                    offset: 2000,
                }),
            'not_found',
        );
    });

    it('merges a drag into one history entry and undo restores the document', () => {
        const { g, w } = oneWall();
        const target = extraWall(g, 3000, 5000);
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        for (let i = 1; i <= 50; i += 1) {
            ok(
                bus.execute(
                    'moveOpening',
                    {
                        openingId: o,
                        ...(i > 25 ? { wallId: target } : {}),
                        offset: 1000 + i * 50,
                    },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe(`moveOpening:${o}`);
        expect(openingOf(bus, o)).toMatchObject({
            wallId: target,
            offset: 3500,
        });
        expectUndoRestores(bus, start);
    });

    it('keeps the first step meta when merging', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const meta = { selectionBefore: ['o'] };
        ok(
            bus.execute(
                'moveOpening',
                { openingId: o, offset: 1500 },
                { merge: true, meta },
            ),
        );
        ok(
            bus.execute(
                'moveOpening',
                { openingId: o, offset: 2000 },
                { merge: true, meta: { other: true } },
            ),
        );
        expect(bus.history().undo[0]!.meta).toBe(meta);
    });

    it('drops the history entry of a move that changes nothing', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const before = bus.getDoc();
        ok(bus.execute('moveOpening', { openingId: o, offset: 1000 }));
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo).toHaveLength(0);
    });

    it('a drag that returns to the start leaves no entry', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute(
                'moveOpening',
                { openingId: o, offset: 2000 },
                { merge: true },
            ),
        );
        ok(
            bus.execute(
                'moveOpening',
                { openingId: o, offset: 1000 },
                { merge: true },
            ),
        );
        expect(bus.getDoc()).toEqual(start);
        expect(bus.history().undo).toHaveLength(0);
    });
});

// ---- resizeOpening -----------------------------------------------------------

describe('resizeOpening', () => {
    it('keep start holds u0: offset becomes u0 + width / 2', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1200,
                keep: 'start',
            }),
        );
        expect(spanOf(openingOf(bus, o))).toEqual([1550, 2750]);
        expect(openingOf(bus, o).offset).toBe(2150);
        expectUndoRestores(bus, start);
    });

    it('keep end holds u1', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1200,
                keep: 'end',
            }),
        );
        expect(spanOf(openingOf(bus, o))).toEqual([1250, 2450]);
        expect(openingOf(bus, o).offset).toBe(1850);
        expectUndoRestores(bus, start);
    });

    it('keep center holds the offset', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1200,
                keep: 'center',
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({ offset: 2000, width: 1200 });
        expectUndoRestores(bus, start);
    });

    it('rounds the offset to whole millimetres when the width change is odd', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 901,
                keep: 'start',
            }),
        );
        expect(Number.isInteger(openingOf(bus, o).offset)).toBe(true);
        expect(openingOf(bus, o).width).toBe(901);
    });

    it('changes height and sill without moving the opening', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const bus = busOf(g);
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                height: 1000,
                sillHeight: 1000,
                keep: 'center',
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            offset: 2000,
            width: 900,
            height: 1000,
            sillHeight: 1000,
        });
    });

    it('refuses a resize that no longer fits or that overlaps a neighbour', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        g.opening(w, 2500, 900);
        const bus = busOf(g);
        // keep centre: 1000 +- 600 reaches below 0
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('resizeOpening', {
                    openingId: o,
                    width: 2400,
                    keep: 'center',
                }),
            'opening_no_fit',
        );
        // keep start: 550 .. 2300 hits the neighbour at 2050
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('resizeOpening', {
                    openingId: o,
                    width: 1750,
                    keep: 'start',
                }),
            'opening_overlap',
        );
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1500,
                keep: 'start',
            }),
        );
    });

    it('refuses a height or sill that reaches over the wall top', () => {
        const { g, w } = oneWall({ height: 2400 });
        const o = g.opening(w, 2000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('resizeOpening', {
                    openingId: o,
                    height: 1501,
                    keep: 'center',
                }),
            'out_of_range',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('resizeOpening', {
                    openingId: o,
                    sillHeight: 1300,
                    keep: 'center',
                }),
            'opening_too_tall',
        );
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                height: 1500,
                keep: 'center',
            }),
        );
    });

    it('refuses out-of-range sizes and an unknown opening', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        for (const over of [
            { width: 299 },
            { width: 6001 },
            { height: 299 },
            { sillHeight: -5 },
            { sillHeight: 3001 },
        ]) {
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('resizeOpening', {
                        openingId: o,
                        keep: 'center',
                        ...over,
                    }),
                'out_of_range',
            );
        }
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('resizeOpening', {
                    openingId: 'o_nope',
                    width: 1000,
                    keep: 'center',
                }),
            'not_found',
        );
    });

    it('merges a resize drag into one history entry and undo restores the document', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        for (let i = 1; i <= 30; i += 1) {
            ok(
                bus.execute(
                    'resizeOpening',
                    { openingId: o, width: 900 + i * 10, keep: 'start' },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe(`resizeOpening:${o}`);
        expect(spanOf(openingOf(bus, o))).toEqual([1550, 2750]);
        expectUndoRestores(bus, start);
    });

    it('drops the entry of a resize that changes nothing', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 900,
                keep: 'start',
            }),
        );
        expect(bus.history().undo).toHaveLength(0);
    });
});

// ---- setOpeningProps ---------------------------------------------------------

describe('setOpeningProps', () => {
    it('changing the kind to window applies the window type, height and sill', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900, { label: 'D1' });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: { kind: 'window' },
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
            width: 900,
            offset: 2000,
            label: 'D1',
        });
        expectUndoRestores(bus, start);
    });

    it('given props win over the kind defaults', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 2000, 900);
        const bus = busOf(g);
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: {
                    kind: 'window',
                    type: 'fixed',
                    height: 800,
                    sillHeight: 1000,
                },
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            kind: 'window',
            type: 'fixed',
            height: 800,
            sillHeight: 1000,
        });
    });

    it('changing the kind to door or opening applies those defaults', () => {
        const { g, w } = oneWall();
        const win = g.opening(w, 1000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const hole = g.opening(w, 3000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const bus = busOf(g);
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [win],
                props: { kind: 'door' },
            }),
        );
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [hole],
                props: { kind: 'opening' },
            }),
        );
        expect(openingOf(bus, win)).toMatchObject({
            kind: 'door',
            type: 'single_swing',
            height: 2100,
            sillHeight: 0,
        });
        expect(openingOf(bus, hole)).toMatchObject({
            kind: 'opening',
            type: 'opening',
            height: 2100,
            sillHeight: 0,
        });
    });

    it('a kind default that reaches over a low wall is reduced like addOpening', () => {
        const { g, w } = oneWall({ height: 1800 });
        const o = g.opening(w, 2000, 900, { height: 1700 });
        const bus = busOf(g);
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: { kind: 'window' },
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            sillHeight: 900,
            height: 900,
        });
    });

    it('a kind change to door or opening that does not fit under the wall is opening_too_tall', () => {
        const { g, w } = oneWall({ height: 2000 });
        const win = g.opening(w, 1000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const bus = busOf(g);
        for (const kind of ['door', 'opening'] as const) {
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('setOpeningProps', {
                        openingIds: [win],
                        props: { kind },
                    }),
                'opening_too_tall',
            );
        }
        // a height that fits is accepted
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [win],
                props: { kind: 'door', height: 2000 },
            }),
        );
        expect(openingOf(bus, win)).toMatchObject({
            kind: 'door',
            sillHeight: 0,
            height: 2000,
        });
    });

    it('a kind change that leaves under 300 mm above the sill is opening_too_tall', () => {
        const { g, w } = oneWall({ height: 1100 });
        const door = g.opening(w, 1000, 900, { height: 1000 });
        const bus = busOf(g);
        // window sill 900 on a 1100 wall: 200 mm left
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [door],
                    props: { kind: 'window' },
                }),
            'opening_too_tall',
        );
    });

    it('sets type, hinge, swing, label and height on several openings at once', () => {
        const { g, w } = oneWall();
        const a = g.opening(w, 1000, 900);
        const b = g.opening(w, 3000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [b, a, a],
                props: {
                    type: 'double_swing',
                    hinge: 'end',
                    swing: 'right',
                    label: 'Main',
                    height: 2000,
                },
            }),
        );
        for (const id of [a, b]) {
            expect(openingOf(bus, id)).toMatchObject({
                type: 'double_swing',
                hinge: 'end',
                swing: 'right',
                label: 'Main',
                height: 2000,
            });
        }
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('clears a label with null', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900, { label: 'D1' });
        const bus = busOf(g);
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: { label: null },
            }),
        );
        expect(openingOf(bus, o).label).toBeNull();
    });

    it('refuses a type that does not belong to the resulting kind', () => {
        const { g, w } = oneWall();
        const door = g.opening(w, 1000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [door],
                    props: { type: 'casement' },
                }),
            'type_mismatch',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [door],
                    props: { kind: 'window', type: 'sliding' },
                }),
            'type_mismatch',
        );
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [door],
                props: { kind: 'window', type: 'bay' },
            }),
        );
    });

    it('refuses one bad opening of a selection and changes none', () => {
        const { g, w } = oneWall();
        const door = g.opening(w, 1000, 900);
        const win = g.opening(w, 3000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [door, win],
                    props: { type: 'sliding' },
                }),
            'type_mismatch',
        );
    });

    it('refuses a height or sill over the wall top and out-of-range values', () => {
        const { g, w } = oneWall({ height: 2400 });
        const o = g.opening(w, 2000, 900, {
            kind: 'window',
            type: 'casement',
            height: 1200,
            sillHeight: 900,
        });
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [o],
                    props: { height: 1600 },
                }),
            'out_of_range',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [o],
                    props: { sillHeight: 1400 },
                }),
            'opening_too_tall',
        );
        for (const props of [
            { height: 299 },
            { sillHeight: 3001 },
            { sillHeight: -1 },
            { label: 'x'.repeat(17) },
            { label: '' },
        ]) {
            const e = refused(
                bus.execute('setOpeningProps', { openingIds: [o], props }),
            );
            expect(e.code).toBe('out_of_range');
        }
        const e = refused(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: { label: 'x'.repeat(17) },
            }),
        );
        expect(e.params).toMatchObject({
            field: 'props.label',
            min: 1,
            max: 16,
        });
    });

    it('refuses an unknown opening and an empty selection', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [o, 'o_nope'],
                    props: { swing: 'right' },
                }),
            'not_found',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setOpeningProps', {
                    openingIds: [],
                    props: { swing: 'right' },
                }),
            'invalid_params',
        );
    });

    it('drops the entry when nothing changes', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: { swing: 'left', kind: 'door', type: 'single_swing' },
            }),
        );
        expect(bus.history().undo).toHaveLength(0);
    });
});

// ---- flipOpening -------------------------------------------------------------

describe('flipOpening', () => {
    it('flips the swing', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('flipOpening', { openingIds: [o], what: 'swing' }));
        expect(openingOf(bus, o)).toMatchObject({
            swing: 'right',
            hinge: 'start',
        });
        expectUndoRestores(bus, start);
    });

    it('flips the hinge', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('flipOpening', { openingIds: [o], what: 'hinge' }));
        expect(openingOf(bus, o)).toMatchObject({
            swing: 'left',
            hinge: 'end',
        });
        expectUndoRestores(bus, start);
    });

    it('flips both, and flipping twice is the identity', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('flipOpening', { openingIds: [o], what: 'both' }));
        expect(openingOf(bus, o)).toMatchObject({
            swing: 'right',
            hinge: 'end',
        });
        ok(bus.execute('flipOpening', { openingIds: [o], what: 'both' }));
        expect(bus.getDoc()).toEqual(start);
        expect(bus.undo()).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('flips each opening of a selection from its own state', () => {
        const { g, w } = oneWall();
        const a = g.opening(w, 1000, 900, { swing: 'left' });
        const b = g.opening(w, 3000, 900, { swing: 'right' });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('flipOpening', {
                openingIds: [a, b, a],
                what: 'swing',
            }),
        );
        expect(openingOf(bus, a).swing).toBe('right');
        expect(openingOf(bus, b).swing).toBe('left');
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown opening and a bad flip', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('flipOpening', {
                    openingIds: [o, 'o_nope'],
                    what: 'both',
                }),
            'not_found',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('flipOpening', {
                    openingIds: [o],
                    what: 'upside' as never,
                }),
            'invalid_params',
        );
    });
});

// ---- deleteOpenings ----------------------------------------------------------

describe('deleteOpenings', () => {
    it('deletes openings, reports their ids, and undo restores the document', () => {
        const { g, w } = oneWall();
        const a = g.opening(w, 1000, 900);
        const b = g.opening(w, 3000, 900);
        const keep = g.opening(w, 4400, 600);
        const bus = busOf(g);
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteOpenings', { openingIds: [b, a, a] }));
        expect(Object.keys(bus.getDoc().openings)).toEqual([keep]);
        expect(r.deletedIds).toEqual([a, b].sort());
        expect(r.changedIds.has(a)).toBe(true);
        expect(bus.getDoc().walls[w]).toBe(start.walls[w]);
        expect(bus.history().undo).toHaveLength(1);
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown opening and an empty list', () => {
        const { g, w } = oneWall();
        const o = g.opening(w, 1000, 900);
        const bus = busOf(g);
        expectRefusedUntouched(
            bus,
            () => bus.execute('deleteOpenings', { openingIds: [o, 'o_nope'] }),
            'not_found',
        );
        expectRefusedUntouched(
            bus,
            () => bus.execute('deleteOpenings', { openingIds: [] }),
            'invalid_params',
        );
    });
});

// ---- documents that already have errors ------------------------------------

describe('with an opening that is already too tall', () => {
    it('can still be moved along its wall, flipped and deleted', () => {
        const { g, w } = oneWall({ height: 2000 });
        const o = g.opening(w, 1000, 900, { height: 2100 });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('moveOpening', { openingId: o, offset: 2000 }));
        ok(bus.execute('flipOpening', { openingIds: [o], what: 'both' }));
        ok(
            bus.execute('setOpeningProps', {
                openingIds: [o],
                props: { label: 'D9' },
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({ offset: 2000, label: 'D9' });
        ok(bus.execute('deleteOpenings', { openingIds: [o] }));
        for (let i = 0; i < 4; i += 1) expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('can still be resized in width, with or without moving its edge', () => {
        const { g, w } = oneWall({ height: 2000 });
        const o = g.opening(w, 2000, 900, { height: 2100 });
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1000,
                keep: 'center',
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            offset: 2000,
            width: 1000,
            height: 2100,
        });
        ok(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1200,
                keep: 'start',
            }),
        );
        expect(openingOf(bus, o)).toMatchObject({
            offset: 2100,
            width: 1200,
            height: 2100,
        });
        // changing the sill or the height re-judges it
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('resizeOpening', {
                    openingId: o,
                    sillHeight: 100,
                    keep: 'center',
                }),
            'opening_too_tall',
        );
        for (let i = 0; i < 2; i += 1) expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });
});

describe('with an opening whose wall is missing', () => {
    it('refuses a resize as not_found', () => {
        const { g } = oneWall();
        const o = g.opening('w_0000000999', 1000, 900);
        const bus = busOf(g);
        const e = refused(
            bus.execute('resizeOpening', {
                openingId: o,
                width: 1000,
                keep: 'center',
            }),
        );
        expect(e.code).toBe('not_found');
        expect(e.params).toEqual({ id: 'w_0000000999' });
    });
});

// ---- with the wall commands --------------------------------------------------

describe('with the wall commands', () => {
    it('an added opening is removed with its wall and comes back on undo', () => {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 2000,
            }),
        );
        const withDoor = bus.getDoc();
        ok(bus.execute('deleteWalls', { wallIds: [w] }));
        expect(bus.getDoc().openings[r.result.openingId]).toBeUndefined();
        expectUndoRestores(bus, withDoor);
    });

    it('a moved wall end keeps the distance of an added opening to the fixed end', () => {
        const { g, a, b, w } = oneWall();
        const bus = busOf(g);
        const r = ok(
            bus.execute('addOpening', {
                wallId: w,
                kind: 'door',
                offset: 4000,
            }),
        );
        ok(
            bus.execute('moveNode', {
                nodeId: a,
                to: { x: 1000, y: 0 },
                finalize: true,
            }),
        );
        expect(openingOf(bus, r.result.openingId).offset).toBe(3000);
        expect(bus.getDoc().nodes[b]!.x).toBe(5000);
    });
});

// ---- fixtures needing custom defaults ----------------------------------------

/** A bus over the graph's document whose default sizes are `sizes` over the usual ones. */
function busOfDefaults(g: Graph, sizes: Partial<PlanDefaults>): Bus {
    return createPlanBus({
        initial: g.doc,
        footprints: () => FOOTPRINT,
        newId: g.ids,
        defaults: {
            wallHeight: 2700,
            interiorThickness: 115,
            exteriorThickness: 230,
            doorWidth: 900,
            doorHeight: 2100,
            windowWidth: 1200,
            windowHeight: 1200,
            windowSill: 900,
            openingWidth: 900,
            openingHeight: 2100,
            ...sizes,
        },
    });
}
