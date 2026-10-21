import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../../../commands/types';
import type { PlanDocument, TextLabel } from '../../schema';
import { busOf, ok, oneWall, refused } from '../../testing/graph';
import { PLAN_COMMANDS } from '../registry';

// ---- fixtures ----------------------------------------------------------------

type Bus = ReturnType<typeof busOf>;

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
    const error = refused(run());
    expect(error.code).toBe(code);
    expect(bus.getDoc()).toBe(before);
    expect(bus.history().undo.length).toBe(entries);
    return error;
}

const dimOf = (bus: Bus, id: string) =>
    bus.getDoc().annotations.dimensions[id]!;
const labelOf = (bus: Bus, id: string): TextLabel =>
    bus.getDoc().annotations.labels[id]!;

const FREE = { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, offset: 400 };

/** `oneWall` (0,0)-(5000,0), 230 thick: faces at y = -115 (left) and y = 115 (right). */
function wallBus() {
    const { g, w } = oneWall();
    return { g, w, bus: busOf(g) };
}

// ---- registry ----------------------------------------------------------------

describe('registry', () => {
    it('registers the six annotation commands; only dimension add and set run the geometry pass', () => {
        for (const [name, label, geometry] of [
            ['addDimension', 'add_dimension', true],
            ['setDimension', 'set_dimension', true],
            ['deleteDimensions', 'delete_dimensions', false],
            ['addLabel', 'add_label', false],
            ['setLabel', 'set_label', false],
            ['deleteLabels', 'delete_labels', false],
        ] as const) {
            const def = PLAN_COMMANDS[name];
            expect(def.type).toBe(name);
            expect(def.labelKey).toBe(`engine.plan.command.label.${label}`);
            expect(def.paramsSchema).toBeDefined();
            expect(def.touchesGeometry).toBe(geometry);
        }
    });

    it('setDimension and setLabel merge with replace mode per entity', () => {
        const dim = PLAN_COMMANDS.setDimension;
        expect(dim.mergeMode ?? 'replace').toBe('replace');
        expect(dim.mergeKey?.({ dimensionId: 'd_a' })).toBe('dim:d_a');
        const label = PLAN_COMMANDS.setLabel;
        expect(label.mergeMode ?? 'replace').toBe('replace');
        expect(label.mergeKey?.({ labelId: 't_a', props: {} })).toBe(
            'label:t_a',
        );
        for (const name of [
            'addDimension',
            'deleteDimensions',
            'addLabel',
            'deleteLabels',
        ] as const) {
            expect(PLAN_COMMANDS[name].mergeKey).toBeUndefined();
        }
    });
});

// ---- addDimension ------------------------------------------------------------

