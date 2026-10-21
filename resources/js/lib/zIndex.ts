// Z-index scale of 15 §3.3. Templates use the matching Tailwind utilities; this
// file is for editor code that sets z-index from TypeScript.
export const Z = {
    /** Editor canvas internal layers occupy 0–9 (05/07 manage them). */
    editorLayerMin: 0,
    editorLayerMax: 9,
    /** Sticky table headers, sticky action bars (`z-10`). */
    sticky: 10,
    /** Editor floating toolbars, tablet inspector overlay (`z-20`). */
    editorFloating: 20,
    /** App header, mobile bottom tab bar (`z-30`). */
    header: 30,
    /** Offcanvas sidebar (`z-40`). */
    sidebar: 40,
    /** Every Reka portal: popover, dropdown, select, tooltip, dialog, sheet, drawer (`z-50`). */
    portal: 50,
    /** Lightbox, opens above dialogs (`z-[60]`). */
    lightbox: 60,
    /** vue-sonner toasts (`z-[100]`). */
    toast: 100,
} as const;
