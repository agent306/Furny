/**
 * English part names for exports (07 §1.6), mirroring `resources/lang/en/parts.php`.
 * Each entry is a template: `{param}` placeholders are filled from the part's
 * `nameParams`, and a missing param simply drops out ("Back panel" when the
 * back is not split).
 */
export const PART_NAMES_EN: Record<string, string> = {
    'parts.side_left': 'Left side',
    'parts.side_right': 'Right side',
    'parts.top': 'Top',
    'parts.bottom': 'Bottom',
    'parts.back': 'Back panel {n}',
    'parts.partition': 'Partition {n}',
    'parts.fixed_shelf': 'Fixed shelf {n}',
    'parts.shelf': 'Shelf {n}',
    'parts.plinth_front': 'Plinth front',
    'parts.plinth_back': 'Plinth back',
    'parts.plinth_return': 'Plinth return {n}',
    'parts.countertop': 'Countertop',
    'parts.door': 'Door {leaf}',
    'parts.flap': 'Flap',
    'parts.sliding_door': 'Sliding door {leaf}',
    'parts.glass_stile': 'Door stile',
    'parts.glass_rail': 'Door rail',
    'parts.glass_panel': 'Glass panel',
    'parts.drawer_front': 'Drawer front {n}',
    'parts.drawer_inner_front': 'Drawer inner front {n}',
    'parts.drawer_side': 'Drawer side',
    'parts.drawer_back': 'Drawer back',
    'parts.drawer_bottom': 'Drawer bottom',
    'parts.table_top': 'Table top',
    'parts.table_top_layer': 'Table top layer {n}',
    'parts.table_leg': 'Leg',
    'parts.apron': 'Apron',
    'parts.stretcher': 'Stretcher',
    'parts.end_panel': 'End panel',
    'parts.modesty_panel': 'Modesty panel',
    'parts.lower_shelf': 'Lower shelf',
    'parts.trestle_upright': 'Trestle upright',
    'parts.trestle_foot': 'Trestle foot',
    'parts.trestle_cleat': 'Trestle cleat',
    'parts.pedestal_side': 'Pedestal side',
    'parts.pedestal_plate': 'Pedestal plate',
    'parts.drawer_runner': 'Drawer runner',
    'parts.extra': '{name}',
};

/**
 * English name of a part. An unknown `nameKey` is returned as is, so a missing
 * entry shows up in exports instead of failing them.
 */
export function partNameEn(
    nameKey: string,
    nameParams: Record<string, string | number> = {},
): string {
    if (!Object.hasOwn(PART_NAMES_EN, nameKey)) return nameKey;
    const template = PART_NAMES_EN[nameKey] as string;
    // A missing param drops out together with the space before it; the values
    // themselves (a user-supplied extra part name) are never rewritten.
    return template
        .replace(/\s*\{(\w+)\}/g, (match, name: string) => {
            const value = nameParams[name];
            if (value === undefined) return '';
            return match.replace(/\{\w+\}/, String(value));
        })
        .trim();
}
