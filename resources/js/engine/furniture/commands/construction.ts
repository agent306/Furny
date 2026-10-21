/**
 * Carcass construction commands (07 §9): `setConstruction`, `setMounting`,
 * `setPlinth`, `setBack`, `setCountertop` and `setHandles`. All of them need a
 * carcass (`not_found { id: 'carcass' }` on a table document). Lengths are
 * rounded to whole millimetres and held to 0-6000 (`out_of_range`; 07 §9 gives
 * no range, so this ruling is ledgered for the spec 19 reconciliation).
 */
import { z } from 'zod';
import { CarcassSpecSchema, type CarcassSpec } from '../schema';
import {
    MAX_MM,
    assign,
    carcassOf,
    checkCarcass,
    checkRange,
    defineFurnitureCommand,
    mergeFields,
    mm,
} from './helpers';

const Construction = CarcassSpecSchema.shape.construction.shape;
const PlinthShape = CarcassSpecSchema.shape.plinth.shape;
const HandlesShape = CarcassSpecSchema.shape.handles.shape;

const NO_PLINTH: CarcassSpec['plinth'] = {
    type: 'none',
    height: 0,
    setback: 0,
    legCode: null,
};

// ---- setConstruction ------------------------------------------------------------------------

const SetConstructionSchema = z.object({
    top: Construction.top.optional(),
    bottom: Construction.bottom.optional(),
});
type SetConstructionParams = z.infer<typeof SetConstructionSchema>;

const setConstruction = defineFurnitureCommand<SetConstructionParams>({
    type: 'furniture.setConstruction',
    labelKey: 'engine.furniture.command.label.set_construction',
    paramsSchema: SetConstructionSchema,
    validate: (doc) => checkCarcass(doc),
    run(d, p) {
        mergeFields(carcassOf(d).construction, p);
    },
});

// ---- setMounting ----------------------------------------------------------------------------

const SetMountingSchema = z.object({
    mounting: CarcassSpecSchema.shape.mounting,
});
type SetMountingParams = z.infer<typeof SetMountingSchema>;

const setMounting = defineFurnitureCommand<SetMountingParams>({
    type: 'furniture.setMounting',
    labelKey: 'engine.furniture.command.label.set_mounting',
    paramsSchema: SetMountingSchema,
    validate: (doc) => checkCarcass(doc),
    run(d, p) {
        const carcass = carcassOf(d);
        carcass.mounting = p.mounting;
        // Wall and loft units have no plinth (07 §9).
        if (p.mounting !== 'floor') mergeFields(carcass.plinth, NO_PLINTH);
    },
});

// ---- setPlinth ------------------------------------------------------------------------------

const SetPlinthSchema = z.object({
    type: PlinthShape.type.optional(),
    height: z.number().optional(),
    setback: z.number().optional(),
    legCode: PlinthShape.legCode.optional(),
});
type SetPlinthParams = z.infer<typeof SetPlinthSchema>;

const setPlinth = defineFurnitureCommand<SetPlinthParams>({
    type: 'furniture.setPlinth',
    labelKey: 'engine.furniture.command.label.set_plinth',
    paramsSchema: SetPlinthSchema,
    validate(doc, p) {
        return (
            checkCarcass(doc) ??
            (p.height === undefined
                ? null
                : checkRange('height', mm(p.height), 0, MAX_MM)) ??
            (p.setback === undefined
                ? null
                : checkRange('setback', mm(p.setback), 0, MAX_MM))
        );
    },
    run(d, p) {
        const plinth = carcassOf(d).plinth;
        const { height, setback, ...rest } = p;
        mergeFields(plinth, {
            ...rest,
            ...(height === undefined ? {} : { height: mm(height) }),
            ...(setback === undefined ? {} : { setback: mm(setback) }),
        });
        // No plinth, no height (07 §9), whatever height was asked for.
        if (p.type === 'none') plinth.height = 0;
    },
    mergeKey: () => 'plinth',
});

// ---- setBack --------------------------------------------------------------------------------

const SetBackSchema = z.object({
    type: CarcassSpecSchema.shape.back.shape.type,
});
type SetBackParams = z.infer<typeof SetBackSchema>;

const setBack = defineFurnitureCommand<SetBackParams>({
    type: 'furniture.setBack',
    labelKey: 'engine.furniture.command.label.set_back',
    paramsSchema: SetBackSchema,
    validate: (doc) => checkCarcass(doc),
    run(d, p) {
        carcassOf(d).back.type = p.type;
    },
});

// ---- setCountertop --------------------------------------------------------------------------

const SetCountertopSchema = CarcassSpecSchema.shape.countertop;
type SetCountertopParams = z.infer<typeof SetCountertopSchema>;

const OVERHANGS = ['overhangFront', 'overhangLeft', 'overhangRight'] as const;

const setCountertop = defineFurnitureCommand<SetCountertopParams>({
    type: 'furniture.setCountertop',
    labelKey: 'engine.furniture.command.label.set_countertop',
    paramsSchema: SetCountertopSchema,
    validate(doc, p) {
        if (p === null) return checkCarcass(doc);
        for (const field of OVERHANGS) {
            const refusal = checkRange(field, mm(p[field]), 0, MAX_MM);
            if (refusal !== null) return refusal;
        }
        return checkCarcass(doc);
    },
    run(d, p) {
        assign(
            carcassOf(d),
            'countertop',
            p === null
                ? null
                : {
                      enabled: p.enabled,
                      overhangFront: mm(p.overhangFront),
                      overhangLeft: mm(p.overhangLeft),
                      overhangRight: mm(p.overhangRight),
                  },
        );
    },
    mergeKey: () => 'countertop',
});

// ---- setHandles -----------------------------------------------------------------------------

const SetHandlesSchema = z.object({
    code: HandlesShape.code.optional(),
    orientation: HandlesShape.orientation.optional(),
    placement: HandlesShape.placement.optional(),
});
type SetHandlesParams = z.infer<typeof SetHandlesSchema>;

const setHandles = defineFurnitureCommand<SetHandlesParams>({
    type: 'furniture.setHandles',
    labelKey: 'engine.furniture.command.label.set_handles',
    paramsSchema: SetHandlesSchema,
    validate: (doc) => checkCarcass(doc),
    run(d, p) {
        mergeFields(carcassOf(d).handles, p);
    },
});

/** The carcass construction commands, registered in `FURNITURE_COMMANDS` (07 §9). */
export const CONSTRUCTION_COMMANDS = {
    'furniture.setConstruction': setConstruction,
    'furniture.setMounting': setMounting,
    'furniture.setPlinth': setPlinth,
    'furniture.setBack': setBack,
    'furniture.setCountertop': setCountertop,
    'furniture.setHandles': setHandles,
};
