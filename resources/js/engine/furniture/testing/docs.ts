/**
 * Shared furniture test documents (07 §12.3 and the §12.4 variants): small
 * `custom_box` carcasses built explicitly, valid against `FurnitureDocumentSchema`.
 * Test-only; not exported from the engine index.
 */
import { readFileSync } from 'node:fs';
import {
    FurnitureDocumentSchema,
    type CarcassSpec,
    type Content,
    type Front,
    type FurnitureDocument,
    type MaterialAssignments,
    type Section,
    type SectionChild,
} from '../schema';

const WARDROBE_FIXTURE = new URL(
    '../../../../../database/fixtures/furniture/wardrobe-3door.json',
    import.meta.url,
);

/** The 07 §12.2 wardrobe fixture, parsed fresh; `patch` may edit it before use. */
export function wardrobeFixture(
    patch: (doc: FurnitureDocument) => void = () => {},
): FurnitureDocument {
    const doc = FurnitureDocumentSchema.parse(
        JSON.parse(readFileSync(WARDROBE_FIXTURE, 'utf8')),
    );
    patch(doc);
    return doc;
}

export const assign = (materialCode: string) => ({
    materialCode,
    edgeBandCode: null,
    finishCode: null,
});

/** The material assignments of the wardrobe fixture (07 §12.2). */
export function defaultMaterials(): MaterialAssignments {
    return {
        carcass: assign('PB18-WHITE'),
        back: assign('HDF3-WHITE'),
        shelf: assign('PB18-WHITE'),
        front: assign('PB18-WHITE'),
        top: assign('PB18-WHITE'),
        drawer_box: assign('PLY12-BWR'),
        drawer_bottom: assign('HDF3-WHITE'),
        plinth: assign('PB18-WHITE'),
        leg: assign('SW50-RUBBER'),
    };
}

/** Id of the single root leaf of the box documents. */
export const BOX_ROOT_ID = 's_0000000001';

/** An undivided section. */
export const leafSection = (
    id: string,
    content: Content | null = { type: 'empty' },
): Section => ({ id, split: 'none', children: [], content });

/** A divided section; `children` are `[size, section]` pairs, left to right / top to bottom. */
export const splitSection = (
    id: string,
    dir: 'columns' | 'rows',
    children: Array<[SectionChild['size'], Section]>,
): Section => ({
    id,
    split: dir,
    children: children.map(([size, section]) => ({ size, section })),
    content: null,
});

export const flex = (weight = 1): SectionChild['size'] => ({
    mode: 'flex',
    weight,
});
export const fixed = (mm: number): SectionChild['size'] => ({
    mode: 'fixed',
    mm,
});

export interface BoxOptions {
    width: number;
    height: number;
    depth: number;
    content?: Content | null;
    /** Replaces the single-leaf interior (then `content` is ignored). */
    interior?: Section;
    fronts?: Front[];
    carcass?: Partial<Omit<CarcassSpec, 'interior' | 'fronts'>>;
    materials?: Partial<MaterialAssignments>;
}

/** A `custom_box` whose interior is one leaf holding `content`. */
export function boxDocument(opts: BoxOptions): FurnitureDocument {
    const carcass: CarcassSpec = {
        construction: { top: 'between_sides', bottom: 'between_sides' },
        mounting: 'floor',
        plinth: { type: 'none', height: 0, setback: 0, legCode: null },
        back: { type: 'grooved' },
        countertop: null,
        handles: {
            code: 'HDL-BAR-160',
            orientation: 'auto',
            placement: 'auto',
        },
        ...opts.carcass,
        interior:
            opts.interior ??
            leafSection(BOX_ROOT_ID, opts.content ?? { type: 'empty' }),
        fronts: opts.fronts ?? [],
    };
    return {
        schemaVersion: 1,
        templateKey: 'custom_box',
        family: 'carcass',
        dims: { width: opts.width, height: opts.height, depth: opts.depth },
        materials: { ...defaultMaterials(), ...opts.materials },
        carcass,
        table: null,
        overrides: {
            parts: {},
            extraParts: [],
            hardware: {},
            extraHardware: [],
        },
        notes: null,
    };
}

/**
 * 07 §12.3: 600 x 720 x 560, three external drawers (equal fronts), no fronts,
 * grooved back, no plinth.
 */
export function drawerTestBox(): FurnitureDocument {
    return boxDocument({
        width: 600,
        height: 720,
        depth: 560,
        content: {
            type: 'drawers',
            count: 3,
            frontHeights: 'equal',
            slideCode: null,
            behindDoor: false,
        },
    });
}

/**
 * 600 x 850 x 560 base unit: legs with a 100 mm kickboard set back 50 mm, and
 * a countertop of 25 mm board overhanging 20 mm at the front.
 */
export function countertopBox(
    overhang: Partial<
        Record<'overhangFront' | 'overhangLeft' | 'overhangRight', number>
    > = {},
): FurnitureDocument {
    return boxDocument({
        width: 600,
        height: 850,
        depth: 560,
        carcass: {
            plinth: { type: 'legs', height: 100, setback: 50, legCode: null },
            countertop: {
                enabled: true,
                overhangFront: 20,
                overhangLeft: 0,
                overhangRight: 0,
                ...overhang,
            },
        },
        materials: { top: assign('PB25-WHITE') },
    });
}
