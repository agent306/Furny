import { describe, expect, it } from 'vitest';
import type { CatalogMaterial } from '../../catalog/snapshot';
import { mutateCatalog, seedCatalog } from '../../testing/seedCatalog';
import { fl } from '../constants';
import { createGenContext } from '../context';
import { makePart, mapEdges, mapGrain } from '../parts';
import type { FurnitureDocument } from '../schema';
import type { Axis, PanelSpec, PhysEdge } from '../types';

function docWith(
    carcassMaterial = 'PB18-WHITE',
    edgeBandCode: string | null = null,
): FurnitureDocument {
    const roles = [
        'carcass',
        'back',
        'shelf',
        'front',
        'top',
        'drawer_box',
        'drawer_bottom',
        'plinth',
        'leg',
    ] as const;
    return {
        schemaVersion: 1,
        templateKey: 'custom_box',
        family: 'carcass',
        dims: { width: 1800, height: 2100, depth: 600 },
        materials: Object.fromEntries(
            roles.map((role) => [
                role,
                {
                    materialCode: carcassMaterial,
                    edgeBandCode: role === 'carcass' ? edgeBandCode : null,
                    finishCode: null,
                },
            ]),
        ) as FurnitureDocument['materials'],
        carcass: null,
        table: null,
        overrides: {
            parts: {},
            extraParts: [],
            hardware: {},
            extraHardware: [],
        },
        notes: null,
    };
}

const ctxFor = (material = 'PB18-WHITE', band: string | null = null) =>
    createGenContext(docWith(material, band), seedCatalog());

function spec(over: Partial<PanelSpec>): PanelSpec {
    return {
        key: 'carcass.test',
        nameKey: 'parts.top',
        role: 'carcass',
        materialCode: 'PB18-WHITE',
        box: { min: [0, 0, 0], size: [18, 2000, 582] },
        thicknessAxis: 'x',
        grainAxis: null,
        banded: [],
        visibleFaces: 1,
        ...over,
    };
}

describe('fl', () => {
    it('floors with epsilon tolerance', () => {
        expect(fl(1.9999999)).toBe(2);
        expect(fl(605.9999995)).toBe(606);
        expect(fl(606.5)).toBe(606);
        expect(fl(1997)).toBe(1997);
        expect(fl(0.99)).toBe(0);
    });
});

describe('makePart: sizes and edge numbering (07 §1.2)', () => {
    it('floors both axes with the epsilon, not Math.floor or Math.round', () => {
        const sized = (size: [number, number, number]) => {
            const part = makePart(
                spec({ box: { min: [0, 0, 0], size } }),
                ctxFor(),
            );
            return [part.length, part.width];
        };
        // first axis (y): 1996.9999995 -> 1997 (Math.floor gives 1996); second (z): 582.5 -> 582 (Math.round gives 583)
        expect(sized([18, 1996.9999995, 582.5])).toEqual([1997, 582]);
        // first axis 1996.5 -> 1996 (Math.round gives 1997); second 582.9999995 -> 583 (Math.floor gives 582)
        expect(sized([18, 1996.5, 582.9999995])).toEqual([1996, 583]);
    });

    it('side panel: thin x, length along y', () => {
        const ctx = ctxFor();
        const part = makePart(
            spec({ key: 'carcass.side.left', banded: ['front'] }),
            ctx,
        );
        expect(part.length).toBe(2000);
        expect(part.width).toBe(582);
        expect(ctx.edgeMap.get('carcass.side.left')).toEqual({
            L1: 'front',
            L2: 'back',
            W1: 'top',
            W2: 'bottom',
        });
    });

    it('top panel 1764 x 582: thin y, length along x', () => {
        const ctx = ctxFor();
        const part = makePart(
            spec({
                key: 'carcass.top',
                box: { min: [18, 2082, 0], size: [1764, 18, 582] },
                thicknessAxis: 'y',
            }),
            ctx,
        );
        expect([part.length, part.width]).toEqual([1764, 582]);
        expect(ctx.edgeMap.get('carcass.top')).toEqual({
            L1: 'front',
            L2: 'back',
            W1: 'left',
            W2: 'right',
        });
    });

    it('door leaf 606.5 x 1997: thin z, sizes floored', () => {
        const ctx = ctxFor();
        const part = makePart(
            spec({
                key: 'front.fr_1.leaf.1',
                role: 'front',
                box: { min: [1.5, 101, 600], size: [606.5, 1997, 18] },
                thicknessAxis: 'z',
            }),
            ctx,
        );
        expect([part.length, part.width]).toEqual([1997, 606]);
        expect(ctx.edgeMap.get('front.fr_1.leaf.1')).toEqual({
            L1: 'left',
            L2: 'right',
            W1: 'top',
            W2: 'bottom',
        });
    });

    it('square panel takes the grain axis as the length axis', () => {
        const base = {
            box: {
                min: [0, 0, 0] as [number, number, number],
                size: [400, 18, 400] as [number, number, number],
            },
            thicknessAxis: 'y' as Axis,
        };
        const edges = (grainAxis: Axis | null) => {
            const ctx = ctxFor();
            makePart(spec({ ...base, grainAxis }), ctx);
            return ctx.edgeMap.get('carcass.test');
        };
        // length along z: L = left/right, W = front/back
        expect(edges('z')).toEqual({
            L1: 'left',
            L2: 'right',
            W1: 'front',
            W2: 'back',
        });
        // length along x (grain x, or no preference, or the thickness axis)
        for (const g of ['x', null, 'y'] as const) {
            expect(edges(g)).toEqual({
                L1: 'front',
                L2: 'back',
                W1: 'left',
                W2: 'right',
            });
        }
    });

    it('square panel with a grained material: grain follows the chosen length axis', () => {
        const ctx = ctxFor('PB18-OAK');
        const box = {
            min: [0, 0, 0] as [number, number, number],
            size: [400, 18, 400] as [number, number, number],
        };
        const z = makePart(
            spec({
                materialCode: 'PB18-OAK',
                box,
                thicknessAxis: 'y',
                grainAxis: 'z',
            }),
            ctx,
        );
        expect(z.grain).toBe('length');
        const x = makePart(
            spec({
                materialCode: 'PB18-OAK',
                box,
                thicknessAxis: 'y',
                grainAxis: 'x',
            }),
            ctx,
        );
        expect(x.grain).toBe('length');
    });

    it('rounds a non-integer material thickness', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            const m = d.materials.find((x) => x.code === 'PB18-WHITE');
            if (m) m.thicknessMm = 17.6;
        });
        const ctx = createGenContext(docWith(), snap);
        expect(makePart(spec({}), ctx).thickness).toBe(18);
    });
});

