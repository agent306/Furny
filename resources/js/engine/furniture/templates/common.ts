/**
 * Shared generator rules for the templates (07 §2.3, §2.5).
 *
 * Section ids are created depth-first, pre-order, children left to right / top
 * to bottom, then the front ids in the order the fronts are listed. `split`
 * therefore takes its children as thunks: it takes its own id first and only
 * then builds the children, so a parent always numbers before its subtree.
 */
import { MATERIAL_ROLES, type MaterialRole } from '../../catalog/snapshot';
import { EngineInputError } from '../../errors';
import { DEFAULT_SHELF_FRONT_SETBACK } from '../constants';
import type {
    CarcassSpec,
    Content,
    Front,
    FurnitureDocument,
    MaterialAssignments,
    Overrides,
    Section,
    SectionChild,
    TemplateKey,
} from '../schema';
import type { ParamField, TemplateContext, TemplateDefinition } from './types';

/** Board thickness of the count heuristics and clamps (the seed boards are 18 mm). */
export const BOARD_THICKNESS = 18;

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** An empty overrides block. */
export function emptyOverrides(): Overrides {
    return { parts: {}, extraParts: [], hardware: {}, extraHardware: [] };
}

/**
 * Per role: the first preferred code that exists and is active, else the
 * catalog role default. Edge bands and finishes start unset.
 */
export function resolveDefaultMaterials(
    def: Pick<TemplateDefinition, 'preferredMaterials'>,
    ctx: TemplateContext,
): MaterialAssignments {
    const entries = MATERIAL_ROLES.map((role: MaterialRole) => {
        const preferred = (def.preferredMaterials?.[role] ?? []).find(
            (code) => ctx.catalog.material(code)?.isActive === true,
        );
        const materialCode =
            preferred ?? ctx.catalog.defaultMaterialFor(role)?.code;
        if (materialCode === undefined) {
            throw new EngineInputError(
                'invalid_input',
                `Catalog has no material for role "${role}"`,
                { role },
            );
        }
        return [
            role,
            { materialCode, edgeBandCode: null, finishCode: null },
        ] as const;
    });
    return Object.fromEntries(entries) as MaterialAssignments;
}

/** Carcass defaults shared by the templates, before interior and fronts. */
export function commonCarcass(
    ctx: TemplateContext,
): Omit<CarcassSpec, 'interior' | 'fronts'> {
    return {
        construction: { top: 'between_sides', bottom: 'between_sides' },
        mounting: 'floor',
        plinth: { type: 'none', height: 0, setback: 0, legCode: null },
        back: { type: 'grooved' },
        countertop: null,
        handles: {
            code: ctx.catalog.defaultHardware('handle.default')?.code ?? null,
            orientation: 'auto',
            placement: 'auto',
        },
    };
}

/** An undivided section holding `content`. */
export function leaf(content: Content, ctx: TemplateContext): Section {
    return { id: ctx.newId('s'), split: 'none', children: [], content };
}

/** Children of a divided section: size and a builder (see `split`). */
export type SectionBuilders = Array<[SectionChild['size'], () => Section]>;

/**
 * A divided section. The children are builders, called in order after this
 * section took its id, which keeps ids in pre-order.
 */
export function split(
    dir: 'columns' | 'rows',
    children: SectionBuilders,
    ctx: TemplateContext,
): Section {
    const id = ctx.newId('s');
    return {
        id,
        split: dir,
        children: children.map(([size, build]) => ({ size, section: build() })),
        content: null,
    };
}

export function hingedFront(
    covers: string[],
    leaves: Front['leaves'],
    hingeSide: Front['hingeSide'],
    ctx: TemplateContext,
    overlay: Front['overlay'] = 'full',
): Front {
    return {
        id: ctx.newId('fr'),
        kind: 'hinged',
        covers,
        leaves,
        hingeSide,
        overlay,
        glass: false,
        handleCode: 'inherit',
        hingeCode: 'auto',
        slidingTrackCode: null,
    };
}

/**
 * `n` equal-weight children of `dir`, built by `build(index)`. A divided
 * section needs two children (03 §2.4), so one child is returned as is.
 */
export function evenSplit(
    dir: 'columns' | 'rows',
    n: number,
    build: (index: number) => Section,
    ctx: TemplateContext,
): Section {
    if (n <= 1) return build(0);
    return split(
        dir,
        Array.from({ length: n }, (_, index) => [
            { mode: 'flex', weight: 1 },
            () => build(index),
        ]),
        ctx,
    );
}

/**
 * Door count per column: pairs of doors, plus one single-door column first
 * (or last for `singleColumnSide = 'right'`) when `doors` is odd.
 */
export function columnsFromDoors(
    doors: number,
    singleColumnSide: 'left' | 'right' = 'left',
): number[] {
    const pairs = Array.from({ length: Math.floor(doors / 2) }, () => 2);
    if (doors % 2 === 0) return pairs;
    return singleColumnSide === 'right' ? [...pairs, 1] : [1, ...pairs];
}

