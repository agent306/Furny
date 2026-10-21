import { apply, create } from 'mutative';
import { describe, expect, it } from 'vitest';
import {
    dist,
    rotationFromFront,
    sub,
    dot,
    scale,
} from '../../../geometry/vec2';
import { createPlanDeriver, derivePlanGeometry } from '../../derive';
import type { FootprintProvider } from '../../footprint';
import { planErrorKeys, validatePlan } from '../../validate';
import type {
    DimensionAnnotation,
    FurniturePlacement,
    PlanDocument,
    Wall,
} from '../../schema';
import { makeDirtyPlan, makeRectPlan } from '../../testing/fixtures';
import { metaFactory, strip } from '../../testing/strip';
import { roundMm } from '../../../geometry/tolerance';
import { CommandAbort } from '../../../commands/types';
import { definePlanCommand } from '../define';
import { planPathToEntityId } from '../paths';
import {
    PLAN_COMMAND_ERROR_CODES,
    defaultPlanDefaults,
    executePlanCommand,
    planPipeline,
    type PlanCommandContext,
} from '../pipeline';
import { PLAN_COMMANDS, createPlanBus } from '../registry';

// ---- fixtures --------------------------------------------------------------

const footprints: FootprintProvider = () => ({
    width: 1000,
    depth: 500,
    height: 700,
});

/** Ids that cannot collide with the ones `makeRectPlan` hands out. */
function freshIds(): PlanCommandContext['newId'] {
    let n = 0;
    return (prefix) => `${prefix}_new${String((n += 1)).padStart(7, '0')}`;
}

function ctxFor(
    doc: PlanDocument,
    sizes: FootprintProvider = footprints,
): PlanCommandContext {
    const deriver = createPlanDeriver();
    return {
        geometry: deriver.derive(doc),
        derive: (d) => deriver.derive(d),
        footprints: sizes,
        defaults: defaultPlanDefaults(doc),
        newId: freshIds(),
    };
}

interface Rect {
    doc: PlanDocument;
    /** Node ids by corner: tl, tr, br, bl. */
    n: Record<'tl' | 'tr' | 'br' | 'bl', string>;
    /** Wall ids by side. */
    w: Record<'top' | 'right' | 'bottom' | 'left', string>;
}

/** A 5000 x 4000 room with 200 mm walls; walls run tl->tr->br->bl->tl. */
function rect(): Rect {
    const doc = makeRectPlan(5000, 4000, 200);
    const at = (x: number, y: number): string =>
        Object.values(doc.nodes).find((n) => n.x === x && n.y === y)!.id;
    const n = {
        tl: at(0, 0),
        tr: at(5000, 0),
        br: at(5000, 4000),
        bl: at(0, 4000),
    };
    const between = (a: string, b: string): string =>
        Object.values(doc.walls).find((w) => w.a === a && w.b === b)!.id;
    return {
        doc,
        n,
        w: {
            top: between(n.tl, n.tr),
            right: between(n.tr, n.br),
            bottom: between(n.br, n.bl),
            left: between(n.bl, n.tl),
        },
    };
}

const dimension = (
    id: string,
    wallId: string,
    face: 'left' | 'right' | 'center',
): DimensionAnnotation => ({
    id,
    a: { x: 1, y: 2 },
    b: { x: 3, y: 4 },
    offset: 300,
    attachedTo: { kind: 'wall', wallId, face },
});

const placement = (
    id: string,
    wallId: string,
    side: 'left' | 'right',
    x: number,
    y: number,
    rotation: number,
): FurniturePlacement => ({
    id,
    designId: 'des_x',
    x,
    y,
    rotation,
    elevation: 0,
    mirrored: false,
    wallAttachment: { wallId, side },
});

/** `doc` edited by `recipe` (mutative; the result is frozen in tests). */
function edit(
    doc: PlanDocument,
    recipe: (d: PlanDocument) => void,
): PlanDocument {
    return create(doc, (d) => {
        recipe(d as PlanDocument);
    });
}

// ---- test-only commands (every one touches geometry) --------------------------

const moveNodes = definePlanCommand<{
    moves: Array<{ id: string; x: number; y: number }>;
}>({
    type: 'test.moveNodes',
    labelKey: 'test.label.moveNodes',
    validate: () => null,
    run(draft, p) {
        for (const m of p.moves) {
            const node = draft.nodes[m.id]!;
            node.x = m.x;
            node.y = m.y;
        }
    },
    mergeKey: (p) => `move:${p.moves.map((m) => m.id).join(',')}`,
    touchesGeometry: true,
});

