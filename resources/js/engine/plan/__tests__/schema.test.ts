import { describe, expect, it } from 'vitest';
import { IssueSchema } from '../types';
import {
    DOOR_TYPES,
    FLOOR_FINISHES,
    PlanDocumentSchema,
    WALL_KINDS,
    WALL_MATERIALS,
    WINDOW_TYPES,
    type PlanDocument,
} from '../schema';
import {
    emptyPlan,
    makeDirtyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';

const clone = (doc: PlanDocument): PlanDocument => structuredClone(doc);

function firstOf<T>(record: Record<string, T>): T {
    const first = Object.values(record)[0];
    if (first === undefined) throw new Error('empty record');
    return first;
}

describe('PlanDocumentSchema', () => {
    it.each([
        ['emptyPlan', () => emptyPlan()],
        ['makeRectPlan', () => makeRectPlan(5000, 4000, 230)],
        ['makeLPlan', () => makeLPlan()],
        ['makeGridPlan(7, 6)', () => makeGridPlan(7, 6)],
        ['makeDirtyPlan', () => makeDirtyPlan()],
    ])('accepts %s', (_name, build) => {
        const doc = build();
        expect(PlanDocumentSchema.parse(doc)).toEqual(doc);
    });

    it('rejects a non-integer wall thickness', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        firstOf(doc.walls).thickness = 115.5;
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(false);
    });

    it('rejects a record whose key differs from the entity id', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const [key, wall] = Object.entries(doc.walls)[0] ?? [];
        if (key === undefined || wall === undefined) throw new Error('no wall');
        delete doc.walls[key];
        doc.walls['w_zzzzzzzzzz'] = wall;
        const result = PlanDocumentSchema.safeParse(doc);
        expect(result.success).toBe(false);
    });

    it('rejects an id with the wrong prefix or shape', () => {
        for (const bad of [
            'n_0000000001',
            'w_00000000',
            'w_000000000A',
            'w-0000000001',
        ]) {
            const doc = makeRectPlan(5000, 4000, 230);
            const wall = firstOf(doc.walls);
            delete doc.walls[wall.id];
            wall.id = bad;
            doc.walls[bad] = wall;
            expect(PlanDocumentSchema.safeParse(doc).success).toBe(false);
        }
    });

    it('rejects a fixture with an unknown libraryKey', () => {
        const doc = emptyPlan();
        doc.fixtures['x_0000000001'] = {
            id: 'x_0000000001',
            libraryKey: 'piano' as never,
            x: 0,
            y: 0,
            rotation: 0,
            width: 1000,
            depth: 500,
            height: 800,
            elevation: 0,
            label: null,
        };
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(false);
        doc.fixtures['x_0000000001'].libraryKey = 'bed_double';
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
    });

    it.each([360, -0.01, 720])('rejects rotation %s', (rotation) => {
        const doc = emptyPlan();
        doc.placements['f_0000000001'] = {
            id: 'f_0000000001',
            designId: '01J0000000000000000000000A',
            x: 0,
            y: 0,
            rotation,
            elevation: 0,
            mirrored: false,
            wallAttachment: null,
        };
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(false);
    });

    it('accepts fractional degrees below 360', () => {
        const doc = emptyPlan({ northAngle: 359.99 });
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
        expect(
            PlanDocumentSchema.safeParse(emptyPlan({ northAngle: 360 }))
                .success,
        ).toBe(false);
    });

    it('accepts imported out-of-range numerics (ranges belong to validatePlan)', () => {
        const doc = makeRectPlan(5000, 4000, 230);
        const wall = firstOf(doc.walls);
        wall.thickness = 5000;
        wall.height = 20;
        firstOf(doc.nodes).x = 5_000_000;
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
    });

    it('rejects labels over 200 characters and bad colours', () => {
        const doc = emptyPlan();
        const label = {
            id: 't_0000000001',
            position: { x: 0, y: 0 },
            text: 'x'.repeat(200),
            fontSize: 250,
            rotation: 0,
        };
        doc.annotations.labels[label.id] = label;
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
        label.text = 'x'.repeat(201);
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(false);

        const walls = makeRectPlan(5000, 4000, 230);
        const wall = firstOf(walls.walls);
        for (const ok of ['#a1B2c3', null]) {
            wall.colorHex = ok;
            expect(PlanDocumentSchema.safeParse(walls).success).toBe(true);
        }
        for (const bad of ['#abc', 'a1b2c3', '#a1b2c3d', '#gggggg']) {
            wall.colorHex = bad;
            expect(PlanDocumentSchema.safeParse(walls).success).toBe(false);
        }
    });

    it('rejects a wrong schemaVersion, unknown enum values and missing fields', () => {
        const base = makeLPlan();
        expect(
            PlanDocumentSchema.safeParse({ ...base, schemaVersion: 2 }).success,
        ).toBe(false);

        const badKind = clone(base);
        firstOf(badKind.walls).kind = 'curtain' as never;
        expect(PlanDocumentSchema.safeParse(badKind).success).toBe(false);

        const badType = clone(base);
        firstOf(badType.openings).type = 'trapdoor' as never;
        expect(PlanDocumentSchema.safeParse(badType).success).toBe(false);

        const missing: Partial<PlanDocument> = clone(base);
        delete missing.view;
        expect(PlanDocumentSchema.safeParse(missing).success).toBe(false);
    });

    it('accepts every opening type including the empty passage', () => {
        const doc = makeLPlan();
        const opening = firstOf(doc.openings);
        for (const type of [
            ...DOOR_TYPES,
            ...WINDOW_TYPES,
            'opening',
        ] as const) {
            opening.type = type;
            expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
        }
    });

    it('accepts every room type, floor finish, background and view state', () => {
        const doc = emptyPlan();
        doc.rooms['r_0000000001'] = {
            id: 'r_0000000001',
            anchor: { x: 100, y: 100 },
            name: 'Master Bedroom',
            type: 'master_bedroom',
            floorFinish: 'wood',
            floorColorHex: null,
            labelOffset: { x: 10, y: -10 },
            showArea: true,
        };
        doc.background = {
            importId: null,
            mediaUuid: 'abc',
            pixelWidth: 800,
            pixelHeight: 600,
            mmPerPixel: 5.25,
            position: { x: 0, y: 0 },
            rotation: 0,
            opacity: 0.5,
            visible: true,
            locked: false,
        };
        doc.view = {
            mode2d: { centerX: 100, centerY: 200, zoom: 0.25 },
            mode3d: { camera: 'orbit', position: [1, 2, 3], target: [0, 0, 0] },
            lastMode: '3d',
        };
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
        for (const floorFinish of FLOOR_FINISHES) {
            firstOf(doc.rooms).floorFinish = floorFinish;
            expect(PlanDocumentSchema.safeParse(doc).success).toBe(true);
        }
        if (doc.background) doc.background.opacity = 1.5;
        expect(PlanDocumentSchema.safeParse(doc).success).toBe(false);
    });

    it('exports the enum lists of 03 section 1', () => {
        expect(WALL_KINDS).toEqual([
            'exterior',
            'interior',
            'partition',
            'half',
        ]);
        expect(WALL_MATERIALS).toEqual([
            'brick',
            'concrete',
            'drywall',
            'glass',
            'other',
        ]);
        expect(FLOOR_FINISHES).toEqual([
            'tile',
            'wood',
            'marble',
            'carpet',
            'concrete',
            'other',
        ]);
        expect(DOOR_TYPES).toHaveLength(6);
        expect(WINDOW_TYPES).toHaveLength(6);
    });
});

describe('IssueSchema', () => {
    it('parses an issue and rejects a bad severity', () => {
        const issue = {
            code: 'plan.node_missing',
            severity: 'error',
            messageKey: 'plan_editor.issues.node_missing',
            params: { wallId: 'w_0000000001', count: 2 },
            entityIds: ['w_0000000001'],
        };
        expect(IssueSchema.parse(issue)).toEqual(issue);
        expect(
            IssueSchema.safeParse({ ...issue, severity: 'fatal' }).success,
        ).toBe(false);
    });
});
