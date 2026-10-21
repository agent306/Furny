/**
 * Opening commands (04 §6.6): `addOpening`, `moveOpening`, `resizeOpening`,
 * `setOpeningProps`, `flipOpening` and `deleteOpenings`.
 *
 * `validate` and `run` share one planner per command: it reads the document
 * (or the draft) and returns the refusal or the values to write, so the two
 * can never disagree. A command that changes nothing writes the same values
 * back; `mutative` records no patch for that, so the bus drops its entry.
 *
 * Params schemas check types only. Numeric ranges are checked by `validate`
 * so that an out-of-range value is `out_of_range` with `{ field, min, max }`
 * (04 §6.6) and not a generic `invalid_params`.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - Height above the wall top (04 §6.6): only a window is shortened, to
 *   `wall.height - sillHeight`, by `addOpening` (explicit or default height)
 *   and by `setOpeningProps` (a height that came from the new kind's default).
 *   A door or opening whose default height does not fit is `opening_too_tall`;
 *   an explicit height over `wall.height - sillHeight` is `out_of_range` on
 *   `height` (max = what is left above the sill), as in the range table. A
 *   sill that pushes an existing height over the top is `opening_too_tall`,
 *   as is a `moveOpening` to a lower wall. Less than 300 mm above the sill is
 *   always `opening_too_tall`.
 * - Like `setWallProps`, the height rule is judged only when the height, the
 *   sill or the wall changes, so an opening that is already too tall (a dirty
 *   import) can still be moved along its wall or flipped. Bounds and overlap
 *   are judged whenever the offset or the width changes, against the other
 *   openings of the target wall only.
 * - Openings that merely touch (a gap of 0 mm) do not overlap, as in
 *   `validatePlan`.
 * - `label` is stored as given (not trimmed): `null`, or 1 to 16 characters.
 *   `setOpeningProps { kind }` keeps the label, so a door turned window keeps
 *   its `D1` until the label is set.
 * - `resizeOpening` rounds `offset'` to whole millimetres, so an odd width
 *   change moves the kept edge by half a millimetre.
 */
import { z } from 'zod';
import { CommandAbort } from '../../commands/types';
import { cmpId } from '../../compare';
import { dist } from '../../geometry/vec2';
import {
    OPENING_HEIGHT_RANGE,
    OPENING_SILL_RANGE,
    OPENING_WIDTH_RANGE,
} from '../limits';
import {
    DOOR_TYPES,
    DoorTypeSchema,
    WINDOW_TYPES,
    WindowTypeSchema,
} from '../schema';
import type { Opening, PlanDocument, Wall } from '../schema';
import type { EngineMessage } from '../types';
import { BOUNDS_TOL } from '../validate';
import { definePlanCommand } from './define';
import { nextOpeningLabel, overlaps, pushDeleted } from './helpers';
import type { PlanCommandContext, PlanDefaults } from './pipeline';
import {
    checkIds,
    checkOpeningCapacity,
    checkRange,
    has,
    message,
    mm,
    notFound,
    uniqueSorted,
} from './validators';

type Doc = Pick<PlanDocument, 'nodes' | 'walls' | 'openings'>;
type Kind = Opening['kind'];
type Planned<T> = T | { error: EngineMessage };

/** `[min, max]` characters of an opening label; `null` is no label. */
const LABEL_RANGE = [1, 16] as const;

// ---- params schemas -------------------------------------------------------------------------

const KindSchema = z.enum(['door', 'window', 'opening']);
const TypeSchema = z.union([
    DoorTypeSchema,
    WindowTypeSchema,
    z.literal('opening'),
]);
const HingeSchema = z.enum(['start', 'end']);
const SwingSchema = z.enum(['left', 'right']);

const AddOpeningSchema = z.object({
    wallId: z.string(),
    kind: KindSchema,
    type: TypeSchema.optional(),
    offset: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    sillHeight: z.number().optional(),
    hinge: HingeSchema.optional(),
    swing: SwingSchema.optional(),
    label: z.string().nullable().optional(),
});
type AddOpeningParams = z.infer<typeof AddOpeningSchema>;

const MoveOpeningSchema = z.object({
    openingId: z.string(),
    wallId: z.string().optional(),
    offset: z.number(),
});
type MoveOpeningParams = z.infer<typeof MoveOpeningSchema>;

const ResizeOpeningSchema = z.object({
    openingId: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    sillHeight: z.number().optional(),
    keep: z.enum(['center', 'start', 'end']),
});
type ResizeOpeningParams = z.infer<typeof ResizeOpeningSchema>;

