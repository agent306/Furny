/**
 * `bookshelf` (07 §2.4.7): a shelving unit of one or more columns, optionally
 * with hinged doors on a lower part.
 */
import { z } from 'zod';
import type { Front, FurnitureDocument, Section } from '../schema';
import {
    booleanField,
    carcassDocument,
    commonCarcass,
    dimensionFields,
    evenSplit,
    hingedFront,
    intField,
    interiorHeight,
    leaf,
    maxColumns,
    resolveDefaultMaterials,
    shelfCount,
    shelvesContent,
    split,
} from './common';
import type { TemplateDefinition } from './types';

const COLUMNS_MAX = 6;
/** Width per column for `columns = 'auto'`. */
const AUTO_COLUMN_WIDTH = 800;
const SHELF_PITCH = 330;
const PLINTH_HEIGHT = 60;
const LOWER_PART_HEIGHT = 700;
const MIN_UPPER_HEIGHT = 200;
const BOARD_THICKNESS = 18;

export const bookshelfParamsSchema = z.object({
    width: z.number().int().min(300).max(2400),
    height: z.number().int().min(600).max(2400),
    depth: z.number().int().min(200).max(450),
    columns: z.union([
        z.literal('auto'),
        z.number().int().min(1).max(COLUMNS_MAX),
    ]),
    lowerDoors: z.boolean(),
});
export type BookshelfParams = z.infer<typeof bookshelfParamsSchema>;

const defaults: BookshelfParams = {
    width: 900,
    height: 1800,
    depth: 300,
    columns: 'auto',
    lowerDoors: false,
};

export const bookshelf: TemplateDefinition<BookshelfParams> = {
    key: 'bookshelf',
    family: 'carcass',
    category: 'shelving',
    nameKey: 'templates.bookshelf.name',
    descriptionKey: 'templates.bookshelf.description',
    thumbnail: '/images/templates/bookshelf.svg',
    fields: [
        ...dimensionFields([300, 2400], [600, 2400], [200, 450]),
        intField('columns', 1, COLUMNS_MAX, { allowAuto: true }),
        booleanField('lowerDoors'),
    ],
    defaults,
    paramsSchema: bookshelfParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const requested =
            params.columns === 'auto'
                ? Math.max(1, Math.ceil(params.width / AUTO_COLUMN_WIDTH))
                : params.columns;
        // Fewer columns when the width cannot give each one 100 mm.
        const columns = Math.min(
            requested,
            maxColumns(params.width - 2 * BOARD_THICKNESS),
        );
        const ih = interiorHeight(params.height, PLINTH_HEIGHT);
        // A low shelf cannot hold the 700 mm lower part: it keeps 200 mm above it.
        const lowerHeight = Math.min(
            LOWER_PART_HEIGHT,
            ih - BOARD_THICKNESS - MIN_UPPER_HEIGHT,
        );
        // With a lower part the shelves only get what is left above it.
        const shelvesHeight = params.lowerDoors
            ? ih - BOARD_THICKNESS - lowerHeight
            : ih;

        const upperColumns = () =>
            evenSplit(
                'columns',
                columns,
                () =>
                    leaf(
                        shelvesContent(
                            shelfCount(shelvesHeight, SHELF_PITCH),
                            0,
                        ),
                        ctx,
                    ),
                ctx,
            );

        let interior: Section;
        const fronts: Front[] = [];
        if (params.lowerDoors) {
            const lower: Section[] = [];
            interior = split(
                'rows',
                [
                    [{ mode: 'flex', weight: 1 }, upperColumns],
                    [
                        { mode: 'fixed', mm: lowerHeight },
                        () =>
                            evenSplit(
                                'columns',
                                columns,
                                () => {
                                    const section = leaf(
                                        shelvesContent(1),
                                        ctx,
                                    );
                                    lower.push(section);
                                    return section;
                                },
                                ctx,
                            ),
                    ],
                ],
                ctx,
            );
            for (const section of lower) {
                fronts.push(hingedFront([section.id], 'auto', 'auto', ctx));
            }
        } else {
            interior = upperColumns();
        }

        return carcassDocument(
            'bookshelf',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(bookshelf, ctx),
            {
                ...commonCarcass(ctx),
                plinth: {
                    type: 'plinth',
                    height: PLINTH_HEIGHT,
                    setback: 0,
                    legCode: null,
                },
                back: { type: 'nailed' },
                interior,
                fronts,
            },
        );
    },
};
