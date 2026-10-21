/**
 * Table hardware lines (07 §3.13): the `table.connectors.*` lines of the
 * bases (cams, dowels, corner brackets).
 */
import { addHardwareLine } from '../rules/hardware';
import type { GenContext } from '../types';

/** Adds a `table.*` connector line of the role default (07 §3.13). */
export function connectorLine(
    ctx: GenContext,
    kind: 'cam' | 'dowel' | 'corner',
    qty: number,
    joints: number,
): void {
    if (qty <= 0) return;
    addHardwareLine(ctx, {
        key: `table.connectors.${kind}`,
        roleKey:
            kind === 'corner'
                ? 'connector.table_corner'
                : kind === 'cam'
                  ? 'connector.cam'
                  : 'connector.dowel',
        qty,
        reasonKey:
            kind === 'corner'
                ? 'hardware.reason.table_corner_brackets'
                : kind === 'cam'
                  ? 'hardware.reason.cam_locks'
                  : 'hardware.reason.dowels',
        reasonParams: kind === 'corner' ? {} : { joints },
        frontId: null,
        sectionId: null,
    });
}