const addRawWall = definePlanCommand<{ a: string; b: string }, string>({
    type: 'test.addRawWall',
    labelKey: 'test.label.addRawWall',
    validate: () => null,
    run(draft, p, ctx, out) {
        const id = ctx.newId('w');
        const wall: Wall = {
            id,
            a: p.a,
            b: p.b,
            thickness: 115,
            height: 2700,
            kind: 'interior',
            justification: 'center',
            material: 'brick',
            colorHex: null,
        };
        draft.walls[id] = wall;
        out.result = id;
    },
    touchesGeometry: true,
});

const removeWall = definePlanCommand<{ id: string }>({
    type: 'test.removeWall',
    labelKey: 'test.label.removeWall',
    validate: (doc, p) =>
        doc.walls[p.id] === undefined
            ? {
                  code: 'not_found',
                  messageKey: 'engine.plan.command.not_found',
                  params: {},
              }
            : null,
    run(draft, p) {
        delete draft.walls[p.id];
    },
    touchesGeometry: true,
});

/** Moves nodes like `moveNodes` but declares that it does not touch geometry. */
const moveNodesQuietly = definePlanCommand<{
    moves: Array<{ id: string; x: number; y: number }>;
}>({
    ...moveNodes,
    type: 'test.moveNodesQuietly',
    touchesGeometry: false,
});

const crash = definePlanCommand<{ id: string }>({
    type: 'test.crash',
    labelKey: 'test.label.crash',
    validate: () => null,
    run(draft, p) {
        draft.nodes[p.id]!.x = 12345;
        throw new Error('boom');
    },
    touchesGeometry: true,
});

const abort = definePlanCommand<{ id: string }>({
    type: 'test.abort',
    labelKey: 'test.label.abort',
    validate: () => null,
    run(draft, p) {
        draft.nodes[p.id]!.x = 12345;
        throw new CommandAbort({
            code: 'wall_too_short',
            messageKey: 'engine.plan.command.wall_too_short',
            params: {},
        });
    },
    touchesGeometry: true,
});

const run = (
    doc: PlanDocument,
    def: Parameters<typeof executePlanCommand>[1],
    params: unknown,
    ctx: PlanCommandContext = ctxFor(doc),
) => executePlanCommand(doc, def, params, ctx);

function ok<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
    return r.value;
}

// ---- tests -----------------------------------------------------------------

describe('planPathToEntityId', () => {
    it.each([
        [['walls', 'w_x', 'a'], 'w_x'],
        [['nodes', 'n_x', 'x'], 'n_x'],
        [['openings', 'o_x'], 'o_x'],
        [['rooms', 'r_x', 'anchor', 'x'], 'r_x'],
        [['placements', 'f_x', 'wallAttachment'], 'f_x'],
        [['fixtures', 'x_x', 'width'], 'x_x'],
        [['annotations', 'labels', 't_x'], 't_x'],
        [['annotations', 'dimensions', 'd_x', 'a', 'x'], 'd_x'],
        [['background', 'opacity'], 'background'],
        [['background'], 'background'],
        [['meta', 'x'], 'meta'],
        [['view', 'mode2d'], null],
        [['view'], null],
        [['walls'], '*'],
        [['rooms'], '*'],
        [['annotations'], '*'],
        [['annotations', 'dimensions'], '*'],
        [['annotations', 'labels'], '*'],
        [['schemaVersion'], '*'],
        [[], '*'],
    ] as Array<[(string | number)[], string | null]>)(
        '%j -> %j',
        (path, id) => {
            expect(planPathToEntityId(path)).toBe(id);
        },
    );
});

describe('defaultPlanDefaults', () => {
    it('reads the document defaults and uses the spec sizes', () => {
        const doc = makeRectPlan(1000, 1000, 115);
        expect(defaultPlanDefaults(doc)).toEqual({
            wallHeight: doc.meta.defaultWallHeight,
            interiorThickness: doc.meta.defaultWallThickness,
            exteriorThickness: 230,
            doorWidth: 900,
            doorHeight: 2100,
            windowWidth: 1200,
            windowHeight: 1200,
            windowSill: 900,
            openingWidth: 900,
            openingHeight: 2100,
        });
        expect(defaultPlanDefaults(doc, 300).exteriorThickness).toBe(300);
    });
});

