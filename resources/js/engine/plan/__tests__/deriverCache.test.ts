import { create, type Draft as MutativeDraft } from 'mutative';
import { describe, expect, it } from 'vitest';
import { createPlanDeriver, derivePlanGeometry } from '../derive';
import type { Opening, PlanDocument, RoomMeta, Wall } from '../schema';
import {
    makeDirtyPlan,
    makeGridPlan,
    makeLPlan,
    makeRectPlan,
} from '../testing/fixtures';

/** Deep equality with a tolerance on numbers; `docRef` is compared by identity. */
function expectGeomClose(actual: unknown, expected: unknown, path = ''): void {
    if (typeof expected === 'number') {
        expect(typeof actual, path).toBe('number');
        expect(Math.abs((actual as number) - expected), path).toBeLessThan(
            1e-6,
        );
        return;
    }
    if (Array.isArray(expected)) {
        expect(Array.isArray(actual), path).toBe(true);
        const a = actual as unknown[];
        expect(a.length, path).toBe(expected.length);
        expected.forEach((e, i) => expectGeomClose(a[i], e, `${path}[${i}]`));
        return;
    }
    if (expected !== null && typeof expected === 'object') {
        expect(actual, path).not.toBeNull();
        expect(typeof actual, path).toBe('object');
        const a = actual as Record<string, unknown>;
        const e = expected as Record<string, unknown>;
        expect(Object.keys(a).sort(), path).toEqual(Object.keys(e).sort());
        for (const k of Object.keys(e)) {
            if (k === 'docRef') expect(a[k], path).toBe(e[k]);
            else expectGeomClose(a[k], e[k], `${path}.${k}`);
        }
        return;
    }
    expect(actual, path).toBe(expected);
}

const nodeAt = (doc: PlanDocument, x: number, y: number): string =>
    Object.values(doc.nodes).find((n) => n.x === x && n.y === y)!.id;

function meta(id: string, x: number, y: number): RoomMeta {
    return {
        id,
        anchor: { x, y },
        name: id,
        type: 'bedroom',
        floorFinish: 'tile',
        floorColorHex: null,
        labelOffset: null,
        showArea: true,
    };
}

