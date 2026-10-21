/**
 * Furniture document schema (03 §2): types, enums, integer millimetres, ids
 * and the count ranges written in the 03 comments. Everything else (dimension
 * ranges, section tree consistency, family/null pairing, code lookups) belongs
 * to `validateFurniture` (03 §2.4), so that stored and imported documents still
 * load and can be repaired in the editor. Codes and references to other
 * entities (`covers`, override keys) are plain strings for the same reason.
 */
import { z } from 'zod';
import { MATERIAL_ROLES } from '../catalog/snapshot';
import { isEntityId, type IdPrefix } from '../ids';

export { MATERIAL_ROLES } from '../catalog/snapshot';
export type { MaterialRole } from '../catalog/snapshot';

/** The 19 furniture templates (07 §2.1). */
export const TEMPLATE_KEYS = [
    'wardrobe_hinged',
    'wardrobe_sliding',
    'loft_cabinet',
    'base_cabinet',
    'wall_cabinet',
    'tall_cabinet',
    'bookshelf',
    'open_shelf_wall',
    'tv_unit',
    'shoe_rack',
    'chest_of_drawers',
    'sideboard',
    'bedside_table',
    'study_desk',
    'dining_table',
    'coffee_table',
    'console_table',
    'dressing_unit',
    'custom_box',
] as const;
export const TemplateKeySchema = z.enum(TEMPLATE_KEYS);
export type TemplateKey = z.infer<typeof TemplateKeySchema>;

/** Deterministic part key, a dot-path (03 §3.6). */
export type PartKey = string;
/** Deterministic hardware key, a dot-path (03 §3.6). */
export type HardwareKey = string;

/** Integer millimetres. */
const Mm = z.number().int();

function entityId(prefix: IdPrefix) {
    return z.string().refine((id) => isEntityId(id, prefix), {
        message: `expected an id of the form ${prefix}_[0-9a-z]{10}`,
    });
}

export const FAMILIES = ['carcass', 'table'] as const;

/** L1/L2 = the two long edges, W1/W2 = the two short edges (03 §2.3). */
export const EDGE_IDS = ['L1', 'L2', 'W1', 'W2'] as const;
export const EdgeIdSchema = z.enum(EDGE_IDS);
export type EdgeId = z.infer<typeof EdgeIdSchema>;

const MaterialRoleSchema = z.enum(MATERIAL_ROLES);
const GrainSchema = z.enum(['length', 'width', 'none']);

export const MaterialAssignmentSchema = z.object({
    materialCode: z.string(),
    edgeBandCode: z.string().nullable(),
    finishCode: z.string().nullable(),
});

/** Exactly one assignment per role. */
export const MaterialAssignmentsSchema = z.record(
    MaterialRoleSchema,
    MaterialAssignmentSchema,
);
export type MaterialAssignments = z.infer<typeof MaterialAssignmentsSchema>;

// --- Sections and contents (03 §2.1) ---------------------------------------

export const ContentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('empty') }),
    z.object({
        type: z.literal('shelves'),
        count: z.number().int().min(1).max(20),
        adjustable: z.boolean(),
        frontSetback: Mm,
    }),
    z.object({
        type: z.literal('drawers'),
        count: z.number().int().min(1).max(10),
        frontHeights: z.union([z.literal('equal'), z.array(Mm)]),
        slideCode: z.string().nullable(),
        behindDoor: z.boolean(),
    }),
    z.object({
        type: z.literal('hanging_rod'),
        topClearance: Mm,
        rodCode: z.string().nullable(),
    }),
    z.object({
        type: z.literal('pull_out_basket'),
        count: z.number().int(),
        basketCode: z.string().nullable(),
    }),
]);
export type Content = z.infer<typeof ContentSchema>;

const SectionSizeSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), mm: Mm }),
    z.object({ mode: z.literal('flex'), weight: z.number().positive() }),
]);

export const SectionSchema = z.object({
    id: entityId('s'),
    split: z.enum(['none', 'columns', 'rows']),
    get children() {
        return z.array(SectionChildSchema);
    },
    content: ContentSchema.nullable(),
});
export const SectionChildSchema = z.object({
    size: SectionSizeSchema,
    get section() {
        return SectionSchema;
    },
});
export type Section = z.infer<typeof SectionSchema>;
export type SectionChild = z.infer<typeof SectionChildSchema>;

export const FRONT_KINDS = [
    'hinged',
    'sliding',
    'flap_up',
    'flap_down',
] as const;

export const FrontSchema = z.object({
    id: entityId('fr'),
    kind: z.enum(FRONT_KINDS),
    covers: z.array(z.string()),
    /** Leaf count: an integer of at least 1, or `'auto'` (03 gives no range). */
    leaves: z.union([z.number().int().min(1), z.literal('auto')]),
    hingeSide: z.enum(['left', 'right', 'auto']),
    overlay: z.enum(['full', 'half', 'inset']),
    glass: z.boolean(),
    /** `'inherit'` = `carcass.handles.code`; null = no handle. */
    handleCode: z.string().nullable(),
    /** `'auto'` = rule-selected hinge; null = none. */
    hingeCode: z.string().nullable(),
    /** `'auto'` = rule-selected track; null = none. Sliding only. */
    slidingTrackCode: z.string().nullable(),
});
export type Front = z.infer<typeof FrontSchema>;