const SetOpeningPropsSchema = z.object({
    openingIds: z.array(z.string()).min(1),
    props: z.object({
        kind: KindSchema.optional(),
        type: TypeSchema.optional(),
        height: z.number().optional(),
        sillHeight: z.number().optional(),
        hinge: HingeSchema.optional(),
        swing: SwingSchema.optional(),
        label: z.string().nullable().optional(),
    }),
});
type SetOpeningPropsParams = z.infer<typeof SetOpeningPropsSchema>;

const FlipOpeningSchema = z.object({
    openingIds: z.array(z.string()).min(1),
    what: z.enum(['swing', 'hinge', 'both']),
});
type FlipOpeningParams = z.infer<typeof FlipOpeningSchema>;

const DeleteOpeningsSchema = z.object({
    openingIds: z.array(z.string()).min(1),
});
type DeleteOpeningsParams = z.infer<typeof DeleteOpeningsSchema>;

// ---- kind defaults ----------------------------------------------------------------------------

const TYPES_OF: Record<Kind, readonly Opening['type'][]> = {
    door: DOOR_TYPES,
    window: WINDOW_TYPES,
    opening: ['opening'],
};

const DEFAULT_TYPE: Record<Kind, Opening['type']> = {
    door: 'single_swing',
    window: 'casement',
    opening: 'opening',
};

/** The size a new opening of `kind` starts with (04 §6.6 `addOpening`). */
function defaultsOf(
    kind: Kind,
    defaults: PlanDefaults,
): { width: number; height: number; sillHeight: number } {
    switch (kind) {
        case 'door':
            return {
                width: defaults.doorWidth,
                height: defaults.doorHeight,
                sillHeight: 0,
            };
        case 'window':
            return {
                width: defaults.windowWidth,
                height: defaults.windowHeight,
                sillHeight: defaults.windowSill,
            };
        case 'opening':
            return {
                width: defaults.openingWidth,
                height: defaults.openingHeight,
                sillHeight: 0,
            };
    }
}

// ---- shared checks ----------------------------------------------------------------------------

const hasError = <T extends object>(
    v: Planned<T>,
): v is { error: EngineMessage } => 'error' in v;

/** `type_mismatch` unless `type` belongs to `kind`. */
function checkTypeOfKind(
    kind: Kind,
    type: Opening['type'],
): EngineMessage | null {
    return TYPES_OF[kind].includes(type)
        ? null
        : message('type_mismatch', { kind, type });
}

/** `out_of_range` unless the label is `null` or 1 to 16 characters (code points). */
function checkLabel(label: string | null, field: string): EngineMessage | null {
    return label === null
        ? null
        : checkRange(field, [...label].length, ...LABEL_RANGE);
}

/** The centre-line length of a wall, or the missing node. */
function lengthOf(
    doc: Pick<PlanDocument, 'nodes'>,
    wall: Wall,
): Planned<{ length: number }> {
    const a = doc.nodes[wall.a];
    if (a === undefined) return { error: notFound(wall.a) };
    const b = doc.nodes[wall.b];
    if (b === undefined) return { error: notFound(wall.b) };
    return { length: dist(a, b) };
}

/**
 * The opening (`offset`, `width`) must lie inside the wall (`opening_no_fit`)
 * and clear of the other openings on it (`opening_overlap`). `selfId` is the
 * opening being placed, which is not its own neighbour.
 */
function checkPlacement(
    doc: Doc,
    wall: Wall,
    at: { offset: number; width: number },
    selfId: string | null,
): EngineMessage | null {
    const measured = lengthOf(doc, wall);
    if (hasError(measured)) return measured.error;
    const { length } = measured;
    const half = at.width / 2;
    if (
        at.offset < half - BOUNDS_TOL ||
        at.offset > length - half + BOUNDS_TOL
    ) {
        return message('opening_no_fit', {
            wallId: wall.id,
            ...(selfId === null ? {} : { openingId: selfId }),
            width: at.width,
            length: mm(length),
        });
    }
    const others = Object.values(doc.openings)
        .filter((o) => o.wallId === wall.id && o.id !== selfId)
        .sort((p, q) => cmpId(p.id, q.id));
    for (const o of others) {
        if (overlaps(at.offset, at.width, o.offset, o.width)) {
            return message('opening_overlap', {
                wallId: wall.id,
                ...(selfId === null ? {} : { openingId: selfId }),
                otherId: o.id,
            });
        }
    }
    return null;
}

