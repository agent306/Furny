import { describe, expect, it } from 'vitest';
import { derivePlanGeometry } from '../derive';
import type { PlanDocument, RoomMeta } from '../schema';
import {
    emptyPlan,
    makeDirtyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';
import { IssueSchema, type Issue } from '../types';
import {
    PLAN_ISSUE_CODES,
    planErrorKeys,
    removeOrphanNodes,
    validatePlan,
} from '../validate';

/** makeRectPlan(5000, 4000, 230): nodes n_…1..4, walls w_…1..4 (w1 runs (0,0)->(5000,0)). */
const N = (i: number): string => `n_${String(i).padStart(10, '0')}`;
const W = (i: number): string => `w_${String(i).padStart(10, '0')}`;
const O = (i: number): string => `o_${String(i).padStart(10, '0')}`;
const R = (i: number): string => `r_${String(i).padStart(10, '0')}`;

const rect = (): PlanDocument => makeRectPlan(5000, 4000, 230);

function addNode(doc: PlanDocument, id: string, x: number, y: number): void {
    doc.nodes[id] = { id, x, y };
}

function addWall(
    doc: PlanDocument,
    id: string,
    a: string,
    b: string,
    extra: Partial<PlanDocument['walls'][string]> = {},
): void {
    doc.walls[id] = {
        id,
        a,
        b,
        thickness: 115,
        height: 2700,
        kind: 'interior',
        justification: 'center',
        material: 'brick',
        colorHex: null,
        ...extra,
    };
}

function addOpening(
    doc: PlanDocument,
    id: string,
    wallId: string,
    extra: Partial<PlanDocument['openings'][string]> = {},
): void {
    doc.openings[id] = {
        id,
        wallId,
        kind: 'door',
        type: 'single_swing',
        offset: 2500,
        width: 900,
        height: 2100,
        sillHeight: 0,
        hinge: 'start',
        swing: 'left',
        label: null,
        ...extra,
    };
}

function addMeta(
    doc: PlanDocument,
    id: string,
    x: number,
    y: number,
    extra: Partial<RoomMeta> = {},
): void {
    doc.rooms[id] = {
        id,
        anchor: { x, y },
        name: 'Hall',
        type: 'living',
        floorFinish: 'tile',
        floorColorHex: null,
        labelOffset: null,
        showArea: true,
        ...extra,
    };
}

/** Documents are memoised by identity, so every call validates a fresh copy. */
function validate(doc: PlanDocument): Issue[] {
    return validatePlan(structuredClone(doc));
}

function only(issues: Issue[], code: string): Issue[] {
    return issues.filter((i) => i.code === code);
}

/** Exactly one issue, of this code; returns it. */
function single(doc: PlanDocument, code: string): Issue {
    const issues = validate(doc);
    expect(issues.map((i) => i.code)).toEqual([code]);
    return issues[0]!;
}

describe('PLAN_ISSUE_CODES', () => {
    it('lists the twelve emitted codes (placement_design_missing is server-only)', () => {
        expect(PLAN_ISSUE_CODES).toEqual([
            'plan.node_missing',
            'plan.wall_degenerate',
            'plan.wall_duplicate',
            'plan.orphan_node',
            'plan.opening_wall_missing',
            'plan.opening_out_of_bounds',
            'plan.opening_overlap',
            'plan.opening_too_tall',
            'plan.walls_intersect',
            'plan.room_anchor_outside',
            'plan.too_large',
            'plan.value_out_of_range',
        ]);
    });
});

describe('validatePlan on valid documents', () => {
    it.each([
        ['makeRectPlan', () => makeRectPlan(5000, 4000, 230)],
        ['makeLPlan', () => makeLPlan()],
        ['makeGridPlan(3,3)', () => makeGridPlan(3, 3)],
        ['emptyPlan', () => emptyPlan()],
    ])('%s has no issues', (_name, make) => {
        expect(validate(make())).toEqual([]);
    });

    it('accepts openings exactly at both wall ends and values on the range limits', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { offset: 450, width: 900 });
        addOpening(doc, O(2), W(1), { offset: 4550, width: 900 });
        doc.walls[W(2)]!.thickness = 50;
        doc.walls[W(3)]!.thickness = 1000;
        doc.walls[W(2)]!.height = 300;
        doc.walls[W(3)]!.height = 10000;
        addOpening(doc, O(3), W(4), {
            offset: 2000,
            width: 6000,
            sillHeight: 0,
            height: 300,
        });
        addOpening(doc, O(4), W(3), {
            offset: 2500,
            width: 300,
            sillHeight: 3000,
            height: 300,
        });
        doc.nodes[N(1)]!.x = -1_000_000;
        doc.nodes[N(2)]!.y = 1_000_000;
        expect(
            validate(doc).filter(
                (i) => i.code !== 'plan.opening_out_of_bounds',
            ),
        ).toEqual([]);
    });
});

