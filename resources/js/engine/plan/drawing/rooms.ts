/** Room symbols (04 §8.2): the net polygon fill and the stacked label. */
import { formatArea, formatLength } from '../../units/format';
import type { DerivedRoom } from '../derive';
import type { RoomType } from '../roomTypes';
import type { RoomMeta } from '../schema';
import { poly, text } from './shared';
import type {
    DrawGroup,
    DrawItem,
    DrawingOptions,
    RoomColorKey,
    StyleKey,
} from './types';

/** Room type to fill token (15 §3.4); all 19 `RoomType`s. */
const ROOM_COLOR_KEY: Readonly<Record<RoomType, RoomColorKey>> = {
    living: 'room-living',
    dining: 'room-living',
    bedroom: 'room-bedroom',
    master_bedroom: 'room-bedroom',
    dress: 'room-bedroom',
    kitchen: 'room-kitchen',
    bathroom: 'room-bath',
    toilet: 'room-bath',
    balcony: 'room-outdoor',
    deck: 'room-outdoor',
    utility: 'room-utility',
    store: 'room-utility',
    garage: 'room-utility',
    ots: 'room-utility',
    study: 'room-study',
    pooja: 'room-pooja',
    foyer: 'room-circulation',
    corridor: 'room-circulation',
    other: 'room-other',
};

export function roomTypeToColorKey(type: RoomType): RoomColorKey {
    return ROOM_COLOR_KEY[type];
}

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
            fillKey: roomTypeToColorKey(meta?.type ?? 'other'),
        }),
    ];

    const lines: Array<{ style: StyleKey; value: string }> = [
        {
            style: 'room_name',
            value:
                meta && meta.name.trim() !== ''
                    ? meta.name.trim()
                    : strings.unnamedRoom,
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
