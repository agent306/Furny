/** Code-unit string order, locale independent: the one comparator for sorting entity ids and keys. */
export const cmpId = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