describe('addDimension', () => {
    it('adds a free dimension with rounded points', () => {
        const { bus } = wallBus();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addDimension', {
                a: { x: 0.4, y: 0 },
                b: { x: 3000, y: 10.6 },
                offset: -400.5,
                attachedTo: null,
            }),
        );
        expect(r.result.dimensionId).toMatch(/^d_/);
        expect(dimOf(bus, r.result.dimensionId)).toEqual({
            id: r.result.dimensionId,
            a: { x: 0, y: 0 },
            b: { x: 3000, y: 11 },
            offset: -401,
            attachedTo: null,
        });
        expect(r.changedIds.has(r.result.dimensionId)).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('takes the points of an attached dimension from the wall face after the command', () => {
        const { w, bus } = wallBus();
        const start = bus.getDoc();
        const attach = (face: 'left' | 'right' | 'center') =>
            ok(
                bus.execute('addDimension', {
                    // deliberately not the face: post-processing overwrites them
                    a: { x: 100, y: 100 },
                    b: { x: 900, y: 900 },
                    offset: 300,
                    attachedTo: { kind: 'wall', wallId: w, face },
                }),
            ).result.dimensionId;
        const left = attach('left');
        const right = attach('right');
        const center = attach('center');
        expect(dimOf(bus, left)).toMatchObject({
            a: { x: 0, y: -115 },
            b: { x: 5000, y: -115 },
            attachedTo: { kind: 'wall', wallId: w, face: 'left' },
        });
        expect(dimOf(bus, right)).toMatchObject({
            a: { x: 0, y: 115 },
            b: { x: 5000, y: 115 },
        });
        expect(dimOf(bus, center)).toMatchObject({
            a: { x: 0, y: 0 },
            b: { x: 5000, y: 0 },
        });
        for (let i = 0; i < 3; i += 1) expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('keeps an attached dimension on the face when the wall thickness changes later', () => {
        const { w, bus } = wallBus();
        const { result } = ok(
            bus.execute('addDimension', {
                ...FREE,
                attachedTo: { kind: 'wall', wallId: w, face: 'right' },
            }),
        );
        ok(
            bus.execute('setWallProps', {
                wallIds: [w],
                props: { thickness: 400 },
            }),
        );
        expect(dimOf(bus, result.dimensionId).a).toEqual({ x: 0, y: 200 });
    });

    it('follows its wall when moveWall moves it, whichever way the dimension was made', () => {
        const { w, bus } = wallBus();
        const { result } = ok(
            bus.execute('addDimension', {
                ...FREE,
                attachedTo: { kind: 'wall', wallId: w, face: 'right' },
            }),
        );
        const start = bus.getDoc();
        ok(
            bus.execute('moveWall', {
                wallId: w,
                distance: 300,
                finalize: true,
            }),
        );
        // the wall normal is (0, -1): the wall is now at y = -300, its right face at y = -185
        expect(dimOf(bus, result.dimensionId)).toMatchObject({
            a: { x: 0, y: -185 },
            b: { x: 5000, y: -185 },
            offset: 400,
        });
        expectUndoRestores(bus, start);
    });

    it('refuses a dimension shorter than 10 mm: 9 is dimension_too_short, 10 passes', () => {
        const { bus } = wallBus();
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addDimension', {
                    a: { x: 0, y: 0 },
                    b: { x: 9, y: 0 },
                    offset: 0,
                    attachedTo: null,
                }),
            'dimension_too_short',
        );
        expect(error.messageKey).toBe(
            'engine.plan.command.dimension_too_short',
        );
        expect(error.params).toEqual({ length: 9, min: 10 });
        // the length is judged after rounding: 9.4 apart rounds to 9
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addDimension', {
                    a: { x: 0, y: 0 },
                    b: { x: 9.4, y: 0 },
                    offset: 0,
                    attachedTo: null,
                }),
            'dimension_too_short',
        );
        ok(
            bus.execute('addDimension', {
                a: { x: 0, y: 0 },
                b: { x: 6, y: 8 },
                offset: 0,
                attachedTo: null,
            }),
        );
    });

    it('refuses an offset beyond 50 000 mm as out_of_range', () => {
        const { bus } = wallBus();
        for (const offset of [50_001, -50_001]) {
            const error = expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addDimension', {
                        ...FREE,
                        offset,
                        attachedTo: null,
                    }),
                'out_of_range',
            );
            expect(error.params).toEqual({
                field: 'offset',
                min: -50_000,
                max: 50_000,
            });
        }
        ok(
            bus.execute('addDimension', {
                ...FREE,
                offset: -50_000,
                attachedTo: null,
            }),
        );
    });

    it('refuses points out of the coordinate range and a missing wall', () => {
        const { bus } = wallBus();
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addDimension', {
                        ...FREE,
                        b: { x: 0, y: 1_000_001 },
                        attachedTo: null,
                    }),
                'out_of_range',
            ).params,
        ).toMatchObject({ field: 'b.y' });
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addDimension', {
                        ...FREE,
                        attachedTo: {
                            kind: 'wall',
                            wallId: 'w_no',
                            face: 'left',
                        },
                    }),
                'not_found',
            ).params,
        ).toEqual({ id: 'w_no' });
    });

    it('requires the attachment in the params', () => {
        const { bus } = wallBus();
        expect(refused(bus.execute('addDimension', FREE as never)).code).toBe(
            'invalid_params',
        );
    });
});

// ---- setDimension ------------------------------------------------------------

