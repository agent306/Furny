/**
 * Hardware spec schemas per category (08 §2.3) and the hardware role keys of
 * 07 §6.11. Every schema is a loose object: extra keys are kept and ignored by
 * the engine (admin forms render the documented fields per category).
 *
 * Documented defaults are applied at parse time, so engine code can read
 * `specs.boringDistanceMm` without re-deriving them. Slide geometry defaults
 * depend on the slide `type`.
 */
import { z } from 'zod';
import type { HardwareCategory } from './snapshot';

/** Non-negative integer millimetres (or other integral unit). */
const Int = z.number().int().nonnegative();

/** Role keys of `hardware_items.is_default_for` (07 §6.11), exhaustive. */
export const HARDWARE_ROLE_KEYS = [
    'hinge.full_overlay',
    'hinge.half_overlay',
    'hinge.inset',
    'hinge_plate.default',
    'slide.side_mount',
    'slide.undermount',
    'handle.default',
    'handle.flush',
    'knob.default',
    'leg.plinth',
    'leg.cabinet',
    'leg.table',
    'rod.default',
    'rod_support.default',
    'shelf_support.default',
    'connector.cam',
    'connector.dowel',
    'connector.table_corner',
    'wall_bracket.default',
    'anti_tip.default',
    'sliding_track.default',
    'sliding_roller.default',
    'gas_strut.default',
    'lift.default',
    'basket.default',
    'screw_pack.default',
    'lock.default',
    'led_strip.default',
] as const;
export type HardwareRoleKey = (typeof HARDWARE_ROLE_KEYS)[number];

const HingeSpecs = z.looseObject({
    overlay: z.enum(['full', 'half', 'inset']),
    crankMm: z.number().nonnegative().optional(),
    openingAngle: Int.optional(),
    softClose: z.boolean().optional(),
    cupDiameterMm: z.number().positive().default(35),
    boringDistanceMm: z.number().min(3).max(6).default(4),
    integratedPlate: z.boolean().default(false),
    maxDoorWeightKg: z.number().nonnegative().optional(),
});

const HingePlateSpecs = z.looseObject({ heightMm: z.number().optional() });

const DrawerSlideSpecs = z
    .looseObject({
        type: z.enum(['side_mount', 'undermount']),
        family: z.string().min(1),
        lengthMm: Int,
        loadKg: Int.optional(),
        softClose: z.boolean().optional(),
        extension: z.enum(['full', 'partial']).optional(),
        clearancePerSideMm: z.number().nonnegative().optional(),
        innerWidthDeductionMm: z.number().nonnegative().optional(),
        lengthDeductionMm: z.number().nonnegative().optional(),
        bottomRecessMm: z.number().nonnegative().optional(),
        maxSideThicknessMm: z.number().positive().optional(),
    })
    .transform((s) =>
        s.type === 'side_mount'
            ? { ...s, clearancePerSideMm: s.clearancePerSideMm ?? 12.7 }
            : {
                  ...s,
                  innerWidthDeductionMm: s.innerWidthDeductionMm ?? 42,
                  lengthDeductionMm: s.lengthDeductionMm ?? 10,
                  bottomRecessMm: s.bottomRecessMm ?? 13,
                  maxSideThicknessMm: s.maxSideThicknessMm ?? 16,
              },
    );

const HandleSpecs = z.looseObject({
    lengthMm: Int.optional(),
    holeSpacingMm: Int.optional(),
    holeCount: Int.default(2),
    flush: z.boolean().optional(),
});

const KnobSpecs = z.looseObject({
    diameterMm: Int.optional(),
    holeCount: Int.default(1),
});

const LegSpecs = z.looseObject({
    heightMm: Int.optional(),
    minHeightMm: Int.optional(),
    maxHeightMm: Int.optional(),
    adjustableMm: Int.optional(),
    sectionMm: Int.optional(),
});

const PlinthLegSpecs = z.looseObject({ minHeightMm: Int, maxHeightMm: Int });

const HangingRodSpecs = z.looseObject({
    maxLengthMm: Int.default(1200),
    profile: z.enum(['oval', 'round']).optional(),
});

const EmptySpecs = z.looseObject({});

const ShelfSupportSpecs = z.looseObject({ pinDiameterMm: Int.optional() });

const ConnectorSpecs = z.looseObject({
    kind: z.enum(['cam', 'dowel', 'table_corner', 'confirmat', 'other']),
});

const LiftMechanismSpecs = z.looseObject({
    maxFlapWeightKg: z.number().nonnegative().optional(),
});

const SlidingTrackSpecs = z.looseObject({
    lengthMm: Int,
    tracks: z.union([z.literal(2), z.literal(3)]).optional(),
    system: z.enum(['top_hung', 'bottom_rolling']).optional(),
});

const SlidingRollerSpecs = z.looseObject({
    maxLeafWeightKg: z.number().nonnegative().optional(),
});

const GasStrutSpecs = z.looseObject({ forceN: Int.optional() });

const ScrewPackSpecs = z.looseObject({ pieces: Int.optional() });

const WallBracketSpecs = z.looseObject({
    kind: z.enum(['hanging', 'anti_tip']).optional(),
    loadKg: Int.optional(),
});

const OtherSpecs = z.looseObject({
    kind: z.string().optional(),
    minInnerWidthMm: Int.optional(),
    maxInnerWidthMm: Int.optional(),
    minDepthMm: Int.optional(),
});

/** One schema per `HardwareCategory` (08 §2.3). */
export const HARDWARE_SPEC_SCHEMAS = {
    hinge: HingeSpecs,
    hinge_plate: HingePlateSpecs,
    drawer_slide: DrawerSlideSpecs,
    handle: HandleSpecs,
    knob: KnobSpecs,
    leg: LegSpecs,
    plinth_leg: PlinthLegSpecs,
    hanging_rod: HangingRodSpecs,
    rod_support: EmptySpecs,
    shelf_support: ShelfSupportSpecs,
    connector: ConnectorSpecs,
    lock: EmptySpecs,
    lift_mechanism: LiftMechanismSpecs,
    sliding_track: SlidingTrackSpecs,
    sliding_roller: SlidingRollerSpecs,
    gas_strut: GasStrutSpecs,
    damper: EmptySpecs,
    screw_pack: ScrewPackSpecs,
    wall_bracket: WallBracketSpecs,
    led_strip: EmptySpecs,
    other: OtherSpecs,
} satisfies Record<HardwareCategory, z.ZodTypeAny>;

/** Parsed specs of a hardware row: the documented fields plus any extra keys. */
export type HardwareSpecs = Record<string, unknown>;

/** Output type of the spec schema of category `C`. */
export type HardwareSpecsOf<C extends HardwareCategory> = z.output<
    (typeof HARDWARE_SPEC_SCHEMAS)[C]
>;

/** Validates `specs` against the schema of `category` and applies its defaults. */
export function parseHardwareSpecs(
    category: HardwareCategory,
    specs: unknown,
): z.ZodSafeParseResult<HardwareSpecs> {
    const schema: z.ZodType<HardwareSpecs> = HARDWARE_SPEC_SCHEMAS[category];
    return schema.safeParse(specs);
}