/** What to do with a height that reaches over the wall top. */
type HeightRule =
    /** Shorten it to what is left above the sill (windows). */
    | { how: 'reduce' }
    /** `opening_too_tall`. */
    | { how: 'refuse' }
    /** `out_of_range` on `field`: the caller gave this height. */
    | { how: 'explicit'; field: string };

/**
 * Keeps `sill + height` under the wall top as `rule` says. Less than the
 * minimum height above the sill is always `opening_too_tall`.
 */
function fitHeight(
    wall: Wall,
    sill: number,
    height: number,
    rule: HeightRule,
    openingId: string | null,
): Planned<{ height: number }> {
    const room = wall.height - sill;
    if (
        room < OPENING_HEIGHT_RANGE[0] ||
        (height > room && rule.how === 'refuse')
    ) {
        return {
            error: message('opening_too_tall', {
                wallId: wall.id,
                ...(openingId === null ? {} : { openingId }),
                sillHeight: sill,
                height,
                wallHeight: wall.height,
            }),
        };
    }
    if (height > room && rule.how === 'explicit') {
        return {
            error: message('out_of_range', {
                field: rule.field,
                min: OPENING_HEIGHT_RANGE[0],
                max: room,
            }),
        };
    }
    return { height: Math.min(height, room) };
}

// ---- addOpening ---------------------------------------------------------------------------------

type NewOpening = Omit<Opening, 'id'>;

/** The opening `addOpening` would create, or the refusal. */
function planAdd(
    doc: Doc,
    p: AddOpeningParams,
    ctx: Pick<PlanCommandContext, 'defaults'>,
): Planned<{ opening: NewOpening }> {
    if (!has(doc.walls, p.wallId)) return { error: notFound(p.wallId) };
    const wall = doc.walls[p.wallId]!;
    const base = defaultsOf(p.kind, ctx.defaults);
    const offset = mm(p.offset);
    const width = mm(p.width ?? base.width);
    const sillHeight = mm(p.sillHeight ?? base.sillHeight);
    const wanted = mm(p.height ?? base.height);
    const type = p.type ?? DEFAULT_TYPE[p.kind];
    const label =
        p.label !== undefined
            ? p.label
            : p.kind === 'opening'
              ? null
              : nextOpeningLabel(doc, p.kind);

    const refusal =
        checkRange('width', width, ...OPENING_WIDTH_RANGE) ??
        checkRange('sillHeight', sillHeight, ...OPENING_SILL_RANGE) ??
        checkRange('height', wanted, ...OPENING_HEIGHT_RANGE) ??
        checkLabel(label, 'label') ??
        checkTypeOfKind(p.kind, type) ??
        checkOpeningCapacity(doc);
    if (refusal !== null) return { error: refusal };

    const rule: HeightRule =
        p.kind === 'window'
            ? { how: 'reduce' }
            : p.height === undefined
              ? { how: 'refuse' }
              : { how: 'explicit', field: 'height' };
    const fitted = fitHeight(wall, sillHeight, wanted, rule, null);
    if (hasError(fitted)) return fitted;
    const placement = checkPlacement(doc, wall, { offset, width }, null);
    if (placement !== null) return { error: placement };

    return {
        opening: {
            wallId: p.wallId,
            kind: p.kind,
            type,
            offset,
            width,
            height: fitted.height,
            sillHeight,
            hinge: p.hinge ?? 'start',
            swing: p.swing ?? 'left',
            label,
        },
    };
}

export interface AddOpeningResult {
    openingId: string;
}

const addOpening = definePlanCommand<AddOpeningParams, AddOpeningResult>({
    type: 'addOpening',
    labelKey: 'engine.plan.command.label.add_opening',
    paramsSchema: AddOpeningSchema,
    validate(doc, p, ctx) {
        const plan = planAdd(doc, p, ctx);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planAdd(d, p, ctx);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const id = ctx.newId('o');
        d.openings[id] = { id, ...plan.opening };
        out.result = { openingId: id };
    },
    touchesGeometry: true,
});

// ---- moveOpening --------------------------------------------------------------------------------