describe('makePart: banding', () => {
    it("banded ['front'] on the side gives the role band on L1 only", () => {
        const part = makePart(spec({ banded: ['front'] }), ctxFor());
        expect(part.edges).toEqual({
            L1: 'EB08-WHITE',
            L2: null,
            W1: null,
            W2: null,
        });
    });

    it('bands every listed physical edge', () => {
        const part = makePart(
            spec({ banded: ['front', 'top', 'bottom'] }),
            ctxFor(),
        );
        expect(part.edges).toEqual({
            L1: 'EB08-WHITE',
            L2: null,
            W1: 'EB08-WHITE',
            W2: 'EB08-WHITE',
        });
    });

    it('bands W2 alone and L2 alone', () => {
        // side panel: L1 front, L2 back, W1 top, W2 bottom
        expect(makePart(spec({ banded: ['bottom'] }), ctxFor()).edges).toEqual({
            L1: null,
            L2: null,
            W1: null,
            W2: 'EB08-WHITE',
        });
        expect(makePart(spec({ banded: ['back'] }), ctxFor()).edges).toEqual({
            L1: null,
            L2: 'EB08-WHITE',
            W1: null,
            W2: null,
        });
    });

    it('uses the band of the part role, not the carcass one', () => {
        const doc = docWith();
        doc.materials.front = {
            ...doc.materials.front,
            edgeBandCode: 'EB2-OAK',
        };
        const ctx = createGenContext(doc, seedCatalog());
        const front = makePart(spec({ role: 'front', banded: ['front'] }), ctx);
        expect(front.edges.L1).toBe('EB2-OAK');
        const carcass = makePart(spec({ banded: ['front'] }), ctx);
        expect(carcass.edges.L1).toBe('EB08-WHITE');
    });

    it('hidden edges stay null', () => {
        expect(makePart(spec({}), ctxFor()).edges).toEqual({
            L1: null,
            L2: null,
            W1: null,
            W2: null,
        });
    });

    it('bandCode null gives no band; a code overrides the role band', () => {
        const none = makePart(
            spec({ banded: ['front', 'top'], bandCode: null }),
            ctxFor(),
        );
        expect(none.edges.L1).toBeNull();
        expect(none.edges.W1).toBeNull();
        const own = makePart(
            spec({ banded: ['front'], bandCode: 'EB08-WHITE' }),
            ctxFor('PB18-WHITE', 'EB2-OAK'),
        );
        expect(own.edges.L1).toBe('EB08-WHITE');
    });

    it('the document role band wins over the material default', () => {
        const part = makePart(
            spec({ banded: ['front'] }),
            ctxFor('PB18-WHITE', 'EB2-OAK'),
        );
        expect(part.edges.L1).toBe('EB2-OAK');
    });

    it('is null when the role has no band at all', () => {
        const snap = mutateCatalog(seedCatalog(), (d) => {
            for (const m of d.materials) m.defaultEdgeBandCode = null;
        });
        const ctx = createGenContext(docWith(), snap);
        expect(makePart(spec({ banded: ['front'] }), ctx).edges.L1).toBeNull();
    });
});

