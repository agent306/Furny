import { newId as generateId } from '../../ids';
import { createCommandBus } from '../../commands/bus';
import type { AnyCommandDef, CommandBus } from '../../commands/types';
import { createPlanDeriver, type DerivedPlan } from '../derive';
import type { FootprintProvider } from '../footprint';
import type { PlanDocument } from '../schema';
import { planPathToEntityId } from './paths';
import {
    PLAN_COMMAND_KEY_PREFIX,
    defaultPlanDefaults,
    planPipeline,
    type PlanCommandContext,
    type PlanDefaults,
} from './pipeline';
import { ANNOTATION_COMMANDS } from './annotations';
import { BACKGROUND_COMMANDS } from './background';
import { FIXTURE_COMMANDS } from './fixtures';
import { MOVE_COMMANDS } from './moves';
import { OPENING_COMMANDS } from './openings';
import { PLACEMENT_COMMANDS } from './placements';
import { PLAN_WIDE_COMMANDS } from './plan';
import { ROOM_COMMANDS } from './rooms';
import { WALL_COMMANDS } from './walls';

/** Results `createPlanBus` remembers by document identity. */
const DERIVE_MEMO_SLOTS = 2;

type PlanCommandRegistry = Record<
    string,
    AnyCommandDef<PlanDocument, PlanCommandContext>
>;

/** Every plan command by name (04 §6.6); the command groups are spread in here. */
export const PLAN_COMMANDS = {
    ...WALL_COMMANDS,
    ...MOVE_COMMANDS,
    ...OPENING_COMMANDS,
    ...ROOM_COMMANDS,
    ...PLACEMENT_COMMANDS,
    ...FIXTURE_COMMANDS,
    ...ANNOTATION_COMMANDS,
    ...BACKGROUND_COMMANDS,
    ...PLAN_WIDE_COMMANDS,
} satisfies PlanCommandRegistry;

export type PlanCommandType = keyof typeof PLAN_COMMANDS & string;

export interface PlanBusConfig<M extends PlanCommandRegistry> {
    initial: PlanDocument;
    footprints: FootprintProvider;
    /** Default: `defaultPlanDefaults(doc)` of the document each command runs on. */
    defaults?: PlanDefaults;
    /** Default: `engine/ids.ts::newId`. */
    newId?: PlanCommandContext['newId'];
    maxHistory?: number;
    /** Passed to the generic bus (`CommandBusConfig.mergeBaseCache`). */
    mergeBaseCache?: boolean;
    /** Default: `PLAN_COMMANDS`. Lets a caller run its own commands (tests, benches). */
    registry?: M;
}

/**
 * The plan command bus (04 §6.1, §6.4): the generic bus with the plan
 * pipeline, patch-path mapping and a context built from one shared cached
 * deriver, so the geometry of the document a command starts from is already
 * cached when the pipeline derives the next one.
 */
export function createPlanBus<
    M extends PlanCommandRegistry = typeof PLAN_COMMANDS,
>(cfg: PlanBusConfig<M>): CommandBus<PlanDocument, PlanCommandContext, M> {
    const deriver = createPlanDeriver();
    // The deriver is incremental against its last document only. A replace
    // merge alternates between the drag's base and the documents built on it,
    // so the two most recent results are kept by identity.
    const recent: Array<{ doc: PlanDocument; geom: DerivedPlan }> = [];
    const derive = (doc: PlanDocument): DerivedPlan => {
        const at = recent.findIndex((e) => e.doc === doc);
        if (at >= 0) {
            const [hit] = recent.splice(at, 1);
            recent.unshift(hit!);
            return hit!.geom;
        }
        const geom = deriver.derive(doc);
        recent.unshift({ doc, geom });
        recent.length = Math.min(recent.length, DERIVE_MEMO_SLOTS);
        return geom;
    };
    return createCommandBus<PlanDocument, PlanCommandContext, M>({
        initial: cfg.initial,
        registry: cfg.registry ?? (PLAN_COMMANDS as unknown as M),
        pipeline: planPipeline,
        pathToEntityId: planPathToEntityId,
        messageKeyPrefix: PLAN_COMMAND_KEY_PREFIX,
        ...(cfg.maxHistory === undefined ? {} : { maxHistory: cfg.maxHistory }),
        ...(cfg.mergeBaseCache === undefined
            ? {}
            : { mergeBaseCache: cfg.mergeBaseCache }),
        getContext: (doc) => ({
            geometry: derive(doc),
            derive,
            footprints: cfg.footprints,
            defaults: cfg.defaults ?? defaultPlanDefaults(doc),
            newId: cfg.newId ?? generateId,
        }),
    });
}
