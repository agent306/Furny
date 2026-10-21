/**
 * `wardrobe_hinged` (07 §2.4.1): a floor-standing hinged-door wardrobe with
 * shelf column(s) and hanging column(s).
 */
import { z } from 'zod';
import type { Front, FurnitureDocument, Section } from '../schema';
import type { SectionBuilders } from './common';
import {
    autoDoorCount,
    BOARD_THICKNESS,
    DOORS_MAX,
    fitDoors,
    leafFitsSheet,
    sheetDoors,
    outerHingeSide,
    tracked,
    columnsFromDoors,
    commonCarcass,
    emptyOverrides,
    hingedFront,
    interiorHeight,
    leaf,
    resolveDefaultMaterials,
    shelfCount,
    split,
} from './common';
import type { ParamField, TemplateDefinition } from './types';

const SHELF_PITCH = 400;
/**
 * 07 §2.4.1 allows 2700; the sides (height - plinth, plinth down to 0) must
 * fit the 2420 mm usable length of the seed boards (spec 19, R40-2).
 */
const HEIGHT_MAX = 2420;
/** Height of one internal drawer including its share of the divider. */
const INTERNAL_DRAWER_HEIGHT = 180;
const HANGING_ZONE_TOP = 350;
const ROD_TOP_CLEARANCE = 60;
const SHELF_FRONT_SETBACK = 20;
const PLINTH_SETBACK = 20;

const HANGING_STYLES = ['long', 'double'] as const;
const BACK_TYPES = ['grooved', 'nailed', 'inset', 'none'] as const;
const SIDES = ['left', 'right'] as const;

export const wardrobeHingedParamsSchema = z.object({
    width: z.number().int().min(600).max(3600),
    height: z.number().int().min(1500).max(HEIGHT_MAX),
    depth: z.number().int().min(450).max(750),
    doors: z.union([z.literal('auto'), z.number().int().min(1).max(DOORS_MAX)]),
    singleColumnSide: z.enum(SIDES),
    hangingStyle: z.enum(HANGING_STYLES),
    internalDrawers: z.number().int().min(0).max(4),
    plinthHeight: z.number().int().min(0).max(150),
    backType: z.enum(BACK_TYPES),
});
export type WardrobeHingedParams = z.infer<typeof wardrobeHingedParamsSchema>;

const options = (values: readonly string[]) =>
    values.map((value) => ({ value, labelKey: `templates.options.${value}` }));

const fields: ParamField[] = [
    {
        key: 'width',
        kind: 'length',
        labelKey: 'templates.fields.width',
        min: 600,
        max: 3600,
        step: 10,
    },
    {
        key: 'height',
        kind: 'length',
        labelKey: 'templates.fields.height',
        min: 1500,
        max: HEIGHT_MAX,
        step: 10,
    },
    {
        key: 'depth',
        kind: 'length',
        labelKey: 'templates.fields.depth',
        min: 450,
        max: 750,
        step: 10,
        helpKey: 'templates.help.hanging_depth',
    },
    {
        key: 'doors',
        kind: 'int',
        labelKey: 'templates.fields.doors',
        min: 1,
        max: DOORS_MAX,
        allowAuto: true,
    },
    {
        key: 'singleColumnSide',
        kind: 'select',
        labelKey: 'templates.fields.singleColumnSide',
        options: options(SIDES),
        // Always visible: any request can resolve to an odd door count
        // (`auto`, or the fitDoors / sheetDoors clamps), and only then is
        // there a single-door column for this side to place.
    },
    {
        key: 'hangingStyle',
        kind: 'select',
        labelKey: 'templates.fields.hangingStyle',
        options: options(HANGING_STYLES),
    },
    {
        key: 'internalDrawers',
        kind: 'int',
        labelKey: 'templates.fields.internalDrawers',
        min: 0,
        max: 4,
    },
    {
        key: 'plinthHeight',
        kind: 'length',
        labelKey: 'templates.fields.plinthHeight',
        min: 0,
        max: 150,
        step: 10,
        advanced: true,
    },
    {
        key: 'backType',
        kind: 'select',
        labelKey: 'templates.fields.backType',
        options: options(BACK_TYPES),
        advanced: true,
    },
];

const defaults: WardrobeHingedParams = {
    width: 1800,
    height: 2100,
    depth: 600,
    doors: 'auto',
    singleColumnSide: 'left',
    hangingStyle: 'long',
    internalDrawers: 0,
    plinthHeight: 100,
    backType: 'grooved',
};

/** Resolves `doors = 'auto'` to `clamp(round(width / 600), 1, 12)`. */
export function wardrobeDoorCount(params: WardrobeHingedParams): number {
    return params.doors === 'auto' ? autoDoorCount(params.width) : params.doors;
}

