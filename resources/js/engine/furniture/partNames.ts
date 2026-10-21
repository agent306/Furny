/**
 * English part names for exports (07 §1.6), mirroring `resources/lang/en/parts.php`.
 * Each entry is a template: `{param}` placeholders are filled from the part's
 * `nameParams`, and a missing param simply drops out ("Back panel" when the
 * back is not split). `{piece}` numbers the pieces of a long panel split at
 * seams ("Top 1", "Top 2"; spec 19, Task 40); behind a second param it reads
 * "Fixed shelf 2 – piece 3" and drops out together with its "– piece" lead-in.
 */
export const PART_NAMES_EN: Record<string, string> = {
    'parts.side_left': 'Left side',
    'parts.side_right': 'Right side',
    'parts.top': 'Top {piece}',
    'parts.bottom': 'Bottom {piece}',
    'parts.back': 'Back panel {n}',
    'parts.partition': 'Partition {n}',
    'parts.fixed_shelf': 'Fixed shelf {n} – piece {piece}',
    'parts.shelf': 'Shelf {n}',
    'parts.plinth_front': 'Plinth front {piece}',
    'parts.plinth_back': 'Plinth back {piece}',
    'parts.plinth_return': 'Plinth return {n}',
    'parts.countertop': 'Countertop {piece}',
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
    'parts.table_top': 'Table top {piece}',
    'parts.table_top_layer': 'Table top layer {n} – piece {piece}',
    'parts.table_leg': 'Leg',
    'parts.apron': 'Apron {piece}',
    'parts.stretcher': 'Stretcher {piece}',
    'parts.end_panel': 'End panel',
    'parts.modesty_panel': 'Modesty panel {piece}',
    'parts.lower_shelf': 'Lower shelf {piece}',
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
        .replace(/(?:\s+– piece)?\s*\{(\w+)\}/g, (match, name: string) => {
            const value = Object.hasOwn(nameParams, name)
                ? nameParams[name]
                : undefined;
            if (value === undefined) return '';
            // function replacers: `$&`, `$$` etc. in a user-supplied name stay literal
            return match.replace(/\{\w+\}/, () => String(value));
        })
        .trim();
}
