/**
 * Annotation commands (04 §6.6): `addDimension`, `setDimension`,
 * `deleteDimensions`, `addLabel`, `setLabel` and `deleteLabels`.
 *
 * `validate` and `run` share one planner per command (see `openings.ts`);
 * points and attachments are written field by field so that an unchanged
 * value makes no patch. Adding or changing a dimension runs the geometry
 * post-processing only so that an attached dimension takes its points from
 * the wall face (`postprocess.ts`, step 2); `addDimension` and `setDimension`
 * do not compute them themselves.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - The length of a dimension is judged on the rounded `a` and `b` as given
 *   (or as merged with the stored ones by `setDimension`), also when
 *   `attachedTo` is set and post-processing then overwrites them. A
 *   `setDimension` that gives neither `a` nor `b` is not judged on length, so
 *   an old dimension can still be moved or detached.
 * - Contract carried to P4 (the plan editor, 05): an attached `addDimension`
 *   must still send `a` and `b` at least 10 mm apart, as placeholders that
 *   post-processing overwrites with the wall face. An editor that sends
 *   `a = b` is refused with `dimension_too_short`.
 * - `setDimension { attachedTo: undefined }` leaves the attachment alone,
 *   `null` detaches it (the points stay where they were).
 * - Label text is trimmed and counted in code points.
 */
import { z } from 'zod';
import { CommandAbort } from '../../commands/types';
import { dist } from '../../geometry/vec2';
import {
    DIMENSION_MIN_LENGTH,
    DIMENSION_OFFSET_MAX,
    LABEL_FONT_SIZE_RANGE,
    LABEL_TEXT_RANGE,
} from '../limits';
import type { DimensionAnnotation, PlanDocument, TextLabel } from '../schema';
import type { EngineMessage } from '../types';
import { PointParamSchema, definePlanCommand } from './define';
import { pushDeleted } from './helpers';
import { storedRotation } from './postprocess';
import {
    type Planned,
    checkIds,
    checkPoint,
    checkRange,
    has,
    hasError,
    message,
    mm,
    notFound,
    uniqueSorted,
} from './validators';

type Point = { x: number; y: number };
type Attachment = DimensionAnnotation['attachedTo'];

/** The default font size of a new label, mm. */
const DEFAULT_FONT_SIZE = 250;

// ---- params schemas -------------------------------------------------------------------------

const AttachmentSchema = z.object({
    kind: z.literal('wall'),
    wallId: z.string(),
    face: z.enum(['left', 'right', 'center']),
});

const AddDimensionSchema = z.object({
    a: PointParamSchema,
    b: PointParamSchema,
    offset: z.number(),
    attachedTo: AttachmentSchema.nullable(),
});
type AddDimensionParams = z.infer<typeof AddDimensionSchema>;

const SetDimensionSchema = z.object({
    dimensionId: z.string(),
    a: PointParamSchema.optional(),
    b: PointParamSchema.optional(),
    offset: z.number().optional(),
    attachedTo: AttachmentSchema.nullable().optional(),
});
type SetDimensionParams = z.infer<typeof SetDimensionSchema>;

const DeleteDimensionsSchema = z.object({
    dimensionIds: z.array(z.string()).min(1),
});
type DeleteDimensionsParams = z.infer<typeof DeleteDimensionsSchema>;

const AddLabelSchema = z.object({
    position: PointParamSchema,
    text: z.string(),
    fontSize: z.number().optional(),
    rotation: z.number().optional(),
});
type AddLabelParams = z.infer<typeof AddLabelSchema>;

const SetLabelSchema = z.object({
    labelId: z.string(),
    props: z.object({
        position: PointParamSchema.optional(),
        text: z.string().optional(),
        fontSize: z.number().optional(),
        rotation: z.number().optional(),
    }),
});
type SetLabelParams = z.infer<typeof SetLabelSchema>;

const DeleteLabelsSchema = z.object({
    labelIds: z.array(z.string()).min(1),
});
type DeleteLabelsParams = z.infer<typeof DeleteLabelsSchema>;

// ---- shared ---------------------------------------------------------------------------------------

const roundPoint = (p: Point): Point => ({ x: mm(p.x), y: mm(p.y) });

/** Writes a point field by field, so an equal point makes no patch. */
function writePoint(target: Point, to: Point): void {
    target.x = to.x;
    target.y = to.y;
}

// ---- dimensions -------------------------------------------------------------------------------------

