/**
 * Plan engine budgets (04 §7.3). `yarn bench:check` asserts the medians against
 * `bench-thresholds.json` (16 §10); the bench names are the threshold keys.
 */
import { bench, describe } from 'vitest';
import {
    buildPlanarGraph,
    nestFaces,
    walkFaces,
} from '../geometry/planarFaces';
import { mulberry32 } from '../testing/random';
import {
    defaultPlanDefaults,
    executePlanCommand,
    type PlanCommandContext,
} from './commands/pipeline';
import { PLAN_COMMANDS } from './commands/registry';
import { createPlanDeriver, derivePlanGeometry } from './derive';
import { buildPlanDrawing } from './drawing';
import type { FootprintProvider } from './footprint';
import { buildHitIndex } from './hitIndex';
import type { PlanDocument } from './schema';
import { buildSnapIndex } from './snapIndex';
import { defaultSnapSettings, snapPoint, type SnapInput } from './snapping';
import { testDrawingOptions } from './testing/drawingOptions';
import { makeGridPlan } from './testing/fixtures';
import { validatePlan } from './validate';

const noFootprints: FootprintProvider = () => null;
const grid97 = makeGridPlan(7, 6);
const grid1012 = makeGridPlan(22, 22);
const grid511 = makeGridPlan(16, 15);
const FIRST_NODE = Object.keys(grid97.nodes)[0]!;

/** `doc` with node `id` shifted by `dx` (one drag step). */
function shifted(doc: PlanDocument, id: string, dx: number): PlanDocument {
    const node = doc.nodes[id]!;
    return {
        ...doc,
        nodes: { ...doc.nodes, [id]: { ...node, x: node.x + dx } },
    };
}

describe('plan derive (04 §7.3)', () => {
    bench('cold derive 7x6', () => {
        derivePlanGeometry(grid97);
    });

    // Alternating two shifted copies keeps every call a real one-node change.
    const dragged = [40, 80].map((dx) => shifted(grid97, FIRST_NODE, dx));
    const warm = createPlanDeriver();
    let step = 0;
    bench(
        'warm derive after moveNode',
        () => {
            warm.derive(dragged[step++ % 2]!);
        },
        { setup: () => void warm.derive(grid97) },
    );

    bench('cold derive 22x22', () => {
        derivePlanGeometry(grid1012);
    });

    // Report-only (no threshold): ledger carry 4a.
    const segments = Object.values(grid1012.walls).map((w) => ({
        a: grid1012.nodes[w.a]!,
        b: grid1012.nodes[w.b]!,
        wallId: w.id,
    }));
    bench('planarFaces 22x22', () => {
        const graph = buildPlanarGraph(segments);
        nestFaces(graph, walkFaces(graph));
    });
});

describe('plan indexes and snapping (04 §7.3)', () => {
    const geom = derivePlanGeometry(grid511);
    const index = buildSnapIndex(grid511, geom, noFootprints);
    const { min, max } = geom.bbox;
    const random = mulberry32(11);
    const calls: SnapInput[] = Array.from({ length: 256 }, (_, k) => ({
        cursor: {
            x: min.x + random() * (max.x - min.x),
            y: min.y + random() * (max.y - min.y),
        },
        zoom: [0.05, 0.1, 0.3][k % 3]!,
        pointerType: 'mouse',
        origin: null,
        previousDir: null,
        exclude: new Set<string>(),
        settings: defaultSnapSettings('metric'),
        modifiers: { shift: false, alt: false },
    }));
    let call = 0;
    bench('snapPoint 511 walls', () => {
        snapPoint(calls[call++ % calls.length]!, index);
    });

    const drawing = buildPlanDrawing(grid511, geom, testDrawingOptions());
    bench('buildSnapIndex + buildHitIndex 511 walls', () => {
        buildSnapIndex(grid511, geom, noFootprints);
        buildHitIndex(grid511, geom, drawing, noFootprints);
    });
});

describe('plan commands and validation (04 §7.3)', () => {
    const deriver = createPlanDeriver();
    const ctx: PlanCommandContext = {
        geometry: deriver.derive(grid97),
        derive: (d) => deriver.derive(d),
        footprints: noFootprints,
        defaults: defaultPlanDefaults(grid97),
        newId: (prefix) => `${prefix}_bench`,
    };
    const node = grid97.nodes[FIRST_NODE]!;
    let drag = 0;
    bench('moveNode non-finalize 97 walls', () => {
        const to = { x: node.x + 40 + (drag++ % 2) * 40, y: node.y };
        const res = executePlanCommand(
            grid97,
            PLAN_COMMANDS.moveNode,
            { nodeId: FIRST_NODE, to, finalize: false },
            ctx,
        );
        if (!res.ok) throw new Error('moveNode refused');
    });

    const geom = derivePlanGeometry(grid97);
    bench('validatePlan 97 walls', () => {
        // validatePlan caches by document identity; a shallow copy is a fresh document.
        validatePlan({ ...grid97 }, geom);
    });
});
