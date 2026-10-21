import { describe, expect, it } from 'vitest';
import { ROOM_NAMES, suggestRoomType } from '../roomNames';
import { ROOM_TYPES } from '../roomTypes';

describe('ROOM_TYPES', () => {
    it('lists the 19 room types of 03 §1', () => {
        expect(ROOM_TYPES).toHaveLength(19);
        expect(new Set(ROOM_TYPES).size).toBe(19);
        expect(ROOM_TYPES[0]).toBe('living');
        expect(ROOM_TYPES[ROOM_TYPES.length - 1]).toBe('other');
    });
});

describe('ROOM_NAMES', () => {
    it('has upper-case keys that map to known room types', () => {
        for (const [key, type] of Object.entries(ROOM_NAMES)) {
            expect(key).toBe(key.toUpperCase());
            expect(ROOM_TYPES).toContain(type);
        }
    });

    it('maps BATH and BATHROOM to bathroom, not toilet', () => {
        expect(ROOM_NAMES['BATH']).toBe('bathroom');
        expect(ROOM_NAMES['BATHROOM']).toBe('bathroom');
        expect(ROOM_NAMES['TOILET']).toBe('toilet');
        expect(ROOM_NAMES['W.C']).toBe('toilet');
    });

    it('contains the 06 §7.8 keys (spot checks across every group)', () => {
        const expected: Record<string, string> = {
            'MASTER BEDROOM': 'master_bedroom',
            MBR: 'master_bedroom',
            'GUEST ROOM': 'bedroom',
            'CHILDREN ROOM': 'bedroom',
            'LIVING/DINING': 'living',
            FAMILY: 'living',
            'DINING ROOM': 'dining',
            PANTRY: 'kitchen',
            POWDER: 'toilet',
            VERANDAH: 'balcony',
            'SIT OUT': 'balcony',
            'W/M': 'utility',
            'SERVICE YARD': 'utility',
            'HOUSEHOLD SHELTER': 'store',
            LIBRARY: 'study',
            PRAYER: 'pooja',
            LOBBY: 'foyer',
            'LOBBY PASSAGE': 'corridor',
            'WALK-IN': 'dress',
            WIC: 'dress',
            'AC LEDGE': 'deck',
            'OPEN TO SKY': 'ots',
            'CAR PORCH': 'garage',
        };
        for (const [key, type] of Object.entries(expected)) {
            expect(ROOM_NAMES[key], key).toBe(type);
        }
    });
});

describe('suggestRoomType', () => {
    it.each([
        ['Master Bedroom', 'master_bedroom'],
        ['M.BED', 'master_bedroom'],
        ['Bed Room', 'bedroom'],
        ['Living/Dining', 'living'],
        ['Kitchn', 'kitchen'],
        ['W.C', 'toilet'],
        ['Bathroom', 'bathroom'],
        ['Sit out', 'balcony'],
        ['Open to sky', 'ots'],
        ['xyz', 'other'],
    ] as const)('%s -> %s', (name, type) => {
        expect(suggestRoomType(name)).toBe(type);
    });

    it('prefers multiword phrases over their single words', () => {
        expect(suggestRoomType('MASTER BEDROOM')).toBe('master_bedroom');
        expect(suggestRoomType('Wash Area')).toBe('utility');
        expect(suggestRoomType('Lobby Passage')).toBe('corridor');
        expect(suggestRoomType('Dining Room')).toBe('dining');
        expect(suggestRoomType('Living Room')).toBe('living');
    });

    it('finds a phrase inside a longer label', () => {
        expect(suggestRoomType('Master Bedroom 1')).toBe('master_bedroom');
        expect(suggestRoomType('Bed Room 2')).toBe('bedroom');
        expect(suggestRoomType('Toilet (attached)')).toBe('toilet');
    });

    it('ignores case, punctuation and extra spaces', () => {
        expect(suggestRoomType('  kitchen  ')).toBe('kitchen');
        expect(suggestRoomType('Living / Dining')).toBe('living');
        expect(suggestRoomType('Walk-in Closet')).toBe('dress');
    });

    it('tolerates a one-letter typo only when the ratio stays at least 0.8', () => {
        expect(suggestRoomType('Balcny')).toBe('balcony');
        expect(suggestRoomType('Bedrom')).toBe('bedroom');
        expect(suggestRoomType('Garag')).toBe('garage');
        // 'BED' vs 'BAD' is 0.667, below the threshold
        expect(suggestRoomType('Bad')).toBe('other');
    });

    it('does not confuse near-miss words of different rooms', () => {
        expect(suggestRoomType('Dining')).toBe('dining');
        expect(suggestRoomType('Living')).toBe('living');
        expect(suggestRoomType('Bath')).toBe('bathroom');
        expect(suggestRoomType('Bedroom')).toBe('bedroom');
    });

    it('returns other for empty or punctuation-only names', () => {
        expect(suggestRoomType('')).toBe('other');
        expect(suggestRoomType('  ... ')).toBe('other');
        expect(suggestRoomType('12')).toBe('other');
    });
});
