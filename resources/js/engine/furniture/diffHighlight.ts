/**
 * Highlight mapping for the change review (07 §10.4): computed from the two
 * models, not from the `ChangeItem`s (which may be collapsed).
 */
import { EDGE_IDS, type PartKey } from './schema';
import type { FurnitureModel, Part, PartGeometry } from './types';

export type Highlight = 'added' | 'removed' | 'changed';

/** A geometry box coordinate that moves by more than this is a change. */
const BOX_TOLERANCE_MM = 1;

const moved = (a: readonly number[], b: readonly number[]): boolean =>
    a.length !== b.length ||
    a.some((v, i) => Math.abs(v - (b[i] as number)) > BOX_TOLERANCE_MM);

function geometryChanged(a: PartGeometry, b: PartGeometry): boolean {
    if (a.kind === 'box' && b.kind === 'box') {
        return moved(a.box.min, b.box.min) || moved(a.box.size, b.box.size);
    }
    if (a.kind === 'extruded' && b.kind === 'extruded') {
        return (
            moved([a.y, a.thickness], [b.y, b.thickness]) ||
            moved(a.outline.flat(), b.outline.flat())
        );
    }
    return true;
}

function partChanged(a: Part, b: Part): boolean {
    return (
        a.length !== b.length ||
        a.width !== b.width ||
        a.thickness !== b.thickness ||
        a.materialCode !== b.materialCode ||
        EDGE_IDS.some((id) => a.edges[id] !== b.edges[id]) ||
        geometryChanged(a.geometry, b.geometry)
    );
}

/** Parts only in `afterModel` are `added`, only in `beforeModel` `removed`, altered ones `changed`. */
export function highlightMap(
    beforeModel: FurnitureModel,
    afterModel: FurnitureModel,
): Map<PartKey, Highlight> {
    const before = new Map(beforeModel.parts.map((p) => [p.key, p]));
    const out = new Map<PartKey, Highlight>();
    for (const part of afterModel.parts) {
        const old = before.get(part.key);
        if (!old) out.set(part.key, 'added');
        else if (partChanged(old, part)) out.set(part.key, 'changed');
    }
    const after = new Set(afterModel.parts.map((p) => p.key));
    for (const key of before.keys()) {
        if (!after.has(key)) out.set(key, 'removed');
    }
    return out;
}
