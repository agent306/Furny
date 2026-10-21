import { customAlphabet } from 'nanoid';

/** Entity id prefixes used inside documents (master §6.3). */
export type IdPrefix =
    'n' | 'w' | 'o' | 'r' | 'f' | 'x' | 'd' | 't' | 's' | 'fr' | 'p' | 'h';

export const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const ID_LENGTH = 10;

const nanoid10 = customAlphabet(ID_ALPHABET, ID_LENGTH);

/** `{prefix}_{nanoid(10)}` over the lowercase alphanumeric alphabet. */
export function newId(prefix: IdPrefix): string {
    return `${prefix}_${nanoid10()}`;
}

/** True when `id` is exactly `{prefix}_` followed by 10 alphabet characters. */
export function isEntityId(id: string, prefix: IdPrefix): boolean {
    const head = `${prefix}_`;
    if (id.length !== head.length + ID_LENGTH || !id.startsWith(head)) {
        return false;
    }
    for (let i = head.length; i < id.length; i += 1) {
        if (!ID_ALPHABET.includes(id.charAt(i))) {
            return false;
        }
    }
    return true;
}