describe('makePart: grain', () => {
    it("is 'none' for a material without grain", () => {
        expect(makePart(spec({ grainAxis: 'y' }), ctxFor()).grain).toBe('none');
    });

    it("follows the length axis ('length') and the width axis ('width')", () => {
        const oak = ctxFor('PB18-OAK');
        const material = oak.idx.material('PB18-OAK') as CatalogMaterial;
        expect(material.hasGrain).toBe(true);
        const common = { materialCode: 'PB18-OAK' };
        // side panel: length y, width z
        expect(makePart(spec({ ...common, grainAxis: 'y' }), oak).grain).toBe(
            'length',
        );
        expect(makePart(spec({ ...common, grainAxis: 'z' }), oak).grain).toBe(
            'width',
        );
    });

    it("is 'none' for a grained material without a preference or along the thickness axis", () => {
        const oak = ctxFor('PB18-OAK');
        const common = { materialCode: 'PB18-OAK' };
        expect(makePart(spec({ ...common, grainAxis: null }), oak).grain).toBe(
            'none',
        );
        expect(makePart(spec({ ...common, grainAxis: 'x' }), oak).grain).toBe(
            'none',
        );
    });

    it('mapGrain maps the axis onto length/width/none', () => {
        expect(mapGrain('y', 'y', 'z')).toBe('length');
        expect(mapGrain('z', 'y', 'z')).toBe('width');
        expect(mapGrain('x', 'y', 'z')).toBe('none');
        expect(mapGrain(null, 'y', 'z')).toBe('none');
    });
});

describe('makePart: defaults', () => {
    it('fills thickness, qty, source, overridden, operations and geometry', () => {
        const box = {
            min: [0, 0, 0] as [number, number, number],
            size: [18, 2000, 582.5] as [number, number, number],
        };
        const part = makePart(
            spec({
                nameKey: 'parts.side_left',
                nameParams: { n: 1 },
                box,
                visibleFaces: 2,
            }),
            ctxFor(),
        );
        expect(part).toMatchObject({
            key: 'carcass.test',
            nameKey: 'parts.side_left',
            nameParams: { n: 1 },
            role: 'carcass',
            materialCode: 'PB18-WHITE',
            thickness: 18,
            qty: 1,
            source: 'generated',
            overridden: false,
            visibleFaces: 2,
            operations: {
                hingeCups: 0,
                shelfPinHoles: 0,
                slideScrewSets: 0,
                handleHoles: 0,
                dowels: 0,
                camLocks: 0,
            },
        });
        expect(part.geometry).toEqual({ kind: 'box', box });
        expect(part.geometry).not.toBe(undefined);
        if (part.geometry.kind === 'box') {
            expect(part.geometry.box).not.toBe(box);
        }
    });

    it('merges partial operations and honours an explicit geometry', () => {
        const geometry = {
            kind: 'extruded' as const,
            outline: [
                [0, 0],
                [10, 0],
                [10, 10],
            ] as Array<[number, number]>,
            plane: 'xz' as const,
            y: 5,
            thickness: 18,
        };
        const part = makePart(
            spec({ operations: { hingeCups: 4, camLocks: 2 }, geometry }),
            ctxFor(),
        );
        expect(part.operations.hingeCups).toBe(4);
        expect(part.operations.camLocks).toBe(2);
        expect(part.operations.dowels).toBe(0);
        expect(part.geometry).toEqual(geometry);
    });

    it('does not let explicit undefined operation fields overwrite the zero defaults', () => {
        const part = makePart(
            spec({ operations: { hingeCups: undefined, dowels: 6 } }),
            ctxFor(),
        );
        expect(part.operations.hingeCups).toBe(0);
        expect(part.operations.dowels).toBe(6);
    });

    it('copies an explicit geometry instead of aliasing it', () => {
        const geometry = {
            kind: 'box' as const,
            box: {
                min: [1, 2, 3] as [number, number, number],
                size: [4, 5, 6] as [number, number, number],
            },
        };
        const part = makePart(spec({ geometry }), ctxFor());
        expect(part.geometry).toEqual(geometry);
        expect(part.geometry).not.toBe(geometry);
        if (part.geometry.kind === 'box') {
            expect(part.geometry.box.min).not.toBe(geometry.box.min);
        }
    });

    it('uses spec.materialCode when it differs from the role material', () => {
        const part = makePart(spec({ materialCode: 'PLY12-BWR' }), ctxFor());
        expect(part.materialCode).toBe('PLY12-BWR');
        expect(part.thickness).toBe(12);
    });

    it('falls back to the role default for an unknown material code', () => {
        const part = makePart(spec({ materialCode: 'NOPE' }), ctxFor());
        expect(part.materialCode).toBe('PB18-WHITE');
        expect(part.thickness).toBe(18);
    });
});

describe('mapEdges', () => {
    it('covers every length/width axis pair with distinct physical edges', () => {
        const axes: Axis[] = ['x', 'y', 'z'];
        for (const l of axes) {
            for (const w of axes) {
                if (l === w) continue;
                const map = mapEdges(l, w);
                expect(new Set(Object.values<PhysEdge>(map)).size).toBe(4);
            }
        }
        expect(mapEdges('y', 'z')).toEqual({
            L1: 'front',
            L2: 'back',
            W1: 'top',
            W2: 'bottom',
        });
        expect(mapEdges('x', 'y')).toEqual({
            L1: 'top',
            L2: 'bottom',
            W1: 'left',
            W2: 'right',
        });
    });
});
