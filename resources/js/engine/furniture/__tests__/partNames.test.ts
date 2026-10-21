import { describe, expect, it } from 'vitest';
import { PART_NAMES_EN, partNameEn } from '../partNames';

/** Every nameKey of 07 §1.6. */
const NAME_KEYS = [
    'parts.side_left',
    'parts.side_right',
    'parts.top',
    'parts.bottom',
    'parts.back',
    'parts.partition',
    'parts.fixed_shelf',
    'parts.shelf',
    'parts.plinth_front',
    'parts.plinth_back',
    'parts.plinth_return',
    'parts.countertop',
    'parts.door',
    'parts.flap',
    'parts.sliding_door',
    'parts.glass_stile',
    'parts.glass_rail',
    'parts.glass_panel',
    'parts.drawer_front',
    'parts.drawer_inner_front',
    'parts.drawer_side',
    'parts.drawer_back',
    'parts.drawer_bottom',
    'parts.table_top',
    'parts.table_top_layer',
    'parts.table_leg',
    'parts.apron',
    'parts.stretcher',
    'parts.end_panel',
    'parts.modesty_panel',
    'parts.lower_shelf',
    'parts.trestle_upright',
    'parts.trestle_foot',
    'parts.trestle_cleat',
    'parts.pedestal_side',
    'parts.pedestal_plate',
    'parts.drawer_runner',
    'parts.extra',
];

describe('PART_NAMES_EN', () => {
    it('has exactly one entry per nameKey of 07 §1.6', () => {
        expect(Object.keys(PART_NAMES_EN).sort()).toEqual(
            [...NAME_KEYS].sort(),
        );
    });
});

describe('partNameEn', () => {
    it('fills optional and required params', () => {
        expect(partNameEn('parts.back', { n: 2 })).toBe('Back panel 2');
        expect(partNameEn('parts.back', {})).toBe('Back panel');
        expect(partNameEn('parts.shelf', { n: 3 })).toBe('Shelf 3');
        expect(partNameEn('parts.door', { leaf: 1 })).toBe('Door 1');
        expect(partNameEn('parts.extra', { name: 'Filler' })).toBe('Filler');
    });

    it('names plain parts and ignores unused params', () => {
        expect(partNameEn('parts.side_left')).toBe('Left side');
        expect(partNameEn('parts.countertop', { n: 4 })).toBe('Countertop');
        expect(partNameEn('parts.plinth_return', { n: 2 })).toBe(
            'Plinth return 2',
        );
    });

    it('returns an unknown key unchanged', () => {
        expect(partNameEn('parts.nope')).toBe('parts.nope');
    });
});