describe('PLAN_COMMAND_ERROR_CODES', () => {
    it('lists the 22 codes of 04 §6.7 once each', () => {
        expect(PLAN_COMMAND_ERROR_CODES).toHaveLength(22);
        expect(new Set(PLAN_COMMAND_ERROR_CODES).size).toBe(22);
        expect([...PLAN_COMMAND_ERROR_CODES]).toEqual([
            'not_found',
            'out_of_range',
            'too_large',
            'wall_too_short',
            'wall_duplicate',
            'split_through_opening',
            'opening_no_fit',
            'opening_overlap',
            'opening_too_tall',
            'type_mismatch',
            'not_collinear',
            'props_differ',
            'design_unknown',
            'fixture_unknown',
            'dimension_too_short',
            'text_length',
            'background_missing',
            'background_locked',
            'calibration_too_short',
            'introduces_error',
            'fragment_opening_dropped',
            'invalid_params',
        ]);
    });
});

describe('planPipeline', () => {
    it('is the plan pipeline of executePlanCommand', () => {
        const { doc, n } = rect();
        const params = { moves: [{ id: n.br, x: 5100, y: 4000 }] };
        const viaPipeline = planPipeline(doc, moveNodes, params, ctxFor(doc));
        const direct = run(doc, moveNodes, params);
        expect(ok(viaPipeline).doc).toEqual(ok(direct).doc);
    });
});

