/**
 * Furniture placement commands (04 §6.6): `addPlacement`, `movePlacement`,
 * `rotatePlacement`, `setPlacementProps` and `deletePlacements`.
 *
 * `validate` and `run` share one planner per command (see `openings.ts`). A
 * placement's `x, y` is the centre of its back edge (master §6.2), so the
 * footprint centre is `P + f(θ)·depth/2`. None of these commands changes the
 * walls, so none runs the geometry post-processing: the attachment of a
 * placement is whatever the editor's snap result says.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - `rotation` is stored as `storedRotation` of post-processing does: in
 *   `[0, 360)`, rounded to 0.01 degree.
 * - `rotatePlacement` judges the attachment for both pivots. The attached
 *   face's orientation is the front of a placement standing against it (the
 *   wall normal on the `left` side, its opposite on the `right` side); the
 *   attachment is cleared when the new rotation differs from it by more than
 *   `ANGLE_TOL_DEG`, wrapped at 360, and also when the wall has no derived
 *   geometry. A `center` pivot of a placement whose design has no footprint
 *   is `design_unknown`.
 */
import { z } from 'zod';
import { CommandAbort } from '../../commands/types';
import { ANGLE_TOL_DEG } from '../../geometry/tolerance';
import {
    normDeg,
    rotationFromFront,
    scale,
    sub,
    type Vec2,
} from '../../geometry/vec2';
import { frontVector, placementFootprint } from '../footprint';
import { ELEVATION_RANGE, MAX_PLACEMENTS } from '../limits';
import type { FurniturePlacement, PlanDocument } from '../schema';
import type { EngineMessage } from '../types';
import { definePlanCommand } from './define';
import { pushDeleted } from './helpers';
import type { PlanCommandContext } from './pipeline';
import { storedRotation } from './postprocess';
import {
    checkCollectionCapacity,
    checkIds,
    checkCoord,
    checkRange,
    has,
    message,
    mm,
    notFound,
    uniqueSorted,
} from './validators';

type Attachment = FurniturePlacement['wallAttachment'];
type Planned<T> = T | { error: EngineMessage };

const hasError = <T extends object>(
    v: Planned<T>,
): v is { error: EngineMessage } => 'error' in v;

// ---- params schemas -------------------------------------------------------------------------

const AttachmentSchema = z.object({
    wallId: z.string(),
    side: z.enum(['left', 'right']),
});

const AddPlacementSchema = z.object({
    designId: z.string().min(1),
    x: z.number(),
    y: z.number(),
    rotation: z.number(),
    elevation: z.number().optional(),
    mirrored: z.boolean().optional(),
    wallAttachment: AttachmentSchema.nullable().optional(),
});
type AddPlacementParams = z.infer<typeof AddPlacementSchema>;

const MovePlacementSchema = z.object({
    placementId: z.string(),
    x: z.number(),
    y: z.number(),
    rotation: z.number().optional(),
    wallAttachment: AttachmentSchema.nullable(),
});
type MovePlacementParams = z.infer<typeof MovePlacementSchema>;

const RotatePlacementSchema = z.object({
    placementId: z.string(),
    rotation: z.number(),
    pivot: z.enum(['center', 'back_center']),
});
type RotatePlacementParams = z.infer<typeof RotatePlacementSchema>;

const SetPlacementPropsSchema = z.object({
    placementIds: z.array(z.string()).min(1),
    props: z.object({
        elevation: z.number().optional(),
        mirrored: z.boolean().optional(),
    }),
});
type SetPlacementPropsParams = z.infer<typeof SetPlacementPropsSchema>;

const DeletePlacementsSchema = z.object({
    placementIds: z.array(z.string()).min(1),
});
type DeletePlacementsParams = z.infer<typeof DeletePlacementsSchema>;

// ---- shared ---------------------------------------------------------------------------------------

/** `not_found` unless the wall a placement is attached to exists. */
function checkAttachment(
    doc: Pick<PlanDocument, 'walls'>,
    attachment: Attachment | undefined,
): EngineMessage | null {
    return attachment === null ||
        attachment === undefined ||
        has(doc.walls, attachment.wallId)
        ? null
        : notFound(attachment.wallId);
}

