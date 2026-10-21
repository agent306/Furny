/**
 * Hardware rules of the fronts (07 §6.2-§6.4): hinge counts and types with
 * the primary / shared split, hinge plates, flap mechanisms, and handles with
 * the knob fallback.
 */
import type { HardwareRoleKey } from '../../catalog/specs';
import { HANDLE_EDGE_OFFSET } from '../constants';
import type { EdgeClass, Overlay } from '../fronts/openings';
import type { Front, HardwareKey } from '../schema';
import type { GenContext, HardwareLine, Part } from '../types';

/** Flaps and drawer fronts wider than this get two handles / mechanisms (07 §6.3-§6.4). */
const SINGLE_FITTING_MAX_WIDTH = 600;

/** Hinges per leaf from the hinge edge length and the leaf weight (07 §6.2). */
export function hingeCount(edgeLengthMm: number, leafWeightKg: number): number {
    const byLength =
        edgeLengthMm <= 900
            ? 2
            : edgeLengthMm <= 1600
              ? 3
              : edgeLengthMm <= 2000
                ? 4
                : 5;
    const byWeight =
        leafWeightKg <= 6
            ? 2
            : leafWeightKg <= 12
              ? 3
              : leafWeightKg <= 17
                ? 4
                : 5;
    return Math.max(byLength, byWeight);
}

/** Hinge type by front overlay and hinge edge class (07 §6.2 table). */
export function hingeRoleKey(
    overlay: Overlay,
    cls: EdgeClass,
): HardwareRoleKey {
    switch (overlay) {
        case 'full':
            return cls === 'shared'
                ? 'hinge.half_overlay'
                : 'hinge.full_overlay';
        case 'half':
            return 'hinge.half_overlay';
        case 'inset':
            return 'hinge.inset';
    }
}

export interface HardwareLineSpec {
    key: HardwareKey;
    roleKey: HardwareRoleKey;
    /** A catalog code; `undefined`/`null` = the default of `roleKey`. */
    code?: string | null;
    qty: number;
    reasonKey: string;
    reasonParams?: Record<string, string | number>;
    frontId: string | null;
    sectionId: string | null;
}

/** A generated, not overridden hardware line. */
function generatedLine(
    line: Pick<
        HardwareLine,
        'key' | 'code' | 'qty' | 'reasonKey' | 'frontId' | 'sectionId'
    > & { reasonParams?: Record<string, string | number> },
): HardwareLine {
    return {
        ...line,
        reasonParams: line.reasonParams ?? {},
        source: 'generated',
        overridden: false,
    };
}

/**
 * Adds a generated hardware line for `code`, or the role default when no code
 * is given. Without either the line is omitted and `furniture.no_default_hardware`
 * names the role (07 §1.5). Returns the code used.
 */
export function addHardwareLine(
    ctx: GenContext,
    line: HardwareLineSpec,
): string | undefined {
    const code = line.code ?? ctx.idx.defaultHardware(line.roleKey)?.code;
    if (code === undefined) {
        ctx.issue(
            'furniture.no_default_hardware',
            'warning',
            { roleKey: line.roleKey },
            [line.key],
        );
        return undefined;
    }
    ctx.addHardware(
        generatedLine({
            key: line.key,
            code,
            qty: line.qty,
            reasonKey: line.reasonKey,
            reasonParams: line.reasonParams,
            frontId: line.frontId,
            sectionId: line.sectionId,
        }),
    );
    return code;
}

/** One hinged leaf (door or flap) as the hinge rules see it. */
export interface HingedLeaf {
    /** The part that receives the hinge cups (the leaf, or its hinge-side frame part). */
    part: Part;
    /** Leaf height for doors, leaf width for flaps. */
    edgeLength: number;
    weightKg: number;
    /** Class of the opening edge on the hinge side (07 §4.2). */
    edgeClass: EdgeClass;
}

/**
 * Hinges and plates of one front (07 §6.2). `front.{F}.hinges` holds the
 * leaves on the front's primary type (that of an outer edge); leaves hinged
 * on a shared edge whose code differs go to `front.{F}.hinges.shared`.
 * Plates count every hinge whose item has no integrated plate. `hingeCode`
 * null means no hinges, plates or cups.
 */
export function hingesFor(
    ctx: GenContext,
    front: Front,
    leaves: readonly HingedLeaf[],
): void {
    if (front.hingeCode === null) return;
    const explicit = front.hingeCode === 'auto' ? null : front.hingeCode;
    const codeFor = (roleKey: HardwareRoleKey) =>
        explicit ?? ctx.idx.defaultHardware(roleKey)?.code;
    const primary = codeFor(hingeRoleKey(front.overlay, 'outer'));

    const groups = {
        main: { code: '', qty: 0, leaves: 0 },
        shared: { code: '', qty: 0, leaves: 0 },
    };
    const missing: HardwareRoleKey[] = [];
    let plates = 0;
    for (const leaf of leaves) {
        const roleKey = hingeRoleKey(front.overlay, leaf.edgeClass);
        const code = codeFor(roleKey);
        if (code === undefined) {
            if (!missing.includes(roleKey)) missing.push(roleKey);
            continue;
        }
        const n = hingeCount(leaf.edgeLength, leaf.weightKg);
        leaf.part.operations.hingeCups += n;
        const group =
            leaf.edgeClass === 'shared' && code !== primary
                ? groups.shared
                : groups.main;
        group.code = code;
        group.qty += n;
        group.leaves += 1;
        if (ctx.idx.hardware(code)?.specs.integratedPlate !== true) plates += n;
    }

    const base = `front.${front.id}.hinges`;
    for (const roleKey of missing) {
        ctx.issue('furniture.no_default_hardware', 'warning', { roleKey }, [
            base,
        ]);
    }
    for (const [key, group] of [
        [base, groups.main],
        [`${base}.shared`, groups.shared],
    ] as const) {
        if (group.qty === 0) continue;
        ctx.addHardware(
            generatedLine({
                key,
                code: group.code,
                qty: group.qty,
                reasonKey: 'hardware.reason.hinges_for_door',
                reasonParams: { leaves: group.leaves },
                frontId: front.id,
                sectionId: null,
            }),
        );
    }
    if (plates > 0) {
        addHardwareLine(ctx, {
            key: `front.${front.id}.hinge_plates`,
            roleKey: 'hinge_plate.default',
            qty: plates,
            reasonKey: 'hardware.reason.hinge_plates',
            frontId: front.id,
            sectionId: null,
        });
    }
}