describe('executePlanCommand: phases and patches', () => {
    it('refuses with the validate error and runs nothing', () => {
        const { doc } = rect();
        const r = run(doc, removeWall, { id: 'w_missing' });
        expect(r).toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'not_found' }),
        });
    });

    it('returns an empty output for a command that changes nothing', () => {
        const { doc, n } = rect();
        const out = ok(
            run(doc, moveNodes, { moves: [{ id: n.tl, x: 0, y: 0 }] }),
        );
        expect(out.doc).toBe(doc);
        expect(out.patches).toEqual([]);
        expect(out.inversePatches).toEqual([]);
    });

    it('turns a CommandAbort into an error result', () => {
        const { doc, n } = rect();
        expect(run(doc, abort, { id: n.tl })).toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'wall_too_short' }),
        });
        expect(doc.nodes[n.tl]!.x).toBe(0);
    });

    it('propagates any other exception', () => {
        const { doc, n } = rect();
        expect(() => run(doc, crash, { id: n.tl })).toThrow('boom');
        expect(doc.nodes[n.tl]!.x).toBe(0);
    });

    it('deletes a node orphaned by the command, and only a related one', () => {
        const { doc, n } = rect();
        // a stub wall to a new node, and an unrelated orphan far away
        const withStub = edit(doc, (d) => {
            d.nodes.n_stub000001 = { id: 'n_stub000001', x: -1000, y: 0 };
            d.nodes.n_other00001 = { id: 'n_other00001', x: 9000, y: 9000 };
            d.walls.w_stub000001 = {
                id: 'w_stub000001',
                a: n.tl,
                b: 'n_stub000001',
                thickness: 115,
                height: 2700,
                kind: 'interior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
        });
        const out = ok(run(withStub, removeWall, { id: 'w_stub000001' }));
        expect(out.doc.nodes.n_stub000001).toBeUndefined();
        expect(out.doc.nodes.n_other00001).toBeDefined();
        expect(out.deletedIds).toContain('n_stub000001');
        expect(out.deletedIds).not.toContain('n_other00001');
        expect(out.doc.nodes[n.tl]).toBeDefined();
    });

    it('recomputes a dimension attached to a face from the derived wall, rounded to mm', () => {
        const { doc, n, w } = rect();
        const dims = [
            dimension('d_left00001', w.top, 'left'),
            dimension('d_right0001', w.top, 'right'),
            dimension('d_center001', w.top, 'center'),
        ];
        const start = edit(doc, (d) => {
            for (const x of dims) d.annotations.dimensions[x.id] = x;
        });
        // a slanted wall: the faces have fractional coordinates
        const moved = ok(
            run(start, moveNodes, {
                moves: [{ id: n.tr, x: 5000, y: 537 }],
            }),
        );
        const wall = derivePlanGeometry(moved.doc).walls[w.top]!;
        const r = (p: { x: number; y: number }) => ({
            x: roundMm(p.x) + 0,
            y: roundMm(p.y) + 0,
        });
        expect(wall.leftFace[0].y % 1).not.toBe(0);
        const got = moved.doc.annotations.dimensions;
        expect([got.d_left00001!.a, got.d_left00001!.b]).toEqual([
            r(wall.leftFace[0]),
            r(wall.leftFace[1]),
        ]);
        expect([got.d_right0001!.a, got.d_right0001!.b]).toEqual([
            r(wall.rightFace[0]),
            r(wall.rightFace[1]),
        ]);
        expect([got.d_center001!.a, got.d_center001!.b]).toEqual([
            r(wall.centerline[0]),
            r(wall.centerline[1]),
        ]);
        for (const d of Object.values(got)) {
            for (const p of [d.a, d.b]) {
                expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(
                    true,
                );
            }
        }
        expect(got.d_left00001!.offset).toBe(300);
    });

    it('leaves dimensions and placements on walls two hops away alone', () => {
        const s = strip(12000, 4000, [4000, 8000]);
        const start = edit(s.doc, (d) => {
            d.annotations.dimensions.d_stale0001 = dimension(
                'd_stale0001',
                s.sides.right,
                'left',
            );
            // deliberately off the face: only a related wall re-snaps it
            d.placements.f_sofa00001 = placement(
                'f_sofa00001',
                s.sides.right,
                'right',
                11000,
                1500,
                90,
            );
        });
        const out = ok(
            run(start, moveNodes, {
                moves: [{ id: s.node['0,0']!, x: 0, y: 300 }],
            }),
        );
        expect(out.doc.annotations.dimensions.d_stale0001).toBe(
            start.annotations.dimensions.d_stale0001,
        );
        expect(out.doc.placements.f_sofa00001).toBe(
            start.placements.f_sofa00001,
        );
    });

    describe('neighbouring walls (one hop)', () => {
        /** A dimension and a placement that start exactly on the faces of the top wall. */
        function onTopWall() {
            const base = rect();
            const geom = derivePlanGeometry(base.doc).walls[base.w.top]!;
            const r = (p: { x: number; y: number }) => ({
                x: roundMm(p.x) + 0,
                y: roundMm(p.y) + 0,
            });
            const start = edit(base.doc, (d) => {
                d.annotations.dimensions.d_left00001 = {
                    ...dimension('d_left00001', base.w.top, 'left'),
                    a: r(geom.leftFace[0]),
                    b: r(geom.leftFace[1]),
                };
                d.placements.f_sofa00001 = placement(
                    'f_sofa00001',
                    base.w.top,
                    'right',
                    4350,
                    100,
                    0,
                );
            });
            return { ...base, start, r };
        }

        it('recomputes them when a side wall gets thicker', () => {
            const { start, w, r } = onTopWall();
            const thicker = definePlanCommand<{ id: string; t: number }>({
                type: 'test.setThickness',
                labelKey: 'x',
                validate: () => null,
                run(draft, p) {
                    draft.walls[p.id]!.thickness = p.t;
                },
                touchesGeometry: true,
            });
            const out = ok(run(start, thicker, { id: w.right, t: 400 }));
            const face = derivePlanGeometry(out.doc).walls[w.top]!.leftFace;
            const dim = out.doc.annotations.dimensions.d_left00001!;
            expect([dim.a, dim.b]).toEqual([r(face[0]), r(face[1])]);
            expect(dim).not.toEqual(start.annotations.dimensions.d_left00001);
            // the placement, 4350 along a 4800 face, no longer fits at the end
            const p = out.doc.placements.f_sofa00001!;
            expect(p.x).toBe(4300);
        });

        it('recomputes them when a side wall is deleted', () => {
            const { start, w, r } = onTopWall();
            const out = ok(run(start, removeWall, { id: w.right }));
            const face = derivePlanGeometry(out.doc).walls[w.top]!.leftFace;
            const dim = out.doc.annotations.dimensions.d_left00001!;
            expect([dim.a, dim.b]).toEqual([r(face[0]), r(face[1])]);
            expect(dim).not.toEqual(start.annotations.dimensions.d_left00001);
        });
    });

    it('deletes a dimension whose wall was deleted and lists it in deletedIds', () => {
        const { doc, w } = rect();
        const start = edit(doc, (d) => {
            d.annotations.dimensions.d_left00001 = dimension(
                'd_left00001',
                w.top,
                'left',
            );
        });
        const out = ok(run(start, removeWall, { id: w.top }));
        expect(out.doc.annotations.dimensions.d_left00001).toBeUndefined();
        expect(out.deletedIds).toEqual(['d_left00001']);
        expect(
            validatePlan(out.doc).filter((i) => i.severity === 'error'),
        ).toEqual([]);
    });

    it('makes a placement follow the face of a moved wall (position and rotation)', () => {
        const { doc, n, w } = rect();
        // against the inside (right) face of the top wall, centred
        const start = edit(doc, (d) => {
            d.placements.f_sofa00001 = placement(
                'f_sofa00001',
                w.top,
                'right',
                2500,
                100,
                0,
            );
        });
        const slanted = ok(
            run(start, moveNodes, { moves: [{ id: n.tr, x: 5000, y: 500 }] }),
        );
        const geom = derivePlanGeometry(slanted.doc);
        const wall = geom.walls[w.top]!;
        const p = slanted.doc.placements.f_sofa00001!;
        const [p0, p1] = wall.rightFace;
        // on the new face (rounding to mm leaves at most ~0.71 mm)
        expect(
            Math.abs(dot(sub({ x: p.x, y: p.y }, p0), wall.normal)),
        ).toBeLessThan(0.8);
        // same distance along the face as before: 2500 - 0 along a 0-based face
        const prevAlong =
            2500 - derivePlanGeometry(start).walls[w.top]!.rightFace[0].x;
        const along = dot(
            sub({ x: p.x, y: p.y }, p0),
            scale(sub(p1, p0), 1 / dist(p0, p1)),
        );
        expect(Math.abs(along - prevAlong)).toBeLessThan(1);
        const front = scale(wall.normal, -1);
        expect(p.rotation).toBe(
            Math.round(rotationFromFront(front) * 100) / 100,
        );
        expect(p.rotation).not.toBe(0);
        expect(p.wallAttachment).toEqual({ wallId: w.top, side: 'right' });
    });

    it('moves a flush placement straight with a parallel wall', () => {
        const { doc, n, w } = rect();
        const start = edit(doc, (d) => {
            d.placements.f_sofa00001 = placement(
                'f_sofa00001',
                w.top,
                'right',
                2500,
                100,
                0,
            );
        });
        const out = ok(
            run(start, moveNodes, {
                moves: [
                    { id: n.tl, x: 0, y: 300 },
                    { id: n.tr, x: 5000, y: 300 },
                ],
            }),
        );
        const p = out.doc.placements.f_sofa00001!;
        expect([p.x, p.y, p.rotation]).toEqual([2500, 400, 0]);
    });

    it('clamps the placement to the shortened face, and centres it when it does not fit', () => {
        const { doc, n, w } = rect();
        const start = edit(doc, (d) => {
            d.placements.f_sofa00001 = placement(
                'f_sofa00001',
                w.top,
                'right',
                2500,
                100,
                0,
            );
        });
        const shorter = ok(
            run(start, moveNodes, {
                moves: [
                    { id: n.tr, x: 3000, y: 0 },
                    { id: n.br, x: 3000, y: 4000 },
                ],
            }),
        );
        const face = derivePlanGeometry(shorter.doc).walls[w.top]!.rightFace;
        const length = dist(face[0], face[1]);
        const p = shorter.doc.placements.f_sofa00001!;
        // 1000 wide: the back centre stays 500 mm inside the end of the face
        expect(Math.abs(p.x - (face[0].x + length - 500))).toBeLessThanOrEqual(
            0.5,
        );

        const wide: FootprintProvider = () => ({
            width: 9000,
            depth: 500,
            height: 700,
        });
        const centred = ok(
            run(
                start,
                moveNodes,
                {
                    moves: [
                        { id: n.tl, x: 0, y: 300 },
                        { id: n.tr, x: 5000, y: 300 },
                    ],
                },
                ctxFor(start, wide),
            ),
        );
        const c = derivePlanGeometry(centred.doc).walls[w.top]!.rightFace;
        expect(
            Math.abs(
                centred.doc.placements.f_sofa00001!.x - (c[0].x + c[1].x) / 2,
            ),
        ).toBeLessThanOrEqual(0.5);
    });

    it('detaches a placement whose wall was deleted and leaves its position', () => {
        const { doc, w } = rect();
        const start = edit(doc, (d) => {
            d.placements.f_sofa00001 = placement(
                'f_sofa00001',
                w.top,
                'right',
                2500,
                100,
                0,
            );
        });
        const out = ok(run(start, removeWall, { id: w.top }));
        const p = out.doc.placements.f_sofa00001!;
        expect(p.wallAttachment).toBeNull();
        expect([p.x, p.y, p.rotation]).toEqual([2500, 100, 0]);
    });

    it('skips post-processing for a command that does not touch geometry', () => {
        const { doc, n, w } = rect();
        const start = edit(doc, (d) => {
            d.annotations.dimensions.d_left00001 = dimension(
                'd_left00001',
                w.top,
                'left',
            );
        });
        const out = ok(
            run(start, moveNodesQuietly, {
                moves: [{ id: n.tl, x: 0, y: 300 }],
            }),
        );
        expect(out.doc.annotations.dimensions.d_left00001).toBe(
            start.annotations.dimensions.d_left00001,
        );
    });

    it('patches = phase 1 + phase 2 and inverse = phase 2 inverse + phase 1 inverse', () => {
        const { doc, w } = rect();
        const start = edit(doc, (d) => {
            d.annotations.dimensions.d_left00001 = dimension(
                'd_left00001',
                w.top,
                'left',
            );
        });
        const out = ok(run(start, removeWall, { id: w.top }));
        const paths = out.patches.map((p) =>
            planPathToEntityId(p.path as (string | number)[]),
        );
        // phase 1 removes the wall, phase 2 the dimension
        expect(paths).toEqual([w.top, 'd_left00001']);
        const inverse = out.inversePatches.map((p) =>
            planPathToEntityId(p.path as (string | number)[]),
        );
        expect(inverse).toEqual(['d_left00001', w.top]);
        expect(apply(start, out.patches)).toEqual(out.doc);
        expect(apply(out.doc, out.inversePatches)).toEqual(start);
    });

    it('freezes the committed document in tests', () => {
        const { doc, n } = rect();
        const out = ok(
            run(doc, moveNodes, { moves: [{ id: n.br, x: 5100, y: 4000 }] }),
        );
        expect(Object.isFrozen(out.doc)).toBe(true);
    });
});