/** Most doors a door-count parameter allows. */
export const DOORS_MAX = 12;
/** Width per door for `doors = 'auto'`. */
const AUTO_DOOR_WIDTH = 600;

/** `doors = 'auto'` resolves to `clamp(round(width / 600), 1, 12)`. */
export function autoDoorCount(width: number): number {
    return clamp(Math.round(width / AUTO_DOOR_WIDTH), 1, DOORS_MAX);
}

/**
 * Hinge side of the door(s) of column `index` of `count` (07 §2.4.1): a
 * single-door column hinges on the carcass-outer side (`left` when first,
 * `right` when last, else `auto`); a double-door column is `auto`.
 */
export function outerHingeSide(
    doorsInColumn: number,
    index: number,
    count: number,
): Front['hingeSide'] {
    if (doorsInColumn !== 1) return 'auto';
    if (index === 0) return 'left';
    return index === count - 1 ? 'right' : 'auto';
}

/**
 * Wraps a section builder so the section it builds is also appended to
 * `into`: the templates use it to find the sections their fronts cover.
 */
export function tracked(into: Section[], build: () => Section): () => Section {
    return () => {
        const section = build();
        into.push(section);
        return section;
    };
}

/** `ih`: the count heuristics' interior height, assuming 18 mm boards. */
export function interiorHeight(H: number, plinthHeight: number): number {
    return H - plinthHeight - 2 * BOARD_THICKNESS;
}

/** Number of shelves that fit `h` at roughly `pitch` spacing (a count, not a part size). */
export function shelfCount(h: number, pitch: number): number {
    return clamp(Math.round(h / pitch) - 1, 1, 20);
}

// --- Count clamps (07 gap, log 19) -------------------------------------------
//
// The §2.4 ranges allow counts that cannot be built (12 doors in 400 mm).
// Generators clamp them before building, so every in-range parameter set
// yields a document without a size error. Like `interiorHeight` these assume
// 18 mm boards and are heuristics, not envelope arithmetic.

/** Narrowest section / door share `validateFurniture` accepts (100 mm). */
const MIN_SECTION_WIDTH = 100;
/** Shortest section height `validateFurniture` accepts (80 mm). */
const MIN_SECTION_HEIGHT = 80;
/**
 * Carcass height one drawer needs: a slot of 100 mm (box height = slot - 40
 * >= 60) plus the board that the end drawers' slots lose to the top and bottom.
 */
const MIN_DRAWER_PITCH = 120;

/** Columns that fit `interiorWidth` (the carcass width less both sides) at 100 mm each. */
export function maxColumns(interiorWidth: number): number {
    return Math.max(
        1,
        Math.floor(
            (interiorWidth + BOARD_THICKNESS) /
                (MIN_SECTION_WIDTH + BOARD_THICKNESS),
        ),
    );
}

/** Rows that fit `interiorHeight` at 80 mm each. */
export function maxRows(interiorHeight: number): number {
    return Math.max(
        1,
        Math.floor(
            (interiorHeight + BOARD_THICKNESS) /
                (MIN_SECTION_HEIGHT + BOARD_THICKNESS),
        ),
    );
}

/**
 * The most doors, up to `doors`, that `columnsFromDoors` can lay out in
 * `interiorWidth` with every door's share of the columns at least 100 mm.
 */
export function fitDoors(doors: number, interiorWidth: number): number {
    for (let n = doors; n > 1; n--) {
        const dividers = columnsFromDoors(n).length - 1;
        if (
            (interiorWidth - dividers * BOARD_THICKNESS) / n >=
            MIN_SECTION_WIDTH
        ) {
            return n;
        }
    }
    return 1;
}

/**
 * The most equal external drawers, up to `count`, that fit `height` of
 * interior with boxes of at least 60 mm. At least one.
 */
export function fitDrawers(count: number, height: number): number {
    return clamp(
        Math.floor((height + 2 * BOARD_THICKNESS) / MIN_DRAWER_PITCH),
        1,
        count,
    );
}

/**
 * Deep copy of `doc` with fresh section and front ids (preset start, 07 §2.5).
 * New ids are drawn sections first (pre-order), then fronts in listed order;
 * `covers` and every override key that contains an old id are rewritten.
 */
export function reidentify(
    doc: FurnitureDocument,
    newId: TemplateContext['newId'],
): FurnitureDocument {
    const copy = structuredClone(doc);
    const carcass = copy.carcass;
    if (!carcass) return copy;

    const map = new Map<string, string>();
    const renumber = (section: Section): void => {
        const fresh = newId('s');
        map.set(section.id, fresh);
        section.id = fresh;
        for (const child of section.children) renumber(child.section);
    };
    renumber(carcass.interior);
    for (const front of carcass.fronts) {
        const fresh = newId('fr');
        map.set(front.id, fresh);
        front.id = fresh;
    }

    for (const front of carcass.fronts) {
        front.covers = front.covers.map((id) => map.get(id) ?? id);
    }

    const idPattern = /(?<![0-9a-z_])(?:s|fr)_[0-9a-z]{10}(?![0-9a-z])/g;
    const rekey = <T>(record: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
            Object.entries(record).map(([key, value]) => [
                key.replace(idPattern, (id) => map.get(id) ?? id),
                value,
            ]),
        );
    copy.overrides.parts = rekey(copy.overrides.parts);
    copy.overrides.hardware = rekey(copy.overrides.hardware);
    return copy;
}