describe('createPlanDeriver', () => {
    it('returns the identical result for the same document', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        expect(deriver.stats().fullHit).toBe(false);
        const second = deriver.derive(doc);
        expect(second).toBe(first);
        expect(deriver.stats()).toEqual({
            joins: 0,
            outlines: 0,
            roomNets: 0,
            fullHit: true,
        });
    });

    it('is a full hit when only placements or view change', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        const next = create(doc, (d) => {
            d.view.lastMode = '3d';
            d.meta.northAngle = 15;
        });
        expect(next).not.toBe(doc);
        const second = deriver.derive(next);
        expect(deriver.stats().fullHit).toBe(true);
        expect(second.docRef).toBe(next);
        expect(first.docRef).toBe(doc);
        expect({ ...second, docRef: doc }).toEqual({ ...first });
        expect(second.walls).toBe(first.walls);
        expect(second.rooms).toBe(first.rooms);
    });

    it('recomputes only the association when only rooms change', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        expect(first.rooms.every((r) => r.metaId === null)).toBe(true);

        const next = create(doc, (d) => {
            d.rooms['r_a'] = meta('r_a', 1500, 1500);
        });
        const second = deriver.derive(next);
        expect(deriver.stats()).toEqual({
            joins: 0,
            outlines: 0,
            roomNets: 0,
            fullHit: false,
        });
        expect(second.walls).toBe(first.walls);
        expect(second.wallsUnion).toBe(first.wallsUnion);
        expect(second.rooms.filter((r) => r.metaId === 'r_a')).toHaveLength(1);
        expect(second.roomIndexByMetaId['r_a']).toBeDefined();
        expectGeomClose(second, derivePlanGeometry(next));
    });

    it('recomputes only the neighbourhood of a moved node', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        deriver.derive(doc);
        const id = nodeAt(doc, 9000, 9000);
        const next = create(doc, (d) => {
            d.nodes[id]!.x += 400;
            d.nodes[id]!.y -= 250;
        });
        const result = deriver.derive(next);
        const stats = deriver.stats();
        expect(stats.fullHit).toBe(false);
        // the node and its four neighbours
        expect(stats.joins).toBeLessThanOrEqual(5);
        expect(stats.joins).toBeGreaterThan(0);
        // the rooms touching the node or one of its neighbours (12 of 42)
        expect(stats.roomNets).toBeGreaterThanOrEqual(4);
        expect(stats.roomNets).toBeLessThanOrEqual(16);
        expect(result.rooms).toHaveLength(42);
        expectGeomClose(result, derivePlanGeometry(next));
    });

    it('recomputes a single wall when an opening is added', () => {
        const doc = makeGridPlan(7, 6);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        const wallId = Object.keys(doc.walls).sort()[5]!;
        const next = create(doc, (d) => {
            d.openings['o_new'] = {
                id: 'o_new',
                wallId,
                kind: 'window',
                type: 'fixed',
                offset: 1500,
                width: 1000,
                height: 1200,
                sillHeight: 900,
                hinge: 'start',
                swing: 'left',
                label: null,
            };
        });
        const second = deriver.derive(next);
        expect(deriver.stats()).toEqual({
            joins: 0,
            outlines: 1,
            roomNets: 0,
            fullHit: false,
        });
        expect(second.openings['o_new']).toBeDefined();
        expect(second.walls[wallId]!.openings.map((o) => o.id)).toContain(
            'o_new',
        );
        // outlines are untouched, so neighbours and the union are reused
        const other = Object.keys(doc.walls).sort()[6]!;
        expect(second.walls[other]!.outline).toBe(first.walls[other]!.outline);
        expect(second.wallsUnion).toBe(first.wallsUnion);
        expectGeomClose(second, derivePlanGeometry(next));
    });

    it('recomputes when a wall is thickened and when a wall is removed', () => {
        const doc = makeGridPlan(3, 3);
        const deriver = createPlanDeriver();
        deriver.derive(doc);
        const interior = Object.values(doc.walls).find(
            (w) => w.kind === 'interior',
        )!;
        const thicker = create(doc, (d) => {
            d.walls[interior.id]!.thickness = 200;
        });
        expectGeomClose(deriver.derive(thicker), derivePlanGeometry(thicker));
        expect(deriver.stats().outlines).toBeGreaterThan(0);
        const removed = create(thicker, (d) => {
            delete d.walls[interior.id];
        });
        const result = deriver.derive(removed);
        expect(result.rooms.length).toBeLessThan(9);
        expectGeomClose(result, derivePlanGeometry(removed));
    });

    it('clear() forces a full recompute', () => {
        const doc = makeGridPlan(4, 3);
        const deriver = createPlanDeriver();
        const first = deriver.derive(doc);
        deriver.clear();
        const second = deriver.derive(doc);
        const stats = deriver.stats();
        expect(second).not.toBe(first);
        expect(stats.fullHit).toBe(false);
        expect(stats.joins).toBe(Object.keys(first.nodes).length);
        expect(stats.outlines).toBe(Object.keys(first.walls).length);
        expect(stats.roomNets).toBe(first.rooms.length);
        expectGeomClose(second, first);
    });

    it('does not mix up documents that share nothing', () => {
        const deriver = createPlanDeriver();
        const a = makeRectPlan(5000, 4000, 230);
        const b = makeGridPlan(2, 2);
        expectGeomClose(deriver.derive(a), derivePlanGeometry(a));
        expectGeomClose(deriver.derive(b), derivePlanGeometry(b));
        expectGeomClose(deriver.derive(a), derivePlanGeometry(a));
    });
});

type Draft = MutativeDraft<PlanDocument>;

function opening(
    id: string,
    wallId: string,
    spec: Partial<Opening> = {},
): Opening {
    return {
        id,
        wallId,
        kind: 'door',
        type: 'single_swing',
        offset: 1500,
        width: 900,
        height: 2100,
        sillHeight: 0,
        hinge: 'start',
        swing: 'left',
        label: null,
        ...spec,
    };
}

/** Feeds `edits` to one long-lived deriver; each step must equal a fresh derive. */
function expectEditsMatchFresh(
    doc: PlanDocument,
    edits: Array<(d: Draft) => void>,
): void {
    const deriver = createPlanDeriver();
    expect(deriver.derive(doc)).toEqual(derivePlanGeometry(doc));
    let cur = doc;
    edits.forEach((edit, i) => {
        const next = create(cur, edit);
        expect(next, `edit ${i} changes the document`).not.toBe(cur);
        expect(deriver.derive(next), `edit ${i}`).toEqual(
            derivePlanGeometry(next),
        );
        cur = next;
    });
}