describe('executePlanCommand: room metas', () => {
    const meta = metaFactory();

    it('deletes the merge loser, reports it in deletedIds and restores it on undo', () => {
        const s = strip(9000, 4000, [3000]);
        const small = meta(1500, 2000);
        const large = meta(6000, 2000);
        const start = edit(s.doc, (d) => {
            d.rooms[small.id] = small;
            d.rooms[large.id] = large;
        });
        const out = ok(run(start, removeWall, { id: s.cutWall[3000]! }));
        expect(out.deletedIds).toEqual([small.id]);
        expect(Object.keys(out.doc.rooms)).toEqual([large.id]);
        expect(
            out.patches.map((p) => planPathToEntityId(p.path as never)),
        ).toEqual([s.cutWall[3000], small.id]);
        const undone = apply(out.doc, out.inversePatches);
        expect(undone).toEqual(start);
        expect(Object.keys(undone.rooms).sort()).toEqual(
            [small.id, large.id].sort(),
        );
    });

    it('leaves the metas of rooms the command did not touch byte-identical', () => {
        const s = strip(9000, 4000, [3000, 6000]);
        const a = meta(1500, 2000);
        // too close to the net edge, and an offset label outside the room
        const b = meta(3100, 2000);
        const c = meta(7500, 2000, { labelOffset: { x: 5000, y: 0 } });
        const start = edit(s.doc, (d) => {
            for (const m of [a, b, c]) d.rooms[m.id] = m;
        });
        const out = ok(
            run(start, moveNodes, {
                moves: [{ id: s.node['0,0']!, x: 0, y: 1 }],
            }),
        );
        expect(out.doc.rooms[b.id]).toBe(start.rooms[b.id]);
        expect(out.doc.rooms[c.id]).toBe(start.rooms[c.id]);
        const touched = out.patches.map((p) =>
            planPathToEntityId(p.path as never),
        );
        expect(touched).not.toContain(b.id);
        expect(touched).not.toContain(c.id);
    });

    it('deletes no duplicate meta when a corner of a room with three metas moves', () => {
        const s = strip(9000, 4000, []);
        const metas = [meta(1500, 2000), meta(4500, 2000), meta(7500, 2000)];
        const start = edit(s.doc, (d) => {
            for (const m of metas) d.rooms[m.id] = m;
        });
        const out = ok(
            run(start, moveNodes, {
                moves: [{ id: s.node['9000,0']!, x: 9000, y: 1 }],
            }),
        );
        expect(out.deletedIds).toEqual([]);
        expect(out.doc.rooms).toEqual(start.rooms);
    });

    it('treats the face of a meta the command itself changed as affected', () => {
        const s = strip(9000, 4000, [4500]);
        const left = meta(2000, 2000);
        const start = edit(s.doc, (d) => {
            d.rooms[left.id] = left;
        });
        const setOffset = definePlanCommand<{ id: string }>({
            type: 'test.setOffset',
            labelKey: 'x',
            validate: () => null,
            run(draft, p) {
                // pushes the label out of the room; no wall is touched
                draft.rooms[p.id]!.labelOffset = { x: 8000, y: 0 };
            },
            touchesGeometry: true,
        });
        const out = ok(run(start, setOffset, { id: left.id }));
        expect(out.doc.rooms[left.id]!.labelOffset).toBeNull();
    });

    it('re-anchors a meta of a face the command changed', () => {
        const s = strip(9000, 4000, [4500]);
        const near = meta(100, 2000); // 42.5 mm from the net edge
        const start = edit(s.doc, (d) => {
            d.rooms[near.id] = near;
        });
        const out = ok(
            run(start, moveNodes, {
                moves: [{ id: s.node['0,0']!, x: 0, y: 1 }],
            }),
        );
        expect(out.doc.rooms[near.id]!.anchor).not.toEqual(near.anchor);
    });
});

