/**
 * `study_desk` (07 §2.4.14): a desk on a cabinet and a panel end, two panel
 * ends or four legs, with an optional drawer in the knee space.
 */
import { z } from 'zod';
import type { Content, FurnitureDocument } from '../schema';
import {
    booleanField,
    drawersContent,
    lengthField,
    resolveDefaultMaterials,
    selectField,
    shelvesContent,
    tableDocument,
    tableTop,
} from './common';
import type { TemplateDefinition } from './types';

const BASES = ['cabinet_ends', 'panel_ends', 'four_legs'] as const;
const CABINET_CONTENTS = ['drawers', 'shelves'] as const;
const CABINET_DRAWERS = 3;
const CABINET_SHELVES = 2;
const LEG_SECTION = 50;
const APRON_HEIGHT = 80;
const APRON_INSET = 15;

export const studyDeskParamsSchema = z.object({
    width: z.number().int().min(800).max(2400),
    height: z.number().int().min(700).max(780),
    depth: z.number().int().min(450).max(800),
    base: z.enum(BASES),
    cabinetWidth: z.number().int().min(300).max(600),
    cabinetContent: z.enum(CABINET_CONTENTS),
    topDrawer: z.boolean(),
});
export type StudyDeskParams = z.infer<typeof studyDeskParamsSchema>;

const defaults: StudyDeskParams = {
    width: 1200,
    height: 750,
    depth: 600,
    base: 'cabinet_ends',
    cabinetWidth: 400,
    cabinetContent: 'drawers',
    topDrawer: false,
};

const CABINET_ENDS = { key: 'base', equals: 'cabinet_ends' };

export const studyDesk: TemplateDefinition<StudyDeskParams> = {
    key: 'study_desk',
    family: 'table',
    category: 'desk',
    nameKey: 'templates.study_desk.name',
    descriptionKey: 'templates.study_desk.description',
    thumbnail: '/images/templates/study_desk.svg',
    fields: [
        lengthField('width', 800, 2400),
        lengthField('height', 700, 780, {}, 5),
        lengthField('depth', 450, 800),
        selectField('base', BASES),
        lengthField('cabinetWidth', 300, 600, { visibleIf: CABINET_ENDS }),
        selectField('cabinetContent', CABINET_CONTENTS, {
            visibleIf: CABINET_ENDS,
        }),
        booleanField('topDrawer'),
    ],
    defaults,
    paramsSchema: studyDeskParamsSchema,
    preferredMaterials: { top: ['PB25-WHITE'] },

    generate(params, ctx): FurnitureDocument {
        const content: Content =
            params.cabinetContent === 'drawers'
                ? drawersContent(CABINET_DRAWERS, null)
                : shelvesContent(CABINET_SHELVES);
        return tableDocument(
            'study_desk',
            { width: params.width, height: params.height, depth: params.depth },
            resolveDefaultMaterials(studyDesk, ctx),
            {
                top: tableTop('rectangle', 0),
                base: {
                    type: params.base,
                    legSource: 'hardware',
                    legCode: null,
                    legSection: LEG_SECTION,
                    apron: {
                        enabled: params.base === 'four_legs',
                        height: APRON_HEIGHT,
                        inset: APRON_INSET,
                    },
                    stretcher: true,
                },
                storage: {
                    drawers: params.topDrawer
                        ? { count: 1, side: 'front', slideCode: null }
                        : null,
                    lowerShelf: false,
                    endCabinets:
                        params.base === 'cabinet_ends'
                            ? { width: params.cabinetWidth, content }
                            : null,
                },
            },
        );
    },
};
