import { describe, expect, it } from 'vitest';
import { furnitureBus, ok, roundTrip } from '../../testing/commands';
import { wardrobeFixture } from '../../testing/docs';

describe('setNotes', () => {
    it('sets the notes trimmed', () => {
        const { after } = roundTrip('furniture.setNotes', {
            notes: '  Oak veneer on the doors \n',
        });
        expect(after.notes).toBe('Oak veneer on the doors');
    });

    it('whitespace-only and null become null', () => {
        const doc = () => wardrobeFixture((d) => (d.notes = 'old'));
        expect(
            roundTrip('furniture.setNotes', { notes: '  ' }, doc()).after.notes,
        ).toBeNull();
        expect(
            roundTrip('furniture.setNotes', { notes: null }, doc()).after.notes,
        ).toBeNull();
    });

    it('merges a typing burst under the key notes; clearing the text leaves no entry', () => {
        const bus = furnitureBus();
        ok(bus.execute('furniture.setNotes', { notes: 'a' }));
        ok(bus.execute('furniture.setNotes', { notes: 'ab' }, { merge: true }));
        expect(bus.history().undo).toHaveLength(1);
        expect(bus.history().undo[0]!.mergeKey).toBe('notes');
        ok(bus.execute('furniture.setNotes', { notes: '' }, { merge: true }));
        expect(bus.history().undo).toHaveLength(0);
        expect(bus.getDoc().notes).toBeNull();
    });
});