/** Writes an attachment without replacing an equal object, so no patch is made for it. */
function writeAttachment(
    target: { wallAttachment: Attachment },
    attachment: Attachment,
): void {
    if (attachment === null || target.wallAttachment === null) {
        target.wallAttachment = attachment;
        return;
    }
    target.wallAttachment.wallId = attachment.wallId;
    target.wallAttachment.side = attachment.side;
}

// ---- addPlacement ---------------------------------------------------------------------------------

type NewPlacement = Omit<FurniturePlacement, 'id'>;

function planAdd(
    doc: PlanDocument,
    p: AddPlacementParams,
    ctx: Pick<PlanCommandContext, 'footprints'>,
): Planned<{ placement: NewPlacement }> {
    if (ctx.footprints(p.designId) === null) {
        return {
            error: message('design_unknown', { designId: p.designId }),
        };
    }
    const x = mm(p.x);
    const y = mm(p.y);
    const elevation = mm(p.elevation ?? 0);
    const range =
        checkCoord('x', x) ??
        checkCoord('y', y) ??
        checkRange('elevation', elevation, ...ELEVATION_RANGE) ??
        checkAttachment(doc, p.wallAttachment) ??
        checkCollectionCapacity(doc.placements, 'placements', MAX_PLACEMENTS);
    if (range !== null) return { error: range };
    return {
        placement: {
            designId: p.designId,
            x,
            y,
            rotation: storedRotation(p.rotation),
            elevation,
            mirrored: p.mirrored ?? false,
            wallAttachment: p.wallAttachment ?? null,
        },
    };
}

export interface AddPlacementResult {
    placementId: string;
}

const addPlacement = definePlanCommand<AddPlacementParams, AddPlacementResult>({
    type: 'addPlacement',
    labelKey: 'engine.plan.command.label.add_placement',
    paramsSchema: AddPlacementSchema,
    validate(doc, p, ctx) {
        const plan = planAdd(doc, p, ctx);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planAdd(d, p, ctx);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const id = ctx.newId('f');
        d.placements[id] = { id, ...plan.placement };
        out.result = { placementId: id };
    },
    touchesGeometry: false,
});

// ---- movePlacement --------------------------------------------------------------------------------

function planMove(
    doc: PlanDocument,
    p: MovePlacementParams,
): Planned<{ x: number; y: number; rotation: number | null }> {
    if (!has(doc.placements, p.placementId)) {
        return { error: notFound(p.placementId) };
    }
    const x = mm(p.x);
    const y = mm(p.y);
    const refusal =
        checkCoord('x', x) ??
        checkCoord('y', y) ??
        checkAttachment(doc, p.wallAttachment);
    if (refusal !== null) return { error: refusal };
    return {
        x,
        y,
        rotation: p.rotation === undefined ? null : storedRotation(p.rotation),
    };
}