describe('executePlanCommand: deletedIds', () => {
    it('lists an id once when the command and phase 2 both report it', () => {
        const { doc, n } = rect();
        const withStub = edit(doc, (d) => {
            d.nodes.n_stub000001 = { id: 'n_stub000001', x: -1000, y: 0 };
            d.walls.w_stub000001 = {
                id: 'w_stub000001',
                a: n.tl,
                b: 'n_stub000001',
                thickness: 115,
                height: 2700,
                kind: 'interior',
                justification: 'center',
                material: 'brick',
                colorHex: null,
            };
        });
        const declaring = definePlanCommand<{ id: string }>({
            type: 'test.removeStubDeclaring',
            labelKey: 'x',
            validate: () => null,
            run(draft, p, _ctx, out) {
                delete draft.walls[p.id];
                // the command names the node, but only phase 2 deletes it
                out.deletedIds.push('n_stub000001');
            },
            touchesGeometry: true,
        });
        const out = ok(run(withStub, declaring, { id: 'w_stub000001' }));
        expect(out.doc.nodes.n_stub000001).toBeUndefined();
        expect(out.deletedIds).toEqual(['n_stub000001']);
    });
});

describe('executePlanCommand: the error invariant', () => {
    it('refuses a command that introduces a new error and leaves the document alone', () => {
        const { doc, n } = rect();
        const before = structuredClone(doc);
        const r = run(doc, addRawWall, { a: n.tl, b: n.tr });
        expect(r).toEqual({
            ok: false,
            error: {
                code: 'introduces_error',
                messageKey: 'engine.plan.command.introduces_error',
                params: { issue: 'plan.wall_duplicate' },
            },
        });
        expect(doc).toEqual(before);
    });

    it('allows a command on a plan that already has errors when it adds none', () => {
        const dirty = makeDirtyPlan();
        const known = planErrorKeys(validatePlan(dirty));
        expect(known.size).toBeGreaterThan(0);
        const corner = Object.values(dirty.nodes).find(
            (node) => node.x === 5000 && node.y === 4000,
        )!;
        const out = ok(
            run(dirty, moveNodes, {
                moves: [{ id: corner.id, x: 5010, y: 4000 }],
            }),
        );
        expect(out.doc.nodes[corner.id]!.x).toBe(5010);
        const after = planErrorKeys(validatePlan(out.doc));
        expect([...after].filter((k) => !known.has(k))).toEqual([]);
    });

    it('still refuses a new error on a plan that already has errors', () => {
        const dirty = makeDirtyPlan();
        const top = Object.values(dirty.walls).find(
            (wall) =>
                dirty.nodes[wall.a]!.x === 0 &&
                dirty.nodes[wall.a]!.y === 0 &&
                dirty.nodes[wall.b]!.x === 5000,
        )!;
        const r = run(dirty, addRawWall, { a: top.a, b: top.b });
        expect(r).toMatchObject({
            ok: false,
            error: {
                code: 'introduces_error',
                params: { issue: 'plan.wall_duplicate' },
            },
        });
    });
});

