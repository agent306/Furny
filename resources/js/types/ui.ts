export type Appearance = 'light' | 'dark' | 'system';
export type ResolvedAppearance = 'light' | 'dark';

export type AppVariant = 'header' | 'sidebar';

export type FlashToast = {
    type: 'success' | 'info' | 'warning' | 'error';
    message: string;
};

/** Semantic colour of a status (15 §9.3); maps 1:1 to the `Badge` variants. */
export type Tone =
    'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