describe('createPlanDeriver edits', () => {
    const wallIds = (doc: PlanDocument): string[] =>
        Object.keys(doc.walls).sort();

    it('follows non-geometric wall edits (height, kind, material, colour)', () => {
        const doc = makeGridPlan(3, 2);
        const [w0, w1] = wallIds(doc) as [string, string];
        expectEditsMatchFresh(doc, [
            (d) => {
                d.walls[w0]!.height = 3100;
            },
            (d) => {
                d.walls[w0]!.kind = 'partition';
            },
            (d) => {
                d.walls[w1]!.material = 'concrete';
            },
            (d) => {
                d.walls[w1]!.colorHex = '#112233';
            },
        ]);
        const deriver = createPlanDeriver();
        deriver.derive(doc);
        const next = create(doc, (d) => {
            d.walls[w0]!.height = 3100;
            d.walls[w0]!.kind = 'partition';
        });
        const plan = deriver.derive(next);
        expect(plan.walls[w0]!.height).toBe(3100);
        expect(plan.walls[w0]!.kind).toBe('partition');
    });

    it('follows opening move, resize, delete and reassignment', () => {
        const doc = create(makeRectPlan(6000, 4000, 230), (d) => {
            const ids = Object.keys(d.walls).sort();
            d.openings['o_a'] = opening('o_a', ids[0]!);
            d.openings['o_b'] = opening('o_b', ids[0]!, {
                kind: 'window',
                type: 'fixed',
                offset: 4000,
            });
        });
        const [w0, w1] = wallIds(doc) as [string, string];
        expectEditsMatchFresh(doc, [
            (d) => {
                d.openings['o_a']!.offset = 1000;
            },
            (d) => {
                d.openings['o_a']!.width = 1400;
            },
            (d) => {
                d.openings['o_a']!.wallId = w1;
            },
            (d) => {
                d.openings['o_a']!.wallId = w0;
                d.openings['o_a']!.offset = 5900;
            },
            (d) => {
                delete d.openings['o_b'];
            },
            (d) => {
                d.openings['o_a']!.wallId = 'w_missing';
            },
            (d) => {
                delete d.openings['o_a'];
            },
        ]);
    });

    it('follows added walls (also crossing), removed walls and removed nodes', () => {
        const doc = makeGridPlan(3, 2);
        const nodes = Object.keys(doc.nodes).sort();
        const [w0] = wallIds(doc) as [string];
        expectEditsMatchFresh(doc, [
            (d) => {
                d.nodes['n_x1'] = { id: 'n_x1', x: -500, y: 1500 };
                d.nodes['n_x2'] = { id: 'n_x2', x: 9500, y: 4500 };
                d.walls['w_cross'] = {
                    id: 'w_cross',
                    a: 'n_x1',
                    b: 'n_x2',
                    thickness: 115,
                    height: 2700,
                    kind: 'interior',
                    justification: 'center',
                    material: 'brick',
                    colorHex: null,
                } satisfies Wall;
            },
            (d) => {
                d.walls['w_diag'] = {
                    id: 'w_diag',
                    a: nodes[0]!,
                    b: nodes[nodes.length - 1]!,
                    thickness: 230,
                    height: 2700,
                    kind: 'exterior',
                    justification: 'center',
                    material: 'brick',
                    colorHex: null,
                };
            },
            (d) => {
                delete d.walls['w_cross'];
            },
            (d) => {
                delete d.nodes[nodes[5]!];
            },
            (d) => {
                delete d.walls[w0];
            },
        ]);
    });

    it('follows room meta label offset, anchor move and delete', () => {
        const doc = create(makeGridPlan(3, 2), (d) => {
            d.rooms['r_a'] = meta('r_a', 1500, 1500);
            d.rooms['r_b'] = meta('r_b', 4500, 1500);
        });
        expectEditsMatchFresh(doc, [
            (d) => {
                d.rooms['r_a']!.labelOffset = { x: 200, y: -150 };
            },
            (d) => {
                d.rooms['r_a']!.anchor = { x: 4600, y: 1600 };
            },
            (d) => {
                d.rooms['r_a']!.labelOffset = null;
            },
            (d) => {
                d.rooms['r_a']!.anchor = { x: -9000, y: 0 };
            },
            (d) => {
                delete d.rooms['r_b'];
            },
        ]);
    });

    it('reverts to an earlier document object', () => {
        const doc = makeGridPlan(3, 2);
        const deriver = createPlanDeriver();
        const [w0] = wallIds(doc) as [string];
        const moved = create(doc, (d) => {
            d.walls[w0]!.height = 2200;
            d.nodes[Object.keys(d.nodes)[4]!]!.x += 300;
        });
        const before = deriver.derive(doc);
        expect(deriver.derive(moved)).toEqual(derivePlanGeometry(moved));
        const back = deriver.derive(doc);
        expect(back).toEqual(before);
        expect(back).toEqual(derivePlanGeometry(doc));
        expect(deriver.derive(moved)).toEqual(derivePlanGeometry(moved));
    });

    it('matches a fresh derive after every step of seeded random edit sequences', () => {
        const starts = [
            () => makeGridPlan(4, 3),
            () => makeLPlan(),
            () => makeDirtyPlan(),
        ];
        for (let seed = 1; seed <= 8; seed += 1) {
            const rnd = prng(seed);
            const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
            const int = (lo: number, hi: number): number =>
                lo + Math.floor(rnd() * (hi - lo + 1));
            let cur = starts[seed % starts.length]!();
            const history: PlanDocument[] = [cur];
            const deriver = createPlanDeriver();
            expect(deriver.derive(cur)).toEqual(derivePlanGeometry(cur));
            for (let step = 0; step < 30; step += 1) {
                let next: PlanDocument;
                if (rnd() < 0.1) {
                    next = pick(history);
                } else {
                    next = create(cur, (d) =>
                        randomEdit(d, step, rnd, pick, int),
                    );
                }
                const label = `seed ${seed} step ${step}`;
                expect(deriver.derive(next), label).toEqual(
                    derivePlanGeometry(next),
                );
                history.push(next);
                cur = next;
            }
        }
    });
});

