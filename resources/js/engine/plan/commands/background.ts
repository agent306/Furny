/**
 * Background image commands (04 §6.6): `setBackground`,
 * `setBackgroundProps`, `calibrateBackground` and `removeBackground`.
 *
 * `validate` and `run` share one planner per command (see `openings.ts`);
 * points are written field by field so that an unchanged value makes no
 * patch. Calibrating scales the plan geometry through `scalePlan`
 * (`plan.ts`), which is why `calibrateBackground` runs the geometry
 * post-processing.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - `calibrateBackground` with `scaleGeometry` scales the geometry about
 *   `p1`, the same point and factor as the background, so the plan stays
 *   registered to the image. A factor under 1 that would leave a wall under
 *   `MIN_WALL_LENGTH` aborts `wall_too_short`, as `rescalePlan` does.
 * - The checks of `calibrateBackground` run in this order: background
 *   present, background unlocked, points in range, `calibration_too_short`,
 *   the real distance, then the resulting `mmPerPixel` (0.01 to 1000).
 * - `setBackgroundProps` is allowed on a locked background (it is how the
 *   editor unlocks it); the lock only guards calibration. With no background
 *   it is refused `background_missing`.
 * - `removeBackground` with no background does nothing (no history entry).
 * - `setBackground` takes `rotation` modulo 360 (0.01 degree), like a
 *   placement's. A blank `mediaUuid` is a params failure (`invalid_params`).
 *   `pixelWidth` and `pixelHeight` must be whole numbers from 1.
 */
import { z } from 'zod';
import { CommandAbort } from '../../commands/types';
import { dist } from '../../geometry/vec2';
import { BACKGROUND_OPACITY_RANGE } from '../limits';
import type { BackgroundImage, PlanDocument } from '../schema';
import type { EngineMessage } from '../types';
import { PointParamSchema, definePlanCommand } from './define';
import { pushDeleted } from './helpers';
import { scaleBackground, scalePlan, type PlanScaling } from './plan';
import { storedRotation } from './postprocess';
import {
    MAX_SPAN,
    type Planned,
    checkBackgroundScale,
    checkPoint,
    checkRange,
    hasError,
    message,
    mm,
} from './validators';

type Point = { x: number; y: number };

/** The fewest pixels two calibration points may be apart. */
const CALIBRATION_MIN_PIXELS = 10;
/** The shortest real distance a calibration may be given, mm. */
const CALIBRATION_MIN_DISTANCE = 100;

// ---- params schemas -------------------------------------------------------------------------

const BackgroundSchema = z.object({
    importId: z.string().nullable(),
    mediaUuid: z.string().min(1),
    pixelWidth: z.number(),
    pixelHeight: z.number(),
    mmPerPixel: z.number(),
    position: PointParamSchema,
    rotation: z.number(),
    opacity: z.number(),
    visible: z.boolean(),
    locked: z.boolean(),
});

const SetBackgroundSchema = z.object({ background: BackgroundSchema });
type SetBackgroundParams = z.infer<typeof SetBackgroundSchema>;

const SetBackgroundPropsSchema = z.object({
    props: z.object({
        position: PointParamSchema.optional(),
        rotation: z.number().optional(),
        opacity: z.number().optional(),
        visible: z.boolean().optional(),
        locked: z.boolean().optional(),
    }),
});
type SetBackgroundPropsParams = z.infer<typeof SetBackgroundPropsSchema>;

const CalibrateBackgroundSchema = z.discriminatedUnion('space', [
    z.object({
        space: z.literal('plan'),
        p1: PointParamSchema,
        p2: PointParamSchema,
        realDistance: z.number(),
        scaleGeometry: z.boolean(),
    }),
    z.object({
        space: z.literal('image'),
        a: PointParamSchema,
        b: PointParamSchema,
        distanceMm: z.number(),
    }),
]);
type CalibrateBackgroundParams = z.infer<typeof CalibrateBackgroundSchema>;

const RemoveBackgroundSchema = z.object({});
type RemoveBackgroundParams = z.infer<typeof RemoveBackgroundSchema>;

// ---- shared ---------------------------------------------------------------------------------------

const roundPoint = (p: Point): Point => ({ x: mm(p.x), y: mm(p.y) });

/** Writes a point field by field, so an equal point makes no patch. */
function writePoint(target: Point, to: Point): void {
    target.x = to.x;
    target.y = to.y;
}