/**
 * Lift hardware of a flap (07 §6.3): gas struts for `flap_up`, soft-down
 * stays for `flap_down`, two above 600 mm of leaf width.
 */
export function flapMechanism(
    ctx: GenContext,
    front: Front,
    leafWidth: number,
): void {
    const qty = leafWidth <= SINGLE_FITTING_MAX_WIDTH ? 1 : 2;
    if (front.kind === 'flap_up') {
        addHardwareLine(ctx, {
            key: `front.${front.id}.gas_struts`,
            roleKey: 'gas_strut.default',
            qty,
            reasonKey: 'hardware.reason.gas_struts',
            frontId: front.id,
            sectionId: null,
        });
    } else if (front.kind === 'flap_down') {
        addHardwareLine(ctx, {
            key: `front.${front.id}.stays`,
            roleKey: 'lift.default',
            qty,
            reasonKey: 'hardware.reason.flap_stays',
            frontId: front.id,
            sectionId: null,
        });
    }
}

/** A front's handle code: `'inherit'` = the carcass handle; null = none (07 §6.4). */
export function handleCodeFor(ctx: GenContext, front: Front): string | null {
    return front.handleCode === 'inherit'
        ? (ctx.doc.carcass?.handles.code ?? null)
        : front.handleCode;
}

export type HandleOrientation = 'vertical' | 'horizontal';
export type HandleFrontKind = 'door' | 'sliding' | 'flap' | 'drawer';

/** `carcass.handles.orientation`; `auto`: doors and sliding leaves vertical, drawers and flaps horizontal. */
export function handleOrientation(
    ctx: GenContext,
    kind: HandleFrontKind,
): HandleOrientation {
    const set = ctx.doc.carcass?.handles.orientation ?? 'auto';
    if (set !== 'auto') return set;
    return kind === 'door' || kind === 'sliding' ? 'vertical' : 'horizontal';
}

/** Handles per leaf: 1 on doors and sliding leaves; flaps and drawer fronts 2 above 600 mm. */
export function handleCount(kind: HandleFrontKind, width: number): number {
    if (kind === 'door' || kind === 'sliding') return 1;
    return width <= SINGLE_FITTING_MAX_WIDTH ? 1 : 2;
}

/** Where a handle line goes and what its issues name. */
export interface HandleTarget {
    key: HardwareKey;
    frontId: string | null;
    sectionId: string | null;
    reasonKey: string;
    /** Named by `handle_replaced_by_knob` (`frontId` param and entity). */
    entityId: string;
}

/** One leaf (or drawer front) that takes `count` handles. */
export interface HandleLeaf {
    /** The part drilled for the handle (the leaf, or its handle-side frame part). */
    part: Part;
    w: number;
    h: number;
    count: number;
}

/** The handle line of a front: `front.{F}.handles`. */
export const frontHandleTarget = (frontId: string): HandleTarget => ({
    key: `front.${frontId}.handles`,
    frontId,
    sectionId: null,
    reasonKey: 'hardware.reason.handles_for_front',
    entityId: frontId,
});

/**
 * One handle line for `leaves` (07 §6.4). A bar handle longer than the leaves
 * allow along `orientation` (length + 2 x 40 mm) becomes the default knob,
 * with info `furniture.handle_replaced_by_knob`. Each handle drills
 * `specs.holeCount` holes (knobs 1, handles 2 when unset) in its part.
 */
export function handlesFor(
    ctx: GenContext,
    target: HandleTarget,
    code: string | null,
    leaves: readonly HandleLeaf[],
    orientation: HandleOrientation,
): void {
    const qty = leaves.reduce((sum, leaf) => sum + leaf.count, 0);
    if (code === null || qty === 0) return;

    let item = ctx.idx.hardware(code);
    const length =
        item?.category === 'handle' ? item.specs.lengthMm : undefined;
    if (typeof length === 'number') {
        const room = Math.min(
            ...leaves.map((l) => (orientation === 'vertical' ? l.h : l.w)),
        );
        if (length + 2 * HANDLE_EDGE_OFFSET > room) {
            item = ctx.idx.defaultHardware('knob.default');
            if (!item) {
                ctx.issue(
                    'furniture.no_default_hardware',
                    'warning',
                    { roleKey: 'knob.default' },
                    [target.key],
                );
                return;
            }
            ctx.issue(
                'furniture.handle_replaced_by_knob',
                'info',
                { frontId: target.entityId },
                [target.entityId],
            );
        }
    }

    const holeCount = item?.specs.holeCount;
    const holes =
        typeof holeCount === 'number'
            ? holeCount
            : item?.category === 'knob'
              ? 1
              : 2;
    for (const leaf of leaves) {
        leaf.part.operations.handleHoles += holes * leaf.count;
    }
    ctx.addHardware(
        generatedLine({
            key: target.key,
            code: item?.code ?? code,
            qty,
            reasonKey: target.reasonKey,
            frontId: target.frontId,
            sectionId: target.sectionId,
        }),
    );
}
