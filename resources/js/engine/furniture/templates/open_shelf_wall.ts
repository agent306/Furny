/**
 * `open_shelf_wall` (07 §2.4.8): a floating open shelf unit fixed to a wall,
 * without doors or back.
 */
import { z } from 'zod';
import type { FurnitureDocument } from '../schema';
import {
    carcassDocument,
    commonCarcass,
    dimensionFields,
    evenSplit,
    intField,
    leaf,
    maxColumns,
    maxRows,
    resolveDefaultMaterials,
} from './common';
import type { TemplateDefinition } from './types';

const COUNT_MAX = 6;
const BOARD_THICKNESS = 18;
/** Height per row and width per column for the `'auto'` counts. */
const AUTO_ROW_HEIGHT = 350;
const AUTO_COLUMN_WIDTH = 900;

const count = z.union([
    z.literal('auto'),
    z.number().int().min(1).max(COUNT_MAX),
]);

export const openShelfWallParamsSchema = z.object({
    width: z.number().int().min(300).max(2400),
    height: z.number().int().min(150).max(1200),
    depth: z.number().int().min(150).max(400),
    rows: count,
    columns: count,
});
export type OpenShelfWallParams = z.infer<typeof openShelfWallParamsSchema>;

const defaults: OpenShelfWallParams = {
    width: 1200,
    height: 400,
    depth: 250,
    rows: 'auto',
    columns: 'auto',
};

export const openShelfWall: TemplateDefinition<OpenShelfWallParams> = {
    key: 'open_shelf_wall',
    family: 'carcass',
    category: 'shelving',
    nameKey: 'templates.open_shelf_wall.name',
    descriptionKey: 'templates.open_shelf_wall.description',
    thumbnail: '/images/templates/open_shelf_wall.svg',
    fields: [
        ...dimensionFields([300, 2400], [150, 1200], [150, 400]),
        intField('rows', 1, COUNT_MAX, { allowAuto: true }),
        intField('columns', 1, COUNT_MAX, { allowAuto: true }),
    ],
    defaults,
    paramsSchema: openShelfWallParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const requestedRows =
            params.rows === 'auto'
                ? Math.max(1, Math.round(params.height / AUTO_ROW_HEIGHT))
                : params.rows;
        const requestedColumns =
            params.columns === 'auto'
                ? Math.max(1, Math.ceil(params.width / AUTO_COLUMN_WIDTH))
                : params.columns;
        // Fewer rows and columns when the size cannot give each 80 / 100 mm.
        const rows = Math.min(
            requestedRows,
            maxRows(params.height - 2 * BOARD_THICKNESS),
        );
        const columns = Math.min(
            requestedColumns,
            maxColumns(params.width - 2 * BOARD_THICKNESS),
        );

        // Rows of columns, each split only when it has more than one part.
        const interior = evenSplit(
            'rows',
            rows,
            () =>
                evenSplit(
                    'columns',
                    columns,
                    () => leaf({ type: 'empty' }, ctx),
                    ctx,
                ),
            ctx,
        );

        return carcassDocument(
            'open_shelf_wall',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(openShelfWall, ctx),
            {
                ...commonCarcass(ctx),
                construction: { top: 'over_sides', bottom: 'over_sides' },
                mounting: 'wall',
                back: { type: 'none' },
                interior,
                fronts: [],
            },
        );
    },
};
