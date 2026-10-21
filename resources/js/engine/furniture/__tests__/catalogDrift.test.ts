import { describe, expect, it } from 'vitest';
import { seedCatalog } from '../../testing/seedCatalog';
import { indexCatalog } from '../catalogIndex';
import { codeIssues, referencedCodes } from '../codes';
import { generateFurniture } from '../generate';
import type { FurnitureDocument } from '../schema';
import { archived, withoutHardware } from '../testing/catalogs';
import {
    assign,
    boxDocument,
    drawerTestBox,
    wardrobeFixture,
} from '../testing/docs';
import type { FurnitureModel } from '../types';

/**
 * Catalog drift (07 §1.5, §3.1 step 2): archived and deleted catalog rows and
 * unknown codes in the document are reported, never thrown, and the model is
 * still generated.
 */
const catalog = seedCatalog();
const plain = generateFurniture(wardrobeFixture(), catalog);

const issuesOf = (model: FurnitureModel, code: string) =>
    model.issues.filter((i) => i.code === code);
const LEAVES = [
    'front.fr_0000000001.leaf.1',
    'front.fr_0000000002.leaf.1',
    'front.fr_0000000002.leaf.2',
];

describe('catalog drift against the wardrobe fixture', () => {
    it('warns archived_code for an inactive material and generates the same parts', () => {
        const model = generateFurniture(
            wardrobeFixture(),
            archived('PB18-WHITE'),
        );
        expect(issuesOf(model, 'furniture.archived_code')).toEqual([
            {
                code: 'furniture.archived_code',
                severity: 'warning',
                messageKey: 'engine.furniture.issue.archived_code',
                params: { code: 'PB18-WHITE' },
                entityIds: [],
            },
        ]);
        expect(model.parts).toEqual(plain.parts);
        expect(model.hardware).toEqual(plain.hardware);
    });

    it('omits the full-overlay hinges with no_default_hardware when HNG-FO-SC is deleted', () => {
        let model: FurnitureModel | undefined;
        expect(() => {
            model = generateFurniture(
                wardrobeFixture(),
                withoutHardware('HNG-FO-SC'),
            );
        }).not.toThrow();
        if (!model) throw new Error('no model');
        expect(
            issuesOf(model, 'furniture.no_default_hardware').map((i) => ({
                severity: i.severity,
                params: i.params,
                entityIds: i.entityIds,
            })),
        ).toEqual(
            ['fr_0000000001', 'fr_0000000002'].map((id) => ({
                severity: 'warning',
                params: { roleKey: 'hinge.full_overlay' },
                entityIds: [`front.${id}.hinges`],
            })),
        );
        // Referenced only through hingeCode 'auto': not an unknown code.
        expect(issuesOf(model, 'furniture.unknown_code')).toEqual([]);
        expect(model.hardware.some((h) => h.code === 'HNG-FO-SC')).toBe(false);
        const keys = model.hardware.map((h) => h.key);
        expect(keys).not.toContain('front.fr_0000000001.hinges');
        expect(keys).not.toContain('front.fr_0000000002.hinges');
        // The half-overlay hinges of the shared edge remain.
        expect(
            model.hardware.find(
                (h) => h.key === 'front.fr_0000000002.hinges.shared',
            ),
        ).toMatchObject({ code: 'HNG-HO-SC', qty: 4 });
        expect(model.parts.map((p) => p.key)).toEqual(
            plain.parts.map((p) => p.key),
        );
    });

    it('reports an unknown front material and still generates the leaves in the role default', () => {
        let model: FurnitureModel | undefined;
        expect(() => {
            model = generateFurniture(
                wardrobeFixture((d) => {
                    d.materials.front = assign('GONE-01');
                }),
                catalog,
            );
        }).not.toThrow();
        if (!model) throw new Error('no model');
        expect(issuesOf(model, 'furniture.unknown_code')).toEqual([
            {
                code: 'furniture.unknown_code',
                severity: 'error',
                messageKey: 'engine.furniture.issue.unknown_code',
                params: { code: 'GONE-01', kind: 'material' },
                entityIds: [],
            },
        ]);
        for (const key of LEAVES) {
            expect(model.parts.find((p) => p.key === key)?.materialCode).toBe(
                'PB18-WHITE',
            );
        }
        expect(model.parts).toEqual(plain.parts);
        expect(issuesOf(model, 'furniture.weight_estimate')).toEqual(
            issuesOf(plain, 'furniture.weight_estimate'),
        );
    });

    it('reports unknown and archived codes of every kind', () => {
        const model = generateFurniture(
            wardrobeFixture((d) => {
                d.materials.carcass.edgeBandCode = 'EB-GONE';
                d.materials.front.finishCode = 'FIN-DUCO';
                d.materials.top.finishCode = 'FIN-GONE';
                if (d.carcass) d.carcass.handles.code = 'HDL-GONE';
            }),
            archived(['FIN-DUCO']),
        );
        expect(
            issuesOf(model, 'furniture.unknown_code').map((i) => i.params),
        ).toEqual([
            { code: 'EB-GONE', kind: 'edge_band' },
            { code: 'FIN-GONE', kind: 'finish' },
            { code: 'HDL-GONE', kind: 'hardware' },
        ]);
        expect(
            issuesOf(model, 'furniture.archived_code').map((i) => i.params),
        ).toEqual([{ code: 'FIN-DUCO' }]);
    });

    it('does not throw for a document whose family has no spec', () => {
        const doc = wardrobeFixture((d) => {
            d.carcass = null;
        });
        expect(() => generateFurniture(doc, catalog)).not.toThrow();
        expect(generateFurniture(doc, catalog).parts).toEqual([]);
    });
});

