import type { RoomType } from './roomTypes';

/**
 * Room-name dictionary of 06 §7.8, mirrored by `vision/app/utils/roomnames.py`.
 * Keys are upper-case; punctuation is kept here as written in the spec and is
 * stripped when matching (see `normaliseName`).
 */
export const ROOM_NAMES: Record<string, RoomType> = {
    'MASTER BEDROOM': 'master_bedroom',
    'MASTER BED': 'master_bedroom',
    'M.BED': 'master_bedroom',
    MBR: 'master_bedroom',

    BEDROOM: 'bedroom',
    'BED ROOM': 'bedroom',
    BED: 'bedroom',
    BR: 'bedroom',
    'GUEST ROOM': 'bedroom',
    'KIDS ROOM': 'bedroom',
    'CHILDREN ROOM': 'bedroom',

    LIVING: 'living',
    'LIVING ROOM': 'living',
    'LIVING/DINING': 'living',
    HALL: 'living',
    DRAWING: 'living',
    'DRAWING ROOM': 'living',
    LOUNGE: 'living',
    FAMILY: 'living',

    DINING: 'dining',
    'DINING ROOM': 'dining',

    KITCHEN: 'kitchen',
    KIT: 'kitchen',
    PANTRY: 'kitchen',

    TOILET: 'toilet',
    WC: 'toilet',
    'W.C': 'toilet',
    WASH: 'toilet',
    POWDER: 'toilet',

    BATH: 'bathroom',
    BATHROOM: 'bathroom',

    BALCONY: 'balcony',
    BALC: 'balcony',
    'SIT OUT': 'balcony',
    SITOUT: 'balcony',
    VERANDAH: 'balcony',
    VERANDA: 'balcony',

    UTILITY: 'utility',
    'WASH AREA': 'utility',
    'W/M': 'utility',
    LAUNDRY: 'utility',
    'SERVICE YARD': 'utility',
    YARD: 'utility',

    STORE: 'store',
    'STORE ROOM': 'store',
    STORAGE: 'store',
    'BOMB SHELTER': 'store',
    SHELTER: 'store',
    'HOUSEHOLD SHELTER': 'store',

    STUDY: 'study',
    OFFICE: 'study',
    LIBRARY: 'study',

    POOJA: 'pooja',
    PUJA: 'pooja',
    PRAYER: 'pooja',

    FOYER: 'foyer',
    ENTRANCE: 'foyer',
    ENTRY: 'foyer',
    LOBBY: 'foyer',

    CORRIDOR: 'corridor',
    PASSAGE: 'corridor',
    'LOBBY PASSAGE': 'corridor',

    DRESS: 'dress',
    DRESSING: 'dress',
    'WALK-IN': 'dress',
    WIC: 'dress',

    DECK: 'deck',
    TERRACE: 'deck',
    'AC LEDGE': 'deck',
    PLANTER: 'deck',

    OTS: 'ots',
    'OPEN TO SKY': 'ots',
    SHAFT: 'ots',
    DUCT: 'ots',

    GARAGE: 'garage',
    PARKING: 'garage',
    'CAR PORCH': 'garage',
};

/** Minimum Levenshtein ratio for a word to count as a match (06 §7.8). */
const MIN_WORD_RATIO = 0.8;

/**
 * Upper-case, hyphens become spaces, every other character that is not a
 * letter, digit, space or `/` is dropped ('W.C' becomes 'WC'), spaces collapse.
 */
function normaliseName(name: string): string {
    return name
        .toUpperCase()
        .replace(/-/g, ' ')
        .replace(/[^\p{L}\p{N}\s/]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Words of a normalised name; `/` separates words as well as spaces. */
function wordsOf(name: string): string[] {
    return normaliseName(name)
        .split(/[\s/]+/)
        .filter((w) => w !== '');
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(
                (prev[j] ?? 0) + 1,
                (cur[j - 1] ?? 0) + 1,
                (prev[j - 1] ?? 0) + cost,
            );
        }
        prev = cur;
    }
    return prev[b.length] ?? 0;
}

/** `1 − dist / max(len)`; 1 for two empty strings. */
function ratio(a: string, b: string): number {
    const longest = Math.max(a.length, b.length);
    return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

interface Entry {
    words: string[];
    type: RoomType;
}

const ENTRIES_BY_WORD_COUNT: Entry[][] = (() => {
    const groups: Entry[][] = [];
    for (const [key, type] of Object.entries(ROOM_NAMES)) {
        const words = wordsOf(key);
        if (words.length === 0) continue;
        (groups[words.length] ??= []).push({ words, type });
    }
    return groups;
})();

/**
 * Suggests a `RoomType` for a drawing label. Multiword phrases are tried first
 * (longest first, anywhere inside the label), then single words; a word matches
 * when its Levenshtein ratio against the dictionary word is at least 0.8. The
 * best mean ratio wins, ties go to the earliest part of the label. Falls back
 * to `'other'`.
 */
export function suggestRoomType(name: string): RoomType {
    const words = wordsOf(name);
    const maxCount = Math.min(words.length, ENTRIES_BY_WORD_COUNT.length - 1);
    for (let count = maxCount; count >= 1; count--) {
        const entries = ENTRIES_BY_WORD_COUNT[count] ?? [];
        let best: RoomType | null = null;
        let bestScore = 0;
        for (let start = 0; start + count <= words.length; start++) {
            for (const entry of entries) {
                let total = 0;
                let ok = true;
                for (let k = 0; k < count; k++) {
                    const r = ratio(
                        words[start + k] ?? '',
                        entry.words[k] ?? '',
                    );
                    if (r < MIN_WORD_RATIO) {
                        ok = false;
                        break;
                    }
                    total += r;
                }
                const score = total / count;
                if (ok && score > bestScore) {
                    best = entry.type;
                    bestScore = score;
                }
            }
        }
        if (best !== null) return best;
    }
    return 'other';
}
