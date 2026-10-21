/**
 * Plan-wide commands (04 §6.6): `rescalePlan` and `setPlanMeta`, and the
 * scaling routine `rescalePlan` shares with `calibrateBackground` (which
 * scales the geometry about `p1` instead of the origin).
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - Any scaling that leaves a wall shorter than `MIN_WALL_LENGTH` aborts
 *   `wall_too_short`, whatever the factor, calibrate included.
 * - Dimensions attached to a wall face are not scaled: post-processing
 *   recomputes their points from the scaled walls. Only their `offset` is
 *   scaled, and only by `rescalePlan` (04 §6.6 lists `offset` there and not
 *   under calibrate, where distances stay as they are).
 * - A placement attached to a wall keeps its relative place on the face. It
 *   is written to the point of its OLD face line at `k` times its distance
 *   from the face start, which is exactly what post-processing reads back,
 *   and post-processing then stands it on the new face. Scaling its `x, y`
 *   like any other placement would be read against the old face and land in
 *   the wrong place.
 * - After scaling, `reclampOpenings` re-fits the openings of every wall. An
 *   opening that no longer fits aborts `opening_no_fit`, as everywhere else
 *   (a 300 mm minimum width can be wider than a wall scaled down hard), and
 *   two openings squeezed into each other are caught by the pipeline's error
 *   invariant (`introduces_error`).
 * - A coordinate pushed out of `+-MAX_COORD` by the factor aborts
 *   `out_of_range` on `coordinates`; so does a background scale outside
 *   0.01 to 1000 (`background.mmPerPixel`).
 * - `view` (the saved camera) is not scaled; 04 §6.6 does not list it.
 * - `setPlanMeta` stores `northAngle` as given (a degree in [0, 360)).
 */
import { z } from 'zod';
import type { Draft } from 'mutative';
import { CommandAbort } from '../../commands/types';
import { cmpId } from '../../compare';
import { MAX_COORD, MIN_WALL_LENGTH } from '../../geometry/tolerance';
import { add, dist, dot, scale, sub, type Vec2 } from '../../geometry/vec2';
import type { DerivedPlan } from '../derive';
import {
    DIMENSION_OFFSET_MAX,
    FLOOR_THICKNESS_RANGE,
    OPENING_WIDTH_RANGE,
    WALL_HEIGHT_RANGE,
    WALL_THICKNESS_RANGE,
} from '../limits';
import type { FurniturePlacement, PlanDocument } from '../schema';
import type { EngineMessage } from '../types';
import { definePlanCommand } from './define';
import { reclampOpenings, wallLength } from './helpers';
import {
    type Planned,
    checkBackgroundScale,
    checkRange,
    fail,
    has,
    hasError,
    message,
    mm,
} from './validators';

type Doc = Draft<PlanDocument>;
type Point = { x: number; y: number };

// ---- scaling ----------------------------------------------------------------------------------

/** How `scalePlan` and `scaleBackground` scale: by `factor` about `about`. */
export interface PlanScaling {
    factor: number;
    about: Vec2;
    /**
     * `rescalePlan` also scales the sizes in the plane (wall thickness,
     * opening width, dimension and room-label offsets); calibrate does not.
     */
    sizes: boolean;
}

/** `value` as a whole millimetre, which must lie inside the coordinate range. */
function coord(value: number): number {
    const rounded = mm(value);
    if (Math.abs(rounded) > MAX_COORD) {
        fail('out_of_range', {
            field: 'coordinates',
            min: -MAX_COORD,
            max: MAX_COORD,
        });
    }
    return rounded;
}

/** The scaled point; the caller writes it field by field so an equal point makes no patch. */
export function scaledPoint(p: Point, s: PlanScaling): Point {
    return {
        x: coord(s.about.x + (p.x - s.about.x) * s.factor),
        y: coord(s.about.y + (p.y - s.about.y) * s.factor),
    };
}

/** Moves `target` to its scaled point. */
function scaleInPlace(target: Point, s: PlanScaling): void {
    const q = scaledPoint(target, s);
    target.x = q.x;
    target.y = q.y;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]): number =>
    Math.min(Math.max(v, lo), hi);

