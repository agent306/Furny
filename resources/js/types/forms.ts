/**
 * The address form shape (02 §1.2 `addresses`, camelCase on the wire). Empty
 * optional fields may be `''` or `null`; the server turns `''` into `null`.
 */
export type AddressFormData = {
    /** "Home", "Site" (max 60). */
    label: string | null;
    /** Max 200. */
    line1: string;
    /** Max 200. */
    line2: string | null;
    /** Max 100. */
    city: string;
    /** State or province (max 100). */
    region: string | null;
    /** Max 20. */
    postalCode: string | null;
    /** ISO-3166-1 alpha-2. */
    countryCode: string;
};