interface DimensionFields {
    a: Point;
    b: Point;
    offset: number;
    attachedTo: Attachment;
}

/** Checks of the values a dimension would hold, in the order of 04 §6.6. */
function checkDimension(
    doc: Pick<PlanDocument, 'walls'>,
    d: DimensionFields,
    judgeLength: boolean,
): EngineMessage | null {
    const range =
        checkPoint('a', d.a) ??
        checkPoint('b', d.b) ??
        checkRange(
            'offset',
            d.offset,
            -DIMENSION_OFFSET_MAX,
            DIMENSION_OFFSET_MAX,
        );
    if (range !== null) return range;
    if (d.attachedTo !== null && !has(doc.walls, d.attachedTo.wallId)) {
        return notFound(d.attachedTo.wallId);
    }
    return judgeLength && dist(d.a, d.b) < DIMENSION_MIN_LENGTH
        ? message('dimension_too_short', {
              length: mm(dist(d.a, d.b)),
              min: DIMENSION_MIN_LENGTH,
          })
        : null;
}

function planAddDimension(
    doc: PlanDocument,
    p: AddDimensionParams,
): Planned<{ dimension: Omit<DimensionAnnotation, 'id'> }> {
    const dimension = {
        a: roundPoint(p.a),
        b: roundPoint(p.b),
        offset: mm(p.offset),
        attachedTo: p.attachedTo,
    };
    const refusal = checkDimension(doc, dimension, true);
    return refusal === null ? { dimension } : { error: refusal };
}

export interface AddDimensionResult {
    dimensionId: string;
}