/**
 * `{ ...defaults, ...overrides }` with keys that are not template fields
 * ignored; the merge is validated by `paramsSchema` and the code defaults are
 * used when it fails (07 §2.1 rule 1).
 */
export function effectiveParams<P extends Record<string, unknown>>(
    def: TemplateDefinition<P>,
    defaultOverrides: Record<string, unknown>,
): P {
    const known = new Set(def.fields.map((field) => field.key));
    const merged: Record<string, unknown> = { ...def.defaults };
    for (const [key, value] of Object.entries(defaultOverrides)) {
        if (known.has(key)) merged[key] = value;
    }
    const parsed = def.paramsSchema.safeParse(merged);
    return parsed.success ? parsed.data : { ...def.defaults };
}

// --- Field constructors (07 §2.1, §2.2) ------------------------------------

type FieldExtras = Partial<
    Pick<ParamField, 'advanced' | 'visibleIf' | 'helpKey'>
>;

/** `select` options: labels are `templates.options.{value}`. */
export function selectOptions(values: readonly string[]) {
    return values.map((value) => ({
        value,
        labelKey: `templates.options.${value}`,
    }));
}

export function lengthField(
    key: string,
    min: number,
    max: number,
    extras: FieldExtras = {},
    step = 10,
): ParamField {
    return {
        key,
        kind: 'length',
        labelKey: `templates.fields.${key}`,
        min,
        max,
        step,
        ...extras,
    };
}

export function intField(
    key: string,
    min: number,
    max: number,
    extras: FieldExtras & { allowAuto?: boolean } = {},
): ParamField {
    return {
        key,
        kind: 'int',
        labelKey: `templates.fields.${key}`,
        min,
        max,
        ...extras,
    };
}

export function selectField(
    key: string,
    values: readonly string[],
    extras: FieldExtras = {},
): ParamField {
    return {
        key,
        kind: 'select',
        labelKey: `templates.fields.${key}`,
        options: selectOptions(values),
        ...extras,
    };
}

export function booleanField(
    key: string,
    extras: FieldExtras = {},
): ParamField {
    return {
        key,
        kind: 'boolean',
        labelKey: `templates.fields.${key}`,
        ...extras,
    };
}

/** The three leading `length` fields every template has (07 §2.1 rule 2). */
export function dimensionFields(
    width: [number, number],
    height: [number, number],
    depth: [number, number],
    depthExtras: FieldExtras = {},
): ParamField[] {
    return [
        lengthField('width', ...width),
        lengthField('height', ...height),
        lengthField('depth', ...depth, depthExtras),
    ];
}

// --- Document assembly -------------------------------------------------------

/** A carcass-family document with no overrides and no notes. */
export function carcassDocument(
    key: TemplateKey,
    dims: FurnitureDocument['dims'],
    materials: MaterialAssignments,
    carcass: CarcassSpec,
): FurnitureDocument {
    return {
        schemaVersion: 1,
        templateKey: key,
        family: 'carcass',
        dims,
        materials,
        carcass,
        table: null,
        overrides: emptyOverrides(),
        notes: null,
    };
}

/** The catalog default slide of a type, or null when the catalog has none (07 §2.4.4, §2.4.11). */
export function defaultSlideCode(
    ctx: TemplateContext,
    type: 'side_mount' | 'undermount',
): string | null {
    return ctx.catalog.defaultHardware(`slide.${type}`)?.code ?? null;
}

/** A `drawers` content with equal fronts and no drawers behind a door. */
export function drawersContent(
    count: number,
    slideCode: string | null,
    behindDoor = false,
): Content {
    return {
        type: 'drawers',
        count,
        frontHeights: 'equal',
        slideCode,
        behindDoor,
    };
}

/** An adjustable `shelves` content. */
export function shelvesContent(
    count: number,
    frontSetback = DEFAULT_SHELF_FRONT_SETBACK,
): Content {
    return { type: 'shelves', count, adjustable: true, frontSetback };
}

/** A front of `kind` over `covers` that is not a hinged door (flap or sliding). */
export function otherFront(
    kind: Exclude<Front['kind'], 'hinged'>,
    covers: string[],
    leaves: number,
    ctx: TemplateContext,
): Front {
    return {
        id: ctx.newId('fr'),
        kind,
        covers,
        leaves,
        hingeSide: 'auto',
        overlay: 'full',
        glass: false,
        handleCode: 'inherit',
        hingeCode: kind === 'sliding' ? null : 'auto',
        slidingTrackCode: kind === 'sliding' ? 'auto' : null,
    };
}
