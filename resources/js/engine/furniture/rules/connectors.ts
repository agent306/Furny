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
 * Adds `n` connectors for `joints` joints to the line `key`: to its quantity
 * and `joints` reason param when the line already exists (a table base's own
 * dowels, 07 §3.13), else as a new line of the role default.
 */
function addConnectors(
    ctx: GenContext,
    key: string,
    roleKey: 'connector.cam' | 'connector.dowel',
    reasonKey: string,
    n: number,
    joints: number,
): void {
    const existing = ctx.hardware.find((line) => line.key === key);
    if (existing) {
        existing.qty += n;
        const before = existing.reasonParams.joints;
        existing.reasonParams = {
            ...existing.reasonParams,
            joints: (typeof before === 'number' ? before : 0) + joints,
        };
        return;
    }
    addHardwareLine(ctx, {
        key,
        roleKey,
        qty: n,
        reasonKey,
        reasonParams: { joints },
        frontId: null,
        sectionId: null,
    });
}

/**
 * Adds `camLocks` and `dowels` to the member part of every joint and the
 * hardware lines `{family}.connectors.cam` (`connector.cam`) and
 * `{family}.connectors.dowel` (`connector.dowel`) with their sums; a line
 * that already exists (the table base's connectors) takes the sums, so each
 * key stays one line. No joints, no lines.
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
    addConnectors(
        ctx,
        `${prefix}.cam`,
        'connector.cam',
        'hardware.reason.cam_locks',
        cams,
        joints,
    );
    addConnectors(
        ctx,
        `${prefix}.dowel`,
        'connector.dowel',
        'hardware.reason.dowels',
        cams,
        joints,
    );
}