/** A size scaled by the factor, rounded and clamped into `range`. */
const scaledSize = (
    v: number,
    factor: number,
    range: readonly [number, number],
): number => clamp(mm(v * factor), range);

/**
 * Where a placement attached to a wall is written before post-processing
 * stands it on the new face: on the old face line at `factor` times its
 * distance from the face start. `null` when the wall has no old geometry
 * (the placement is then scaled like a free one).
 */
function alongOldFace(
    p: Draft<FurniturePlacement>,
    geometry: DerivedPlan,
    factor: number,
): Vec2 | null {
    const attachment = p.wallAttachment;
    if (attachment === null || !has(geometry.walls, attachment.wallId)) {
        return null;
    }
    const wall = geometry.walls[attachment.wallId]!;
    const [q0, q1] =
        attachment.side === 'left' ? wall.leftFace : wall.rightFace;
    const length = dist(q0, q1);
    if (length < 1e-9) return null;
    const dir = scale(sub(q1, q0), 1 / length);
    const u = dot(sub({ x: p.x, y: p.y }, q0), dir);
    return add(q0, scale(dir, u * factor));
}

/**
 * Scales the plan geometry (04 §6.6 `rescalePlan` and `calibrateBackground`
 * with `scaleGeometry`): nodes, placements and fixtures `x, y`, label
 * positions, unattached dimension points and RoomMeta anchors; with
 * `s.sizes` also the sizes listed on `PlanScaling`. Opening offsets are
 * scaled and the openings re-fitted. `geometry` is the geometry of the
 * document the command started from. Aborts `wall_too_short` when a wall
 * ends up under `MIN_WALL_LENGTH`.
 */
export function scalePlan(d: Doc, geometry: DerivedPlan, s: PlanScaling): void {
    const { factor } = s;
    const fitted = [
        ...new Set(
            Object.values(d.openings)
                .map((o) => o.wallId)
                .filter((id) => has(d.walls, id)),
        ),
    ].sort(cmpId);
    const oldLengths = fitted.map((id) => wallLength(d, id));

    for (const node of Object.values(d.nodes)) scaleInPlace(node, s);
    for (const wall of Object.values(d.walls)) {
        if (!has(d.nodes, wall.a) || !has(d.nodes, wall.b)) continue;
        const length = wallLength(d, wall.id);
        if (length < MIN_WALL_LENGTH) {
            fail('wall_too_short', {
                wallId: wall.id,
                length: mm(length),
            });
        }
        if (s.sizes) {
            wall.thickness = scaledSize(
                wall.thickness,
                factor,
                WALL_THICKNESS_RANGE,
            );
        }
    }

    for (const o of Object.values(d.openings)) {
        o.offset = mm(o.offset * factor);
        if (s.sizes) {
            o.width = scaledSize(o.width, factor, OPENING_WIDTH_RANGE);
        }
    }
    fitted.forEach((id, i) => reclampOpenings(d, id, 'none', oldLengths[i]!));

    for (const meta of Object.values(d.rooms)) {
        scaleInPlace(meta.anchor, s);
        if (s.sizes && meta.labelOffset !== null) {
            scaleInPlace(meta.labelOffset, s);
        }
    }
    for (const p of Object.values(d.placements)) {
        const along = alongOldFace(p, geometry, factor);
        if (along === null) {
            scaleInPlace(p, s);
        } else {
            p.x = coord(along.x);
            p.y = coord(along.y);
        }
    }
    for (const f of Object.values(d.fixtures)) scaleInPlace(f, s);
    for (const label of Object.values(d.annotations.labels)) {
        scaleInPlace(label.position, s);
    }
    for (const dim of Object.values(d.annotations.dimensions)) {
        if (dim.attachedTo === null) {
            scaleInPlace(dim.a, s);
            scaleInPlace(dim.b, s);
        }
        if (s.sizes) {
            dim.offset = clamp(mm(dim.offset * factor), [
                -DIMENSION_OFFSET_MAX,
                DIMENSION_OFFSET_MAX,
            ]);
        }
    }
}

/**
 * Scales a background about `s.about`: its `mmPerPixel` by the factor and
 * its `position` (the image's top-left corner) as a point. Aborts
 * `out_of_range` when the new scale leaves 0.01 to 1000.
 */
