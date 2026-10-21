/** `furniture.setNotes` (07 §9): the free-text notes, trimmed; empty becomes `null`. */
import { z } from 'zod';
import { defineFurnitureCommand } from './helpers';

const SetNotesSchema = z.object({ notes: z.string().nullable() });
type SetNotesParams = z.infer<typeof SetNotesSchema>;

const setNotes = defineFurnitureCommand<SetNotesParams>({
    type: 'furniture.setNotes',
    labelKey: 'engine.furniture.command.label.set_notes',
    paramsSchema: SetNotesSchema,
    validate: () => null,
    run(d, p) {
        const trimmed = p.notes?.trim() ?? '';
        d.notes = trimmed === '' ? null : trimmed;
    },
    mergeKey: () => 'notes',
});

/** The notes command, registered in `FURNITURE_COMMANDS` (07 §9). */
export const NOTES_COMMANDS = { 'furniture.setNotes': setNotes };