export const CarcassSpecSchema = z.object({
    construction: z.object({
        top: z.enum(['between_sides', 'over_sides']),
        bottom: z.enum(['between_sides', 'over_sides']),
    }),
    mounting: z.enum(['floor', 'wall', 'loft']),
    plinth: z.object({
        type: z.enum(['none', 'plinth', 'legs']),
        height: Mm,
        setback: Mm,
        legCode: z.string().nullable(),
    }),
    back: z.object({ type: z.enum(['none', 'nailed', 'grooved', 'inset']) }),
    countertop: z
        .object({
            enabled: z.boolean(),
            overhangFront: Mm,
            overhangLeft: Mm,
            overhangRight: Mm,
        })
        .nullable(),
    interior: SectionSchema,
    fronts: z.array(FrontSchema),
    handles: z.object({
        code: z.string().nullable(),
        orientation: z.enum(['auto', 'vertical', 'horizontal']),
        placement: z.enum(['auto', 'top', 'middle', 'bottom']),
    }),
});
export type CarcassSpec = z.infer<typeof CarcassSpecSchema>;

// --- Table family (03 §2.2) ------------------------------------------------

export const TableSpecSchema = z.object({
    top: z.object({
        shape: z.enum(['rectangle', 'rounded_rectangle', 'round', 'oval']),
        /** `'material'` = thickness of the top material. */
        thickness: z.union([Mm, z.literal('material')]),
        cornerRadius: Mm,
        overhang: Mm,
    }),
    base: z.object({
        type: z.enum([
            'four_legs',
            'panel_ends',
            'trestle',
            'pedestal',
            'cabinet_ends',
        ]),
        legSource: z.enum(['hardware', 'solid']),
        legCode: z.string().nullable(),
        legSection: Mm,
        apron: z.object({ enabled: z.boolean(), height: Mm, inset: Mm }),
        stretcher: z.boolean(),
    }),
    storage: z.object({
        drawers: z
            .object({
                count: z.number().int().min(0).max(3),
                side: z.enum(['front', 'left', 'right']),
                slideCode: z.string().nullable(),
            })
            .nullable(),
        lowerShelf: z.boolean(),
        endCabinets: z.object({ width: Mm, content: ContentSchema }).nullable(),
    }),
});
export type TableSpec = z.infer<typeof TableSpecSchema>;

// --- Overrides (03 §2.3) ---------------------------------------------------

export const PartOverrideSchema = z.object({
    removed: z.literal(true).optional(),
    materialCode: z.string().optional(),
    /** Edge band code per edge; null = no banding. */
    edges: z.partialRecord(EdgeIdSchema, z.string().nullable()).optional(),
    lengthDelta: Mm.optional(),
    widthDelta: Mm.optional(),
    grain: GrainSchema.optional(),
    note: z.string().optional(),
});
export type PartOverride = z.infer<typeof PartOverrideSchema>;

export const ExtraPartSchema = z.object({
    id: entityId('p'),
    name: z.string(),
    role: MaterialRoleSchema,
    materialCode: z.string(),
    length: Mm,
    width: Mm,
    qty: z.number().int().min(1).max(99),
    edges: z.record(EdgeIdSchema, z.string().nullable()),
    grain: GrainSchema,
    note: z.string().nullable(),
    placement: z
        .object({
            min: z.tuple([Mm, Mm, Mm]),
            size: z.tuple([Mm, Mm, Mm]),
        })
        .nullable(),
});
export type ExtraPart = z.infer<typeof ExtraPartSchema>;

export const HardwareOverrideSchema = z.object({
    removed: z.literal(true).optional(),
    code: z.string().optional(),
    qtyDelta: z.number().int().optional(),
    note: z.string().optional(),
});
export type HardwareOverride = z.infer<typeof HardwareOverrideSchema>;

export const ExtraHardwareSchema = z.object({
    id: entityId('h'),
    code: z.string(),
    qty: z.number().int(),
    note: z.string().nullable(),
});
export type ExtraHardware = z.infer<typeof ExtraHardwareSchema>;

export const OverridesSchema = z.object({
    parts: z.record(z.string(), PartOverrideSchema),
    extraParts: z.array(ExtraPartSchema),
    hardware: z.record(z.string(), HardwareOverrideSchema),
    extraHardware: z.array(ExtraHardwareSchema),
});
export type Overrides = z.infer<typeof OverridesSchema>;

// --- Document (03 §2) ------------------------------------------------------

export const FurnitureDocumentSchema = z.object({
    schemaVersion: z.literal(1),
    templateKey: TemplateKeySchema,
    family: z.enum(FAMILIES),
    /** Overall OUTER bounding box incl. plinth, legs and top overhangs. */
    dims: z.object({ width: Mm, height: Mm, depth: Mm }),
    materials: MaterialAssignmentsSchema,
    /** Required iff `family = 'carcass'` (checked by `validateFurniture`). */
    carcass: CarcassSpecSchema.nullable(),
    /** Required iff `family = 'table'` (checked by `validateFurniture`). */
    table: TableSpecSchema.nullable(),
    overrides: OverridesSchema,
    notes: z.string().nullable(),
});
export type FurnitureDocument = z.infer<typeof FurnitureDocumentSchema>;
