import type { IconName } from '@/lib/icons';

export type BreadcrumbItem = {
    /** Already translated. */
    title: string;
    /** The last crumb (the current page) has none. */
    href?: string;
};

/** The sidebar badge a nav item shows, read from the shared `staffCounters` prop (11 §4). */
export type NavCounter = 'submitted' | 'toCall';

export type NavItem = {
    key: string;
    /** Translation key of the visible label. */
    labelKey: string;
    /** The mobile tab bar label when it differs (`Home` for the dashboard). */
    tabLabelKey?: string;
    /** A Wayfinder URL (`route.url()`), never a hand-written one. */
    href: string;
    icon: IconName;
    /** The item is visible when the user passes ANY of these permissions or owner gates; omitted = everyone. */
    anyOf?: readonly string[];
    counter?: NavCounter;
    /** Active only on exactly this path, not on the paths below it. */
    exact?: boolean;
    /** Appears in the mobile tab bar (customer app, < 768 px). */
    tab?: boolean;
};

export type NavGroup = {
    key: string;
    /** Translation key of the group heading; omitted for the ungrouped top group. */
    labelKey?: string;
    items: readonly NavItem[];
};
