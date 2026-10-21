/**
 * `furniture.setTable` (07 §9): deep-merges a patch into the table spec;
 * arrays are replaced, and so is a storage `content` (a union: merging two
 * different kinds would leave the fields of both). A nullable object
 * (`drawers`, `endCabinets`) given as `null` is cleared; given as an object
 * while it is `null` it is set as is, so the patch must then be complete or
 * the schema check of the pipeline refuses it (`invalid_document`).
 */
import { z } from 'zod';
import { TableSpecSchema } from '../schema';
import {
    checkTable,
    defineFurnitureCommand,
    mergeDeep,
    tableOf,
} from './helpers';

const Table = TableSpecSchema.shape;
const Storage = Table.storage.shape;

const SetTableSchema = z.object({
    patch: z.object({
        top: Table.top.partial().optional(),
        base: Table.base
            .partial()
            .extend({ apron: Table.base.shape.apron.partial().optional() })
            .optional(),
        storage: z
            .object({
                drawers: Storage.drawers
                    .unwrap()
                    .partial()
                    .nullable()
                    .optional(),
                lowerShelf: Storage.lowerShelf.optional(),
                endCabinets: Storage.endCabinets
                    .unwrap()
                    .partial()
                    .nullable()
                    .optional(),
            })
            .optional(),
    }),
});
type SetTableParams = z.infer<typeof SetTableSchema>;

const ATOMIC: ReadonlySet<string> = new Set(['content']);

const setTable = defineFurnitureCommand<SetTableParams>({
    type: 'furniture.setTable',
    labelKey: 'engine.furniture.command.label.set_table',
    paramsSchema: SetTableSchema,
    validate: (doc) => checkTable(doc),
    run(d, p) {
        mergeDeep(tableOf(d), p.patch, ATOMIC);
    },
    mergeKey: () => 'table',
});

/** The table command, registered in `FURNITURE_COMMANDS` (07 §9). */
export const TABLE_COMMANDS = { 'furniture.setTable': setTable };
