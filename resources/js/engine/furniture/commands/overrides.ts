/**
 * Override commands (07 §9): part and hardware overrides, extra parts and
 * extra hardware, and `resetOverrides`.
 *
 * Rulings carried by this file (ledgered for the spec 19 reconciliation):
 * - `setPartOverride` and `setHardwareOverride` take the whole new override
 *   as `patch`: `null` or an object with no fields deletes the entry (07 §9),
 *   anything else replaces it, so the editor sends the override it shows.
 * - A key may not be `__proto__` (`invalid_params`): override maps are plain
 *   objects keyed by user-visible part keys.
 * - `resetOverrides` deletes the entries of the maps one by one and keeps the
 *   extra parts and extra hardware lists (an `extra.<id>` part override goes
 *   with the part map).
 */
import { z } from 'zod';
import {
    ExtraHardwareSchema,
    ExtraPartSchema,
    HardwareOverrideSchema,
    PartOverrideSchema,
} from '../schema';
import {
    assign,
    defineFurnitureCommand,
    mergeFields,
    notFound,
    pushDeleted,
} from './helpers';

const KeySchema = z
    .string()
    .min(1)
    .refine((key) => key !== '__proto__', { message: 'reserved key' });

/** `patch` without its `undefined` fields; `null` when nothing is left. */
function definedFields<T extends object>(patch: T | null): T | null {
    if (patch === null) return null;
    const fields = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    return Object.keys(fields).length === 0 ? null : (fields as T);
}

/** Replaces the entry of `key`, or deletes it when `patch` has no fields. */
function writeEntry<T extends object>(
    map: Record<string, T>,
    key: string,
    patch: T | null,
): void {
    const entry = definedFields(patch);
    if (entry !== null) assign(map, key, entry);
    else if (Object.hasOwn(map, key)) delete map[key];
}

const hasId = (list: ReadonlyArray<{ id: string }>, id: string): boolean =>
    list.some((item) => item.id === id);

const indexOfId = (list: ReadonlyArray<{ id: string }>, id: string): number =>
    list.findIndex((item) => item.id === id);

// ---- part overrides -------------------------------------------------------------------------

const SetPartOverrideSchema = z.object({
    partKey: KeySchema,
    patch: PartOverrideSchema.nullable(),
});
type SetPartOverrideParams = z.infer<typeof SetPartOverrideSchema>;

const setPartOverride = defineFurnitureCommand<SetPartOverrideParams>({
    type: 'furniture.setPartOverride',
    labelKey: 'engine.furniture.command.label.set_part_override',
    paramsSchema: SetPartOverrideSchema,
    validate: () => null,
    run(d, p) {
        writeEntry(d.overrides.parts, p.partKey, p.patch);
    },
    mergeKey: (p) => `part:${p.partKey}`,
});

// ---- extra parts ----------------------------------------------------------------------------

const ExtraPartFieldsSchema = ExtraPartSchema.omit({ id: true });
type AddExtraPartParams = z.infer<typeof ExtraPartFieldsSchema>;

const addExtraPart = defineFurnitureCommand<AddExtraPartParams, { id: string }>(
    {
        type: 'furniture.addExtraPart',
        labelKey: 'engine.furniture.command.label.add_extra_part',
        paramsSchema: ExtraPartFieldsSchema,
        validate: () => null,
        run(d, p, ctx, out) {
            const id = ctx.newId('p');
            d.overrides.extraParts.push({ ...p, id });
            out.result = { id };
        },
    },
);

const UpdateExtraPartSchema = z.object({
    id: z.string(),
    patch: ExtraPartFieldsSchema.partial(),
});
type UpdateExtraPartParams = z.infer<typeof UpdateExtraPartSchema>;

const updateExtraPart = defineFurnitureCommand<UpdateExtraPartParams>({
    type: 'furniture.updateExtraPart',
    labelKey: 'engine.furniture.command.label.update_extra_part',
    paramsSchema: UpdateExtraPartSchema,
    validate: (doc, p) =>
        hasId(doc.overrides.extraParts, p.id) ? null : notFound(p.id),
    run(d, p) {
        const list = d.overrides.extraParts;
        mergeFields(list[indexOfId(list, p.id)]!, p.patch);
    },
    mergeKey: (p) => `extra:${p.id}`,
});

const RemoveByIdSchema = z.object({ id: z.string() });
type RemoveByIdParams = z.infer<typeof RemoveByIdSchema>;

