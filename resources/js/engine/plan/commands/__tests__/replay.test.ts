import { describe, expect, it } from 'vitest';
import { CommandAbort } from '../../../commands/types';
import type { PlanDocument } from '../../schema';
import { createPlanDeriver } from '../../derive';
import { definePlanCommand } from '../define';
import {
    defaultPlanDefaults,
    executePlanCommand,
    planCommandMessage,
    type PlanRunState,
} from '../pipeline';
import { Graph, busOf, ok, planBus } from '../../testing/graph';
import { derivePlanGeometry } from '../../derive';
import { makeRectPlan } from '../../testing/fixtures';
import { testIds } from '../../../testing/ids';

// Merge-chain id replay (controller ruling, ledgered for the spec 19
// reconciliation): a `replace` merge re-runs on the drag's base, and the ids
// the first run issued are issued again.

const added = (before: object, after: object): string[] =>
    Object.keys(after).filter((id) => !Object.hasOwn(before, id));

/** A 6000 mm wall, and a free vertical wall P-Q whose end P a drag can land on it. */
function tWorld() {
    const g = new Graph();
    const a = g.node(0, 0);
    const b = g.node(6000, 0);
    const wall = g.wall(a, b);
    const p = g.node(3000, 2000);
    const q = g.node(3000, 4000);
    g.wall(p, q);
    return { wall, p, bus: busOf(g) };
}

/** One merged step of a drag of `p` onto the wall at `x`. */
const dragTo = (bus: ReturnType<typeof busOf>, nodeId: string, x: number) =>
    ok(
        bus.execute(
            'moveNode',
            { nodeId, to: { x, y: 0 }, finalize: true },
            { merge: true },
        ),
    );

describe('id replay across a replace merge', () => {
    it('setRoomMeta creating a meta, merged three times, keeps one r_ id', () => {
        const ids = testIds();
        const doc = makeRectPlan(4000, 3000, 200, ids);
        const faceKey = derivePlanGeometry(doc).rooms[0]!.faceKey;
        const bus = planBus(doc, ids);
        const results = ['H', 'Ha', 'Hall'].map(
            (name) =>
                ok(
                    bus.execute(
                        'setRoomMeta',
                        { faceKey, props: { name } },
                        { merge: true },
                    ),
                ).result,
        );
        expect(results.map((r) => r.created)).toEqual([true, true, true]);
        expect(new Set(results.map((r) => r.metaId)).size).toBe(1);
        expect(Object.keys(bus.getDoc().rooms)).toEqual([results[0]!.metaId]);
        expect(bus.getDoc().rooms[results[0]!.metaId]!.name).toBe('Hall');
        expect(bus.history().undo.length).toBe(1);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(doc);
    });

    it('a moveNode drag whose steps split a wall keeps the split node and wall ids', () => {
        const { bus, p } = tWorld();
        const start = bus.getDoc();
        const splitIds = (doc: PlanDocument) => ({
            nodes: added(start.nodes, doc.nodes),
            walls: added(start.walls, doc.walls),
        });
        dragTo(bus, p, 3000);
        const first = splitIds(bus.getDoc());
        expect(first.nodes).toHaveLength(1);
        expect(first.walls).toHaveLength(1);
        for (const x of [3500, 2000, 4200]) {
            dragTo(bus, p, x);
            expect(splitIds(bus.getDoc())).toEqual(first);
        }
        expect(bus.history().undo.length).toBe(1);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('a drag after seal() starts a new entry with fresh ids', () => {
        const { bus, p } = tWorld();
        const start = bus.getDoc();
        dragTo(bus, p, 3000);
        dragTo(bus, p, 3500);
        const first = added(start.nodes, bus.getDoc().nodes);
        bus.seal();
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
        dragTo(bus, p, 3000);
        const second = added(start.nodes, bus.getDoc().nodes);
        expect(second).toHaveLength(1);
        expect(second).not.toEqual(first);
        dragTo(bus, p, 2500);
        expect(added(start.nodes, bus.getDoc().nodes)).toEqual(second);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });

    it('draws fresh ids for prefixes or counts the first run did not use', () => {
        const { bus, p } = tWorld();
        const start = bus.getDoc();
        // step 1 only previews (finalize false): no id issued, nothing recorded
        ok(
            bus.execute(
                'moveNode',
                { nodeId: p, to: { x: 3000, y: 100 }, finalize: false },
                { merge: true },
            ),
        );
        expect(Object.keys(bus.getDoc().nodes)).toHaveLength(4);
        dragTo(bus, p, 3000);
        const ids = added(start.nodes, bus.getDoc().nodes);
        expect(ids).toHaveLength(1);
        // a step that splits nothing, then one that splits again: the id comes back
        ok(
            bus.execute(
                'moveNode',
                { nodeId: p, to: { x: 3000, y: 100 }, finalize: false },
                { merge: true },
            ),
        );
        expect(added(start.nodes, bus.getDoc().nodes)).toEqual([]);
        dragTo(bus, p, 1000);
        expect(added(start.nodes, bus.getDoc().nodes)).toEqual(ids);
        expect(bus.undo()).toBe(true);
        expect(bus.getDoc()).toEqual(start);
    });
});

describe('replayingNewId, through executePlanCommand', () => {
    /** Issues two `n` ids and a `w` id, then aborts: a re-run that fails after drawing. */
    const drawThenAbort = definePlanCommand<Record<string, never>>({
        type: 'drawThenAbort',
        labelKey: 'engine.plan.command.label.draw_then_abort',
        validate: () => null,
        run(_d, _p, ctx) {
            ctx.newId('n');
            ctx.newId('n');
            ctx.newId('w');
            throw new CommandAbort(planCommandMessage('wall_too_short'));
        },
        touchesGeometry: false,
    });

    it('a re-run that issues ids and then aborts leaves the recorded ids unchanged', () => {
        const doc = makeRectPlan(4000, 3000, 200, testIds());
        const deriver = createPlanDeriver();
        const drawn: string[] = [];
        const recorded: PlanRunState = { ids: { n: ['n_recorded1'] } };
        const snapshot = structuredClone(recorded);
        const result = executePlanCommand(
            doc,
            drawThenAbort,
            {},
            {
                geometry: deriver.derive(doc),
                derive: (d) => deriver.derive(d),
                footprints: () => null,
                defaults: defaultPlanDefaults(doc),
                newId: (prefix) => {
                    drawn.push(prefix);
                    return `${prefix}_drawn${String(drawn.length)}`;
                },
            },
            recorded,
        );
        expect(result.ok).toBe(false);
        // the first n id came from the record, the rest were drawn fresh
        expect(drawn).toEqual(['n', 'w']);
        // the failed run must not have appended to the entry's own lists
        expect(recorded).toEqual(snapshot);
        expect(recorded.ids.n).toEqual(['n_recorded1']);
    });
});
