/**
 * Part construction helper (07 §1.2): every generated panel is created here so
 * that length/width, edge numbering and grain follow one set of rules.
 */
import { fl } from './constants';
import type { EdgeId } from './schema';
import type {
    Axis,
    GenContext,
    PanelSpec,
    Part,
    PartGrain,
    PhysEdge,
} from './types';

const AXES: readonly Axis[] = ['x', 'y', 'z'];
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/** Physical names of an axis' two ends: `[min end, max end]`. */
const AXIS_EDGES: Record<Axis, readonly [PhysEdge, PhysEdge]> = {
    x: ['left', 'right'],
    y: ['bottom', 'top'],
    z: ['back', 'front'],
};

/** The end that is edge `1` of its pair: `front`, `top` or `left`. */
const PRIORITY_END: Record<Axis, 0 | 1> = { x: 0, y: 1, z: 1 };

/** Physical edge of an axis pair: `1` is the priority edge, `2` its opposite. */
function edgeOf(axis: Axis, number: 1 | 2): PhysEdge {
    const priority = PRIORITY_END[axis];
    const end = number === 1 ? priority : priority === 0 ? 1 : 0;
    return AXIS_EDGES[axis][end];
}

/**
 * Physical meaning of each `EdgeId` (07 §1.2 rules 3-5): `L1/L2` are the two
 * edges at the ends of the width axis, `W1/W2` those at the ends of the length
 * axis, edge `1` being the one named front, top or left.
 */
export function mapEdges(
    lengthAxis: Axis,
    widthAxis: Axis,
): Record<EdgeId, PhysEdge> {
    return {
        L1: edgeOf(widthAxis, 1),
        L2: edgeOf(widthAxis, 2),
        W1: edgeOf(lengthAxis, 1),
        W2: edgeOf(lengthAxis, 2),
    };
}

/** Rule 7 without the material test: which finished dimension follows the grain. */
export function mapGrain(
    grainAxis: Axis | null,
    lengthAxis: Axis,
    widthAxis: Axis,
): PartGrain {
    if (grainAxis === lengthAxis) return 'length';
    if (grainAxis === widthAxis) return 'width';
    return 'none';
}

/** Builds a `Part` from a panel spec and records its edge meaning in `ctx.edgeMap`. */
export function makePart(spec: PanelSpec, ctx: GenContext): Part {
    const [a, b] = AXES.filter((axis) => axis !== spec.thicknessAxis) as [
        Axis,
        Axis,
    ];
    const sa = fl(spec.box.size[AXIS_INDEX[a]] ?? 0);
    const sb = fl(spec.box.size[AXIS_INDEX[b]] ?? 0);

    let lengthAxis: Axis;
    if (sa === sb) {
        lengthAxis = spec.grainAxis === b ? b : a;
    } else {
        lengthAxis = sa > sb ? a : b;
    }
    const widthAxis = lengthAxis === a ? b : a;

    const material = ctx.idx.material(spec.materialCode) ?? ctx.mat(spec.role);

    const physical = mapEdges(lengthAxis, widthAxis);
    const bandCode =
        spec.bandCode !== undefined ? spec.bandCode : ctx.roleBand(spec.role);
    const banded = new Set(spec.banded);
    const edgeCode = (id: EdgeId): string | null =>
        banded.has(physical[id]) ? bandCode : null;

    ctx.edgeMap.set(spec.key, physical);

    return {
        key: spec.key,
        nameKey: spec.nameKey,
        nameParams: { ...spec.nameParams },
        role: spec.role,
        materialCode: material.code,
        thickness: Math.round(material.thicknessMm),
        length: Math.max(sa, sb),
        width: Math.min(sa, sb),
        grain: material.hasGrain
            ? mapGrain(spec.grainAxis, lengthAxis, widthAxis)
            : 'none',
        edges: {
            L1: edgeCode('L1'),
            L2: edgeCode('L2'),
            W1: edgeCode('W1'),
            W2: edgeCode('W2'),
        },
        qty: 1,
        geometry: spec.geometry ?? {
            kind: 'box',
            box: { min: [...spec.box.min], size: [...spec.box.size] },
        },
        operations: {
            hingeCups: 0,
            shelfPinHoles: 0,
            slideScrewSets: 0,
            handleHoles: 0,
            dowels: 0,
            camLocks: 0,
            ...spec.operations,
        },
        visibleFaces: spec.visibleFaces,
        source: 'generated',
        overridden: false,
    };
}
