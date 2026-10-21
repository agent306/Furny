import { z } from 'zod';
import { isEntityId, type IdPrefix } from '../ids';
import { FIXTURE_KEYS } from './fixtures';
import { ROOM_TYPES } from './roomTypes';

/**
 * Structural plan document schema (03 §1): types, enums, integer millimetres,
 * angle domain, id shape and record-key consistency. Numeric ranges of 03 §1.1
 * (thickness, height, width, sill, coordinates) belong to `validatePlan`, so
 * that imported documents still load and can be repaired in the editor.
 * References to other entities (`a`, `b`, `wallId`, `designId`) are plain
 * strings: a dangling reference is reported by `validatePlan`, not a parse error.
 */

export const DOOR_TYPES = [
    'single_swing',
    'double_swing',
    'sliding',
    'pocket',
    'bifold',
    'main_entrance',
] as const;
export const WINDOW_TYPES = [
    'casement',
    'sliding_window',
    'fixed',
    'french_window',
    'bay',
    'ventilator',
] as const;
export const WALL_KINDS = [
    'exterior',
    'interior',
    'partition',
    'half',
] as const;
export const WALL_MATERIALS = [
    'brick',
    'concrete',
    'drywall',
    'glass',
    'other',
] as const;
export const FLOOR_FINISHES = [
    'tile',
    'wood',
    'marble',
    'carpet',
    'concrete',
    'other',
] as const;

export const DoorTypeSchema = z.enum(DOOR_TYPES);
export const WindowTypeSchema = z.enum(WINDOW_TYPES);

/** Integer millimetres. */
const Mm = z.number().int();
/** Degrees in [0, 360). */
const Deg = z.number().min(0).lt(360);
const ColorHex = z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable();

function entityId(prefix: IdPrefix) {
    return z.string().refine((id) => isEntityId(id, prefix), {
        message: `expected an id of the form ${prefix}_[0-9a-z]{10}`,
    });
}

/** `Record<id, entity>` whose keys must equal each entity's own `id`. */
function entityRecord<T extends z.ZodType<{ id: string }>>(item: T) {
    return z.record(z.string(), item).superRefine((record, ctx) => {
        for (const [key, entity] of Object.entries(record)) {
            if (key !== entity.id) {
                ctx.addIssue({
                    code: 'custom',
                    path: [key, 'id'],
                    message: `record key "${key}" does not match entity id "${entity.id}"`,
                });
            }
        }
    });
}

export const PointSchema = z.object({ x: Mm, y: Mm });
export type Point = z.infer<typeof PointSchema>;

export const PlanMetaSchema = z.object({
    defaultWallHeight: Mm,
    defaultWallThickness: Mm,
    floorThickness: Mm,
    northAngle: Deg.nullable(),
    createdWith: z.enum(['editor', 'import', 'trace']),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

export const WallNodeSchema = z.object({
    id: entityId('n'),
    x: Mm,
    y: Mm,
});
export type WallNode = z.infer<typeof WallNodeSchema>;

export const WallSchema = z.object({
    id: entityId('w'),
    a: z.string(),
    b: z.string(),
    thickness: Mm,
    height: Mm,
    kind: z.enum(WALL_KINDS),
    justification: z.literal('center'),
    material: z.enum(WALL_MATERIALS),
    colorHex: ColorHex,
});
export type Wall = z.infer<typeof WallSchema>;

export const OpeningSchema = z.object({
    id: entityId('o'),
    wallId: z.string(),
    kind: z.enum(['door', 'window', 'opening']),
    // Kind/type consistency is a validatePlan concern.
    type: z.union([DoorTypeSchema, WindowTypeSchema, z.literal('opening')]),
    offset: Mm,
    width: Mm,
    height: Mm,
    sillHeight: Mm,
    hinge: z.enum(['start', 'end']),
    swing: z.enum(['left', 'right']),
    label: z.string().nullable(),
});
export type Opening = z.infer<typeof OpeningSchema>;
export type DoorType = z.infer<typeof DoorTypeSchema>;
export type WindowType = z.infer<typeof WindowTypeSchema>;

export const RoomMetaSchema = z.object({
    id: entityId('r'),
    anchor: PointSchema,
    name: z.string(),
    type: z.enum(ROOM_TYPES),
    floorFinish: z.enum(FLOOR_FINISHES),
    floorColorHex: ColorHex,
    labelOffset: PointSchema.nullable(),
    showArea: z.boolean(),
});
export type RoomMeta = z.infer<typeof RoomMetaSchema>;

export const FurniturePlacementSchema = z.object({
    id: entityId('f'),
    designId: z.string().min(1),
    x: Mm,
    y: Mm,
    rotation: Deg,
    elevation: Mm,
    mirrored: z.boolean(),
    wallAttachment: z
        .object({ wallId: z.string(), side: z.enum(['left', 'right']) })
        .nullable(),
});
export type FurniturePlacement = z.infer<typeof FurniturePlacementSchema>;

export const FixtureSchema = z.object({
    id: entityId('x'),
    libraryKey: z.enum(FIXTURE_KEYS),
    x: Mm,
    y: Mm,
    rotation: Deg,
    width: Mm,
    depth: Mm,
    height: Mm,
    elevation: Mm,
    label: z.string().nullable(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export const DimensionAnnotationSchema = z.object({
    id: entityId('d'),
    a: PointSchema,
    b: PointSchema,
    offset: Mm,
    attachedTo: z
        .object({
            kind: z.literal('wall'),
            wallId: z.string(),
            face: z.enum(['left', 'right', 'center']),
        })
        .nullable(),
});
export type DimensionAnnotation = z.infer<typeof DimensionAnnotationSchema>;

export const TextLabelSchema = z.object({
    id: entityId('t'),
    position: PointSchema,
    text: z.string().max(200),
    fontSize: Mm,
    rotation: Deg,
});
export type TextLabel = z.infer<typeof TextLabelSchema>;

export const BackgroundImageSchema = z.object({
    importId: z.string().nullable(),
    mediaUuid: z.string(),
    pixelWidth: z.number().int(),
    pixelHeight: z.number().int(),
    mmPerPixel: z.number(),
    position: PointSchema,
    rotation: Deg,
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
    locked: z.boolean(),
});
export type BackgroundImage = z.infer<typeof BackgroundImageSchema>;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const ViewStateSchema = z.object({
    mode2d: z.object({ centerX: Mm, centerY: Mm, zoom: z.number() }).nullable(),
    mode3d: z
        .object({
            camera: z.enum(['orbit', 'top', 'walk']),
            position: Vec3,
            target: Vec3,
        })
        .nullable(),
    lastMode: z.enum(['2d', '3d']),
});
export type ViewState = z.infer<typeof ViewStateSchema>;

export const PlanDocumentSchema = z.object({
    schemaVersion: z.literal(1),
    meta: PlanMetaSchema,
    nodes: entityRecord(WallNodeSchema),
    walls: entityRecord(WallSchema),
    openings: entityRecord(OpeningSchema),
    rooms: entityRecord(RoomMetaSchema),
    placements: entityRecord(FurniturePlacementSchema),
    fixtures: entityRecord(FixtureSchema),
    annotations: z.object({
        dimensions: entityRecord(DimensionAnnotationSchema),
        labels: entityRecord(TextLabelSchema),
    }),
    background: BackgroundImageSchema.nullable(),
    view: ViewStateSchema,
});
export type PlanDocument = z.infer<typeof PlanDocumentSchema>;
