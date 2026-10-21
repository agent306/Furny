/**
 * Template registry (07 §2). Templates are added as their tasks land, hence
 * the partial record until all 19 exist.
 */
import { EngineInputError } from '../../errors';
import { newId as newIdFn } from '../../ids';
import type { Issue } from '../../plan/types';
import type { CatalogIndex } from '../catalogIndex';
import type { FurnitureDocument, TemplateKey } from '../schema';
import { effectiveParams } from './common';
import type { TemplateContext, TemplateDefinition } from './types';
import { wardrobeHinged } from './wardrobe_hinged';

export const TEMPLATES = {
    wardrobe_hinged: wardrobeHinged,
} satisfies Partial<Record<TemplateKey, TemplateDefinition>>;

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
 * (code defaults merged with the admin `default_overrides`, 07 §2.1 rule 1).
 * `issues` stays empty until `validateFurniture` exists (Task 37).
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
    return { document, issues: [] };
}