describe('validatePlan on the dirty import fixture', () => {
    it('reports its crossing walls, orphan node and out-of-bounds window', () => {
        const issues = validate(makeDirtyPlan());
        expect(issues.map((i) => [i.code, i.severity])).toEqual([
            ['plan.orphan_node', 'warning'],
            ['plan.opening_out_of_bounds', 'error'],
            ['plan.walls_intersect', 'warning'],
        ]);
    });
});

describe('validatePlan: issue shape', () => {
    it('produces IssueSchema-valid issues with the plan_editor key pattern', () => {
        const doc = rect();
        addNode(doc, N(9), 9000, 9000);
        addOpening(doc, O(1), 'w_missing000');
        const issues = validate(doc);
        expect(issues.length).toBe(2);
        for (const issue of issues) {
            expect(IssueSchema.parse(issue)).toEqual(issue);
            expect(issue.messageKey).toBe(
                'plan_editor.issues.' + issue.code.replace(/^plan\./, ''),
            );
            expect(PLAN_ISSUE_CODES).toContain(issue.code);
        }
    });
});

describe('plan.node_missing', () => {
    it('flags a wall whose node does not exist (error)', () => {
        const doc = rect();
        doc.walls[W(1)]!.b = 'n_gone000000';
        expect(single(doc, 'plan.node_missing')).toEqual({
            code: 'plan.node_missing',
            severity: 'error',
            messageKey: 'plan_editor.issues.node_missing',
            params: { wallId: W(1), nodeId: 'n_gone000000', end: 'b' },
            entityIds: [W(1)],
        });
    });

    it('reports each missing end', () => {
        const doc = rect();
        doc.walls[W(1)]!.a = 'n_gone000001';
        doc.walls[W(1)]!.b = 'n_gone000002';
        const issues = only(validate(doc), 'plan.node_missing');
        expect(issues.map((i) => i.params.end)).toEqual(['a', 'b']);
    });
});

describe('plan.wall_degenerate', () => {
    it('flags a 9 mm wall (error) but not a 10 mm wall', () => {
        const doc = rect();
        addNode(doc, N(5), 10_000, 0);
        addNode(doc, N(6), 10_009, 0);
        addWall(doc, W(5), N(5), N(6));
        expect(single(doc, 'plan.wall_degenerate')).toEqual({
            code: 'plan.wall_degenerate',
            severity: 'error',
            messageKey: 'plan_editor.issues.wall_degenerate',
            params: { wallId: W(5), length: 9 },
            entityIds: [W(5)],
        });
        doc.nodes[N(6)]!.x = 10_010;
        expect(validate(doc)).toEqual([]);
    });

    it('flags a wall whose two ends are the same node', () => {
        const doc = rect();
        addWall(doc, W(5), N(1), N(1));
        const issue = single(doc, 'plan.wall_degenerate');
        expect(issue.severity).toBe('error');
        expect(issue.entityIds).toEqual([W(5)]);
        expect(issue.params).toEqual({ wallId: W(5), length: 0 });
    });

    it('does not double-report a wall with a missing node', () => {
        const doc = rect();
        doc.walls[W(1)]!.a = 'n_gone000000';
        expect(validate(doc).map((i) => i.code)).toEqual(['plan.node_missing']);
    });
});

