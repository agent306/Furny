/**
 * `furniture.setMaterial` (07 §9): sets the given fields of the assignment of
 * `role` and of every role in `applyToRoles`. Codes are not looked up here:
 * an unknown or archived code is reported by `validateFurniture`
 * (`furniture.unknown_code`, `furniture.archived_code`).
 */
import { z } from 'zod';
import { MATERIAL_ROLES } from '../schema';
import { defineFurnitureCommand, mergeFields } from './helpers';

const RoleSchema = z.enum(MATERIAL_ROLES);

const SetMaterialSchema = z.object({
    role: RoleSchema,
    materialCode: z.string().optional(),
    edgeBandCode: z.string().nullable().optional(),
    finishCode: z.string().nullable().optional(),
    applyToRoles: z.array(RoleSchema).optional(),
});
type SetMaterialParams = z.infer<typeof SetMaterialSchema>;

const setMaterial = defineFurnitureCommand<SetMaterialParams>({
    type: 'furniture.setMaterial',
    labelKey: 'engine.furniture.command.label.set_material',
    paramsSchema: SetMaterialSchema,
    validate: () => null,
    run(d, p) {
        const { role, applyToRoles, ...fields } = p;
        for (const target of new Set([role, ...(applyToRoles ?? [])])) {
            mergeFields(d.materials[target], fields);
        }
    },
});

/** The material command, registered in `FURNITURE_COMMANDS` (07 §9). */
export const MATERIAL_COMMANDS = { 'furniture.setMaterial': setMaterial };
