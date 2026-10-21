import '@inertiajs/core';

// The shared Inertia props (01 §6, 15 §8), exactly what `HandleInertiaRequests::share`
// sends. `AuthUserData` and `BusinessPublicData` are generated from their PHP Data
// classes (`types/generated.d.ts`); the rest are the small shapes the middleware
// builds inline. Wire format is camelCase; `features` keeps the master §6.7 flag names.

export type FeatureFlags = {
    payments: boolean;
    whatsapp: boolean;
    sms: boolean;
    web_push: boolean;
    google_login: boolean;
    dxf_import: boolean;
    walkthrough_camera: boolean;
    captcha: boolean;
};

export type FlashMessages = {
    success: string | null;
    error: string | null;
    info: string | null;
    warning: string | null;
};

export type HealthBanner = {
    key: string;
    /** Translation key `admin.health.{key}.{status}`. */
    messageKey: string;
};

export type SharedPageProps = {
    app: { name: string; logoUrl: string | null; version: string };
    auth: { user: App.Domain.Identity.Data.AuthUserData | null };
    business: App.Domain.Settings.Data.BusinessPublicData;
    features: FeatureFlags;
    /** Already-translated strings. */
    flash: FlashMessages;
    i18n: { locale: string; hash: string };
    /** Open state of the sidebar, from its cookie. */
    sidebarOpen: boolean;
    /** Authenticated users only. */
    unreadNotifications?: number;
    /** Optional prop (partial reloads only); `null` unless the user is active staff (11 §4). */
    staffCounters?: { submitted: number; toCall: number } | null;
    /** Authenticated users only; empty without `settings.manage` (11 §4). */
    healthBanners?: HealthBanner[];
};

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: SharedPageProps;
    }
}