describe('plan.wall_duplicate', () => {
    it('flags two walls on the same unordered node pair (error)', () => {
        const doc = rect();
        addWall(doc, W(5), N(2), N(1)); // reversed
        expect(single(doc, 'plan.wall_duplicate')).toEqual({
            code: 'plan.wall_duplicate',
            severity: 'error',
            messageKey: 'plan_editor.issues.wall_duplicate',
            params: { nodeA: N(1), nodeB: N(2), count: 2 },
            entityIds: [W(1), W(5)],
        });
    });

    it('reports a group of three once', () => {
        const doc = rect();
        addWall(doc, W(5), N(1), N(2));
        addWall(doc, W(6), N(2), N(1));
        const issues = only(validate(doc), 'plan.wall_duplicate');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.entityIds).toEqual([W(1), W(5), W(6)]);
        expect(issues[0]!.params.count).toBe(3);
    });
});

describe('plan.orphan_node', () => {
    it('flags a node no wall references (warning)', () => {
        const doc = rect();
        addNode(doc, N(9), 9000, 9000);
        expect(single(doc, 'plan.orphan_node')).toEqual({
            code: 'plan.orphan_node',
            severity: 'warning',
            messageKey: 'plan_editor.issues.orphan_node',
            params: { nodeId: N(9) },
            entityIds: [N(9)],
        });
    });
});

describe('plan.opening_wall_missing', () => {
    it('flags an opening on a missing wall (error)', () => {
        const doc = rect();
        addOpening(doc, O(1), 'w_gone000000');
        expect(single(doc, 'plan.opening_wall_missing')).toEqual({
            code: 'plan.opening_wall_missing',
            severity: 'error',
            messageKey: 'plan_editor.issues.opening_wall_missing',
            params: {
                wallId: 'w_gone000000',
                field: 'opening.wallId',
            },
            entityIds: [O(1)],
        });
    });

    it('flags a placement wallAttachment to a missing wall', () => {
        const doc = rect();
        doc.placements['f_0000000001'] = {
            id: 'f_0000000001',
            designId: 'design-1',
            x: 100,
            y: 100,
            rotation: 0,
            elevation: 0,
            mirrored: false,
            wallAttachment: { wallId: 'w_gone000000', side: 'left' },
        };
        const issue = single(doc, 'plan.opening_wall_missing');
        expect(issue.severity).toBe('error');
        expect(issue.entityIds).toEqual(['f_0000000001']);
        expect(issue.params).toEqual({
            wallId: 'w_gone000000',
            field: 'placement.wallAttachment.wallId',
        });
        doc.placements['f_0000000001']!.wallAttachment = {
            wallId: W(1),
            side: 'left',
        };
        expect(validate(doc)).toEqual([]);
    });

    it('flags a dimension attachedTo a missing wall', () => {
        const doc = rect();
        doc.annotations.dimensions['d_0000000001'] = {
            id: 'd_0000000001',
            a: { x: 0, y: 0 },
            b: { x: 1000, y: 0 },
            offset: 300,
            attachedTo: { kind: 'wall', wallId: 'w_gone000000', face: 'left' },
        };
        const issue = single(doc, 'plan.opening_wall_missing');
        expect(issue.entityIds).toEqual(['d_0000000001']);
        expect(issue.params.field).toBe('dimension.attachedTo.wallId');
        doc.annotations.dimensions['d_0000000001']!.attachedTo = {
            kind: 'wall',
            wallId: W(2),
            face: 'center',
        };
        expect(validate(doc)).toEqual([]);
    });

    it('reports no bounds/height issues for an opening on a missing wall', () => {
        const doc = rect();
        addOpening(doc, O(1), 'w_gone000000', { sillHeight: 3000 });
        expect(validate(doc).map((i) => i.code)).toEqual([
            'plan.opening_wall_missing',
        ]);
    });
});

