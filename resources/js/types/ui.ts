export type Appearance = 'light' | 'dark' | 'system';
export type ResolvedAppearance = 'light' | 'dark';

/** Semantic colour of a status (15 §9.3); maps 1:1 to the `Badge` variants. */
export type Tone =
    'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

/** Autosave state shown by `SaveStatusIndicator` in the editor top bar (15 §9.31). */
export type SaveStatus =
    'saved' | 'saving' | 'dirty' | 'offline' | 'error' | 'conflict' | 'invalid';
