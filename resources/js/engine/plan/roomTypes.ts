/** The 19 `RoomType` values of 03 §1, in spec order. */
export const ROOM_TYPES = [
    'living',
    'dining',
    'kitchen',
    'bedroom',
    'master_bedroom',
    'bathroom',
    'toilet',
    'balcony',
    'utility',
    'store',
    'study',
    'pooja',
    'foyer',
    'corridor',
    'dress',
    'deck',
    'ots',
    'garage',
    'other',
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];