describe('plan.opening_out_of_bounds', () => {
    it('flags width/2 > offset (error)', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { offset: 449, width: 900 });
        expect(single(doc, 'plan.opening_out_of_bounds')).toEqual({
            code: 'plan.opening_out_of_bounds',
            severity: 'error',
            messageKey: 'plan_editor.issues.opening_out_of_bounds',
            params: { wallId: W(1), offset: 449, width: 900, wallLength: 5000 },
            entityIds: [O(1)],
        });
    });

    it('flags offset > wallLength - width/2', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { offset: 4551, width: 900 });
        expect(single(doc, 'plan.opening_out_of_bounds').entityIds).toEqual([
            O(1),
        ]);
    });

    it('uses the centre-line length of a diagonal wall', () => {
        const doc = emptyPlan();
        addNode(doc, N(1), 0, 0);
        addNode(doc, N(2), 3000, 4000); // length 5000
        addWall(doc, W(1), N(1), N(2));
        addOpening(doc, O(1), W(1), { offset: 4550, width: 900 });
        expect(validate(doc)).toEqual([]);
        doc.openings[O(1)]!.offset = 4551;
        expect(single(doc, 'plan.opening_out_of_bounds').entityIds).toEqual([
            O(1),
        ]);
    });
});

describe('plan.opening_overlap', () => {
    it('allows touching openings (gap 0) and flags a 1 mm overlap (error)', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { offset: 1000, width: 600 }); // 700..1300
        addOpening(doc, O(2), W(1), { offset: 1600, width: 600 }); // 1300..1900
        expect(validate(doc)).toEqual([]);
        doc.openings[O(2)]!.offset = 1599; // 1299..1899
        expect(single(doc, 'plan.opening_overlap')).toEqual({
            code: 'plan.opening_overlap',
            severity: 'error',
            messageKey: 'plan_editor.issues.opening_overlap',
            params: { wallId: W(1), overlap: 1 },
            entityIds: [O(1), O(2)],
        });
    });

    it('ignores openings on different walls and finds overlaps beyond the neighbour', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { offset: 2000, width: 3000 }); // 500..3500
        addOpening(doc, O(2), W(1), { offset: 800, width: 400 }); // 600..1000
        addOpening(doc, O(3), W(1), { offset: 3000, width: 400 }); // 2800..3200
        addOpening(doc, O(4), W(2), { offset: 2000, width: 3000 });
        const pairs = only(validate(doc), 'plan.opening_overlap').map(
            (i) => i.entityIds,
        );
        expect(pairs).toEqual([
            [O(1), O(2)],
            [O(1), O(3)],
        ]);
    });
});

describe('plan.opening_too_tall', () => {
    it('flags sillHeight + height > wall.height (error)', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), {
            kind: 'window',
            type: 'casement',
            sillHeight: 900,
            height: 1801,
        });
        expect(single(doc, 'plan.opening_too_tall')).toEqual({
            code: 'plan.opening_too_tall',
            severity: 'error',
            messageKey: 'plan_editor.issues.opening_too_tall',
            params: {
                wallId: W(1),
                sillHeight: 900,
                height: 1801,
                wallHeight: 2700,
            },
            entityIds: [O(1)],
        });
        doc.openings[O(1)]!.height = 1800;
        expect(validate(doc)).toEqual([]);
    });
});