/** mulberry32. */
function prng(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomEdit(
    d: Draft,
    step: number,
    rnd: () => number,
    pick: <T>(xs: T[]) => T,
    int: (lo: number, hi: number) => number,
): void {
    const nodes = Object.keys(d.nodes).sort();
    const walls = Object.keys(d.walls).sort();
    const openings = Object.keys(d.openings).sort();
    const rooms = Object.keys(d.rooms).sort();
    const op = int(0, 15);
    switch (op) {
        case 0:
        case 1:
            if (nodes.length > 0) {
                const n = d.nodes[pick(nodes)]!;
                n.x += int(-6, 6) * 100;
                n.y += int(-6, 6) * 100;
            }
            break;
        case 2:
            if (walls.length > 0) {
                d.walls[pick(walls)]!.thickness = pick([100, 115, 150, 230]);
            }
            break;
        case 3:
            if (walls.length > 0) {
                const w = d.walls[pick(walls)]!;
                w.height = pick([2400, 2700, 3000]);
                w.kind = pick(['exterior', 'interior', 'partition'] as const);
            }
            break;
        case 4:
            if (nodes.length > 1) {
                const a = pick(nodes);
                const b = pick(nodes.filter((n) => n !== a));
                d.walls[`w_r${step}`] = {
                    id: `w_r${step}`,
                    a,
                    b,
                    thickness: pick([115, 230]),
                    height: 2700,
                    kind: 'interior',
                    justification: 'center',
                    material: 'brick',
                    colorHex: null,
                };
            }
            break;
        case 5:
            if (walls.length > 0) delete d.walls[pick(walls)];
            break;
        case 6:
            if (nodes.length > 0) delete d.nodes[pick(nodes)];
            break;
        case 7:
            d.nodes[`n_r${step}`] = {
                id: `n_r${step}`,
                x: int(0, 120) * 100,
                y: int(0, 90) * 100,
            };
            break;
        case 8:
            if (walls.length > 0) {
                d.openings[`o_r${step}`] = opening(`o_r${step}`, pick(walls), {
                    offset: int(0, 40) * 100,
                    width: int(4, 15) * 100,
                });
            }
            break;
        case 9:
            if (openings.length > 0) {
                const o = d.openings[pick(openings)]!;
                o.offset = int(0, 40) * 100;
                o.width = int(4, 15) * 100;
            }
            break;
        case 10:
            if (openings.length > 0) delete d.openings[pick(openings)];
            break;
        case 11:
            if (openings.length > 0 && walls.length > 0) {
                d.openings[pick(openings)]!.wallId = pick(walls);
            }
            break;
        case 12:
            d.rooms[`r_r${step}`] = meta(
                `r_r${step}`,
                int(0, 120) * 100,
                int(0, 90) * 100,
            );
            break;
        case 13:
            if (rooms.length > 0) {
                const r = d.rooms[pick(rooms)]!;
                if (rnd() < 0.5) {
                    r.labelOffset =
                        rnd() < 0.3 ? null : { x: int(-5, 5) * 100, y: 0 };
                } else {
                    r.anchor = { x: int(0, 120) * 100, y: int(0, 90) * 100 };
                }
            }
            break;
        case 14:
            if (rooms.length > 0) delete d.rooms[pick(rooms)];
            break;
        default:
            d.view.lastMode = d.view.lastMode === '2d' ? '3d' : '2d';
    }
}