/** The background of `doc`, or the `background_missing` refusal. */
function backgroundOf(
    doc: Pick<PlanDocument, 'background'>,
): Planned<{ background: BackgroundImage }> {
    return doc.background === null
        ? { error: message('background_missing') }
        : { background: doc.background };
}

// ---- setBackground ----------------------------------------------------------------------------------

/** `out_of_range` unless `value` is a whole number from 1. */
function checkPixels(field: string, value: number): EngineMessage | null {
    return Number.isInteger(value) && value >= 1
        ? null
        : message('out_of_range', {
              field,
              min: 1,
              max: Number.MAX_SAFE_INTEGER,
          });
}

function planSetBackground(
    p: SetBackgroundParams,
): Planned<{ background: BackgroundImage }> {
    const b = p.background;
    const background: BackgroundImage = {
        importId: b.importId,
        mediaUuid: b.mediaUuid,
        pixelWidth: b.pixelWidth,
        pixelHeight: b.pixelHeight,
        mmPerPixel: b.mmPerPixel,
        position: roundPoint(b.position),
        rotation: storedRotation(b.rotation),
        opacity: b.opacity,
        visible: b.visible,
        locked: b.locked,
    };
    const refusal =
        checkPixels('background.pixelWidth', background.pixelWidth) ??
        checkPixels('background.pixelHeight', background.pixelHeight) ??
        checkBackgroundScale('background.mmPerPixel', background.mmPerPixel) ??
        checkPoint('background.position', background.position) ??
        checkRange(
            'background.opacity',
            background.opacity,
            ...BACKGROUND_OPACITY_RANGE,
        );
    return refusal === null ? { background } : { error: refusal };
}