const addDimension = definePlanCommand<AddDimensionParams, AddDimensionResult>({
    type: 'addDimension',
    labelKey: 'engine.plan.command.label.add_dimension',
    paramsSchema: AddDimensionSchema,
    validate(doc, p) {
        const plan = planAddDimension(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planAddDimension(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const id = ctx.newId('d');
        d.annotations.dimensions[id] = { id, ...plan.dimension };
        out.result = { dimensionId: id };
    },
    touchesGeometry: true,
});

/** The values `setDimension` gives the dimension, or the refusal. */
function planSetDimension(
    doc: PlanDocument,
    p: SetDimensionParams,
): Planned<DimensionFields> {
    if (!has(doc.annotations.dimensions, p.dimensionId)) {
        return { error: notFound(p.dimensionId) };
    }
    const was = doc.annotations.dimensions[p.dimensionId]!;
    const next: DimensionFields = {
        a: p.a === undefined ? was.a : roundPoint(p.a),
        b: p.b === undefined ? was.b : roundPoint(p.b),
        offset: p.offset === undefined ? was.offset : mm(p.offset),
        attachedTo: p.attachedTo === undefined ? was.attachedTo : p.attachedTo,
    };
    const refusal = checkDimension(
        doc,
        next,
        p.a !== undefined || p.b !== undefined,
    );
    return refusal === null ? next : { error: refusal };
}

const setDimension = definePlanCommand<SetDimensionParams>({
    type: 'setDimension',
    labelKey: 'engine.plan.command.label.set_dimension',
    paramsSchema: SetDimensionSchema,
    validate(doc, p) {
        const plan = planSetDimension(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planSetDimension(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const dimension = d.annotations.dimensions[p.dimensionId]!;
        writePoint(dimension.a, plan.a);
        writePoint(dimension.b, plan.b);
        dimension.offset = plan.offset;
        const to = plan.attachedTo;
        if (to === null || dimension.attachedTo === null) {
            dimension.attachedTo = to;
        } else {
            dimension.attachedTo.wallId = to.wallId;
            dimension.attachedTo.face = to.face;
        }
    },
    mergeKey: (p) => `dim:${p.dimensionId}`,
    mergeMode: 'replace',
    touchesGeometry: true,
});

const deleteDimensions = definePlanCommand<DeleteDimensionsParams>({
    type: 'deleteDimensions',
    labelKey: 'engine.plan.command.label.delete_dimensions',
    paramsSchema: DeleteDimensionsSchema,
    validate: (doc, p) => checkIds(doc.annotations.dimensions, p.dimensionIds),
    run(d, p, _ctx, out) {
        const ids = uniqueSorted(p.dimensionIds);
        for (const id of ids) delete d.annotations.dimensions[id];
        pushDeleted(out, ...ids);
    },
    touchesGeometry: false,
});

// ---- labels ---------------------------------------------------------------------------------------

/** `text_length` unless the trimmed text is 1 to 200 characters (code points). */
function checkText(text: string): EngineMessage | null {
    const length = [...text].length;
    return length < LABEL_TEXT_RANGE[0] || length > LABEL_TEXT_RANGE[1]
        ? message('text_length', {
              length,
              min: LABEL_TEXT_RANGE[0],
              max: LABEL_TEXT_RANGE[1],
          })
        : null;
}

function planAddLabel(
    p: AddLabelParams,
): Planned<{ label: Omit<TextLabel, 'id'> }> {
    const label = {
        position: roundPoint(p.position),
        text: p.text.trim(),
        fontSize: mm(p.fontSize ?? DEFAULT_FONT_SIZE),
        rotation: storedRotation(p.rotation ?? 0),
    };
    const refusal =
        checkPoint('position', label.position) ??
        checkText(label.text) ??
        checkRange('fontSize', label.fontSize, ...LABEL_FONT_SIZE_RANGE);
    return refusal === null ? { label } : { error: refusal };
}

export interface AddLabelResult {
    labelId: string;
}

const addLabel = definePlanCommand<AddLabelParams, AddLabelResult>({
    type: 'addLabel',
    labelKey: 'engine.plan.command.label.add_label',
    paramsSchema: AddLabelSchema,
    validate(_doc, p) {
        const plan = planAddLabel(p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p, ctx, out) {
        const plan = planAddLabel(p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const id = ctx.newId('t');
        d.annotations.labels[id] = { id, ...plan.label };
        out.result = { labelId: id };
    },
    touchesGeometry: false,
});

/** The values `setLabel` gives the label, or the refusal. */
function planSetLabel(
    doc: PlanDocument,
    p: SetLabelParams,
): Planned<Omit<TextLabel, 'id'>> {
    if (!has(doc.annotations.labels, p.labelId)) {
        return { error: notFound(p.labelId) };
    }
    const was = doc.annotations.labels[p.labelId]!;
    const { props } = p;
    const next = {
        position:
            props.position === undefined
                ? was.position
                : roundPoint(props.position),
        text: props.text === undefined ? was.text : props.text.trim(),
        fontSize:
            props.fontSize === undefined ? was.fontSize : mm(props.fontSize),
        rotation:
            props.rotation === undefined
                ? was.rotation
                : storedRotation(props.rotation),
    };
    const refusal =
        (props.position === undefined
            ? null
            : checkPoint('props.position', next.position)) ??
        (props.text === undefined ? null : checkText(next.text)) ??
        (props.fontSize === undefined
            ? null
            : checkRange(
                  'props.fontSize',
                  next.fontSize,
                  ...LABEL_FONT_SIZE_RANGE,
              ));
    return refusal === null ? next : { error: refusal };
}

const setLabel = definePlanCommand<SetLabelParams>({
    type: 'setLabel',
    labelKey: 'engine.plan.command.label.set_label',
    paramsSchema: SetLabelSchema,
    validate(doc, p) {
        const plan = planSetLabel(doc, p);
        return hasError(plan) ? plan.error : null;
    },
    run(d, p) {
        const plan = planSetLabel(d, p);
        if (hasError(plan)) throw new CommandAbort(plan.error);
        const label = d.annotations.labels[p.labelId]!;
        writePoint(label.position, plan.position);
        label.text = plan.text;
        label.fontSize = plan.fontSize;
        label.rotation = plan.rotation;
    },
    mergeKey: (p) => `label:${p.labelId}`,
    mergeMode: 'replace',
    touchesGeometry: false,
});

const deleteLabels = definePlanCommand<DeleteLabelsParams>({
    type: 'deleteLabels',
    labelKey: 'engine.plan.command.label.delete_labels',
    paramsSchema: DeleteLabelsSchema,
    validate: (doc, p) => checkIds(doc.annotations.labels, p.labelIds),
    run(d, p, _ctx, out) {
        const ids = uniqueSorted(p.labelIds);
        for (const id of ids) delete d.annotations.labels[id];
        pushDeleted(out, ...ids);
    },
    touchesGeometry: false,
});

/** The annotation commands, registered in `PLAN_COMMANDS` (04 §6.6). */
export const ANNOTATION_COMMANDS = {
    addDimension,
    setDimension,
    deleteDimensions,
    addLabel,
    setLabel,
    deleteLabels,
};
