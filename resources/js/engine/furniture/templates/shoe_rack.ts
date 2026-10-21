/**
 * `shoe_rack` (07 §2.4.10): a shallow shoe cabinet with one hinged door per
 * column.
 */
import { z } from 'zod';
import type { Front, FurnitureDocument, Section } from '../schema';
import type { SectionBuilders } from './common';
import {
    tracked,
    carcassDocument,
    commonCarcass,
    dimensionFields,
    hingedFront,
    interiorHeight,
    leaf,
    resolveDefaultMaterials,
    shelfCount,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

/** Width per column. */
const COLUMN_WIDTH = 600;
const SHELF_PITCH = 180;
const PLINTH_HEIGHT = 60;
const PLINTH_SETBACK = 20;

export const shoeRackParamsSchema = z.object({
    width: z.number().int().min(400).max(1500),
    height: z.number().int().min(600).max(1800),
    depth: z.number().int().min(300).max(420),
});
export type ShoeRackParams = z.infer<typeof shoeRackParamsSchema>;

const defaults: ShoeRackParams = { width: 800, height: 1000, depth: 350 };

export const shoeRack: TemplateDefinition<ShoeRackParams> = {
    key: 'shoe_rack',
    family: 'carcass',
    category: 'storage',
    nameKey: 'templates.shoe_rack.name',
    descriptionKey: 'templates.shoe_rack.description',
    thumbnail: '/images/templates/shoe_rack.svg',
    fields: dimensionFields([400, 1500], [600, 1800], [300, 420]),
    defaults,
    paramsSchema: shoeRackParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const columns = Math.max(1, Math.ceil(params.width / COLUMN_WIDTH));
        const ih = interiorHeight(params.height, PLINTH_HEIGHT);

        const sections: Section[] = [];
        const column = tracked(sections, () =>
            leaf(shelvesContent(shelfCount(ih, SHELF_PITCH)), ctx),
        );
        const builders: SectionBuilders = Array.from(
            { length: columns },
            () => [{ mode: 'flex', weight: 1 }, column],
        );
        // A divided section needs two children, so one column is the root itself.
        const interior =
            columns > 1 ? split('columns', builders, ctx) : column();

        const fronts: Front[] = sections.map((section, index) =>
            hingedFront([section.id], 1, index === 0 ? 'left' : 'right', ctx),
        );

        return carcassDocument(
            'shoe_rack',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(shoeRack, ctx),
            {
                ...commonCarcass(ctx),
                plinth: {
                    type: 'plinth',
                    height: PLINTH_HEIGHT,
                    setback: PLINTH_SETBACK,
                    legCode: null,
                },
                back: { type: 'nailed' },
                interior,
                fronts,
            },
        );
    },
};
