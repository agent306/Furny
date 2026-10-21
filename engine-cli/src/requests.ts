import { z } from 'zod';
import {
    CatalogSnapshotSchema,
    EdgeIdSchema,
    TemplateKeySchema,
} from '../../resources/js/engine/index';

/**
 * Request schemas of the engine CLI commands (01 §5.4, 08 §9.2). Documents
 * stay `unknown` here: `migratePlan` / `migrateFurniture` own their schemas
 * and version handling. Everything a schema rejects becomes `invalid_input`.
 */

const document = z.unknown();

export const PlanRequestSchema = z.object({ document });

export const FurnitureRequestSchema = z.object({
    document,
    catalog: CatalogSnapshotSchema,
});

export const ComputeBomRequestSchema = z.object({
    document,
    catalog: CatalogSnapshotSchema,
    options: z.object({
        nesting: z.boolean(),
        allowRotation: z.boolean().optional(),
        price: z
            .object({
                quantity: z.number().int().positive(),
                includeInstallation: z.boolean(),
            })
            .optional(),
    }),
});

/** The part of a `Bom` that `cutListCsv` reads: the cut list rows. */
export const BomInputSchema = z.object({
    cutList: z.array(
        z.object({
            rowKey: z.string(),
            partKeys: z.array(z.string()),
            name: z.string(),
            nameKey: z.string(),
            nameParams: z.record(z.string(), z.union([z.string(), z.number()])),
            materialCode: z.string(),
            thickness: z.number(),
            length: z.number(),
            width: z.number(),
            cutLength: z.number(),
            cutWidth: z.number(),
            qty: z.number(),
            grain: z.enum(['length', 'width', 'none']),
            edges: z.record(EdgeIdSchema, z.string().nullable()),
        }),
    ),
});

export const CutlistCsvRequestSchema = z.object({
    bom: BomInputSchema,
    catalog: CatalogSnapshotSchema,
    document,
});

export const TemplateDefaultRequestSchema = z.object({
    templateKey: TemplateKeySchema,
    overrides: z.record(z.string(), z.unknown()).default({}),
    catalog: CatalogSnapshotSchema,
});

export const DiffFurnitureRequestSchema = z.object({
    before: document,
    after: document,
    catalog: CatalogSnapshotSchema,
});
