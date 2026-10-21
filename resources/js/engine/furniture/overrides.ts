/**
 * Overrides (07 §3.14), applied to the generated model in this order: part
 * overrides, hardware overrides, extra parts, extra hardware. Overrides of
 * keys the model does not have are dropped with info
 * `furniture.override_orphaned` (03 §3.6). Part overrides of the long
 * horizontal panels were applied earlier, before the split into pieces
 * (`panelSplit.ts`, spec 19), and are skipped here.
 */
import type { MaterialRole } from '../catalog/snapshot';
import { cmpId } from '../compare';
import {
    EDGE_IDS,
    type ExtraHardware,
    type ExtraPart,
    type HardwareOverride,
    type PartOverride,
} from './schema';
import type { Axis, GenContext, HardwareLine, Part, PhysEdge } from './types';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
const AXIS_OF_EDGE: Record<PhysEdge, Axis> = {
    left: 'x',
    right: 'x',
    bottom: 'y',
    top: 'y',
    back: 'z',
    front: 'z',
};

/** Roles whose extra parts show one face (07 §3.14 step 3). */
const ONE_FACE_ROLES = new Set<MaterialRole>([
    'carcass',
    'top',
    'plinth',
    'leg',
]);

const sortedKeys = (record: Record<string, unknown>): string[] =>
    Object.keys(record).sort(cmpId);

/** How `applyOverrides` treats overrides whose key the model does not have. */
export interface OverrideOptions {
    /**
     * Report them as info `furniture.override_orphaned` (default). Off when
     * no model was generated (e.g. `furniture.envelope_too_small`): every
     * override would be orphaned, which is noise, not news.
     */
    reportOrphans?: boolean;
}

type Orphan = (key: string) => void;

const orphanReporter =
    (ctx: GenContext, options: OverrideOptions): Orphan =>
    (key) => {
        if (options.reportOrphans === false) return;
        ctx.issue('furniture.override_orphaned', 'info', { key }, [key]);
    };

/** The parts of model front `id`: the leaf (or drawer front) part and its frame parts. */
const belongsTo = (id: string, partKey: string): boolean =>
    partKey === id || partKey.startsWith(`${id}.`);

/**
 * The model fronts after part removals: a front goes when none of its parts
 * remain (07 §3.14 "its fronts entry"); while some do, its `partKey` moves
 * to the first remaining part (by key) if its own part was removed, e.g. the
 * left stile of a glass door.
 */
function remainingFronts(ctx: GenContext, removed: ReadonlySet<string>) {
    const out: GenContext['fronts'] = [];
    for (const front of ctx.fronts) {
        if (!removed.has(front.partKey)) {
            out.push(front);
            continue;
        }
        const rest = ctx.parts
            .filter((p) => belongsTo(front.id, p.key))
            .map((p) => p.key)
            .sort(cmpId);
        const partKey = rest[0];
        if (partKey !== undefined) out.push({ ...front, partKey });
    }
    return out;
}

/**
 * Material of an override or extra part: the code's row, or for an unknown
 * code the role default (generation only; the code check reports it).
 */
function materialFor(ctx: GenContext, code: string, role: MaterialRole) {
    return ctx.idx.material(code) ?? ctx.idx.defaultMaterialFor(role);
}

/**
 * Adds the length / width deltas to the part and its box (from the min
 * corner, along the axes `ctx.edgeMap` records for the part). A result of
 * zero or less is error `furniture.override_invalid` and the part keeps its
 * generated size.
 */
function resize(ctx: GenContext, part: Part, override: PartOverride): void {
    const dl = override.lengthDelta ?? 0;
    const dw = override.widthDelta ?? 0;
    if (dl === 0 && dw === 0) return;
    const length = part.length + dl;
    const width = part.width + dw;
    if (length <= 0 || width <= 0) {
        ctx.issue('furniture.override_invalid', 'error', { key: part.key }, [
            part.key,
        ]);
        return;
    }
    part.length = length;
    part.width = width;

    const edges = ctx.edgeMap.get(part.key);
    if (!edges || part.geometry.kind !== 'box') return;
    // W1/W2 lie at the ends of the length axis, L1/L2 at the ends of the width axis.
    const size = part.geometry.box.size;
    const lengthAt = AXIS_INDEX[AXIS_OF_EDGE[edges.W1]];
    const widthAt = AXIS_INDEX[AXIS_OF_EDGE[edges.L1]];
    size[lengthAt] = (size[lengthAt] ?? 0) + dl;
    size[widthAt] = (size[widthAt] ?? 0) + dw;
}