describe('createPlanBus', () => {
    const newBus = (initial: PlanDocument) =>
        createPlanBus({
            initial,
            footprints,
            newId: freshIds(),
            registry: { moveNodes, addRawWall, removeWall },
        });

    it('starts from the initial document with an empty registry by default', () => {
        const { doc } = rect();
        const bus = createPlanBus({ initial: doc, footprints });
        expect(bus.getDoc()).toBe(doc);
        expect(Object.keys(PLAN_COMMANDS)).toEqual([]);
    });

    it('turns a 200-step node drag into one history entry that undo reverts', () => {
        const { doc, n, w } = rect();
        const start = edit(doc, (d) => {
            d.annotations.dimensions.d_left00001 = dimension(
                'd_left00001',
                w.top,
                'left',
            );
            d.placements.f_sofa00001 = placement(
                'f_sofa00001',
                w.top,
                'right',
                2500,
                100,
                0,
            );
        });
        const bus = newBus(start);
        const events: string[][] = [];
        bus.subscribe((e) => events.push([e.kind, ...e.changedIds]));
        for (let i = 1; i <= 200; i += 1) {
            const r = bus.execute(
                'moveNodes',
                { moves: [{ id: n.tr, x: 5000, y: i }] },
                { merge: true },
            );
            expect(r.ok).toBe(true);
        }
        expect(bus.history().undo).toHaveLength(1);
        const dragged = bus.getDoc();
        expect(dragged.nodes[n.tr]!.y).toBe(200);
        // the follow-ups ride along in the same entry
        expect(dragged.placements.f_sofa00001).not.toEqual(
            start.placements.f_sofa00001,
        );
        expect(dragged.annotations.dimensions.d_left00001).not.toEqual(
            start.annotations.dimensions.d_left00001,
        );
        expect(events.at(-1)).toEqual(
            expect.arrayContaining([
                'merge',
                n.tr,
                'f_sofa00001',
                'd_left00001',
            ]),
        );
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
        expect(bus.redo()).toBe(true);
        expect(bus.getDoc()).toEqual(dragged);
    });

    it('reports a refused command without changing anything', () => {
        const { doc, n } = rect();
        const bus = newBus(doc);
        const r = bus.execute('addRawWall', { a: n.tl, b: n.tr });
        expect(r).toMatchObject({
            ok: false,
            error: { code: 'introduces_error' },
        });
        expect(bus.getDoc()).toBe(doc);
        expect(bus.canUndo()).toBe(false);
    });

    it('deletes a meta mid-drag, restores it when the drag moves back, and undoes in one step', () => {
        const s = strip(9000, 4000, [3000]);
        const meta = metaFactory();
        const small = meta(1500, 2000);
        const large = meta(6000, 2000);
        const start = edit(s.doc, (d) => {
            d.rooms[small.id] = small;
            d.rooms[large.id] = large;
        });
        // an absolute drag: a far enough pull removes the wall between the rooms
        const pull = definePlanCommand<{ dy: number }>({
            type: 'test.pull',
            labelKey: 'x',
            validate: () => null,
            run(draft, p) {
                draft.nodes[s.node['0,0']!]!.y = p.dy;
                if (p.dy >= 100) delete draft.walls[s.cutWall[3000]!];
            },
            mergeKey: () => 'pull',
            touchesGeometry: true,
        });
        const bus = createPlanBus({
            initial: start,
            footprints,
            newId: freshIds(),
            registry: { pull },
        });
        const step = (dy: number) =>
            bus.execute('pull', { dy }, { merge: true });

        expect(step(10).ok).toBe(true);
        expect(Object.keys(bus.getDoc().rooms)).toHaveLength(2);
        const mid = step(150);
        expect(mid).toMatchObject({ ok: true, deletedIds: [small.id] });
        expect(Object.keys(bus.getDoc().rooms)).toEqual([large.id]);
        // back above the threshold: the base is re-run, both metas are back
        expect(step(20).ok).toBe(true);
        expect(Object.keys(bus.getDoc().rooms).sort()).toEqual(
            [small.id, large.id].sort(),
        );
        expect(step(200)).toMatchObject({ ok: true, deletedIds: [small.id] });
        expect(bus.history().undo).toHaveLength(1);

        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
        expect(bus.redo()).toBe(true);
        expect(Object.keys(bus.getDoc().rooms)).toEqual([large.id]);
    });
});
