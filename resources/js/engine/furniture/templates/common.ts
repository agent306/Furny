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
import type {
    CarcassSpec,
    Content,
    Front,
    FurnitureDocument,
    MaterialAssignments,
    Overrides,
    Section,
    SectionChild,
} from '../schema';
import type { TemplateContext, TemplateDefinition } from './types';

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
    leaves: number,
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

/** `ih`: the count heuristics' interior height, assuming 18 mm boards. */
export function interiorHeight(H: number, plinthHeight: number): number {
    return H - plinthHeight - 2 * 18;
}

/** Number of shelves that fit `h` at roughly `pitch` spacing (a count, not a part size). */
export function shelfCount(h: number, pitch: number): number {
    return clamp(Math.round(h / pitch) - 1, 1, 20);
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
