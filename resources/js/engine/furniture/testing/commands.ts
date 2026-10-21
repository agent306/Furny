/**
 * Test helpers shared by the furniture command tests (07 §9, §12.5): a bus on
 * the wardrobe fixture with deterministic ids that continue after the
 * fixture's, and the apply / undo / redo round trip every command is held to.
 * Test-only; not exported from the engine index.
 */
import { expect } from 'vitest';
import type {
    ExecuteOptions,
    ExecuteResult,
    ParamsOf,
    ResultOf,
} from '../../commands/types';
import type { IdPrefix } from '../../ids';
import { seedCatalog } from '../../testing/seedCatalog';
import { testIds } from '../../testing/ids';
import { indexCatalog } from '../catalogIndex';
import {
    FURNITURE_COMMANDS,
    createFurnitureBus,
    type FurnitureCommandType,
} from '../commands/registry';
import type { FurnitureDocument, Section } from '../schema';
import { wardrobeFixture } from './docs';

/** Ids of the wardrobe fixture: `s_0000000001..5` and `fr_0000000001..2`. */
export const FIXTURE_SECTIONS = {
    root: 's_0000000001',
    shelves: 's_0000000002',
    rows: 's_0000000003',
    empty: 's_0000000004',
    rod: 's_0000000005',
} as const;
export const FIXTURE_FRONTS = {
    left: 'fr_0000000001',
    right: 'fr_0000000002',
} as const;

/** A `testIds()` that already issued the fixture's ids, so the next section is `s_0000000006`. */
export function idsAfterFixture(): (prefix: IdPrefix) => string {
    const ids = testIds();
    for (let i = 0; i < 5; i += 1) ids('s');
    for (let i = 0; i < 2; i += 1) ids('fr');
    return ids;
}

/** A furniture bus on `doc` (default: the wardrobe fixture) over the seed catalog. */
export function furnitureBus(doc: FurnitureDocument = wardrobeFixture()) {
    return createFurnitureBus({
        initial: doc,
        catalog: indexCatalog(seedCatalog()),
        newId: idsAfterFixture(),
    });
}

export type TestBus = ReturnType<typeof furnitureBus>;

export function ok<T>(
    r: ExecuteResult<T>,
): Extract<ExecuteResult<T>, { ok: true }> {
    if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
    return r;
}

export function refused<T>(r: ExecuteResult<T>) {
    if (r.ok) throw new Error('expected an error');
    return r.error;
}

/** The section with `id`, searched pre-order. */
export function sectionOf(doc: FurnitureDocument, id: string): Section {
    const visit = (s: Section): Section | undefined => {
        if (s.id === id) return s;
        for (const child of s.children) {
            const hit = visit(child.section);
            if (hit) return hit;
        }
        return undefined;
    };
    const found = doc.carcass ? visit(doc.carcass.interior) : undefined;
    if (!found) throw new Error(`no section ${id}`);
    return found;
}

/** Section ids in pre-order. */
export function sectionIdsOf(doc: FurnitureDocument): string[] {
    const ids: string[] = [];
    const visit = (s: Section): void => {
        ids.push(s.id);
        s.children.forEach((c) => visit(c.section));
    };
    if (doc.carcass) visit(doc.carcass.interior);
    return ids;
}

/**
 * Executes `type` on a bus over `doc`, checks that undo restores the original
 * document and redo the result (07 §12.5), and returns what the command did.
 */
export function roundTrip<K extends FurnitureCommandType>(
    type: K,
    params: ParamsOf<(typeof FURNITURE_COMMANDS)[K]>,
    doc: FurnitureDocument = wardrobeFixture(),
    opts?: ExecuteOptions,
) {
    const bus = furnitureBus(doc);
    const before = structuredClone(bus.getDoc());
    const result = ok(bus.execute(type, params, opts)) as Extract<
        ExecuteResult<ResultOf<(typeof FURNITURE_COMMANDS)[K]>>,
        { ok: true }
    >;
    const after = bus.getDoc();
    expect(after).not.toEqual(before);
    expect(bus.history().undo).toHaveLength(1);
    expect(bus.undo()).toBe(true);
    expect(bus.getDoc()).toEqual(before);
    expect(bus.redo()).toBe(true);
    expect(bus.getDoc()).toEqual(after);
    return { bus, before, after, result };
}