/** Applies one non-removal part override to `part` (material, edges, size, grain). */
export function applyPartOverride(
    ctx: GenContext,
    part: Part,
    override: PartOverride,
): void {
    if (override.materialCode !== undefined) {
        const material = materialFor(ctx, override.materialCode, part.role);
        if (material) {
            part.materialCode = material.code;
            part.thickness = Math.round(material.thicknessMm);
        }
    }
    if (override.edges) {
        for (const id of EDGE_IDS) {
            const code = override.edges[id];
            if (code !== undefined) part.edges[id] = code;
        }
    }
    resize(ctx, part, override);
    if (override.grain !== undefined) part.grain = override.grain;
    part.overridden = true;
}

function applyPartOverrides(ctx: GenContext, orphaned: Orphan): void {
    const overrides = ctx.doc.overrides.parts;
    const removed = new Set<string>();
    for (const key of sortedKeys(overrides)) {
        // Applied already, before the part was (maybe) split into pieces.
        if (ctx.overriddenBeforeSplit.has(key)) continue;
        const override = overrides[key];
        // Seam pieces take their panel's override, never one of their own.
        const part = ctx.seamPieces.has(key)
            ? undefined
            : ctx.parts.find((p) => p.key === key);
        if (!override || !part) {
            orphaned(key);
            continue;
        }
        if (override.removed) removed.add(key);
        else applyPartOverride(ctx, part, override);
    }
    if (removed.size === 0) return;
    ctx.parts = ctx.parts.filter((p) => !removed.has(p.key));
    ctx.fronts = remainingFronts(ctx, removed);
    for (const key of removed) ctx.edgeMap.delete(key);
}

function applyHardwareOverride(
    ctx: GenContext,
    key: string,
    override: HardwareOverride,
    orphaned: Orphan,
): void {
    const line = ctx.hardware.find((h) => h.key === key);
    if (!line) {
        orphaned(key);
        return;
    }
    if (override.code !== undefined) line.code = override.code;
    if (override.qtyDelta !== undefined) line.qty += override.qtyDelta;
    line.overridden = true;
    if (override.removed || line.qty <= 0) {
        ctx.hardware = ctx.hardware.filter((h) => h !== line);
    }
}

function extraPart(ctx: GenContext, extra: ExtraPart): Part {
    const material = materialFor(ctx, extra.materialCode, extra.role);
    const role = extra.role;
    return {
        key: `extra.${extra.id}`,
        nameKey: 'parts.extra',
        nameParams: { name: extra.name },
        role,
        materialCode: material?.code ?? extra.materialCode,
        thickness: material ? Math.round(material.thicknessMm) : 0,
        length: extra.length,
        width: extra.width,
        grain: extra.grain,
        edges: {
            L1: extra.edges.L1 ?? null,
            L2: extra.edges.L2 ?? null,
            W1: extra.edges.W1 ?? null,
            W2: extra.edges.W2 ?? null,
        },
        qty: extra.qty,
        geometry: {
            kind: 'box',
            box: extra.placement
                ? {
                      min: [...extra.placement.min],
                      size: [...extra.placement.size],
                  }
                : { min: [0, 0, 0], size: [0, 0, 0] },
        },
        operations: {
            hingeCups: 0,
            shelfPinHoles: 0,
            slideScrewSets: 0,
            handleHoles: 0,
            dowels: 0,
            camLocks: 0,
        },
        visibleFaces: role === 'front' ? 2 : ONE_FACE_ROLES.has(role) ? 1 : 0,
        source: 'extra',
        overridden: false,
    };
}

function extraHardware(extra: ExtraHardware): HardwareLine {
    return {
        key: `extra.${extra.id}`,
        code: extra.code,
        qty: extra.qty,
        reasonKey: 'hardware.reason.extra',
        reasonParams: {},
        frontId: null,
        sectionId: null,
        source: 'extra',
        overridden: false,
    };
}

/**
 * Applies `ctx.doc.overrides` to the generated parts, fronts and hardware
 * (07 §3.14). Extras come last, so overrides never apply to them.
 */
export function applyOverrides(
    ctx: GenContext,
    options: OverrideOptions = {},
): void {
    const { overrides } = ctx.doc;
    const orphaned = orphanReporter(ctx, options);
    applyPartOverrides(ctx, orphaned);
    for (const key of sortedKeys(overrides.hardware)) {
        const override = overrides.hardware[key];
        if (override) applyHardwareOverride(ctx, key, override, orphaned);
    }
    for (const extra of overrides.extraParts) {
        ctx.parts.push(extraPart(ctx, extra));
    }
    for (const extra of overrides.extraHardware) {
        ctx.hardware.push(extraHardware(extra));
    }
}
