/**
 * Room meta commands (04 §6.6): `setRoomMeta` and `deleteRoomMeta`.
 *
 * A room is identified by its `faceKey`; `setRoomMeta` creates the RoomMeta
 * of a face that has none and updates the one it has. `validate` and `run`
 * share one planner so they cannot disagree. A command that changes nothing
 * writes the same values back; `mutative` records no patch for that, so the
 * bus drops its entry (a `labelOffset` is written coordinate by coordinate
 * for that reason).
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - `name` is trimmed, then judged by code points: 0 to 80 characters,
 *   `out_of_range` on `props.name` otherwise.
 * - `labelOffset` is held to the coordinate range like any point.
 * - `floorColorHex` is lower-cased, as `setWallProps` does with `colorHex`.
 */
import { z } from 'zod';
import { CommandAbort } from '../../commands/types';
import { ROOM_NAME_RANGE } from '../limits';
import { FLOOR_FINISHES, type PlanDocument, type RoomMeta } from '../schema';
import { ROOM_TYPES } from '../roomTypes';
import { PointParamSchema, definePlanCommand } from './define';
import { pushDeleted } from './helpers';
import type { PlanCommandContext } from './pipeline';
import {
    type Planned,
    checkPoint,
    checkRange,
    has,
    hasError,
    mm,
    notFound,
} from './validators';

// ---- params schemas -------------------------------------------------------------------------

const SetRoomMetaSchema = z.object({
    faceKey: z.string(),
    props: z.object({
        name: z.string().optional(),
        type: z.enum(ROOM_TYPES).optional(),
        floorFinish: z.enum(FLOOR_FINISHES).optional(),
        floorColorHex: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable()
            .optional(),
        labelOffset: PointParamSchema.nullable().optional(),
        showArea: z.boolean().optional(),
    }),
});
type SetRoomMetaParams = z.infer<typeof SetRoomMetaSchema>;

const DeleteRoomMetaSchema = z.object({ metaId: z.string() });
type DeleteRoomMetaParams = z.infer<typeof DeleteRoomMetaSchema>;

// ---- setRoomMeta ----------------------------------------------------------------------------------

type MetaFields = Omit<RoomMeta, 'id' | 'anchor'>;
type Point = { x: number; y: number };

/** What `setRoomMeta` writes: the props, cleaned, and the face it applies to. */
interface RoomMetaPlan {
    /** The RoomMeta of the face, `null` when it has none yet. */
    metaId: string | null;
    labelPoint: Point;
    props: Partial<MetaFields>;
}

/** The cleaned props of `setRoomMeta`, or the refusal. */
function cleanProps(
    props: SetRoomMetaParams['props'],
): Planned<Partial<MetaFields>> {
    const out: Partial<MetaFields> = {};
    if (props.name !== undefined) {
        const name = props.name.trim();
        const refusal = checkRange(
            'props.name',
            [...name].length,
            ...ROOM_NAME_RANGE,
        );
        if (refusal !== null) return { error: refusal };
        out.name = name;
    }
    if (props.type !== undefined) out.type = props.type;
    if (props.floorFinish !== undefined) out.floorFinish = props.floorFinish;
    if (props.floorColorHex !== undefined) {
        out.floorColorHex =
            props.floorColorHex === null
                ? null
                : props.floorColorHex.toLowerCase();
    }
    if (props.labelOffset !== undefined) {
        if (props.labelOffset === null) {
            out.labelOffset = null;
        } else {
            const offset = {
                x: mm(props.labelOffset.x),
                y: mm(props.labelOffset.y),
            };
            const refusal = checkPoint('props.labelOffset', offset);
            if (refusal !== null) return { error: refusal };
            out.labelOffset = offset;
        }
    }
    if (props.showArea !== undefined) out.showArea = props.showArea;
    return out;
}

function planSet(
    doc: Pick<PlanDocument, 'rooms'>,
    p: SetRoomMetaParams,
    ctx: Pick<PlanCommandContext, 'geometry'>,
): Planned<RoomMetaPlan> {
    const face = ctx.geometry.rooms.find((r) => r.faceKey === p.faceKey);
    if (face === undefined) return { error: notFound(p.faceKey) };
    if (face.metaId !== null && !has(doc.rooms, face.metaId)) {
        return { error: notFound(face.metaId) };
    }
    const props = cleanProps(p.props);
    if (hasError(props)) return props;
    return {
        metaId: face.metaId,
        labelPoint: { x: mm(face.labelPoint.x), y: mm(face.labelPoint.y) },
        props,
    };
}

/** Writes a point (or `null`) without replacing an equal object. */
function writeOffset(meta: RoomMeta, offset: Point | null): void {
    if (offset === null || meta.labelOffset === null) {
        meta.labelOffset = offset;
        return;
    }
    meta.labelOffset.x = offset.x;
    meta.labelOffset.y = offset.y;
}

export interface SetRoomMetaResult {
    metaId: string;
    created: boolean;
}

const setRoomMeta = definePlanCommand<SetRoomMetaParams, SetRoomMetaResult>({
    type: 'setRoomMeta',
    labelKey: 'engine.plan.command.label.set_room_meta',
    paramsSchema: SetRoomMetaSchema,
    validate(doc, p, ctx) {
        const plan = planSet(doc, p, ctx);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planSet(d, p, ctx);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const { props } = plan;
        if (plan.metaId === null) {
            const id = ctx.newId('r');
            d.rooms[id] = {
                id,
                anchor: plan.labelPoint,
                name: '',
                type: 'other',
                floorFinish: 'tile',
                floorColorHex: null,
                labelOffset: null,
                showArea: true,
                ...props,
            };
            out.result = { metaId: id, created: true };
            return;
        }
        const meta = d.rooms[plan.metaId]!;
        if (props.name !== undefined) meta.name = props.name;
        if (props.type !== undefined) meta.type = props.type;
        if (props.floorFinish !== undefined) {
            meta.floorFinish = props.floorFinish;
        }
        if (props.floorColorHex !== undefined) {
            meta.floorColorHex = props.floorColorHex;
        }
        if (props.labelOffset !== undefined)
            writeOffset(meta, props.labelOffset);
        if (props.showArea !== undefined) meta.showArea = props.showArea;
        out.result = { metaId: plan.metaId, created: false };
    },
    mergeKey: (p) => `roomMeta:${p.faceKey}`,
    mergeMode: 'replace',
    touchesGeometry: false,
});

// ---- deleteRoomMeta -------------------------------------------------------------------------------

const deleteRoomMeta = definePlanCommand<DeleteRoomMetaParams>({
    type: 'deleteRoomMeta',
    labelKey: 'engine.plan.command.label.delete_room_meta',
    paramsSchema: DeleteRoomMetaSchema,
    validate: (doc, p) =>
        has(doc.rooms, p.metaId) ? null : notFound(p.metaId),
    run(d, p, _ctx, out) {
        delete d.rooms[p.metaId];
        pushDeleted(out, p.metaId);
    },
    touchesGeometry: false,
});

/** The room meta commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const ROOM_COMMANDS = { setRoomMeta, deleteRoomMeta };
