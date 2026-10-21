/** Room symbols (04 §8.2): the net polygon fill and the stacked label. */
import { formatArea, formatLength } from '../../units/format';
import type { DerivedRoom } from '../derive';
import type { RoomType } from '../roomTypes';
import type { RoomMeta } from '../schema';
import { poly, text } from './shared';
import type { DrawGroup, DrawItem, DrawingOptions, StyleKey } from './types';

/**
 * Light-theme fill of each room type: sRGB hex of the room tokens of 15 §3.1,
 * grouped as in 15 §3.4.
 */
export const ROOM_FILL: Readonly<Record<RoomType, string>> = {
    living: '#f9efda',
    dining: '#f9efda',
    bedroom: '#e2f0ff',
    master_bedroom: '#e2f0ff',
    dress: '#e2f0ff',
    kitchen: '#ffebda',
    bathroom: '#d8f5f8',
    toilet: '#d8f5f8',
    balcony: '#e1f6dc',
    deck: '#e1f6dc',
    utility: '#f0ece7',
    store: '#f0ece7',
    garage: '#f0ece7',
    ots: '#f0ece7',
    study: '#f1ebfd',
    pooja: '#ffe8e2',
    foyer: '#f8f5ef',
    corridor: '#f8f5ef',
    other: '#f5f3f0',
};

/** `dyEm` of each line of a stack of two or three; one line sits at 0. */
const STACK_DY = [-0.6, 0.6, 1.8] as const;

export function drawRoom(
    r: DerivedRoom,
    meta: RoomMeta | null,
    opts: DrawingOptions,
): DrawGroup {
    const { units, strings, include, lod } = opts;
    const items: DrawItem[] = [
        poly(r.polygon, 'room_fill', {
            holes: r.holes,
            fill: ROOM_FILL[meta?.type ?? 'other'],
        }),
    ];

    const lines: Array<{ style: StyleKey; value: string }> = [
        {
            style: 'room_name',
            value: meta && meta.name !== '' ? meta.name : strings.unnamedRoom,
        },
    ];
    // LOD 1 hides the size line, LOD 2 also the area (05 §4.7).
    if (include.roomAreas && (meta?.showArea ?? true) && lod < 2) {
        lines.push({
            style: 'room_area',
            value: formatArea(r.areaMm2, units),
        });
    }
    if (include.roomDims && r.netRect && lod < 1) {
        const { width, depth } = r.netRect;
        const summary = { style: 'summary' } as const;
        lines.push({
            style: 'room_dims',
            value: `${formatLength(width, units, summary)} × ${formatLength(depth, units, summary)}`,
        });
    }
    lines.forEach(({ style, value }, i) => {
        items.push(
            text(r.labelPoint, value, opts.textSizeMm(style), style, {
                dyEm: lines.length === 1 ? 0 : STACK_DY[i],
            }),
        );
    });

    return { entityId: r.metaId, entityKind: 'room', items };
}