describe('plan.walls_intersect', () => {
    function crossed(): PlanDocument {
        const doc = rect();
        addNode(doc, N(5), 1000, 1000);
        addNode(doc, N(6), 4000, 3000);
        addNode(doc, N(7), 1000, 3000);
        addNode(doc, N(8), 4000, 1000);
        addWall(doc, W(5), N(5), N(6));
        addWall(doc, W(6), N(7), N(8));
        return doc;
    }

    it('flags walls crossing without a shared node (warning, both ids)', () => {
        expect(single(crossed(), 'plan.walls_intersect')).toEqual({
            code: 'plan.walls_intersect',
            severity: 'warning',
            messageKey: 'plan_editor.issues.walls_intersect',
            params: { x: 2500, y: 2000 },
            entityIds: [W(5), W(6)],
        });
    });

    it('does not flag walls that meet at a shared node', () => {
        // Every grid junction is a shared node; also an explicit star of 3 walls.
        const doc = rect();
        addNode(doc, N(5), 2500, 2000);
        addWall(doc, W(5), N(1), N(5));
        addWall(doc, W(6), N(3), N(5));
        addWall(doc, W(7), N(2), N(5));
        expect(validate(doc)).toEqual([]);
        expect(validate(makeGridPlan(3, 3))).toEqual([]);
    });

    it("does not flag a T-junction whose endpoint node lies on the other wall's interior", () => {
        const doc = rect();
        addNode(doc, N(5), 2500, 0); // on wall 1's interior, not a vertex of wall 1
        addNode(doc, N(6), 2500, 4000); // on wall 3's interior
        addWall(doc, W(5), N(5), N(6));
        expect(validate(doc)).toEqual([]);
    });

    it('does not flag distinct nodes at the same coordinates meeting end to end', () => {
        const doc = rect();
        addNode(doc, N(5), 0, 0); // same spot as n1
        addNode(doc, N(6), 0, -2000);
        addWall(doc, W(5), N(5), N(6));
        expect(validate(doc)).toEqual([]);
    });

    it('does not report collinear overlaps (04 §6.4 counts only point crossings)', () => {
        const doc = rect();
        addNode(doc, N(5), 1000, 0);
        addNode(doc, N(6), 3000, 0);
        addWall(doc, W(5), N(5), N(6));
        expect(only(validate(doc), 'plan.walls_intersect')).toEqual([]);
    });

    it('reports each crossing pair once', () => {
        const doc = crossed();
        addNode(doc, N(9), 2500, 500);
        addNode(doc, N(10), 2500, 3500);
        addWall(doc, W(7), N(9), N(10)); // crosses both diagonals at (2500, 2000)
        const pairs = only(validate(doc), 'plan.walls_intersect').map(
            (i) => i.entityIds,
        );
        expect(pairs).toEqual([
            [W(5), W(6)],
            [W(5), W(7)],
            [W(6), W(7)],
        ]);
    });
});

describe('plan.room_anchor_outside', () => {
    it('flags a meta anchored in no face (warning) and accepts one inside a room', () => {
        const doc = rect();
        addMeta(doc, R(1), 2500, 2000);
        expect(validate(doc)).toEqual([]);
        addMeta(doc, R(2), -5000, -5000);
        expect(single(doc, 'plan.room_anchor_outside')).toEqual({
            code: 'plan.room_anchor_outside',
            severity: 'warning',
            messageKey: 'plan_editor.issues.room_anchor_outside',
            params: { x: -5000, y: -5000 },
            entityIds: [R(2)],
        });
    });

    it('treats an anchor on a wall centre line as outside', () => {
        const doc = rect();
        addMeta(doc, R(1), 2500, 0);
        expect(single(doc, 'plan.room_anchor_outside').entityIds).toEqual([
            R(1),
        ]);
    });

    it('treats an anchor inside a hole as outside, exactly like room association', () => {
        // A 10 x 10 m room around a tiny 300 x 300 closed box: the box's face
        // is below the minimum room area, so its interior is a hole of the room
        // and belongs to no room.
        const doc = makeRectPlan(10_000, 10_000, 230);
        const pts: Array<[number, number]> = [
            [4000, 4000],
            [4300, 4000],
            [4300, 4300],
            [4000, 4300],
        ];
        pts.forEach(([x, y], i) => addNode(doc, N(10 + i), x, y));
        pts.forEach((_p, i) =>
            addWall(doc, W(10 + i), N(10 + i), N(10 + ((i + 1) % 4))),
        );
        const geom = derivePlanGeometry(doc);
        expect(geom.rooms).toHaveLength(1);
        expect(geom.rooms[0]!.facePolygon.holes).toHaveLength(1);
        addMeta(doc, R(1), 4150, 4150);
        addMeta(doc, R(2), 2000, 2000);
        const issues = validate(doc);
        expect(
            only(issues, 'plan.room_anchor_outside').map((i) => i.entityIds),
        ).toEqual([[R(1)]]);
        // Association agrees: only the second meta is attached to a room.
        const attached = derivePlanGeometry(doc).rooms.map((r) => r.metaId);
        expect(attached).toEqual([R(2)]);
    });

    it('uses the supplied geometry when given', () => {
        const doc = rect();
        addMeta(doc, R(1), 2500, 2000);
        expect(validatePlan(doc, derivePlanGeometry(doc))).toEqual([]);
        // The supplied geometry is what anchors are tested against.
        const bare = derivePlanGeometry(emptyPlan());
        expect(
            validatePlan(structuredClone(doc), bare).map((i) => i.code),
        ).toEqual(['plan.room_anchor_outside']);
    });
});

