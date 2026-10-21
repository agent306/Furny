/**
 * Table family (07 §3.13): the top (layers and outline), the base
 * (`four_legs`, `panel_ends`, `trestle`, `pedestal`, `cabinet_ends`), the
 * under-top drawers and the table hardware (`table.*` lines; nothing from
 * the mounting rules of §6.8).
 *
 * Coordinates are furniture local space (07 §1.1): the top covers
 * `x ∈ [0, W]`, `z ∈ [0, D]`; the base stands in the footprint
 * `[bx0, bx0 + Wb] x [bz0, bz0 + Db]` under the top (`y ∈ [0, Hb]`).
 * The steps live in `top.ts`, `bases.ts`, `cabinet.ts`, `drawers.ts` and
 * `hardware.ts`; `frame.ts` holds the shared symbols and helpers.
 */
import { screwPacks } from '../rules/carcassHardware';
import { connectorsForJoints } from '../rules/connectors';
import type { GenContext } from '../types';
import { fourLegs, panelEnds, pedestal, trestle } from './bases';
import { cabinetEnds } from './cabinet';
import { underTopDrawers } from './drawers';
import { tableFrame } from './frame';
import { topParts } from './top';

/**
 * Step 3 of `generateFurniture` for the table family (07 §3.13): the top, the
 * base, the under-top drawers, then the connectors of the recorded joints
 * (merged into the base's `table.connectors.*` lines) and the screw packs.
 * Returns false when nothing could be generated (`furniture.envelope_too_small`:
 * no room under the top) or the document has no table spec.
 */
export function tableParts(ctx: GenContext): boolean {
    const T = ctx.doc.table;
    if (!T) return false;
    const f = tableFrame(ctx, T);
    if (!f) return false;

    topParts(ctx, f);
    let cabinetX0 = f.bx0 + f.Wb;
    switch (T.base.type) {
        case 'four_legs':
            fourLegs(ctx, f);
            break;
        case 'panel_ends':
            panelEnds(ctx, f);
            break;
        case 'trestle':
            trestle(ctx, f);
            break;
        case 'pedestal':
            pedestal(ctx, f);
            break;
        case 'cabinet_ends':
            cabinetX0 = cabinetEnds(ctx, f);
            break;
    }
    underTopDrawers(ctx, f, cabinetX0);
    connectorsForJoints(ctx, 'table');
    screwPacks(ctx, 'table');
    return true;
}
