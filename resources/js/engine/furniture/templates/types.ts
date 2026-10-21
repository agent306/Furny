/**
 * Template definition types (07 §2.1). A template turns a small parameter
 * object into a complete `FurnitureDocument`; the parameters are never stored.
 */
import type { z } from 'zod';
import type { MaterialRole } from '../../catalog/snapshot';
import type { CatalogIndex } from '../catalogIndex';
import type { FurnitureDocument, TemplateKey } from '../schema';

/** Equals `furniture_presets.category`. */
export type TemplateCategory =
    | 'wardrobe'
    | 'kitchen'
    | 'storage'
    | 'shelving'
    | 'tv_unit'
    | 'table'
    | 'desk'
    | 'bed'
    | 'other';

/** Shows a field only while the parameter `key` has one of the given values. */
export interface Condition {
    key: string;
    equals: string | number | boolean | Array<string | number>;
}

interface FieldBase {
    key: string;
    /** `templates.fields.{key}`. */
    labelKey: string;
    advanced?: boolean;
    visibleIf?: Condition;
    helpKey?: string;
}

export type ParamField =
    | (FieldBase & {
          kind: 'length';
          min: number;
          max: number;
          step: number;
      })
    | (FieldBase & {
          kind: 'int';
          min: number;
          max: number;
          allowAuto?: boolean;
      })
    | (FieldBase & {
          kind: 'select';
          /** Option labels are `templates.options.{value}`. */
          options: Array<{ value: string; labelKey: string }>;
      })
    | (FieldBase & { kind: 'boolean' });

export interface TemplateContext {
    catalog: CatalogIndex;
    /** Production: `engine/ids.ts` `newId`; tests: `testIds()` (07 §12.1). */
    newId: (prefix: 's' | 'fr') => string;
}

export interface TemplateDefinition<
    P extends Record<string, unknown> = Record<string, unknown>,
> {
    key: TemplateKey;
    family: 'carcass' | 'table';
    category: TemplateCategory;
    /** `templates.{key}.name`. */
    nameKey: string;
    /** `templates.{key}.description`. */
    descriptionKey: string;
    /** Static asset path `/images/templates/{key}.svg`. */
    thumbnail: string;
    /** UI order. */
    fields: ParamField[];
    /** Values may be `'auto'` where a field allows it. */
    defaults: P;
    /** Ranges identical to `fields`. */
    paramsSchema: z.ZodType<P>;
    /** Catalog codes tried in order before the usage rule. */
    preferredMaterials?: Partial<Record<MaterialRole, string[]>>;
    generate(params: P, ctx: TemplateContext): FurnitureDocument;
}