describe('referencedCodes (07 §3.1 step 2)', () => {
    it('lists each material of the wardrobe once, with no other codes', () => {
        expect(referencedCodes(wardrobeFixture())).toEqual([
            { code: 'PB18-WHITE', kind: 'material' },
            { code: 'HDF3-WHITE', kind: 'material' },
            { code: 'PLY12-BWR', kind: 'material' },
            { code: 'SW50-RUBBER', kind: 'material' },
            { code: 'HDL-BAR-160', kind: 'hardware' },
        ]);
    });

    it('collects the hardware codes of fronts, contents, handles, plinth and overrides', () => {
        const doc: FurnitureDocument = boxDocument({
            width: 600,
            height: 720,
            depth: 560,
            content: {
                type: 'drawers',
                count: 2,
                frontHeights: 'equal',
                slideCode: 'SLD-UM-500',
                behindDoor: true,
            },
            fronts: [
                {
                    id: 'fr_0000000001',
                    kind: 'hinged',
                    covers: ['s_0000000001'],
                    leaves: 1,
                    hingeSide: 'auto',
                    overlay: 'full',
                    glass: false,
                    handleCode: 'KNB-ROUND-30',
                    hingeCode: 'HNG-IN-SC',
                    slidingTrackCode: 'TRK-SLD-2T-3000',
                },
            ],
            carcass: {
                plinth: {
                    type: 'legs',
                    height: 100,
                    setback: 0,
                    legCode: 'LEG-CAB-ADJ',
                },
            },
        });
        doc.materials.shelf = {
            materialCode: 'PB18-WHITE',
            edgeBandCode: 'EB04-WHITE',
            finishCode: 'FIN-PU-MATT',
        };
        doc.overrides.parts['carcass.top'] = {
            materialCode: 'PB18-OAK',
            edges: { L1: 'EB08-OAK', L2: null },
        };
        doc.overrides.extraParts.push({
            id: 'p_0000000001',
            name: 'Filler',
            role: 'front',
            materialCode: 'MDF18-RAW',
            length: 700,
            width: 60,
            qty: 1,
            edges: { L1: 'EB20-OAK', L2: null, W1: null, W2: null },
            grain: 'none',
            note: null,
            placement: null,
        });
        doc.overrides.hardware['carcass.screws'] = { code: 'DMP-PUSH' };
        doc.overrides.extraHardware.push({
            id: 'h_0000000001',
            code: 'LCK-CAM-20',
            qty: 1,
            note: null,
        });
        expect(referencedCodes(doc)).toEqual([
            { code: 'PB18-WHITE', kind: 'material' },
            { code: 'HDF3-WHITE', kind: 'material' },
            { code: 'EB04-WHITE', kind: 'edge_band' },
            { code: 'FIN-PU-MATT', kind: 'finish' },
            { code: 'PLY12-BWR', kind: 'material' },
            { code: 'SW50-RUBBER', kind: 'material' },
            { code: 'LEG-CAB-ADJ', kind: 'hardware' },
            { code: 'HDL-BAR-160', kind: 'hardware' },
            { code: 'KNB-ROUND-30', kind: 'hardware' },
            { code: 'HNG-IN-SC', kind: 'hardware' },
            { code: 'TRK-SLD-2T-3000', kind: 'hardware' },
            { code: 'SLD-UM-500', kind: 'hardware' },
            { code: 'PB18-OAK', kind: 'material' },
            { code: 'EB08-OAK', kind: 'edge_band' },
            { code: 'MDF18-RAW', kind: 'material' },
            { code: 'EB20-OAK', kind: 'edge_band' },
            { code: 'DMP-PUSH', kind: 'hardware' },
            { code: 'LCK-CAM-20', kind: 'hardware' },
        ]);
    });

    it('skips the inherit, auto and null placeholders', () => {
        const doc = drawerTestBox();
        expect(
            referencedCodes(doc).filter((r) => r.kind === 'hardware'),
        ).toEqual([{ code: 'HDL-BAR-160', kind: 'hardware' }]);
    });

    it('collects the codes of a table spec', () => {
        const doc = drawerTestBox();
        doc.family = 'table';
        doc.carcass = null;
        doc.table = {
            top: {
                shape: 'rectangle',
                thickness: 'material',
                cornerRadius: 0,
                overhang: 0,
            },
            base: {
                type: 'cabinet_ends',
                legSource: 'hardware',
                legCode: 'LEG-TBL-710',
                legSection: 60,
                apron: { enabled: false, height: 0, inset: 0 },
                stretcher: false,
            },
            storage: {
                drawers: { count: 1, side: 'front', slideCode: 'SLD-BB-400' },
                lowerShelf: false,
                endCabinets: {
                    width: 400,
                    content: {
                        type: 'hanging_rod',
                        topClearance: 60,
                        rodCode: 'ROD-OVAL-1200',
                    },
                },
            },
        };
        expect(
            referencedCodes(doc).filter((r) => r.kind === 'hardware'),
        ).toEqual([
            { code: 'LEG-TBL-710', kind: 'hardware' },
            { code: 'SLD-BB-400', kind: 'hardware' },
            { code: 'ROD-OVAL-1200', kind: 'hardware' },
        ]);
    });
});

describe('codeIssues', () => {
    it('is empty for the wardrobe against the seed catalog', () => {
        expect(codeIssues(wardrobeFixture(), indexCatalog(catalog))).toEqual(
            [],
        );
    });

    it('reports a code used by several roles once', () => {
        const issues = codeIssues(
            wardrobeFixture(),
            indexCatalog(archived('PB18-WHITE')),
        );
        expect(issues).toHaveLength(1);
    });

    it('reports a code that names a row of another kind as unknown', () => {
        const doc = wardrobeFixture((d) => {
            d.materials.front = assign('HDL-BAR-160');
        });
        expect(
            codeIssues(doc, indexCatalog(catalog)).map((i) => i.params),
        ).toEqual([{ code: 'HDL-BAR-160', kind: 'material' }]);
    });
});
