import { z } from 'zod';
import type { CommandDef } from '../../commands/types';
import type { PlanDocument } from '../schema';
import type { PlanCommandContext } from './pipeline';

/**
 * Typed identity helper for plan commands: fixes the document and context
 * types so a command file only names its params `P` and result `R`.
 */
export function definePlanCommand<P, R = void>(
    def: CommandDef<PlanDocument, P, PlanCommandContext, R>,
): CommandDef<PlanDocument, P, PlanCommandContext, R> {
    return def;
}

/** A point in a command's params; rounded to whole millimetres by the command. */
export const PointParamSchema = z.object({ x: z.number(), y: z.number() });
