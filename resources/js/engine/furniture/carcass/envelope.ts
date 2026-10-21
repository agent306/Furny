/**
 * Carcass envelope (07 §3.2): the outer box of the carcass proper, i.e. the
 * overall size minus plinth, countertop and the zone in front of the carcass,
 * plus the rear/front z positions the other generators build on.
 */
import { EngineInputError } from '../../errors';
import { BACK_GROOVE_OFFSET, SLIDING_TRACK_PITCH_EXTRA } from '../constants';
import type { CarcassSpec, Front, FurnitureDocument, Section } from '../schema';
import type { Box3, GenContext } from '../types';

export interface Envelope {
    /** Carcass min corner (the z min is always 0). */
    x0: number;
    y0: number;
    /** Carcass box size. */
    Wc: number;
    Hc: number;
    Dc: number;
    /** Front zone depth: fronts standing in front of the carcass. */
    fz: number;
    /** Plinth height and countertop thickness. */
    plinthH: number;
    ctT: number;
    /** Rear z of sides/top/bottom (`t_b` for a nailed back, else 0). */
    zp: number;
    /** z of the back panel's front face; the interior starts here. */
    zBackFront: number;
    /** Depth reserved at the front of the interior for sliding doors (0 if none). */
    slidingZone: number;
    /** Overlay used by the drawer fronts (07 §4.4). */
    drawerStyle: 'full' | 'inset';
    /** Root section box. */
    interior: Box3;
}

/** Smallest carcass sizes (07 §3.2). */
const MIN_CARCASS_WIDTH = 150;
const MIN_CARCASS_HEIGHT = 100;
const MIN_CARCASS_DEPTH = 100;

/** Section ids from the root down to `sectionId` inclusive; empty when absent. */
function pathTo(root: Section, sectionId: string): string[] {
    if (root.id === sectionId) return [root.id];
    for (const child of root.children) {
        const rest = pathTo(child.section, sectionId);
        if (rest.length > 0) return [root.id, ...rest];
    }
    return [];
}

/**
 * The front covering `sectionId`, directly or through an ancestor section
 * (a front over a column covers everything in it).
 */
export function coveringFront(
    doc: FurnitureDocument,
    sectionId: string,
): Front | undefined {
    const carcass = doc.carcass;
    if (!carcass) return undefined;
    const path = pathTo(carcass.interior, sectionId);
    const ids = path.length > 0 ? path : [sectionId];
    return carcass.fronts.find((front) =>
        front.covers.some((id) => ids.includes(id)),
    );
}

/**
 * True when some leaf holds drawers that are not behind a door and that no
 * front covers (directly or via an ancestor): they get their own fronts.
 */
export function hasExternalDrawers(doc: FurnitureDocument): boolean {
    const carcass = doc.carcass;
    if (!carcass) return false;
    const visit = (section: Section): boolean => {
        if (section.children.length > 0) {
            return section.children.some((child) => visit(child.section));
        }
        const content = section.content;
        return (
            content?.type === 'drawers' &&
            !content.behindDoor &&
            coveringFront(doc, section.id) === undefined
        );
    };
    return visit(carcass.interior);
}

/**
 * Overlay of the external drawer fronts (07 §4.4): `inset` when the cabinet
 * has fronts and all of them are inset, else `full`.
 */
export function drawerStyleOf(doc: FurnitureDocument): Envelope['drawerStyle'] {
    const fronts = doc.carcass?.fronts ?? [];
    return fronts.length > 0 && fronts.every((f) => f.overlay === 'inset')
        ? 'inset'
        : 'full';
}

function backFrontZ(type: CarcassSpec['back']['type'], tBack: number): number {
    switch (type) {
        case 'none':
            return 0;
        case 'grooved':
            return BACK_GROOVE_OFFSET + tBack;
        case 'nailed':
        case 'inset':
            return tBack;
    }
}

/**
 * The envelope of the document's carcass, or `null` after reporting the error
 * `furniture.envelope_too_small` (generation then stops without parts).
 * Wall and loft units ignore a plinth, reported as info `furniture.plinth_ignored`.
 */
export function computeEnvelope(ctx: GenContext): Envelope | null {
    const { doc } = ctx;
    const C = doc.carcass;
    if (!C) {
        throw new EngineInputError(
            'invalid_input',
            'computeEnvelope needs a carcass document',
            { family: doc.family },
        );
    }
    const tc = ctx.t('carcass');
    const tf = ctx.t('front');
    const tb = ctx.t('back');

    const hasSliding = C.fronts.some((f) => f.kind === 'sliding');
    const drawerStyle = drawerStyleOf(doc);
    const hasOverlayFronts =
        C.fronts.some((f) => f.kind !== 'sliding' && f.overlay !== 'inset') ||
        (hasExternalDrawers(doc) && drawerStyle === 'full');
    const fz = hasSliding ? 0 : hasOverlayFronts ? tf : 0;

    let plinthH = 0;
    if (C.plinth.type !== 'none') {
        if (C.mounting === 'floor') plinthH = C.plinth.height;
        else ctx.issue('furniture.plinth_ignored', 'info');
    }

    const ct = C.countertop?.enabled ? C.countertop : null;
    const ctT = ct ? ctx.t('top') : 0;
    const oL = ct ? ct.overhangLeft : 0;
    const oR = ct ? ct.overhangRight : 0;
    const oF = ct ? ct.overhangFront : 0;

    const Wc = doc.dims.width - oL - oR;
    const Hc = doc.dims.height - plinthH - ctT;
    const Dc = doc.dims.depth - fz - oF;
    const x0 = oL;
    const y0 = plinthH;

    const zp = C.back.type === 'nailed' ? tb : 0;
    const zBackFront = backFrontZ(C.back.type, tb);
    const slidingZone = hasSliding ? 2 * (tf + SLIDING_TRACK_PITCH_EXTRA) : 0;

    const interior: Box3 = {
        min: [x0 + tc, y0 + tc, zBackFront],
        size: [Wc - 2 * tc, Hc - 2 * tc, Dc - slidingZone - zBackFront],
    };

    if (
        Wc < MIN_CARCASS_WIDTH ||
        Hc < MIN_CARCASS_HEIGHT ||
        Dc < MIN_CARCASS_DEPTH ||
        interior.size.some((s) => s <= 0)
    ) {
        ctx.issue('furniture.envelope_too_small', 'error');
        return null;
    }

    return {
        x0,
        y0,
        Wc,
        Hc,
        Dc,
        fz,
        plinthH,
        ctT,
        zp,
        zBackFront,
        slidingZone,
        drawerStyle,
        interior,
    };
}
