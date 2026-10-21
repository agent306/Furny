/**
 * Carcass-level hardware (07 §3.1 step 3.8): cabinet legs (§6.6), wall
 * brackets and the anti-tip kit (§6.8) and screw packs (§6.9).
 */
import type { CatalogHardware } from '../../catalog/snapshot';
import type { Envelope } from '../carcass/envelope';
import {
    ANTI_TIP_MIN_HEIGHT,
    LEG_COLUMN_SPACING,
    SCREW_PACK_PARTS,
} from '../constants';
import type { GenContext } from '../types';
import { addHardwareLine } from './hardware';

/** One pair of wall brackets per started metre of carcass width (07 §6.8). */
const WALL_BRACKET_SPAN = 1000;

const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;

/**
 * Whether a leg suits a plinth `height` (07 §6.6, 08 §2.3): within
 * `minHeightMm`..`maxHeightMm` when the specs give a range, else within
 * `adjustableMm` (default 0) of `heightMm`. Specs with neither cannot be
 * checked and count as not fitting (the conservative reading of §6.6, whose
 * formula needs `heightMm`).
 */
export function legFitsHeight(leg: CatalogHardware, height: number): boolean {
    const { specs } = leg;
    const min = num(specs.minHeightMm);
    const max = num(specs.maxHeightMm);
    if (min !== undefined || max !== undefined) {
        return height >= (min ?? -Infinity) && height <= (max ?? Infinity);
    }
    const nominal = num(specs.heightMm);
    if (nominal === undefined) return false;
    return Math.abs(nominal - height) <= (num(specs.adjustableMm) ?? 0);
}

/**
 * Cabinet legs of a floor unit on a `legs` base (07 §6.6): two rows of
 * `max(2, ceil(Wc / 800) + 1)` legs, line `plinth.legs`. The code is the
 * document's `legCode`, else the default plinth leg (behind a set-back
 * kickboard) or cabinet leg (no setback). A leg that does not suit the plinth
 * height warns `furniture.leg_height_mismatch`.
 */
export function cabinetLegs(ctx: GenContext, env: Envelope): void {
    const C = ctx.doc.carcass;
    if (!C || C.mounting !== 'floor' || C.plinth.type !== 'legs') return;
    const setBack = C.plinth.setback > 0;
    const cols = Math.max(2, Math.ceil(env.Wc / LEG_COLUMN_SPACING) + 1);
    const key = 'plinth.legs';
    const code = addHardwareLine(ctx, {
        key,
        roleKey: setBack ? 'leg.plinth' : 'leg.cabinet',
        code: C.plinth.legCode,
        qty: 2 * cols,
        reasonKey: setBack
            ? 'hardware.reason.plinth_legs'
            : 'hardware.reason.cabinet_legs',
        frontId: null,
        sectionId: null,
    });
    const leg = code === undefined ? undefined : ctx.idx.hardware(code);
    if (leg && !legFitsHeight(leg, C.plinth.height)) {
        ctx.issue(
            'furniture.leg_height_mismatch',
            'warning',
            { code: leg.code },
            [key],
        );
    }
}

/**
 * Mounting hardware (07 §6.8): wall and loft units get
 * `2 x max(1, ceil(Wc / 1000))` wall brackets (`carcass.wall_brackets`);
 * floor units at least `ANTI_TIP_MIN_HEIGHT` high get one anti-tip kit
 * (`carcass.anti_tip`), announced by info `furniture.anti_tip_added`.
 */
export function mountingHardware(ctx: GenContext, env: Envelope): void {
    const C = ctx.doc.carcass;
    if (!C) return;
    if (C.mounting === 'wall' || C.mounting === 'loft') {
        addHardwareLine(ctx, {
            key: 'carcass.wall_brackets',
            roleKey: 'wall_bracket.default',
            qty: 2 * Math.max(1, Math.ceil(env.Wc / WALL_BRACKET_SPAN)),
            reasonKey: 'hardware.reason.wall_brackets',
            frontId: null,
            sectionId: null,
        });
        return;
    }
    if (ctx.doc.dims.height < ANTI_TIP_MIN_HEIGHT) return;
    const added = addHardwareLine(ctx, {
        key: 'carcass.anti_tip',
        roleKey: 'anti_tip.default',
        qty: 1,
        reasonKey: 'hardware.reason.anti_tip',
        frontId: null,
        sectionId: null,
    });
    if (added !== undefined) ctx.issue('furniture.anti_tip_added', 'info');
}

/**
 * Screw packs (07 §6.9): `{prefix}.screws` = `max(1, ceil(n / 30))` packs,
 * `n` being the generated part count (`Σ qty`) at the time of the call,
 * which the pipeline makes before the overrides.
 */
export function screwPacks(ctx: GenContext, prefix: 'carcass' | 'table'): void {
    const count = ctx.parts.reduce((total, part) => total + part.qty, 0);
    addHardwareLine(ctx, {
        key: `${prefix}.screws`,
        roleKey: 'screw_pack.default',
        qty: Math.max(1, Math.ceil(count / SCREW_PACK_PARTS)),
        reasonKey: 'hardware.reason.screw_pack',
        frontId: null,
        sectionId: null,
    });
}