const removeExtraPart = defineFurnitureCommand<RemoveByIdParams>({
    type: 'furniture.removeExtraPart',
    labelKey: 'engine.furniture.command.label.remove_extra_part',
    paramsSchema: RemoveByIdSchema,
    validate: (doc, p) =>
        hasId(doc.overrides.extraParts, p.id) ? null : notFound(p.id),
    run(d, p, _ctx, out) {
        const list = d.overrides.extraParts;
        list.splice(indexOfId(list, p.id), 1);
        // The part's own override goes with it (07 §9).
        const key = `extra.${p.id}`;
        if (Object.hasOwn(d.overrides.parts, key)) {
            delete d.overrides.parts[key];
        }
        pushDeleted(out, p.id);
    },
});

// ---- hardware overrides ---------------------------------------------------------------------

const SetHardwareOverrideSchema = z.object({
    hardwareKey: KeySchema,
    patch: HardwareOverrideSchema.nullable(),
});
type SetHardwareOverrideParams = z.infer<typeof SetHardwareOverrideSchema>;

const setHardwareOverride = defineFurnitureCommand<SetHardwareOverrideParams>({
    type: 'furniture.setHardwareOverride',
    labelKey: 'engine.furniture.command.label.set_hardware_override',
    paramsSchema: SetHardwareOverrideSchema,
    validate: () => null,
    run(d, p) {
        writeEntry(d.overrides.hardware, p.hardwareKey, p.patch);
    },
    mergeKey: (p) => `hw:${p.hardwareKey}`,
});

// ---- extra hardware -------------------------------------------------------------------------

const ExtraHardwareFieldsSchema = ExtraHardwareSchema.omit({ id: true });
type AddExtraHardwareParams = z.infer<typeof ExtraHardwareFieldsSchema>;

const addExtraHardware = defineFurnitureCommand<
    AddExtraHardwareParams,
    { id: string }
>({
    type: 'furniture.addExtraHardware',
    labelKey: 'engine.furniture.command.label.add_extra_hardware',
    paramsSchema: ExtraHardwareFieldsSchema,
    validate: () => null,
    run(d, p, ctx, out) {
        const id = ctx.newId('h');
        d.overrides.extraHardware.push({ ...p, id });
        out.result = { id };
    },
});

const UpdateExtraHardwareSchema = z.object({
    id: z.string(),
    patch: ExtraHardwareFieldsSchema.partial(),
});
type UpdateExtraHardwareParams = z.infer<typeof UpdateExtraHardwareSchema>;

const updateExtraHardware = defineFurnitureCommand<UpdateExtraHardwareParams>({
    type: 'furniture.updateExtraHardware',
    labelKey: 'engine.furniture.command.label.update_extra_hardware',
    paramsSchema: UpdateExtraHardwareSchema,
    validate: (doc, p) =>
        hasId(doc.overrides.extraHardware, p.id) ? null : notFound(p.id),
    run(d, p) {
        const list = d.overrides.extraHardware;
        mergeFields(list[indexOfId(list, p.id)]!, p.patch);
    },
    mergeKey: (p) => `xhw:${p.id}`,
});

const removeExtraHardware = defineFurnitureCommand<RemoveByIdParams>({
    type: 'furniture.removeExtraHardware',
    labelKey: 'engine.furniture.command.label.remove_extra_hardware',
    paramsSchema: RemoveByIdSchema,
    validate: (doc, p) =>
        hasId(doc.overrides.extraHardware, p.id) ? null : notFound(p.id),
    run(d, p, _ctx, out) {
        const list = d.overrides.extraHardware;
        list.splice(indexOfId(list, p.id), 1);
        pushDeleted(out, p.id);
    },
});

// ---- resetOverrides -------------------------------------------------------------------------

const ResetOverridesSchema = z.object({
    scope: z.enum(['parts', 'hardware', 'all']),
});
type ResetOverridesParams = z.infer<typeof ResetOverridesSchema>;

function clearMap(map: Record<string, unknown>): void {
    for (const key of Object.keys(map)) delete map[key];
}

const resetOverrides = defineFurnitureCommand<ResetOverridesParams>({
    type: 'furniture.resetOverrides',
    labelKey: 'engine.furniture.command.label.reset_overrides',
    paramsSchema: ResetOverridesSchema,
    validate: () => null,
    run(d, p) {
        if (p.scope !== 'hardware') clearMap(d.overrides.parts);
        if (p.scope !== 'parts') clearMap(d.overrides.hardware);
    },
});

/** The override commands, registered in `FURNITURE_COMMANDS` (07 §9). */
export const OVERRIDE_COMMANDS = {
    'furniture.setPartOverride': setPartOverride,
    'furniture.addExtraPart': addExtraPart,
    'furniture.updateExtraPart': updateExtraPart,
    'furniture.removeExtraPart': removeExtraPart,
    'furniture.setHardwareOverride': setHardwareOverride,
    'furniture.addExtraHardware': addExtraHardware,
    'furniture.updateExtraHardware': updateExtraHardware,
    'furniture.removeExtraHardware': removeExtraHardware,
    'furniture.resetOverrides': resetOverrides,
};