export function scaleBackground(
    bg: NonNullable<Doc['background']>,
    s: PlanScaling,
): void {
    const mmPerPixel = bg.mmPerPixel * s.factor;
    const refusal = checkBackgroundScale('background.mmPerPixel', mmPerPixel);
    if (refusal !== null) throw new CommandAbort(refusal);
    bg.mmPerPixel = mmPerPixel;
    scaleInPlace(bg.position, s);
}

// ---- rescalePlan ------------------------------------------------------------------------------------

/** `factor` of `rescalePlan`, 04 §6.6. */
const RESCALE_FACTOR_RANGE = [0.01, 100] as const;

const RescalePlanSchema = z.object({ factor: z.number() });
type RescalePlanParams = z.infer<typeof RescalePlanSchema>;

const rescalePlan = definePlanCommand<RescalePlanParams>({
    type: 'rescalePlan',
    labelKey: 'engine.plan.command.label.rescale_plan',
    paramsSchema: RescalePlanSchema,
    validate: (_doc, p) =>
        checkRange('factor', p.factor, ...RESCALE_FACTOR_RANGE),
    run(d, p, ctx) {
        const s = { factor: p.factor, about: { x: 0, y: 0 }, sizes: true };
        scalePlan(d, ctx.geometry, s);
        if (d.background !== null) scaleBackground(d.background, s);
    },
    touchesGeometry: true,
});

// ---- setPlanMeta ------------------------------------------------------------------------------------

const SetPlanMetaSchema = z.object({
    props: z.object({
        defaultWallHeight: z.number().optional(),
        defaultWallThickness: z.number().optional(),
        floorThickness: z.number().optional(),
        northAngle: z.number().nullable().optional(),
    }),
});
type SetPlanMetaParams = z.infer<typeof SetPlanMetaSchema>;

type MetaValues = Partial<
    Pick<
        PlanDocument['meta'],
        | 'defaultWallHeight'
        | 'defaultWallThickness'
        | 'floorThickness'
        | 'northAngle'
    >
>;

/** `northAngle` is null or a degree in [0, 360). */
function checkNorthAngle(angle: number): EngineMessage | null {
    return angle < 0 || angle >= 360
        ? message('out_of_range', {
              field: 'props.northAngle',
              min: 0,
              max: 360,
          })
        : null;
}

/** The meta values `setPlanMeta` gives (rounded), or the refusal. */
function planMeta(p: SetPlanMetaParams): Planned<MetaValues> {
    const { props } = p;
    const values: MetaValues = {};
    let refusal: EngineMessage | null = null;
    if (props.defaultWallHeight !== undefined) {
        values.defaultWallHeight = mm(props.defaultWallHeight);
        refusal ??= checkRange(
            'props.defaultWallHeight',
            values.defaultWallHeight,
            ...WALL_HEIGHT_RANGE,
        );
    }
    if (props.defaultWallThickness !== undefined) {
        values.defaultWallThickness = mm(props.defaultWallThickness);
        refusal ??= checkRange(
            'props.defaultWallThickness',
            values.defaultWallThickness,
            ...WALL_THICKNESS_RANGE,
        );
    }
    if (props.floorThickness !== undefined) {
        values.floorThickness = mm(props.floorThickness);
        refusal ??= checkRange(
            'props.floorThickness',
            values.floorThickness,
            ...FLOOR_THICKNESS_RANGE,
        );
    }
    if (props.northAngle !== undefined) {
        values.northAngle = props.northAngle;
        if (props.northAngle !== null) {
            refusal ??= checkNorthAngle(props.northAngle);
        }
    }
    return refusal === null ? values : { error: refusal };
}

const setPlanMeta = definePlanCommand<SetPlanMetaParams>({
    type: 'setPlanMeta',
    labelKey: 'engine.plan.command.label.set_plan_meta',
    paramsSchema: SetPlanMetaSchema,
    validate(_doc, p) {
        const plan = planMeta(p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planMeta(p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        Object.assign(d.meta, plan);
    },
    touchesGeometry: false,
});

/** The plan-wide commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const PLAN_WIDE_COMMANDS = { rescalePlan, setPlanMeta };