export const wardrobeHinged: TemplateDefinition<WardrobeHingedParams> = {
    key: 'wardrobe_hinged',
    family: 'carcass',
    category: 'wardrobe',
    nameKey: 'templates.wardrobe_hinged.name',
    descriptionKey: 'templates.wardrobe_hinged.description',
    thumbnail: '/images/templates/wardrobe_hinged.svg',
    fields,
    defaults,
    paramsSchema: wardrobeHingedParamsSchema,

    generate(params, ctx): FurnitureDocument {
        const materials = resolveDefaultMaterials(wardrobeHinged, ctx);
        // More doors when a leaf would exceed a sheet, fewer when a door
        // would get less than 100 mm (spec 19, Task 40).
        const doors = fitDoors(
            sheetDoors(
                wardrobeDoorCount(params),
                params.width,
                params.height,
                leafFitsSheet(ctx, materials.front.materialCode),
            ),
            params.width - 2 * BOARD_THICKNESS,
        );
        const columns = columnsFromDoors(doors, params.singleColumnSide);
        const ih = interiorHeight(params.height, params.plinthHeight);

        // Internal drawers go into the first single-door column, else the first column.
        const drawerColumn = Math.max(0, columns.indexOf(1));
        const drawersHeight = params.internalDrawers * INTERNAL_DRAWER_HEIGHT;

        const shelves = (height: number) =>
            leaf(
                {
                    type: 'shelves',
                    count: shelfCount(height, SHELF_PITCH),
                    adjustable: true,
                    frontSetback: SHELF_FRONT_SETBACK,
                },
                ctx,
            );
        const rod = () =>
            leaf(
                {
                    type: 'hanging_rod',
                    topClearance: ROD_TOP_CLEARANCE,
                    rodCode: null,
                },
                ctx,
            );

        const buildColumn = (doorsInColumn: number, index: number): Section => {
            if (params.internalDrawers > 0 && index === drawerColumn) {
                return split(
                    'rows',
                    [
                        [
                            { mode: 'flex', weight: 1 },
                            () => shelves(ih - BOARD_THICKNESS - drawersHeight),
                        ],
                        [
                            { mode: 'fixed', mm: drawersHeight },
                            () =>
                                leaf(
                                    {
                                        type: 'drawers',
                                        count: params.internalDrawers,
                                        frontHeights: 'equal',
                                        slideCode: null,
                                        behindDoor: true,
                                    },
                                    ctx,
                                ),
                        ],
                    ],
                    ctx,
                );
            }
            if (doorsInColumn === 1) return shelves(ih);
            const hanging: SectionBuilders = [
                [
                    { mode: 'fixed', mm: HANGING_ZONE_TOP },
                    () => leaf({ type: 'empty' }, ctx),
                ],
                [{ mode: 'flex', weight: 1 }, rod],
            ];
            if (params.hangingStyle === 'double') {
                hanging.push([{ mode: 'flex', weight: 1 }, rod]);
            }
            return split('rows', hanging, ctx);
        };

        const columnSections: Section[] = [];
        const columnBuilders: SectionBuilders = columns.map(
            (doorsInColumn, index) => [
                { mode: 'flex', weight: doorsInColumn },
                tracked(columnSections, () =>
                    buildColumn(doorsInColumn, index),
                ),
            ],
        );
        // A divided section needs two children: one column is the root itself.
        const interior =
            columnBuilders.length > 1
                ? split('columns', columnBuilders, ctx)
                : (columnBuilders[0] as SectionBuilders[number])[1]();

        const fronts: Front[] = columns.map((doorsInColumn, index) =>
            hingedFront(
                [(columnSections[index] as Section).id],
                doorsInColumn,
                outerHingeSide(doorsInColumn, index, columns.length),
                ctx,
            ),
        );

        return {
            schemaVersion: 1,
            templateKey: 'wardrobe_hinged',
            family: 'carcass',
            dims: {
                width: params.width,
                height: params.height,
                depth: params.depth,
            },
            materials,
            carcass: {
                ...commonCarcass(ctx),
                plinth:
                    params.plinthHeight > 0
                        ? {
                              type: 'plinth',
                              height: params.plinthHeight,
                              setback: PLINTH_SETBACK,
                              legCode: null,
                          }
                        : {
                              type: 'none',
                              height: 0,
                              setback: 0,
                              legCode: null,
                          },
                back: { type: params.backType },
                interior,
                fronts,
            },
            table: null,
            overrides: emptyOverrides(),
            notes: null,
        };
    },
};
