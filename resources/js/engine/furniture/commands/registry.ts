/**
 * The furniture command bus (07 §9, 04 §6.1): the 28 furniture commands, the
 * furniture pipeline and the patch-path mapping, wired into the generic bus.
 */
import { apply, type Patches } from 'mutative';
import { createCommandBus } from '../../commands/bus';
import type { AnyCommandDef, CommandBus } from '../../commands/types';
import { newId as generateId } from '../../ids';
import type { CatalogIndex } from '../catalogIndex';
import type { FurnitureDocument } from '../schema';
import { CONSTRUCTION_COMMANDS } from './construction';
import { DIMS_COMMANDS } from './dims';
import { FRONT_COMMANDS } from './fronts';
import { MATERIAL_COMMANDS } from './materials';
import { NOTES_COMMANDS } from './notes';
import { OVERRIDE_COMMANDS } from './overrides';
import {
    FURNITURE_COMMAND_KEY_PREFIX,
    furniturePipeline,
    type FurnitureCommandContext,
} from './pipeline';
import { SECTION_COMMANDS } from './sections';
import { TABLE_COMMANDS } from './table';

type FurnitureCommandRegistry = Record<
    string,
    AnyCommandDef<FurnitureDocument, FurnitureCommandContext>
>;

/** Every furniture command by type (07 §9); the command groups are spread in here. */
export const FURNITURE_COMMANDS = {
    ...DIMS_COMMANDS,
    ...CONSTRUCTION_COMMANDS,
    ...SECTION_COMMANDS,
    ...FRONT_COMMANDS,
    ...MATERIAL_COMMANDS,
    ...TABLE_COMMANDS,
    ...OVERRIDE_COMMANDS,
    ...NOTES_COMMANDS,
} satisfies FurnitureCommandRegistry;

export type FurnitureCommandType = keyof typeof FURNITURE_COMMANDS & string;

/** `['overrides', 'parts' | 'hardware', key]` are keyed by the part or hardware key. */
const KEYED_OVERRIDES: ReadonlySet<string> = new Set(['parts', 'hardware']);

const isIndex = (v: unknown): v is number => typeof v === 'number';

/**
 * Patch path -> changed entity id: the per-path mapping of the furniture bus
 * (04 §6.3).
 *
 * - `['overrides', 'parts' | 'hardware', key, ...]` -> `key`.
 * - Sections: `['carcass', 'interior', ...]` -> the id of the deepest section
 *   the path reaches; a child added, removed or replaced (`children`,
 *   `children[i]`) counts for its parent, a child's `size` for the child.
 * - `['carcass', 'fronts', i, ...]` -> the id of front `i`;
 *   `['overrides', 'extraParts' | 'extraHardware', i, ...]` -> the id of item `i`.
 * - Anything else (dimensions, materials, construction, table, notes, a whole
 *   collection) -> `'*'`.
 *
 * Contract: a reported section id means that section **and its subtree** may
 * have changed (a structural change reports the section whose `children`
 * changed, not the children). A reported front or extra id means that item
 * changed; `'*'` means anything may have changed (a collection grew or shrank).
 * Sections, fronts and extras sit in arrays, so a path holds indices, not ids:
 * they are read from `doc`, which must be the document the patch applies to
 * (`furnitureEntityIdsOf` walks a patch list so that this holds for each
 * patch). An index `doc` does not have (an entity being added) is a change of
 * the parent or the collection. Without `doc` these paths are `'*'`.
 */
export function furniturePathToEntityId(
    path: (string | number)[],
    doc?: FurnitureDocument,
): string | null {
    const [head, second, third] = path;
    if (head === 'overrides') {
        if (typeof second === 'string' && KEYED_OVERRIDES.has(second)) {
            return third === undefined ? '*' : String(third);
        }
        if (second === 'extraParts' || second === 'extraHardware') {
            return (
                (isIndex(third)
                    ? doc?.overrides[second][third]?.id
                    : undefined) ?? '*'
            );
        }
        return '*';
    }
    const carcass = head === 'carcass' ? doc?.carcass : undefined;
    if (!carcass) return '*';
    if (second === 'fronts') {
        return (isIndex(third) ? carcass.fronts[third]?.id : undefined) ?? '*';
    }
    if (second !== 'interior') return '*';

    let section = carcass.interior;
    let at = 2;
    while (path[at] === 'children') {
        const index = path[at + 1];
        const child = isIndex(index) ? section.children[index] : undefined;
        if (child === undefined) return section.id;
        if (path[at + 2] !== 'section') {
            // `children[i].size` belongs to the child; `children[i]` itself to the parent.
            return path[at + 2] === undefined ? section.id : child.section.id;
        }
        section = child.section;
        at += 3;
    }
    return section.id;
}