describe('plan.too_large', () => {
    function bulkWalls(doc: PlanDocument, count: number): void {
        for (let i = 0; i < count; i += 1) {
            const a = `n_a${String(i).padStart(8, '0')}`;
            const b = `n_b${String(i).padStart(8, '0')}`;
            addNode(doc, a, 0, i * 100);
            addNode(doc, b, 1000, i * 100);
            addWall(doc, `w_${String(i + 1).padStart(10, '0')}`, a, b);
        }
    }

    it('accepts 2000 walls and flags 2001 (error, kind walls)', () => {
        const doc = emptyPlan();
        bulkWalls(doc, 2000);
        expect(only(validate(doc), 'plan.too_large')).toEqual([]);
        const bigger = emptyPlan();
        bulkWalls(bigger, 2001);
        const issues = only(validate(bigger), 'plan.too_large');
        expect(issues).toEqual([
            {
                code: 'plan.too_large',
                severity: 'error',
                messageKey: 'plan_editor.issues.too_large',
                params: { kind: 'walls', count: 2001, max: 2000 },
                entityIds: [],
            },
        ]);
    });

    it('flags > 1000 openings, > 500 placements, > 1000 fixtures', () => {
        const doc = rect();
        for (let i = 1; i <= 1001; i += 1) {
            addOpening(doc, `o_${String(i).padStart(10, '0')}`, W(1), {
                offset: 2500,
            });
        }
        for (let i = 1; i <= 501; i += 1) {
            const id = `f_${String(i).padStart(10, '0')}`;
            doc.placements[id] = {
                id,
                designId: 'd',
                x: 0,
                y: 0,
                rotation: 0,
                elevation: 0,
                mirrored: false,
                wallAttachment: null,
            };
        }
        for (let i = 1; i <= 1001; i += 1) {
            const id = `x_${String(i).padStart(10, '0')}`;
            doc.fixtures[id] = {
                id,
                libraryKey: 'wc',
                x: 0,
                y: 0,
                rotation: 0,
                width: 400,
                depth: 600,
                height: 800,
                elevation: 0,
                label: null,
            };
        }
        const kinds = only(validate(doc), 'plan.too_large').map(
            (i) => i.params.kind,
        );
        expect(kinds).toEqual(['openings', 'placements', 'fixtures']);
    });

    it('flags JSON over 2 MiB measured in UTF-8 bytes (error, kind json)', () => {
        const doc = rect();
        const label = (text: string): void => {
            doc.annotations.labels['t_0000000001'] = {
                id: 't_0000000001',
                position: { x: 0, y: 0 },
                text,
                fontSize: 250,
                rotation: 0,
            };
        };
        // ~2.0 MB of ASCII: under the limit.
        label('x'.repeat(2_000_000));
        expect(only(validate(doc), 'plan.too_large')).toEqual([]);
        // 700 000 three-byte characters: fewer than 2 097 152 characters, more bytes.
        label('€'.repeat(700_000));
        const issues = only(validate(doc), 'plan.too_large');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.params.kind).toBe('json');
        expect(issues[0]!.params.max).toBe(2_097_152);
        expect(issues[0]!.params.count as number).toBeGreaterThan(2_097_152);
    });
});

