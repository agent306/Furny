/**
 * Plan command pipeline (04 §6.4): validate, phase 1 (the command), phase 2
 * (geometry post-processing) and the error invariant, producing one patch
 * list so a command and its follow-ups are a single history entry.
 */
import { create, type Draft, type Patches } from 'mutative';
import { shouldAutoFreeze } from '../../commands/bus';
import {
    CommandAbort,
    type AnyCommandDef,
    type CommandOutput,
    type Pipeline,
    type PipelineOutput,
} from '../../commands/types';
import type { DerivedPlan } from '../derive';
import type { FootprintProvider } from '../footprint';
import type { PlanDocument } from '../schema';
import type { EngineMessage, Result } from '../types';
import { planErrorKeys, validatePlan } from '../validate';
import { planPathToEntityId } from './paths';
import { postProcess } from './postprocess';

/** The message-key prefix of every plan command message (04 §6.7). */
export const PLAN_COMMAND_KEY_PREFIX = 'engine.plan.command';

/** Error codes of plan commands (04 §6.7); `messageKey` is `engine.plan.command.{code}`. */
export const PLAN_COMMAND_ERROR_CODES = [
    'not_found',
    'out_of_range',
    'too_large',
    'wall_too_short',
    'wall_duplicate',
    'split_through_opening',
    'opening_no_fit',
    'opening_overlap',
    'opening_too_tall',
    'type_mismatch',
    'not_collinear',
    'props_differ',
    'design_unknown',
    'fixture_unknown',
    'dimension_too_short',
    'text_length',
    'background_missing',
    'background_locked',
    'calibration_too_short',
    'introduces_error',
    'fragment_opening_dropped',
    'invalid_params',
] as const;

export type PlanCommandErrorCode = (typeof PLAN_COMMAND_ERROR_CODES)[number];

/** A plan command message: `engine.plan.command.{code}` plus `params`. */
export function planCommandMessage(
    code: PlanCommandErrorCode,
    params: EngineMessage['params'] = {},
): EngineMessage {
    return { code, messageKey: `${PLAN_COMMAND_KEY_PREFIX}.${code}`, params };
}

export interface PlanDefaults {
    /** `doc.meta.defaultWallHeight`. */
    wallHeight: number;
    /** `doc.meta.defaultWallThickness`. */
    interiorThickness: number;
    /** `units.default_exterior_wall_thickness_mm` (02 §13). */
    exteriorThickness: number;
    doorWidth: number;
    doorHeight: number;
    windowWidth: number;
    windowHeight: number;
    windowSill: number;
    openingWidth: number;
    openingHeight: number;
}

/** The sizes new walls, doors, windows and openings start with (04 §6.4). */
export function defaultPlanDefaults(
    doc: PlanDocument,
    exteriorThickness = 230,
): PlanDefaults {
    return {
        wallHeight: doc.meta.defaultWallHeight,
        interiorThickness: doc.meta.defaultWallThickness,
        exteriorThickness,
        doorWidth: 900,
        doorHeight: 2100,
        windowWidth: 1200,
        windowHeight: 1200,
        windowSill: 900,
        openingWidth: 900,
        openingHeight: 2100,
    };
}

export interface PlanCommandContext {
    /** Geometry of the current document (cached deriver). */
    geometry: DerivedPlan;
    /** The shared cached deriver (04 §7). */
    derive(doc: PlanDocument): DerivedPlan;
    footprints: FootprintProvider;
    defaults: PlanDefaults;
    /** `engine/ids.ts::newId`; injectable for deterministic tests. */
    newId(prefix: 'n' | 'w' | 'o' | 'r' | 'f' | 'x' | 'd' | 't'): string;
}

/** Every entity id touched by `patches` (`'*'` stays as it is). */
function changedIdsOf(patches: Patches): Set<string> {
    const ids = new Set<string>();
    for (const patch of patches) {
        const id = planPathToEntityId(patch.path as (string | number)[]);
        if (id !== null) ids.add(id);
    }
    return ids;
}

/**
 * Runs one command on one document (04 §6.4). The caller (the bus) has
 * already parsed `params` with the command's schema. A thrown `CommandAbort`
 * becomes an error result; any other exception propagates.
 *
 * The invariant (step 4): the command may not add an error to
 * `validatePlan`, judged by `planErrorKeys` (`code|entityIds`), so a plan
 * that already has errors stays editable and a command can still repair it.
 */
export function executePlanCommand(
    doc: PlanDocument,
    def: AnyCommandDef<PlanDocument, PlanCommandContext>,
    params: unknown,
    ctx: PlanCommandContext,
): Result<PipelineOutput<PlanDocument>> {
    const invalid = def.validate(doc, params, ctx);
    if (invalid !== null) return { ok: false, error: invalid };

    const out: CommandOutput<unknown> = {
        result: undefined,
        warnings: [],
        deletedIds: [],
    };
    const options = {
        enablePatches: true as const,
        enableAutoFreeze: shouldAutoFreeze(),
    };
    try {
        const [doc1, p1, i1] = create(
            doc,
            (draft) => {
                def.run(draft as Draft<PlanDocument>, params, ctx, out);
            },
            options,
        ) as [PlanDocument, Patches, Patches];
        if (p1.length === 0) {
            return {
                ok: true,
                value: {
                    doc,
                    patches: [],
                    inversePatches: [],
                    result: out.result,
                    warnings: out.warnings,
                    deletedIds: out.deletedIds,
                },
            };
        }

        let doc2 = doc1;
        let p2: Patches = [];
        let i2: Patches = [];
        if (def.touchesGeometry) {
            const info = {
                doc: doc1,
                prevDoc: doc,
                prevGeom: ctx.geometry,
                geom: ctx.derive(doc1),
                footprints: ctx.footprints,
                changed: changedIdsOf(p1),
            };
            [doc2, p2, i2] = create(
                doc1,
                (draft) => {
                    postProcess(draft as Draft<PlanDocument>, info, out);
                },
                options,
            ) as [PlanDocument, Patches, Patches];
        }

        const before = planErrorKeys(validatePlan(doc, ctx.geometry));
        const after = planErrorKeys(validatePlan(doc2, ctx.derive(doc2)));
        for (const key of after) {
            if (!before.has(key)) {
                return {
                    ok: false,
                    error: planCommandMessage('introduces_error', {
                        issue: key.slice(0, key.indexOf('|')),
                    }),
                };
            }
        }

        return {
            ok: true,
            value: {
                doc: doc2,
                patches: [...p1, ...p2],
                inversePatches: [...i2, ...i1],
                result: out.result,
                warnings: out.warnings,
                deletedIds: out.deletedIds,
            },
        };
    } catch (error) {
        if (error instanceof CommandAbort)
            return { ok: false, error: error.reason };
        throw error;
    }
}

/** The pipeline the plan bus runs every command through. */
export const planPipeline: Pipeline<PlanDocument, PlanCommandContext> = (
    doc,
    def,
    params,
    ctx,
) => executePlanCommand(doc, def, params, ctx);