/** Where `moveOpening` puts the opening, or the refusal. */
function planMove(
    doc: Doc,
    p: MoveOpeningParams,
): Planned<{ wallId: string; offset: number }> {
    if (!has(doc.openings, p.openingId)) {
        return { error: notFound(p.openingId) };
    }
    const opening = doc.openings[p.openingId]!;
    const wallId = p.wallId ?? opening.wallId;
    if (!has(doc.walls, wallId)) return { error: notFound(wallId) };
    const wall = doc.walls[wallId]!;
    const offset = mm(p.offset);

    // The height rule only applies to a wall the opening is not already on.
    if (
        wallId !== opening.wallId &&
        opening.sillHeight + opening.height > wall.height
    ) {
        return {
            error: message('opening_too_tall', {
                wallId,
                openingId: opening.id,
                sillHeight: opening.sillHeight,
                height: opening.height,
                wallHeight: wall.height,
            }),
        };
    }
    const placement = checkPlacement(
        doc,
        wall,
        { offset, width: opening.width },
        opening.id,
    );
    return placement === null ? { wallId, offset } : { error: placement };
}

const moveOpening = definePlanCommand<MoveOpeningParams>({
    type: 'moveOpening',
    labelKey: 'engine.plan.command.label.move_opening',
    paramsSchema: MoveOpeningSchema,
    validate(doc, p) {
        const plan = planMove(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planMove(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const opening = d.openings[p.openingId]!;
        opening.wallId = plan.wallId;
        opening.offset = plan.offset;
    },
    mergeKey: (p) => `moveOpening:${p.openingId}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

// ---- resizeOpening ------------------------------------------------------------------------------

/** The size and offset `resizeOpening` gives the opening, or the refusal. */
function planResize(
    doc: Doc,
    p: ResizeOpeningParams,
): Planned<Pick<Opening, 'offset' | 'width' | 'height' | 'sillHeight'>> {
    if (!has(doc.openings, p.openingId)) {
        return { error: notFound(p.openingId) };
    }
    const o = doc.openings[p.openingId]!;
    const width = p.width === undefined ? o.width : mm(p.width);
    const height = p.height === undefined ? o.height : mm(p.height);
    const sillHeight =
        p.sillHeight === undefined ? o.sillHeight : mm(p.sillHeight);
    const range =
        (p.width === undefined
            ? null
            : checkRange('width', width, ...OPENING_WIDTH_RANGE)) ??
        (p.height === undefined
            ? null
            : checkRange('height', height, ...OPENING_HEIGHT_RANGE)) ??
        (p.sillHeight === undefined
            ? null
            : checkRange('sillHeight', sillHeight, ...OPENING_SILL_RANGE));
    if (range !== null) return { error: range };

    const offset =
        p.keep === 'center'
            ? o.offset
            : p.keep === 'start'
              ? mm(o.offset - o.width / 2 + width / 2)
              : mm(o.offset + o.width / 2 - width / 2);

    if (!has(doc.walls, o.wallId)) return { error: notFound(o.wallId) };
    const wall = doc.walls[o.wallId]!;
    if (height !== o.height || sillHeight !== o.sillHeight) {
        const rule: HeightRule =
            p.height === undefined
                ? { how: 'refuse' }
                : { how: 'explicit', field: 'height' };
        const fitted = fitHeight(wall, sillHeight, height, rule, o.id);
        if (hasError(fitted)) return fitted;
    }
    if (offset !== o.offset || width !== o.width) {
        const placement = checkPlacement(doc, wall, { offset, width }, o.id);
        if (placement !== null) return { error: placement };
    }
    return { offset, width, height, sillHeight };
}

const resizeOpening = definePlanCommand<ResizeOpeningParams>({
    type: 'resizeOpening',
    labelKey: 'engine.plan.command.label.resize_opening',
    paramsSchema: ResizeOpeningSchema,
    validate(doc, p) {
        const plan = planResize(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planResize(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const opening = d.openings[p.openingId]!;
        opening.offset = plan.offset;
        opening.width = plan.width;
        opening.height = plan.height;
        opening.sillHeight = plan.sillHeight;
    },
    mergeKey: (p) => `resizeOpening:${p.openingId}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

// ---- setOpeningProps ------------------------------------------------------------------------------

type OpeningFields = Pick<
    Opening,
    'kind' | 'type' | 'height' | 'sillHeight' | 'hinge' | 'swing' | 'label'
>;

/** What `setOpeningProps` makes of one opening, or the refusal. */
function planProps(
    doc: Doc,
    o: Opening,
    props: SetOpeningPropsParams['props'],
    defaults: PlanDefaults,
): Planned<OpeningFields> {
    const kind = props.kind ?? o.kind;
    const kindChanged = kind !== o.kind;
    const base = defaultsOf(kind, defaults);

    // A new kind brings its own type, height and sill unless they are given.
    const type = props.type ?? (kindChanged ? DEFAULT_TYPE[kind] : o.type);
    let height = o.height;
    let sillHeight = o.sillHeight;
    if (kindChanged) {
        height = base.height;
        sillHeight = base.sillHeight;
    }
    if (props.sillHeight !== undefined) sillHeight = mm(props.sillHeight);
    if (props.height !== undefined) height = mm(props.height);
    const label = props.label === undefined ? o.label : props.label;

    const refusal =
        (props.height === undefined
            ? null
            : checkRange('props.height', height, ...OPENING_HEIGHT_RANGE)) ??
        (props.sillHeight === undefined
            ? null
            : checkRange(
                  'props.sillHeight',
                  sillHeight,
                  ...OPENING_SILL_RANGE,
              )) ??
        (props.label === undefined || props.label === null
            ? null
            : checkLabel(props.label, 'props.label')) ??
        (props.type === undefined && !kindChanged
            ? null
            : checkTypeOfKind(kind, type));
    if (refusal !== null) return { error: refusal };

    const wall = doc.walls[o.wallId];
    if (
        wall !== undefined &&
        (height !== o.height || sillHeight !== o.sillHeight)
    ) {
        // only a window's height that came from its kind default is shortened
        const rule: HeightRule =
            props.height !== undefined
                ? { how: 'explicit', field: 'props.height' }
                : kind === 'window' && kindChanged
                  ? { how: 'reduce' }
                  : { how: 'refuse' };
        const fitted = fitHeight(wall, sillHeight, height, rule, o.id);
        if (hasError(fitted)) return fitted;
        height = fitted.height;
    }
    return {
        kind,
        type,
        height,
        sillHeight,
        hinge: props.hinge ?? o.hinge,
        swing: props.swing ?? o.swing,
        label,
    };
}

const setOpeningProps = definePlanCommand<SetOpeningPropsParams>({
    type: 'setOpeningProps',
    labelKey: 'engine.plan.command.label.set_opening_props',
    paramsSchema: SetOpeningPropsSchema,
    validate(doc, p, ctx) {
        const missing = checkIds(doc.openings, p.openingIds);
        if (missing !== null) return missing;
        for (const id of uniqueSorted(p.openingIds)) {
            const plan = planProps(
                doc,
                doc.openings[id]!,
                p.props,
                ctx.defaults,
            );
            if (hasError(plan)) return plan.error;
        }
        return null;
    },
    run(d, p, ctx) {
        for (const id of uniqueSorted(p.openingIds)) {
            const opening = d.openings[id]!;
            const plan = planProps(d, opening, p.props, ctx.defaults);
            if (hasError(plan)) throw new CommandAbort(plan.error);
            Object.assign(opening, plan);
        }
    },
    touchesGeometry: true,
});

// ---- flipOpening ----------------------------------------------------------------------------------

const flipOpening = definePlanCommand<FlipOpeningParams>({
    type: 'flipOpening',
    labelKey: 'engine.plan.command.label.flip_opening',
    paramsSchema: FlipOpeningSchema,
    validate: (doc, p) => checkIds(doc.openings, p.openingIds),
    run(d, p) {
        for (const id of uniqueSorted(p.openingIds)) {
            const opening = d.openings[id]!;
            if (p.what !== 'hinge') {
                opening.swing = opening.swing === 'left' ? 'right' : 'left';
            }
            if (p.what !== 'swing') {
                opening.hinge = opening.hinge === 'start' ? 'end' : 'start';
            }
        }
    },
    touchesGeometry: true,
});

// ---- deleteOpenings -------------------------------------------------------------------------------

const deleteOpenings = definePlanCommand<DeleteOpeningsParams>({
    type: 'deleteOpenings',
    labelKey: 'engine.plan.command.label.delete_openings',
    paramsSchema: DeleteOpeningsSchema,
    validate: (doc, p) => checkIds(doc.openings, p.openingIds),
    run(d, p, _ctx, out) {
        const ids = uniqueSorted(p.openingIds);
        for (const id of ids) delete d.openings[id];
        pushDeleted(out, ...ids);
    },
    touchesGeometry: true,
});

/** The opening commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const OPENING_COMMANDS = {
    addOpening,
    moveOpening,
    resizeOpening,
    setOpeningProps,
    flipOpening,
    deleteOpenings,
};
