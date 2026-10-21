/**
 * Shared furniture test documents (07 §12.3 and the §12.4 variants): small
 * `custom_box` carcasses built explicitly, valid against `FurnitureDocumentSchema`.
 * Test-only; not exported from the engine index.
 */
import type {
    CarcassSpec,
    Content,
    Front,
    FurnitureDocument,
    MaterialAssignments,
} from '../schema';

const assign = (materialCode: string) => ({
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

export interface BoxOptions {
    width: number;
    height: number;
    depth: number;
    content?: Content | null;
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
        interior: {
            id: BOX_ROOT_ID,
            split: 'none',
            children: [],
            content: opts.content ?? { type: 'empty' },
        },
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