describe('setDimension', () => {
    function dimBus(attached = false) {
        const { g, w } = oneWall();
        const bus = busOf(g);
        const { result } = ok(
            bus.execute('addDimension', {
                ...FREE,
                attachedTo: attached
                    ? { kind: 'wall', wallId: w, face: 'left' }
                    : null,
            }),
        );
        return { w, bus, id: result.dimensionId };
    }

    it('changes the points and the offset', () => {
        const { bus, id } = dimBus();
        const start = bus.getDoc();
        ok(
            bus.execute('setDimension', {
                dimensionId: id,
                a: { x: 100.4, y: 50 },
                b: { x: 2000, y: 50 },
                offset: -250,
            }),
        );
        expect(dimOf(bus, id)).toEqual({
            id,
            a: { x: 100, y: 50 },
            b: { x: 2000, y: 50 },
            offset: -250,
            attachedTo: null,
        });
        expectUndoRestores(bus, start);
    });

    it('recomputes the points of an attached dimension when the face changes', () => {
        const { w, bus, id } = dimBus(true);
        expect(dimOf(bus, id).a).toEqual({ x: 0, y: -115 });
        const start = bus.getDoc();
        ok(
            bus.execute('setDimension', {
                dimensionId: id,
                attachedTo: { kind: 'wall', wallId: w, face: 'right' },
            }),
        );
        expect(dimOf(bus, id)).toMatchObject({
            a: { x: 0, y: 115 },
            b: { x: 5000, y: 115 },
            attachedTo: { kind: 'wall', wallId: w, face: 'right' },
        });
        expectUndoRestores(bus, start);
    });

    it('overwrites points given for an attached dimension with the wall face', () => {
        const { bus, id } = dimBus(true);
        ok(
            bus.execute('setDimension', {
                dimensionId: id,
                a: { x: 7, y: 7 },
                b: { x: 700, y: 700 },
            }),
        );
        expect(dimOf(bus, id)).toMatchObject({
            a: { x: 0, y: -115 },
            b: { x: 5000, y: -115 },
        });
    });

    it('detaches with null and keeps the points', () => {
        const { bus, id } = dimBus(true);
        ok(bus.execute('setDimension', { dimensionId: id, attachedTo: null }));
        expect(dimOf(bus, id)).toMatchObject({
            a: { x: 0, y: -115 },
            b: { x: 5000, y: -115 },
            attachedTo: null,
        });
    });

    it('leaves the attachment alone when attachedTo is not given', () => {
        const { w, bus, id } = dimBus(true);
        ok(bus.execute('setDimension', { dimensionId: id, offset: 900 }));
        expect(dimOf(bus, id)).toMatchObject({
            offset: 900,
            attachedTo: { kind: 'wall', wallId: w, face: 'left' },
        });
    });

    it('drops the entry of a call that changes nothing', () => {
        const { w, bus, id } = dimBus(true);
        const before = bus.getDoc();
        ok(
            bus.execute('setDimension', {
                dimensionId: id,
                a: { x: 0, y: -115 },
                offset: 400,
                attachedTo: { kind: 'wall', wallId: w, face: 'left' },
            }),
        );
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo.length).toBe(1);
    });

    it('judges the length only when a point is given', () => {
        const { bus, id } = dimBus();
        const error = expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setDimension', {
                    dimensionId: id,
                    b: { x: 5, y: 0 },
                }),
            'dimension_too_short',
        );
        expect(error.params).toEqual({ length: 5, min: 10 });
        ok(bus.execute('setDimension', { dimensionId: id, offset: 1 }));
    });

    it('still moves or detaches an old dimension whose points are shorter than 10 mm', () => {
        const { g, w } = oneWall();
        const attached = g.dimension(w, 'left'); // points (0,0)-(1,1), 1.4 mm apart
        const free = g.ids('d');
        g.doc.annotations.dimensions[free] = {
            id: free,
            a: { x: 0, y: 0 },
            b: { x: 4, y: 0 },
            offset: 100,
            attachedTo: null,
        };
        const bus = busOf(g);
        const start = bus.getDoc();
        ok(bus.execute('setDimension', { dimensionId: free, offset: 700 }));
        expect(dimOf(bus, free)).toMatchObject({
            offset: 700,
            b: { x: 4, y: 0 },
        });
        ok(bus.execute('setDimension', { dimensionId: attached, offset: 800 }));
        expect(dimOf(bus, attached)).toMatchObject({
            offset: 800,
            a: { x: 0, y: -115 },
        });
        ok(
            bus.execute('setDimension', {
                dimensionId: attached,
                attachedTo: null,
            }),
        );
        expect(dimOf(bus, attached).attachedTo).toBeNull();
        for (let i = 0; i < 3; i += 1) expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('refuses an unknown dimension, a missing wall and an offset out of range', () => {
        const { bus, id } = dimBus();
        expectRefusedUntouched(
            bus,
            () => bus.execute('setDimension', { dimensionId: 'd_no' }),
            'not_found',
        );
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('setDimension', {
                        dimensionId: id,
                        attachedTo: {
                            kind: 'wall',
                            wallId: 'w_no',
                            face: 'left',
                        },
                    }),
                'not_found',
            ).params,
        ).toEqual({ id: 'w_no' });
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setDimension', {
                    dimensionId: id,
                    offset: 60_000,
                }),
            'out_of_range',
        );
    });

    it('merges a drag of the offset into one entry that undoes to the start', () => {
        const { bus, id } = dimBus(true);
        const start = bus.getDoc();
        for (const offset of [100, 200, 300, 450]) {
            ok(
                bus.execute(
                    'setDimension',
                    { dimensionId: id, offset },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(2);
        expect(dimOf(bus, id).offset).toBe(450);
        expectUndoRestores(bus, start);
    });
});

// ---- deleteDimensions --------------------------------------------------------

describe('deleteDimensions', () => {
    it('deletes the dimensions and reports their ids', () => {
        const { bus } = wallBus();
        const ids = [1, 2].map(
            (i) =>
                ok(
                    bus.execute('addDimension', {
                        ...FREE,
                        offset: i * 100,
                        attachedTo: null,
                    }),
                ).result.dimensionId,
        );
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteDimensions', { dimensionIds: ids }));
        expect(r.deletedIds).toEqual([...ids].sort());
        expect(bus.getDoc().annotations.dimensions).toEqual({});
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown id and an empty selection', () => {
        const { bus } = wallBus();
        expectRefusedUntouched(
            bus,
            () => bus.execute('deleteDimensions', { dimensionIds: ['d_no'] }),
            'not_found',
        );
        expect(
            refused(bus.execute('deleteDimensions', { dimensionIds: [] })).code,
        ).toBe('invalid_params');
    });
});

// ---- addLabel ----------------------------------------------------------------

describe('addLabel', () => {
    it('stores the trimmed text with the default font size and rotation', () => {
        const { bus } = wallBus();
        const start = bus.getDoc();
        const r = ok(
            bus.execute('addLabel', {
                position: { x: 100.4, y: -200 },
                text: '  hi  ',
            }),
        );
        expect(r.result.labelId).toMatch(/^t_/);
        expect(labelOf(bus, r.result.labelId)).toEqual({
            id: r.result.labelId,
            position: { x: 100, y: -200 },
            text: 'hi',
            fontSize: 250,
            rotation: 0,
        });
        expect(r.changedIds.has(r.result.labelId)).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('takes the font size and normalises the rotation', () => {
        const { bus } = wallBus();
        const r = ok(
            bus.execute('addLabel', {
                position: { x: 0, y: 0 },
                text: 'x',
                fontSize: 399.6,
                rotation: -90,
            }),
        );
        expect(labelOf(bus, r.result.labelId)).toMatchObject({
            fontSize: 400,
            rotation: 270,
        });
    });

    it('refuses an empty or blank text with text_length', () => {
        const { bus } = wallBus();
        for (const text of ['', '   ', '\n\t']) {
            const error = expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addLabel', { position: { x: 0, y: 0 }, text }),
                'text_length',
            );
            expect(error.messageKey).toBe('engine.plan.command.text_length');
            expect(error.params).toEqual({ length: 0, min: 1, max: 200 });
        }
    });

    it('counts the text in code points after trimming: 200 pass, 201 are text_length', () => {
        const { bus } = wallBus();
        const emoji200 = '\u{1F6CB}'.repeat(200);
        const r = ok(
            bus.execute('addLabel', {
                position: { x: 0, y: 0 },
                text: ` ${emoji200} `,
            }),
        );
        expect(labelOf(bus, r.result.labelId).text).toBe(emoji200);
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('addLabel', {
                        position: { x: 0, y: 0 },
                        text: `${emoji200}x`,
                    }),
                'text_length',
            ).params,
        ).toEqual({ length: 201, min: 1, max: 200 });
    });

    it('checks the font size and the position ranges', () => {
        const { bus } = wallBus();
        for (const fontSize of [49, 5001]) {
            expect(
                expectRefusedUntouched(
                    bus,
                    () =>
                        bus.execute('addLabel', {
                            position: { x: 0, y: 0 },
                            text: 'x',
                            fontSize,
                        }),
                    'out_of_range',
                ).params,
            ).toEqual({ field: 'fontSize', min: 50, max: 5000 });
        }
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('addLabel', {
                    position: { x: 2_000_000, y: 0 },
                    text: 'x',
                }),
            'out_of_range',
        );
        for (const fontSize of [50, 5000]) {
            ok(
                bus.execute('addLabel', {
                    position: { x: 0, y: 0 },
                    text: 'x',
                    fontSize,
                }),
            );
        }
    });
});