describe('plan.value_out_of_range', () => {
    function rangeIssue(doc: PlanDocument): Issue {
        return single(doc, 'plan.value_out_of_range');
    }

    it('flags wall thickness 49 (min 50, max 1000)', () => {
        const doc = rect();
        doc.walls[W(1)]!.thickness = 49;
        expect(rangeIssue(doc)).toEqual({
            code: 'plan.value_out_of_range',
            severity: 'error',
            messageKey: 'plan_editor.issues.value_out_of_range',
            params: { field: 'wall.thickness', min: 50, max: 1000 },
            entityIds: [W(1)],
        });
        doc.walls[W(1)]!.thickness = 1001;
        expect(rangeIssue(doc).params).toEqual({
            field: 'wall.thickness',
            min: 50,
            max: 1000,
        });
    });

    it('flags wall height 10 001 (300..10000)', () => {
        const doc = rect();
        doc.walls[W(2)]!.height = 10_001;
        const issue = rangeIssue(doc);
        expect(issue.params).toEqual({
            field: 'wall.height',
            min: 300,
            max: 10_000,
        });
        expect(issue.entityIds).toEqual([W(2)]);
        doc.walls[W(2)]!.height = 299;
        expect(rangeIssue(doc).params.field).toBe('wall.height');
    });

    it('flags opening width 299 (300..6000)', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { width: 299 });
        const issue = rangeIssue(doc);
        expect(issue.params).toEqual({
            field: 'opening.width',
            min: 300,
            max: 6000,
        });
        expect(issue.entityIds).toEqual([O(1)]);
    });

    it('flags opening sill 3001 (0..3000)', () => {
        const doc = rect();
        addOpening(doc, O(1), W(1), { sillHeight: 3001, height: 300 });
        // 3001 + 300 also exceeds the 2700 mm wall: select by code.
        const issues = only(validate(doc), 'plan.value_out_of_range');
        expect(issues).toHaveLength(1);
        expect(issues[0]!.params).toEqual({
            field: 'opening.sillHeight',
            min: 0,
            max: 3000,
        });
        doc.openings[O(1)]!.sillHeight = -1;
        expect(
            only(validate(doc), 'plan.value_out_of_range')[0]!.params.field,
        ).toBe('opening.sillHeight');
    });

    it('flags a node coordinate of 1 000 001 (±1 000 000)', () => {
        const doc = rect();
        addNode(doc, N(5), 1_000_001, 0);
        addWall(doc, W(5), N(1), N(5));
        const issues = only(validate(doc), 'plan.value_out_of_range');
        expect(issues).toEqual([
            {
                code: 'plan.value_out_of_range',
                severity: 'error',
                messageKey: 'plan_editor.issues.value_out_of_range',
                params: { field: 'node.x', min: -1_000_000, max: 1_000_000 },
                entityIds: [N(5)],
            },
        ]);
        doc.nodes[N(5)]!.x = -1_000_001;
        expect(
            only(validate(doc), 'plan.value_out_of_range')[0]!.params.field,
        ).toBe('node.x');
    });

    it('checks the coordinates of other positioned entities', () => {
        const doc = rect();
        addMeta(doc, R(1), 2500, 2000);
        doc.rooms[R(1)]!.anchor = { x: 2500, y: 2_000_000 };
        doc.fixtures['x_0000000001'] = {
            id: 'x_0000000001',
            libraryKey: 'wc',
            x: -2_000_000,
            y: 0,
            rotation: 0,
            width: 400,
            depth: 600,
            height: 800,
            elevation: 0,
            label: null,
        };
        const fields = only(validate(doc), 'plan.value_out_of_range').map(
            (i) => i.params.field,
        );
        expect(fields.sort()).toEqual(['fixture.x', 'room.anchor.y']);
    });

    it('flags background mmPerPixel <= 0 or non-finite', () => {
        const doc = rect();
        doc.background = {
            importId: null,
            mediaUuid: 'u',
            pixelWidth: 100,
            pixelHeight: 100,
            mmPerPixel: 1.5,
            position: { x: 0, y: 0 },
            rotation: 0,
            opacity: 0.5,
            visible: true,
            locked: false,
        };
        expect(validate(doc)).toEqual([]);
        for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
            doc.background.mmPerPixel = bad;
            const issue = rangeIssue(doc);
            expect(issue.severity).toBe('error');
            expect(issue.params.field).toBe('background.mmPerPixel');
            expect(issue.params.min).toBe(0);
            expect(issue.entityIds).toEqual([]);
        }
    });

    it('treats NaN as out of range', () => {
        const doc = rect();
        doc.walls[W(1)]!.thickness = Number.NaN;
        expect(rangeIssue(doc).params.field).toBe('wall.thickness');
    });
});