/**
 * The patch paths whose application can change what a later index path means:
 * anything under `carcass.interior`, `carcass.fronts` and
 * `overrides.extraParts / extraHardware`, and a patch that replaces one of
 * their ancestors (`[]`, `['carcass']`, `['overrides']`).
 */
const indexed = (path: (string | number)[]): boolean => {
    const [head, second] = path;
    if (path.length <= 1) {
        return head === undefined || head === 'carcass' || head === 'overrides';
    }
    if (head === 'carcass') return second === 'interior' || second === 'fronts';
    return (
        head === 'overrides' &&
        (second === 'extraParts' || second === 'extraHardware')
    );
};

/**
 * The entity ids `patches` touch, for the bus' `entityIdsOf`: each patch is
 * read by `furniturePathToEntityId` against the document it applies to, that
 * is `base` with the patches before it applied. `base` is the pre-command
 * document for a command, a redo, a transaction commit and a replace merge,
 * and the post-command document for an undo (04 §6.2). The contract of the
 * ids is that of `furniturePathToEntityId`.
 */
export function furnitureEntityIdsOf(
    base: FurnitureDocument,
    patches: Patches,
): Set<string> {
    const ids = new Set<string>();
    let doc = base;
    patches.forEach((patch, at) => {
        const path = patch.path as (string | number)[];
        const id = furniturePathToEntityId(path, doc);
        if (id !== null) ids.add(id);
        // Patches that cannot move a section, front or extra do not change what the next one means.
        if (at < patches.length - 1 && indexed(path)) {
            doc = apply(doc, [patch]) as FurnitureDocument;
        }
    });
    return ids;
}

export interface FurnitureBusConfig<M extends FurnitureCommandRegistry> {
    initial: FurnitureDocument;
    catalog: CatalogIndex;
    /** Default: `engine/ids.ts::newId`. */
    newId?: FurnitureCommandContext['newId'];
    maxHistory?: number;
    /** Passed to the generic bus (`CommandBusConfig.mergeBaseCache`). */
    mergeBaseCache?: boolean;
    /** Default: `FURNITURE_COMMANDS`. Lets a caller run its own commands (tests, benches). */
    registry?: M;
}

/**
 * The furniture command bus (07 §9): the generic bus with `furniturePipeline`
 * (every result is checked against `FurnitureDocumentSchema`), the furniture
 * patch-path mapping and a context of the catalog index and the id factory.
 * The editor calls `seal()` after each finalize (pointer-up, blur).
 */
export function createFurnitureBus<
    M extends FurnitureCommandRegistry = typeof FURNITURE_COMMANDS,
>(
    cfg: FurnitureBusConfig<M>,
): CommandBus<FurnitureDocument, FurnitureCommandContext, M> {
    const context: FurnitureCommandContext = {
        catalog: cfg.catalog,
        newId: cfg.newId ?? generateId,
    };
    return createCommandBus<FurnitureDocument, FurnitureCommandContext, M>({
        initial: cfg.initial,
        registry: cfg.registry ?? (FURNITURE_COMMANDS as unknown as M),
        pipeline: furniturePipeline,
        pathToEntityId: (path) => furniturePathToEntityId(path),
        entityIdsOf: furnitureEntityIdsOf,
        messageKeyPrefix: FURNITURE_COMMAND_KEY_PREFIX,
        getContext: () => context,
        ...(cfg.maxHistory === undefined ? {} : { maxHistory: cfg.maxHistory }),
        ...(cfg.mergeBaseCache === undefined
            ? {}
            : { mergeBaseCache: cfg.mergeBaseCache }),
    });
}