const setBackground = definePlanCommand<SetBackgroundParams>({
    type: 'setBackground',
    labelKey: 'engine.plan.command.label.set_background',
    paramsSchema: SetBackgroundSchema,
    validate(_doc, p) {
        const plan = planSetBackground(p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planSetBackground(p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        d.background = plan.background;
    },
    touchesGeometry: false,
});

// ---- setBackgroundProps -----------------------------------------------------------------------

type BackgroundProps = Partial<
    Pick<BackgroundImage, 'rotation' | 'opacity' | 'visible' | 'locked'>
> & { position?: Point };

/** The values `setBackgroundProps` gives the background, or the refusal. */
function planProps(
    doc: Pick<PlanDocument, 'background'>,
    p: SetBackgroundPropsParams,
): Planned<BackgroundProps> {
    const had = backgroundOf(doc);
    if (hasError(had)) return had;
    const { props } = p;
    const values: BackgroundProps = {};
    if (props.position !== undefined) {
        values.position = roundPoint(props.position);
    }
    if (props.rotation !== undefined) {
        values.rotation = storedRotation(props.rotation);
    }
    if (props.opacity !== undefined) values.opacity = props.opacity;
    if (props.visible !== undefined) values.visible = props.visible;
    if (props.locked !== undefined) values.locked = props.locked;
    const refusal =
        (values.position === undefined
            ? null
            : checkPoint('props.position', values.position)) ??
        (values.opacity === undefined
            ? null
            : checkRange(
                  'props.opacity',
                  values.opacity,
                  ...BACKGROUND_OPACITY_RANGE,
              ));
    return refusal === null ? values : { error: refusal };
}

const setBackgroundProps = definePlanCommand<SetBackgroundPropsParams>({
    type: 'setBackgroundProps',
    labelKey: 'engine.plan.command.label.set_background_props',
    paramsSchema: SetBackgroundPropsSchema,
    validate(doc, p) {
        const plan = planProps(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planProps(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const bg = d.background!;
        if (plan.position !== undefined) writePoint(bg.position, plan.position);
        if (plan.rotation !== undefined) bg.rotation = plan.rotation;
        if (plan.opacity !== undefined) bg.opacity = plan.opacity;
        if (plan.visible !== undefined) bg.visible = plan.visible;
        if (plan.locked !== undefined) bg.locked = plan.locked;
    },
    mergeKey: () => 'bgProps',
    mergeMode: 'replace',
    touchesGeometry: false,
});

// ---- calibrateBackground ------------------------------------------------------------------

/** What `calibrateBackground` does: the factor and the new scale, and the scaling for a plan-space one. */
interface CalibrationPlan {
    /** New `mmPerPixel` over the old one. */
    factor: number;
    /** The new `mmPerPixel`. */
    mmPerPixel: number;
    /** `null` for an image-space calibration, which moves nothing. */
    scaling: PlanScaling | null;
    scaleGeometry: boolean;
}

/** The checks and numbers of an image-space calibration (06 §12.2). */
function planImageCalibration(
    bg: BackgroundImage,
    p: Extract<CalibrateBackgroundParams, { space: 'image' }>,
): Planned<CalibrationPlan> {
    const pixels = dist(p.a, p.b);
    if (pixels < CALIBRATION_MIN_PIXELS) return tooShort(pixels);
    const mmPerPixel = p.distanceMm / pixels;
    const refusal =
        checkRange(
            'distanceMm',
            p.distanceMm,
            CALIBRATION_MIN_DISTANCE,
            MAX_SPAN,
        ) ?? checkBackgroundScale('mmPerPixel', mmPerPixel);
    return refusal === null
        ? {
              factor: mmPerPixel / bg.mmPerPixel,
              mmPerPixel,
              scaling: null,
              scaleGeometry: false,
          }
        : { error: refusal };
}

/** The checks and numbers of a calibration from two plan points (the editor's Background tool). */
function planPlanCalibration(
    bg: BackgroundImage,
    p: Extract<CalibrateBackgroundParams, { space: 'plan' }>,
): Planned<CalibrationPlan> {
    const p1 = roundPoint(p.p1);
    const p2 = roundPoint(p.p2);
    const length = dist(p1, p2);
    const refusal =
        checkPoint('p1', p1) ??
        checkPoint('p2', p2) ??
        (length / bg.mmPerPixel < CALIBRATION_MIN_PIXELS
            ? tooShort(length / bg.mmPerPixel).error
            : null) ??
        checkRange(
            'realDistance',
            p.realDistance,
            CALIBRATION_MIN_DISTANCE,
            MAX_SPAN,
        );
    if (refusal !== null) return { error: refusal };
    const factor = p.realDistance / length;
    const scale = checkBackgroundScale('mmPerPixel', bg.mmPerPixel * factor);
    if (scale !== null) return { error: scale };
    return {
        factor,
        mmPerPixel: bg.mmPerPixel * factor,
        scaling: { factor, about: p1, sizes: false },
        scaleGeometry: p.scaleGeometry,
    };
}

const tooShort = (pixels: number): { error: EngineMessage } => ({
    error: message('calibration_too_short', {
        pixels: Math.round(pixels * 100) / 100,
        min: CALIBRATION_MIN_PIXELS,
    }),
});

function planCalibration(
    doc: Pick<PlanDocument, 'background'>,
    p: CalibrateBackgroundParams,
): Planned<CalibrationPlan> {
    const had = backgroundOf(doc);
    if (hasError(had)) return had;
    const bg = had.background;
    if (bg.locked) return { error: message('background_locked') };
    return p.space === 'plan'
        ? planPlanCalibration(bg, p)
        : planImageCalibration(bg, p);
}

export interface CalibrateBackgroundResult {
    /** New `mmPerPixel` over the old one. */
    factor: number;
}

const calibrateBackground = definePlanCommand<
    CalibrateBackgroundParams,
    CalibrateBackgroundResult
>({
    type: 'calibrateBackground',
    labelKey: 'engine.plan.command.label.calibrate_background',
    paramsSchema: CalibrateBackgroundSchema,
    validate(doc, p) {
        const plan = planCalibration(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planCalibration(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const bg = d.background!;
        if (plan.scaling === null) {
            bg.mmPerPixel = plan.mmPerPixel;
        } else {
            scaleBackground(bg, plan.scaling);
            if (plan.scaleGeometry) scalePlan(d, ctx.geometry, plan.scaling);
        }
        out.result = { factor: plan.factor };
    },
    touchesGeometry: true,
});

// ---- removeBackground -------------------------------------------------------------------------

const removeBackground = definePlanCommand<RemoveBackgroundParams>({
    type: 'removeBackground',
    labelKey: 'engine.plan.command.label.remove_background',
    paramsSchema: RemoveBackgroundSchema,
    validate: () => null,
    run(d, _p, _ctx, out) {
        if (d.background === null) return;
        d.background = null;
        pushDeleted(out, 'background');
    },
    touchesGeometry: false,
});

/** The background commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const BACKGROUND_COMMANDS = {
    setBackground,
    setBackgroundProps,
    calibrateBackground,
    removeBackground,
};
