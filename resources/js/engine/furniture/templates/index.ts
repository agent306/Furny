/**
 * Template registry (07 §2): one definition per `TemplateKey`.
 */
import { EngineInputError } from '../../errors';
import { newId as newIdFn } from '../../ids';
import type { Issue } from '../../plan/types';
import type { CatalogIndex } from '../catalogIndex';
import type { FurnitureDocument, TemplateKey } from '../schema';
import { validateFurniture } from '../validate';
import { effectiveParams } from './common';
import type { TemplateContext, TemplateDefinition } from './types';
import { wardrobeHinged } from './wardrobe_hinged';
import { wardrobeSliding } from './wardrobe_sliding';
import { loftCabinet } from './loft_cabinet';
import { baseCabinet } from './base_cabinet';
import { wallCabinet } from './wall_cabinet';
import { tallCabinet } from './tall_cabinet';
import { bookshelf } from './bookshelf';
import { openShelfWall } from './open_shelf_wall';
import { tvUnit } from './tv_unit';
import { shoeRack } from './shoe_rack';
import { chestOfDrawers } from './chest_of_drawers';
import { sideboard } from './sideboard';
import { bedsideTable } from './bedside_table';
import { studyDesk } from './study_desk';
import { diningTable } from './dining_table';
import { coffeeTable } from './coffee_table';
import { consoleTable } from './console_table';
import { dressingUnit } from './dressing_unit';
import { customBox } from './custom_box';

export const TEMPLATES = {
    wardrobe_hinged: wardrobeHinged,
    wardrobe_sliding: wardrobeSliding,
    loft_cabinet: loftCabinet,
    base_cabinet: baseCabinet,
    wall_cabinet: wallCabinet,
    tall_cabinet: tallCabinet,
    bookshelf,
    open_shelf_wall: openShelfWall,
    tv_unit: tvUnit,
    shoe_rack: shoeRack,
    chest_of_drawers: chestOfDrawers,
    sideboard,
    bedside_table: bedsideTable,
    study_desk: studyDesk,
    dining_table: diningTable,
    coffee_table: coffeeTable,
    console_table: consoleTable,
    dressing_unit: dressingUnit,
    custom_box: customBox,
} satisfies Record<TemplateKey, TemplateDefinition>;

const REGISTRY: Partial<Record<TemplateKey, TemplateDefinition>> = TEMPLATES;

/** The template for `key`; throws `invalid_input` when none is registered. */
export function getTemplate(key: TemplateKey): TemplateDefinition {
    const template = Object.hasOwn(REGISTRY, key) ? REGISTRY[key] : undefined;
    if (!template) {
        throw new EngineInputError(
            'invalid_input',
            `Unknown furniture template "${key}"`,
            { key },
        );
    }
    return template;
}

/**
 * The document a template generates with its effective default parameters
 * (code defaults merged with the admin `default_overrides`, 07 §2.1 rule 1),
 * with the issues `validateFurniture` finds in it.
 */
export function templateDefaultDocument(
    key: TemplateKey,
    defaultOverrides: Record<string, unknown>,
    catalog: CatalogIndex,
    newId: TemplateContext['newId'] = newIdFn,
): { document: FurnitureDocument; issues: Issue[] } {
    const template = getTemplate(key);
    const params = effectiveParams(template, defaultOverrides);
    const document = template.generate(params, { catalog, newId });
    return { document, issues: validateFurniture(document, catalog.snapshot) };
}