describe('validatePlan memoisation', () => {
    it('returns the same array for the same document identity', () => {
        const doc = rect();
        expect(validatePlan(doc)).toBe(validatePlan(doc));
    });

    it('does not mix up documents and keeps only the last four', () => {
        const docs = [0, 1, 2, 3, 4].map(() => rect());
        const first = validatePlan(docs[0]!);
        expect(validatePlan(docs[0]!)).toBe(first);
        for (const d of docs.slice(1, 4)) validatePlan(d);
        expect(validatePlan(docs[0]!)).toBe(first); // 4 live entries
        validatePlan(docs[4]!); // evicts the least recently used (docs[1])
        expect(validatePlan(docs[0]!)).toBe(first); // refreshed above, still cached
        const second = validatePlan(docs[1]!);
        expect(second).toEqual(first);
    });

    it('evicts the least recently used entry beyond four documents', () => {
        const docs = [0, 1, 2, 3, 4].map(() => rect());
        const first = validatePlan(docs[0]!);
        for (const d of docs.slice(1)) validatePlan(d);
        expect(validatePlan(docs[0]!)).not.toBe(first);
        expect(validatePlan(docs[0]!)).toEqual(first);
    });

    it('treats a modified copy as a different document', () => {
        const doc = rect();
        const before = validatePlan(doc);
        const next = { ...doc, nodes: { ...doc.nodes } };
        addNode(next, N(9), 9000, 9000);
        expect(before).toEqual([]);
        expect(validatePlan(next).map((i) => i.code)).toEqual([
            'plan.orphan_node',
        ]);
        expect(validatePlan(doc)).toBe(before);
    });
});

describe('planErrorKeys', () => {
    it('keeps only errors, as code|sorted entity ids', () => {
        const issues: Issue[] = [
            {
                code: 'plan.wall_duplicate',
                severity: 'error',
                messageKey: 'plan_editor.issues.wall_duplicate',
                params: {},
                entityIds: ['w_b', 'w_a'],
            },
            {
                code: 'plan.orphan_node',
                severity: 'warning',
                messageKey: 'plan_editor.issues.orphan_node',
                params: {},
                entityIds: ['n_1'],
            },
            {
                code: 'plan.too_large',
                severity: 'error',
                messageKey: 'plan_editor.issues.too_large',
                params: {},
                entityIds: [],
            },
        ];
        expect(planErrorKeys(issues)).toEqual(
            new Set(['plan.wall_duplicate|w_a,w_b', 'plan.too_large|']),
        );
    });

    it('works on real validation output', () => {
        const doc = rect();
        addOpening(doc, O(1), 'w_gone000000');
        addNode(doc, N(9), 0, 9000);
        expect([...planErrorKeys(validate(doc))]).toEqual([
            `plan.opening_wall_missing|${O(1)}`,
        ]);
    });
});

describe('removeOrphanNodes', () => {
    it('drops only unreferenced nodes and leaves the input untouched', () => {
        const doc = rect();
        addNode(doc, N(9), 9000, 9000);
        const snapshot = structuredClone(doc);
        const cleaned = removeOrphanNodes(doc);
        expect(doc).toEqual(snapshot);
        expect(Object.keys(cleaned.nodes).sort()).toEqual([
            N(1),
            N(2),
            N(3),
            N(4),
        ]);
        expect(cleaned.walls).toBe(doc.walls);
        expect(validate(cleaned)).toEqual([]);
    });

    it('returns the same document when nothing is orphaned', () => {
        const doc = rect();
        expect(removeOrphanNodes(doc)).toBe(doc);
    });
});
