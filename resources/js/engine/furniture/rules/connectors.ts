/**
 * Connectors (07 §6.9): cam locks and dowels for every joint recorded in
 * `ctx.joints`, drilled in the member part.
 */
import { CAM_SPACING } from '../constants';
import type { GenContext, Part } from '../types';
import { addHardwareLine } from './hardware';

/** Cams (and as many dowels) for a joint of `length` mm. */
export const camsPerJoint = (length: number): number =>
    Math.max(2, Math.ceil(length / CAM_SPACING));

/**
 * Adds `camLocks` and `dowels` to the member part of every joint and the
 * hardware lines `{family}.connectors.cam` (`connector.cam`) and
 * `{family}.connectors.dowel` (`connector.dowel`) with their sums. No joints,
 * no lines.
 */
export function connectorsForJoints(
    ctx: GenContext,
    family: 'carcass' | 'table',
): void {
    if (ctx.joints.length === 0) return;
    const byKey = new Map<string, Part>();
    for (const part of ctx.parts) {
        if (!byKey.has(part.key)) byKey.set(part.key, part);
    }

    let cams = 0;
    for (const joint of ctx.joints) {
        const n = camsPerJoint(joint.length);
        cams += n;
        const member = byKey.get(joint.member);
        if (member) {
            member.operations.camLocks += n;
            member.operations.dowels += n;
        }
    }

    const joints = ctx.joints.length;
    const prefix = `${family}.connectors`;
    addHardwareLine(ctx, {
        key: `${prefix}.cam`,
        roleKey: 'connector.cam',
        qty: cams,
        reasonKey: 'hardware.reason.cam_locks',
        reasonParams: { joints },
        frontId: null,
        sectionId: null,
    });
    addHardwareLine(ctx, {
        key: `${prefix}.dowel`,
        roleKey: 'connector.dowel',
        qty: cams,
        reasonKey: 'hardware.reason.dowels',
        reasonParams: { joints },
        frontId: null,
        sectionId: null,
    });
}