const movePlacement = definePlanCommand<MovePlacementParams>({
    type: 'movePlacement',
    labelKey: 'engine.plan.command.label.move_placement',
    paramsSchema: MovePlacementSchema,
    validate(doc, p) {
        const plan = planMove(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planMove(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const placement = d.placements[p.placementId]!;
        placement.x = plan.x;
        placement.y = plan.y;
        if (plan.rotation !== null) placement.rotation = plan.rotation;
        writeAttachment(placement, p.wallAttachment);
    },
    mergeKey: (p) => `placement:${p.placementId}`,
    mergeMode: 'replace',
    touchesGeometry: false,
});

// ---- rotatePlacement ------------------------------------------------------------------------------

/** Angle between two rotations, degrees in `[0, 180]`. */
function angleBetween(a: number, b: number): number {
    const d = normDeg(a - b);
    return Math.min(d, 360 - d);
}

/** Whether `rotation` is the orientation of the face the placement is attached to. */
function matchesFace(
    attachment: NonNullable<Attachment>,
    rotation: number,
    ctx: Pick<PlanCommandContext, 'geometry'>,
): boolean {
    const wall = ctx.geometry.walls[attachment.wallId];
    if (wall === undefined) return false;
    const front =
        attachment.side === 'left' ? wall.normal : scale(wall.normal, -1);
    return (
        angleBetween(rotation, rotationFromFront(front)) <= ANGLE_TOL_DEG + 1e-9
    );
}

function planRotate(
    doc: PlanDocument,
    p: RotatePlacementParams,
    ctx: Pick<PlanCommandContext, 'footprints' | 'geometry'>,
): Planned<{ x: number; y: number; rotation: number; detach: boolean }> {
    if (!has(doc.placements, p.placementId)) {
        return { error: notFound(p.placementId) };
    }
    const placement = doc.placements[p.placementId]!;
    const rotation = storedRotation(p.rotation);
    let at: Vec2 = { x: placement.x, y: placement.y };
    if (p.pivot === 'center') {
        const size = ctx.footprints(placement.designId);
        if (size === null) {
            return {
                error: message('design_unknown', {
                    designId: placement.designId,
                }),
            };
        }
        // C = P + f(θ)·D/2 stays fixed: P' = C − f(θ')·D/2
        const { center } = placementFootprint(placement, size);
        at = sub(center, scale(frontVector(rotation), size.depth / 2));
    }
    const attachment = placement.wallAttachment;
    return {
        x: mm(at.x),
        y: mm(at.y),
        rotation,
        detach: attachment !== null && !matchesFace(attachment, rotation, ctx),
    };
}

const rotatePlacement = definePlanCommand<RotatePlacementParams>({
    type: 'rotatePlacement',
    labelKey: 'engine.plan.command.label.rotate_placement',
    paramsSchema: RotatePlacementSchema,
    validate(doc, p, ctx) {
        const plan = planRotate(doc, p, ctx);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx) {
        const plan = planRotate(d, p, ctx);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const placement = d.placements[p.placementId]!;
        placement.x = plan.x;
        placement.y = plan.y;
        placement.rotation = plan.rotation;
        if (plan.detach) placement.wallAttachment = null;
    },
    mergeKey: (p) => `placementRot:${p.placementId}`,
    mergeMode: 'replace',
    touchesGeometry: false,
});

// ---- setPlacementProps ----------------------------------------------------------------------------

const setPlacementProps = definePlanCommand<SetPlacementPropsParams>({
    type: 'setPlacementProps',
    labelKey: 'engine.plan.command.label.set_placement_props',
    paramsSchema: SetPlacementPropsSchema,
    validate(doc, p) {
        const missing = checkIds(doc.placements, p.placementIds);
        if (missing !== null) return missing;
        return p.props.elevation === undefined
            ? null
            : checkRange(
                  'props.elevation',
                  mm(p.props.elevation),
                  ...ELEVATION_RANGE,
              );
    },
    run(d, p) {
        const { elevation, mirrored } = p.props;
        for (const id of uniqueSorted(p.placementIds)) {
            const placement = d.placements[id]!;
            if (elevation !== undefined) placement.elevation = mm(elevation);
            if (mirrored !== undefined) placement.mirrored = mirrored;
        }
    },
    touchesGeometry: false,
});

// ---- deletePlacements -----------------------------------------------------------------------------

const deletePlacements = definePlanCommand<DeletePlacementsParams>({
    type: 'deletePlacements',
    labelKey: 'engine.plan.command.label.delete_placements',
    paramsSchema: DeletePlacementsSchema,
    validate: (doc, p) => checkIds(doc.placements, p.placementIds),
    run(d, p, _ctx, out) {
        const ids = uniqueSorted(p.placementIds);
        for (const id of ids) delete d.placements[id];
        pushDeleted(out, ...ids);
    },
    touchesGeometry: false,
});

/** The placement commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const PLACEMENT_COMMANDS = {
    addPlacement,
    movePlacement,
    rotatePlacement,
    setPlacementProps,
    deletePlacements,
};