// ---- setLabel ----------------------------------------------------------------

describe('setLabel', () => {
    function labelBus() {
        const { bus } = wallBus();
        const { result } = ok(
            bus.execute('addLabel', {
                position: { x: 10, y: 20 },
                text: 'Kitchen',
            }),
        );
        return { bus, id: result.labelId };
    }

    it('changes the given props only, trimming the text', () => {
        const { bus, id } = labelBus();
        const start = bus.getDoc();
        ok(
            bus.execute('setLabel', {
                labelId: id,
                props: {
                    position: { x: 300.6, y: 400 },
                    text: '  Dining  ',
                    fontSize: 300,
                    rotation: 450,
                },
            }),
        );
        expect(labelOf(bus, id)).toEqual({
            id,
            position: { x: 301, y: 400 },
            text: 'Dining',
            fontSize: 300,
            rotation: 90,
        });
        ok(bus.execute('setLabel', { labelId: id, props: { fontSize: 500 } }));
        expect(labelOf(bus, id)).toMatchObject({
            text: 'Dining',
            fontSize: 500,
        });
        expect(bus.undo()).toBe(true);
        expectUndoRestores(bus, start);
    });

    it('drops the entry of a call that changes nothing', () => {
        const { bus, id } = labelBus();
        const before = bus.getDoc();
        const entries = bus.history().undo.length;
        ok(
            bus.execute('setLabel', {
                labelId: id,
                props: { position: { x: 10, y: 20 }, text: ' Kitchen ' },
            }),
        );
        expect(bus.getDoc()).toBe(before);
        expect(bus.history().undo.length).toBe(entries);
    });

    it('refuses an unknown label, an empty text and a font size out of range', () => {
        const { bus, id } = labelBus();
        expectRefusedUntouched(
            bus,
            () => bus.execute('setLabel', { labelId: 't_no', props: {} }),
            'not_found',
        );
        expectRefusedUntouched(
            bus,
            () =>
                bus.execute('setLabel', { labelId: id, props: { text: ' ' } }),
            'text_length',
        );
        expect(
            expectRefusedUntouched(
                bus,
                () =>
                    bus.execute('setLabel', {
                        labelId: id,
                        props: { fontSize: 10 },
                    }),
                'out_of_range',
            ).params,
        ).toEqual({ field: 'props.fontSize', min: 50, max: 5000 });
    });

    it('merges a drag into one entry that undoes to the start', () => {
        const { bus, id } = labelBus();
        const start = bus.getDoc();
        const entries = bus.history().undo.length;
        for (const x of [100, 200, 300]) {
            ok(
                bus.execute(
                    'setLabel',
                    { labelId: id, props: { position: { x, y: x } } },
                    { merge: true },
                ),
            );
        }
        expect(bus.history().undo.length).toBe(entries + 1);
        expect(labelOf(bus, id).position).toEqual({ x: 300, y: 300 });
        expectUndoRestores(bus, start);
    });
});

// ---- deleteLabels ------------------------------------------------------------

describe('deleteLabels', () => {
    it('deletes the labels and reports their ids', () => {
        const { bus } = wallBus();
        const ids = ['a', 'b'].map(
            (text) =>
                ok(bus.execute('addLabel', { position: { x: 0, y: 0 }, text }))
                    .result.labelId,
        );
        const start = bus.getDoc();
        const r = ok(bus.execute('deleteLabels', { labelIds: ids }));
        expect(r.deletedIds).toEqual([...ids].sort());
        expect(bus.getDoc().annotations.labels).toEqual({});
        expectUndoRestores(bus, start);
    });

    it('refuses an unknown id and an empty selection', () => {
        const { bus } = wallBus();
        expectRefusedUntouched(
            bus,
            () => bus.execute('deleteLabels', { labelIds: ['t_no'] }),
            'not_found',
        );
        expect(
            refused(bus.execute('deleteLabels', { labelIds: [] })).code,
        ).toBe('invalid_params');
    });
});
