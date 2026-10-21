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
